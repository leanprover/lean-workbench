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
  const conf = `location /user/${username}/_vs/ {
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
      `--server-base-path=/user/${username}/_vs/`,
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

const LANDING_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>podserver</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #333; }
  h1 { margin-bottom: 4px; }
  h1 + p { color: #666; margin-top: 0; }
  form { display: flex; gap: 8px; margin: 20px 0; }
  input[type=text] { flex: 1; padding: 8px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
  button { padding: 8px 16px; font-size: 14px; background: #0078d4; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  button:hover { background: #005ea2; }
  #error { color: #c00; margin: 8px 0; display: none; }
  #users { margin-top: 24px; }
  #users a { display: block; padding: 6px 0; color: #0078d4; text-decoration: none; }
  #users a:hover { text-decoration: underline; }
  #no-users { color: #999; display: none; }
</style>
</head>
<body>
<h1>podserver</h1>
<p>Multi-user sandboxed VS Code server.</p>

<h2>Launch a session</h2>
<form id="launch-form">
  <input type="text" id="username" placeholder="username" pattern="[a-z][a-z0-9_-]{0,30}" required autofocus>
  <button type="submit">Launch</button>
</form>
<div id="error"></div>

<h2>Active users</h2>
<div id="users"><span id="no-users">No active users.</span></div>

<script>
const form = document.getElementById('launch-form');
const input = document.getElementById('username');
const errorDiv = document.getElementById('error');
const usersDiv = document.getElementById('users');
const noUsers = document.getElementById('no-users');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorDiv.style.display = 'none';
  const username = input.value.trim();
  if (!username) return;
  try {
    const res = await fetch('/api/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorDiv.textContent = data.error + (data.detail ? ': ' + data.detail : '');
      errorDiv.style.display = 'block';
      return;
    }
    window.location = data.url;
  } catch (err) {
    errorDiv.textContent = 'Request failed: ' + err.message;
    errorDiv.style.display = 'block';
  }
});

async function loadUsers() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const alive = Object.entries(data.users).filter(([, u]) => u.alive);
    if (alive.length === 0) {
      noUsers.style.display = 'inline';
      return;
    }
    noUsers.style.display = 'none';
    usersDiv.innerHTML = '';
    for (const [name] of alive) {
      const a = document.createElement('a');
      a.href = '/user/' + name + '/';
      a.textContent = name;
      usersDiv.appendChild(a);
    }
  } catch {}
}

loadUsers();
</script>
</body>
</html>`;

const app = express();
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.type("html").send(LANDING_HTML);
});

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

app.get("/user/:username/", (req: Request, res: Response) => {
  const username = req.params.username;
  if (!USERNAME_RE.test(username)) {
    res.status(404).send("Not found");
    return;
  }
  res.type("html").send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${username} - podserver</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  nav { height: 36px; background: #1e1e1e; color: #ccc; display: flex; align-items: center; padding: 0 12px; font-family: system-ui, sans-serif; font-size: 13px; border-bottom: 1px solid #333; }
  nav .brand { color: #999; }
  nav .sep { margin: 0 8px; color: #555; }
  nav .user { color: #ddd; }
  nav .spacer { flex: 1; }
  nav a { color: #569cd6; text-decoration: none; font-size: 13px; }
  nav a:hover { text-decoration: underline; }
  iframe { width: 100%; height: calc(100% - 36px); border: none; display: block; }
</style>
</head>
<body>
<nav>
  <span class="brand">podserver</span>
  <span class="sep">|</span>
  <span class="user">${username}</span>
  <span class="spacer"></span>
  <a href="/">Home</a>
</nav>
<iframe src="/user/${username}/_vs/"></iframe>
</body>
</html>`);
});

const HOST = "127.0.0.1";
const PORT = 3002;
app.listen(PORT, HOST, () => {
  console.log(`[spawner] Listening on ${HOST}:${PORT}`);
});
