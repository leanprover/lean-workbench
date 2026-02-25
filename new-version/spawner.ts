import express from "express";
import type { Request, Response } from "express";
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";

const OPENVSCODE_SERVER_ROOT = "/home/.openvscode-server";
const WORKSPACE = "/home/workspace";
const NGINX_ROUTES_DIR = "/etc/nginx/user-routes";
const PORT = 3010;

let session: { port: number; pid: number } | null = null;

function waitForPort(port: number, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for port ${port}`));
        return;
      }
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(attempt, 200);
      });
    }
    attempt();
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeNginxConf(port: number): void {
  const conf = `location /session/_vs/ {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 86400;
    proxy_hide_header X-Frame-Options;
}
`;
  fs.writeFileSync(`${NGINX_ROUTES_DIR}/session.conf`, conf);
}

function reloadNginx(): void {
  execSync("nginx -s reload");
}

async function ensureSession(): Promise<void> {
  if (session && isAlive(session.pid)) return;

  const child = spawn(
    "bwrap",
    [
      "--ro-bind", "/usr", "/usr",
      "--ro-bind", "/lib", "/lib",
      "--ro-bind-try", "/lib64", "/lib64",
      "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/etc", "/etc",
      "--ro-bind", OPENVSCODE_SERVER_ROOT, OPENVSCODE_SERVER_ROOT,
      "--bind", WORKSPACE, "/workspace",
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--clearenv",
      "--setenv", "HOME", "/workspace",
      "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-uts",
      "--unshare-cgroup",
      "--die-with-parent",
      "--new-session",
      "--",
      `${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server`,
      "--host", "127.0.0.1",
      "--port", String(PORT),
      "--without-connection-token",
      "--server-base-path=/session/_vs/",
      "--default-folder", "/workspace",
    ],
    { stdio: "inherit", detached: true },
  );
  child.unref();

  session = { port: PORT, pid: child.pid! };

  writeNginxConf(PORT);
  reloadNginx();

  await waitForPort(PORT);
}

const app = express();

app.get("/", (_req: Request, res: Response) => {
  res.type("html").send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>podserver</title></head>
<body>
<h1>podserver</h1>
<p><a href="/session/">Open session</a></p>
</body></html>`);
});

app.get("/session/", async (_req: Request, res: Response) => {
  try {
    await ensureSession();
  } catch (err) {
    res.status(500).send("Failed to start session: " + (err as Error).message);
    return;
  }

  res.type("html").send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>session - podserver</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  nav { height: 36px; background: #1e1e1e; color: #ccc; display: flex; align-items: center; padding: 0 12px; font-family: system-ui; font-size: 13px; }
  nav a { color: #569cd6; text-decoration: none; }
  nav .spacer { flex: 1; }
  iframe { width: 100%; height: calc(100% - 36px); border: none; display: block; }
</style></head>
<body>
<nav><span>podserver</span><span class="spacer"></span><a href="/">Home</a></nav>
<iframe src="/session/_vs/"></iframe>
</body></html>`);
});

app.listen(3002, "127.0.0.1", () => {
  console.log("[spawner] Listening on 127.0.0.1:3002");
});
