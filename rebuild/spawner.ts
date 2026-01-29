import express from "express";
import type { Request, Response } from "express";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OPENVSCODE_SERVER_ROOT = "/home/.openvscode-server";
const WORKSPACE_BASE = "/home/workspace";
const NGINX_ROUTES_DIR = "/etc/nginx/user-routes";
const USERNAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;
const BASE_PORT = 3010;

interface UserInfo {
  port: number;
  pid: number;
  workspace: string;
}

// In-memory state: username -> { port, pid, workspace }
const users: Record<string, UserInfo> = {};
let nextPort = BASE_PORT;

function allocatePort(): number {
  return nextPort++;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeNginxConf(username: string, port: number): void {
  const conf = `location /user/${username}/ {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 86400;
}
`;
  const confPath = path.join(NGINX_ROUTES_DIR, `${username}.conf`);
  fs.writeFileSync(confPath, conf);
}

function reloadNginx(): void {
  execSync("nginx -s reload");
}

function spawnUser(username: string): { info: UserInfo; created: boolean } {
  let port: number;

  // Idempotent: if already spawned and alive, return existing info
  if (users[username]) {
    const existing = users[username];
    if (isAlive(existing.pid)) {
      return { info: existing, created: false };
    }
    // Process died — respawn on same port
    port = existing.port;
  } else {
    port = allocatePort();
  }

  const workspace = path.join(WORKSPACE_BASE, username);
  fs.mkdirSync(workspace, { recursive: true });

  const child = spawn(
    "bwrap",
    [
      "--ro-bind", "/usr", "/usr",
      "--ro-bind", "/lib", "/lib",
      "--ro-bind-try", "/lib64", "/lib64",
      "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/etc", "/etc",
      "--ro-bind", OPENVSCODE_SERVER_ROOT, OPENVSCODE_SERVER_ROOT,
      "--bind", workspace, workspace,
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--unshare-pid",
      "--die-with-parent",
      "--new-session",
      "--",
      `${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server`,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--without-connection-token",
      `--server-base-path=/user/${username}/`,
    ],
    {
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();

  const info: UserInfo = { port, pid: child.pid!, workspace };
  users[username] = info;

  writeNginxConf(username, port);
  reloadNginx();

  return { info, created: true };
}

const app = express();
app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/status", (_req: Request, res: Response) => {
  const status: Record<string, object> = {};
  for (const [name, info] of Object.entries(users)) {
    status[name] = {
      port: info.port,
      pid: info.pid,
      alive: isAlive(info.pid),
      workspace: info.workspace,
    };
  }
  res.json({ users: status });
});

app.post("/api/spawn", (req: Request, res: Response) => {
  const username: string = req.body?.username ?? "";
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({
      error: "invalid username",
      detail: "must match ^[a-z][a-z0-9_-]{0,30}$",
    });
    return;
  }

  try {
    const { info, created } = spawnUser(username);
    res.status(created ? 201 : 200).json({
      username,
      port: info.port,
      pid: info.pid,
      url: `/user/${username}/`,
      workspace: info.workspace,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const HOST = "127.0.0.1";
const PORT = 3002;
app.listen(PORT, HOST, () => {
  console.log(`[spawner] Listening on ${HOST}:${PORT}`);
});
