import express from "express";
import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import {
  ensureUser, getUserById, getUserByUsername, getAvatarUrl,
  isAdmin as checkIsAdmin,
  getProjectsByUser, getProjectByUserAndName, createProject,
  getProjectById, updateProject, deleteProject, PROJECT_NAME_RE,
  type UserRow, type ProjectRow,
} from "./db.ts";

const OPENVSCODE_SERVER_ROOT = "/home/.openvscode-server";
const EXTENSIONS_DIR = "/home/extensions";
const DATA_DIR = "/data";
const ELAN_DIR = `${DATA_DIR}/elan`;
const WORKSPACES_DIR = `${DATA_DIR}/workspaces`;
const NGINX_ROUTES_DIR = "/etc/nginx/user-routes";
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;
const BASE_PORT = 3010;

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

// --- Session management ---

interface SessionInfo {
  port: number;
  pid: number;
  workspace: string;
  projectId: string;
}

let nextPort = BASE_PORT;
const sessions = new Map<string, SessionInfo>();

function sessionKey(username: string, projectId: string): string {
  return `${username}/${projectId}`;
}

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

function writeNginxConf(username: string, projectName: string, projectId: string, port: number): void {
  const encodedName = encodeURIComponent(projectName);
  const conf = `location /${username}/${encodedName}/_vs/ {
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
  fs.writeFileSync(`${NGINX_ROUTES_DIR}/${username}-${projectId}.conf`, conf);
}

function reloadNginx(): void {
  execSync("nginx -s reload");
}

function ensureMachineSettings(workspace: string): void {
  const machineSettingsDir = path.join(workspace, ".vscode-data", "data", "Machine");
  const machineSettingsFile = path.join(machineSettingsDir, "settings.json");
  if (!fs.existsSync(machineSettingsFile)) {
    fs.mkdirSync(machineSettingsDir, { recursive: true });
    fs.writeFileSync(machineSettingsFile, JSON.stringify({
      "security.workspace.trust.enabled": false,
      "workbench.startupEditor": "none",
      "files.watcherExclude": { "/home/elan/**": true },
    }, null, 2) + "\n");
  }
}

function killSession(username: string, projectId: string): void {
  const key = sessionKey(username, projectId);
  const s = sessions.get(key);
  if (!s) return;
  try {
    process.kill(s.pid);
  } catch {
    // already dead
  }
  sessions.delete(key);
  try {
    fs.unlinkSync(`${NGINX_ROUTES_DIR}/${username}-${projectId}.conf`);
    reloadNginx();
  } catch {
    // conf may not exist
  }
}

async function spawnProject(username: string, projectName: string, projectId: string): Promise<SessionInfo> {
  const key = sessionKey(username, projectId);
  const existing = sessions.get(key);
  if (existing && isAlive(existing.pid)) return existing;

  // Clean up stale entry
  if (existing) sessions.delete(key);

  const port = nextPort++;
  const workspace = path.join(WORKSPACES_DIR, username, projectId);
  fs.mkdirSync(workspace, { recursive: true });
  ensureMachineSettings(workspace);

  const encodedName = encodeURIComponent(projectName);
  const child = spawn(
    "bwrap",
    [
      "--ro-bind", "/usr", "/usr",
      "--ro-bind", "/lib", "/lib",
      "--ro-bind-try", "/lib64", "/lib64",
      "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/etc", "/etc",
      "--ro-bind", OPENVSCODE_SERVER_ROOT, OPENVSCODE_SERVER_ROOT,
      "--ro-bind", ELAN_DIR, "/home/elan",
      "--ro-bind", EXTENSIONS_DIR, EXTENSIONS_DIR,
      "--bind", workspace, "/workspace",
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--clearenv",
      "--setenv", "HOME", "/workspace",
      "--setenv", "ELAN_HOME", "/home/elan",
      "--setenv", "PATH", `/home/elan/bin:/usr/local/bin:/usr/bin:/bin`,
      "--unshare-user",
      "--unshare-pid",
      "--unshare-uts",
      "--unshare-cgroup",
      "--die-with-parent",
      "--new-session",
      "--",
      `${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server`,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--without-connection-token",
      `--server-base-path=/${username}/${encodedName}/_vs/`,
      "--default-folder", "/workspace",
      "--extensions-dir", EXTENSIONS_DIR,
      "--server-data-dir", "/workspace/.vscode-data",
    ],
    { stdio: "inherit", detached: true },
  );
  child.unref();

  const info: SessionInfo = { port, pid: child.pid!, workspace, projectId };
  sessions.set(key, info);

  writeNginxConf(username, projectName, projectId, port);
  reloadNginx();

  await waitForPort(port);
  return info;
}

// --- Auth helpers ---

function requireAuth(req: Request, res: Response): UserRow | null {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).send("Not logged in");
    return null;
  }
  const user = getUserById(userId);
  if (!user) {
    res.status(401).send("User not found");
    return null;
  }
  return user;
}

function requireOwner(req: Request, res: Response): UserRow | null {
  const { username } = req.params;
  if (!USERNAME_RE.test(username)) {
    res.status(404).send("Not found");
    return null;
  }
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.username !== username) {
    res.status(403).send("Forbidden");
    return null;
  }
  return user;
}

// --- Express app ---

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(import.meta.dirname!, "public"));

app.use(session({
  secret: "lean-workbench-dev-secret",
  resave: false,
  saveUninitialized: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use("/static", express.static(path.join(import.meta.dirname!, "public")));

// --- Auth routes ---

app.get("/dev-login", (req: Request, res: Response) => {
  const user = ensureUser("dev");
  req.session.userId = user.id;
  req.session.save(() => {
    res.redirect("/dev/");
  });
});

app.get("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

// --- API routes (must come before /:username/ params) ---

app.get("/api/projects", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  res.json(getProjectsByUser(user.id));
});

app.get("/api/status", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  if (!user.is_admin) {
    res.status(403).send("Forbidden");
    return;
  }
  const result: Record<string, { port: number; pid: number; alive: boolean; workspace: string; projectId: string }> = {};
  for (const [key, s] of sessions) {
    result[key] = { ...s, alive: isAlive(s.pid) };
  }
  res.json({ sessions: result });
});

app.post("/api/projects", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const { name } = req.body;
  if (!name || !PROJECT_NAME_RE.test(name)) {
    res.status(400).send("Invalid project name");
    return;
  }

  const existing = getProjectByUserAndName(user.id, name);
  if (existing) {
    res.status(409).send("Project already exists");
    return;
  }

  const project = createProject(user.id, name);
  res.json(project);
});

app.put("/api/projects/:projectId", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const project = getProjectById(req.params.projectId);
  if (!project || project.user_id !== user.id) {
    res.status(404).send("Project not found");
    return;
  }

  const { name } = req.body;
  if (!name || !PROJECT_NAME_RE.test(name)) {
    res.status(400).send("Invalid project name");
    return;
  }

  if (name !== project.name) {
    killSession(user.username, project.id);
  }

  updateProject(project.id, name);
  res.json({ ok: true });
});

app.delete("/api/projects/:projectId", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const project = getProjectById(req.params.projectId);
  if (!project || project.user_id !== user.id) {
    res.status(404).send("Project not found");
    return;
  }

  killSession(user.username, project.id);
  deleteProject(project.id);
  res.json({ ok: true });
});

// --- Page routes ---

app.get("/", (req: Request, res: Response) => {
  let user: { username: string } | null = null;
  if (req.session.userId) {
    const u = getUserById(req.session.userId);
    if (u) user = { username: u.username };
  }
  res.render("landing", { user });
});

app.get("/:username/", (req: Request, res: Response) => {
  const user = requireOwner(req, res);
  if (!user) return;

  res.render("profile", { username: user.username, isAdmin: user.is_admin });
});

app.get("/:username/:projectName/", async (req: Request, res: Response) => {
  const user = requireOwner(req, res);
  if (!user) return;

  const { projectName } = req.params;
  const project = getProjectByUserAndName(user.id, projectName);
  if (!project) {
    res.status(404).send("Project not found");
    return;
  }

  try {
    await spawnProject(user.username, projectName, project.id);
  } catch (err) {
    res.status(500).send("Failed to start session: " + (err as Error).message);
    return;
  }

  res.render("session", { username: user.username, projectName });
});

app.listen(3002, "127.0.0.1", () => {
  console.log("[spawner] Listening on 127.0.0.1:3002");
});
