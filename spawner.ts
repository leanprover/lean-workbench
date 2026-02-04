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
  upsertGithubUser, getUserById, ensureUser, getAvatarUrl,
  getProjectsByUser, getProjectById, getProjectByUserAndName,
  createProject, updateProject, deleteProject,
  PROJECT_NAME_RE,
} from "./db.ts";
import type { UserRow } from "./db.ts";

const OPENVSCODE_SERVER_ROOT = "/home/.openvscode-server";
const EXTENSIONS_DIR = "/home/extensions";
const ELAN_BASE = "/home/elan";
const WORKSPACE_BASE = process.env.WORKSPACE_BASE ?? "/home/workspace";
const NGINX_ROUTES_DIR = process.env.NGINX_ROUTES_DIR ?? "/etc/nginx/user-routes";
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;
const BASE_PORT = 3010;

interface SessionInfo {
  port: number;
  pid: number;
  workspace: string;
  projectId: string;
}

// In-memory state: "username/projectId" -> { port, pid, workspace, projectId }
const sessions: Record<string, SessionInfo> = {};
let nextPort = BASE_PORT;

function sessionKey(username: string, projectId: string): string {
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
  const confPath = path.join(NGINX_ROUTES_DIR, `${username}-${projectId}.conf`);
  fs.writeFileSync(confPath, conf);
}

function removeNginxConf(username: string, projectId: string): void {
  const confPath = path.join(NGINX_ROUTES_DIR, `${username}-${projectId}.conf`);
  try { fs.unlinkSync(confPath); } catch { }
}

function reloadNginx(): void {
  try {
    execSync("nginx -s reload");
  } catch (err) {
    console.warn("[spawner] nginx reload failed (expected in local dev):", (err as Error).message);
  }
}

async function spawnProject(username: string, projectName: string, projectId: string): Promise<{ info: SessionInfo; created: boolean }> {
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

  const workspace = path.join(WORKSPACE_BASE, username, projectId);
  fs.mkdirSync(workspace, { recursive: true });

  // Initialize the vscode config for this workspace
  const machineSettingsDir = path.join(workspace, ".vscode-data", "data", "Machine");
  const machineSettingsFile = path.join(machineSettingsDir, "settings.json");
  if (!fs.existsSync(machineSettingsFile)) {
    fs.mkdirSync(machineSettingsDir, { recursive: true });
    fs.writeFileSync(machineSettingsFile, JSON.stringify({ "security.workspace.trust.enabled": false, "workbench.startupEditor": "none" }));
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
      "--ro-bind", EXTENSIONS_DIR, EXTENSIONS_DIR,
      "--ro-bind", ELAN_BASE, ELAN_BASE,
      "--tmpfs", `${ELAN_BASE}/tmp`,
      "--tmpfs", "/workspace",
      "--dir", `/workspace/${projectId}`,
      "--bind", workspace, `/workspace/${projectId}/lean-project`,
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--clearenv",
      "--setenv", "ELAN_HOME", ELAN_BASE,
      "--setenv", "PATH", `${ELAN_BASE}/bin:/usr/local/bin:/usr/bin:/bin`,
      "--setenv", "HOME", `/workspace/${projectId}`,
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
      "--extensions-dir", EXTENSIONS_DIR,
      "--server-data-dir", `/workspace/${projectId}/lean-project/.vscode-data`,
      "--default-folder", `/workspace/${projectId}/lean-project`,
      `--server-base-path=/${username}/${encodeURIComponent(projectName)}/_vs/`,
    ],
    {
      stdio: "inherit",
      detached: true,
    },
  );

  // Handle async spawn errors (e.g. bwrap ENOENT on macOS)
  const spawnResult = await new Promise<"ok" | "error">((resolve) => {
    child.once("error", (err) => {
      console.warn("[spawner] bwrap spawn failed (expected in local dev):", err.message);
      resolve("error");
    });
    child.once("spawn", () => {
      resolve("ok");
    });
  });

  if (spawnResult === "error") {
    const info: SessionInfo = { port, pid: -1, workspace, projectId };
    sessions[key] = info;
    return { info, created: true };
  }

  child.unref();

  const info: SessionInfo = { port, pid: child.pid!, workspace, projectId };
  sessions[key] = info;

  writeNginxConf(username, projectName, projectId, port);
  reloadNginx();

  await waitForPort(port);

  return { info, created: true };
}

function killSession(username: string, projectId: string): void {
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
const PROFILE_TEMPLATE = fs.readFileSync(path.join(publicDir, "profile.ejs"), "utf-8");

// --- App setup ---
const app = express();
app.use("/static", express.static(publicDir));
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

// --- Dev login (non-production only) ---
if (process.env.NODE_ENV !== "production") {
  app.get("/dev-login", (req: Request, res: Response, next: NextFunction) => {
    const user = ensureUser("dev");
    req.login(user, (err) => {
      if (err) return next(err);
      res.redirect("/dev/");
    });
  });
}

// --- Pages ---
app.get("/", (req: Request, res: Response) => {
  const u = req.user as UserRow | undefined;
  const user = u ? { username: u.username, avatarUrl: getAvatarUrl(u.id) } : null;
  const devMode = process.env.NODE_ENV !== "production";
  res.type("html").send(ejs.render(LANDING_TEMPLATE, { user, devMode }));
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/status", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  if (!user.is_admin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
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

// --- Helper: require auth (no username in URL) ---
function requireAuth(req: Request, res: Response): UserRow | null {
  if (!req.user) {
    res.status(401).json({ error: "Not logged in" });
    return null;
  }
  return req.user as UserRow;
}

// --- Project CRUD API ---
app.get("/api/projects", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const projects = getProjectsByUser(user.id);
  res.json(projects);
});

app.post("/api/projects", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  const trimmedName = name.trim();
  if (!PROJECT_NAME_RE.test(trimmedName)) {
    res.status(400).json({ error: "Name must start with a letter or digit and contain only letters, digits, hyphens, or underscores" });
    return;
  }

  try {
    const project = createProject(user.id, trimmedName);
    res.json(project);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) {
      res.status(409).json({ error: "A project with that name already exists" });
    } else {
      res.status(500).json({ error: `Failed to create project: ${err.message}` });
    }
  }
});

app.put("/api/projects/:projectId", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const projectId = req.params.projectId as string;

  const project = getProjectById(projectId);
  if (!project || project.user_id !== user.id) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const trimmedName = name.trim();
  if (!PROJECT_NAME_RE.test(trimmedName)) {
    res.status(400).json({ error: "Name must start with a letter or digit and contain only letters, digits, hyphens, or underscores" });
    return;
  }

  try {
    // Kill session if name changed (base path will be different)
    if (trimmedName !== project.name) {
      killSession(user.username, projectId);
    }
    updateProject(projectId, trimmedName);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) {
      res.status(409).json({ error: "A project with that name already exists" });
    } else {
      res.status(500).json({ error: "Failed to update project" });
    }
  }
});

app.delete("/api/projects/:projectId", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const projectId = req.params.projectId as string;

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

// --- Profile page ---
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
    res.status(403).send("Forbidden: you can only access your own profile.");
    return;
  }

  const projects = getProjectsByUser(loggedInUser.id);
  const avatarUrl = getAvatarUrl(loggedInUser.id);
  res.type("html").send(ejs.render(PROFILE_TEMPLATE, { username, avatarUrl, isAdmin: loggedInUser.is_admin, projects }));
});

// --- Project session page ---
app.get("/:username/:projectName/", async (req: Request, res: Response) => {
  const username = req.params.username as string;
  if (!USERNAME_RE.test(username)) {
    res.status(404).send("Not found");
    return;
  }

  const projectName = decodeURIComponent(req.params.projectName as string);

  if (!req.user) {
    res.redirect("/");
    return;
  }

  const loggedInUser = (req.user as UserRow);
  if (loggedInUser.username !== username) {
    res.status(403).send("Forbidden: you can only access your own sessions.");
    return;
  }

  const project = getProjectByUserAndName(loggedInUser.id, projectName);
  if (!project) {
    res.status(404).send("Project not found");
    return;
  }

  try {
    await spawnProject(username, project.name, project.id);
  } catch (err) {
    res.status(500).send("Failed to spawn session: " + (err as Error).message);
    return;
  }

  const avatarUrl = getAvatarUrl(loggedInUser.id);
  res.type("html").send(ejs.render(SESSION_TEMPLATE, {
    username,
    avatarUrl,
    projectName: project.name,
  }));
});

const HOST = "127.0.0.1";
const PORT = 3002;
app.listen(PORT, HOST, () => {
  console.log(`[spawner] Listening on ${HOST}:${PORT}`);
});
