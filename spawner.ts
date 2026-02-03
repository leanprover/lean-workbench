import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import type { VerifyCallback } from "passport-oauth2";
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import ejs from "ejs";
import {
  upsertGithubUser, getUserById, ensureUser,
  getProjectsByUser, getProjectById, createProject, updateProject, deleteProject,
} from "./db.ts";
import type { UserRow } from "./db.ts";

const OPENVSCODE_SERVER_ROOT = "/home/.openvscode-server";
const WORKSPACE_BASE = "/home/workspace";
const NGINX_ROUTES_DIR = "/etc/nginx/user-routes";
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;
const BASE_PORT = 3010;

interface SessionInfo {
  port: number;
  pid: number;
  workspace: string;
  projectId: number;
}

// In-memory state: "username/projectId" -> { port, pid, workspace, projectId }
const sessions: Record<string, SessionInfo> = {};
let nextPort = BASE_PORT;

function sessionKey(username: string, projectId: number): string {
  return `${username}/${projectId}`;
}

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
        setTimeout(attempt, 1000);
      });
    }
    attempt();
  });
}

function writeNginxConf(username: string, projectId: number, port: number): void {
  const conf = `location /${username}/${projectId}/_vs/ {
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
  const confPath = path.join(NGINX_ROUTES_DIR, `${username}-${projectId}.conf`);
  fs.writeFileSync(confPath, conf);
}

function removeNginxConf(username: string, projectId: number): void {
  const confPath = path.join(NGINX_ROUTES_DIR, `${username}-${projectId}.conf`);
  try { fs.unlinkSync(confPath); } catch { }
}

function reloadNginx(): void {
  execSync("nginx -s reload");
}

async function spawnProject(username: string, projectId: number): Promise<{ info: SessionInfo; created: boolean }> {
  const key = sessionKey(username, projectId);
  let port: number;

  // Idempotent: if already spawned and alive, return existing info
  if (sessions[key]) {
    const existing = sessions[key];
    if (isAlive(existing.pid)) {
      return { info: existing, created: false };
    }
    // Process died — respawn on same port
    port = existing.port;
  } else {
    port = allocatePort();
  }

  const workspace = path.join(WORKSPACE_BASE, username, String(projectId));
  fs.mkdirSync(workspace, { recursive: true });

  // Initialize the vscode config for this workspace
  const machineSettingsDir = path.join(workspace, ".vscode-data", "data", "Machine");
  const machineSettingsFile = path.join(machineSettingsDir, "settings.json");
  if (!fs.existsSync(machineSettingsFile)) {
    fs.mkdirSync(machineSettingsDir, { recursive: true });
    fs.writeFileSync(machineSettingsFile, JSON.stringify({ "security.workspace.trust.enabled": false }));
  }

  const child = spawn(
    "bwrap",
    [
      "--ro-bind", "/usr", "/usr",
      "--ro-bind", "/lib", "/lib",
      "--ro-bind-try", "/lib64", "/lib64",
      "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/etc", "/etc",
      "--ro-bind", OPENVSCODE_SERVER_ROOT, OPENVSCODE_SERVER_ROOT,
      "--bind", workspace, "/workspace",
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
      "--server-data-dir", "/workspace/.vscode-data",
      "--default-folder", "/workspace",
      `--server-base-path=/${username}/${projectId}/_vs/`,
    ],
    {
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();

  const info: SessionInfo = { port, pid: child.pid!, workspace, projectId };
  sessions[key] = info;

  writeNginxConf(username, projectId, port);
  reloadNginx();

  await waitForPort(port);

  return { info, created: true };
}

function killSession(username: string, projectId: number): void {
  const key = sessionKey(username, projectId);
  const session = sessions[key];
  if (session) {
    try { process.kill(session.pid); } catch { }
    delete sessions[key];
  }
  removeNginxConf(username, projectId);
  try { reloadNginx(); } catch { }
}

// --- Templates ---
const publicDir = path.join(import.meta.dirname, "public");
const LANDING_TEMPLATE = fs.readFileSync(path.join(publicDir, "landing.ejs"), "utf-8");
const SESSION_TEMPLATE = fs.readFileSync(path.join(publicDir, "session.ejs"), "utf-8");
const PROJECTS_TEMPLATE = fs.readFileSync(path.join(publicDir, "projects.ejs"), "utf-8");

// --- App setup ---
const app = express();
app.use(express.json());

// Session middleware
app.use(session({
  secret: "lean-workbench-demo-secret", // FIXME
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

// --- GitHub OAuth strategy ---
passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      callbackURL: process.env.CALLBACK_URL ?? "http://localhost:3000/auth/github/callback",
    },
    (accessToken: string, refreshToken: string, profile: any, done: VerifyCallback) => {
      try {
        const user = upsertGithubUser({
          github_id: parseInt(profile.id, 10),
          github_username: profile.username,
          display_name: profile.displayName,
          email: profile.emails?.[0]?.value,
          avatar_url: profile.photos?.[0]?.value,
        });
        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    },
  ),
);

passport.serializeUser((user, done) => done(null, (user as UserRow).id));
passport.deserializeUser((id, done) => {
  const user = getUserById(id as number);
  done(null, user ?? false);
});

// --- Helper: require auth + ownership ---
function requireOwner(req: Request, res: Response): UserRow | null {
  const username = req.params.username as string;
  if (!USERNAME_RE.test(username)) {
    res.status(404).send("Not found");
    return null;
  }
  if (!req.user) {
    res.status(401).json({ error: "Not logged in" });
    return null;
  }
  const user = req.user as UserRow;
  if (user.username !== username) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

// --- Auth routes ---
app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));

app.get(
  "/auth/github/callback",
  passport.authenticate("github", { failureRedirect: "/" }),
  (req: Request, res: Response) => {
    const username = (req.user as UserRow)?.username ?? "";
    res.redirect(`/${username}/`);
  },
);

app.get("/logout", (req: Request, res: Response, next: NextFunction) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
});

// --- Pages ---
app.get("/", (req: Request, res: Response) => {
  const user = req.user ? { username: (req.user as UserRow).username } : null;
  res.type("html").send(ejs.render(LANDING_TEMPLATE, { user }));
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/status", (_req: Request, res: Response) => {
  const status: Record<string, object> = {};
  for (const [key, info] of Object.entries(sessions)) {
    status[key] = {
      port: info.port,
      pid: info.pid,
      alive: isAlive(info.pid),
      workspace: info.workspace,
      projectId: info.projectId,
    };
  }
  res.json({ sessions: status });
});

// --- Project CRUD routes (before /:username/ to avoid conflicts) ---
app.post("/:username/projects", (req: Request, res: Response) => {
  const user = requireOwner(req, res);
  if (!user) return;

  const { name, description } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    const project = createProject(user.id, name.trim(), description?.trim() || undefined);
    res.json(project);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) {
      res.status(409).json({ error: "A project with that name already exists" });
    } else {
      res.status(500).json({ error: "Failed to create project" });
    }
  }
});

app.put("/:username/projects/:projectId", (req: Request, res: Response) => {
  const user = requireOwner(req, res);
  if (!user) return;

  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const project = getProjectById(projectId);
  if (!project || project.user_id !== user.id) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { name, description } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    updateProject(projectId, name.trim(), description ?? null);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) {
      res.status(409).json({ error: "A project with that name already exists" });
    } else {
      res.status(500).json({ error: "Failed to update project" });
    }
  }
});

app.delete("/:username/projects/:projectId", (req: Request, res: Response) => {
  const user = requireOwner(req, res);
  if (!user) return;

  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const project = getProjectById(projectId);
  if (!project || project.user_id !== user.id) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Kill session if running, remove nginx conf
  killSession(user.username, projectId);

  // Delete DB row (workspace files intentionally kept)
  deleteProject(projectId);

  res.json({ ok: true });
});

// --- Project list page ---
app.get("/:username/", (req: Request, res: Response) => {
  const username = req.params.username as string;
  if (!USERNAME_RE.test(username)) {
    res.status(404).send("Not found");
    return;
  }

  if (!req.user) {
    res.redirect("/");
    return;
  }

  const loggedInUser = (req.user as UserRow);
  if (loggedInUser.username !== username) {
    res.status(403).send("Forbidden: you can only access your own projects.");
    return;
  }

  const projects = getProjectsByUser(loggedInUser.id);
  res.type("html").send(ejs.render(PROJECTS_TEMPLATE, { username, projects }));
});

// --- Project session page ---
app.get("/:username/:projectId/", async (req: Request, res: Response) => {
  const username = req.params.username as string;
  if (!USERNAME_RE.test(username)) {
    res.status(404).send("Not found");
    return;
  }

  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) {
    res.status(404).send("Not found");
    return;
  }

  if (!req.user) {
    res.redirect("/");
    return;
  }

  const loggedInUser = (req.user as UserRow);
  if (loggedInUser.username !== username) {
    res.status(403).send("Forbidden: you can only access your own sessions.");
    return;
  }

  const project = getProjectById(projectId);
  if (!project || project.user_id !== loggedInUser.id) {
    res.status(404).send("Project not found");
    return;
  }

  try {
    await spawnProject(username, projectId);
  } catch (err) {
    res.status(500).send("Failed to spawn session: " + (err as Error).message);
    return;
  }

  res.type("html").send(ejs.render(SESSION_TEMPLATE, {
    username,
    projectId,
    projectName: project.name,
  }));
});

const HOST = "127.0.0.1";
const PORT = 3002;
app.listen(PORT, HOST, () => {
  console.log(`[spawner] Listening on ${HOST}:${PORT}`);
});
