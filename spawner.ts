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
import { upsertGithubUser, getUserById, ensureUser } from "./db.js";
import type { UserRow } from "./db.js";

const OPENVSCODE_SERVER_ROOT = "/home/.openvscode-server";
const WORKSPACE_BASE = "/home/workspace";
const NGINX_ROUTES_DIR = "/etc/nginx/user-routes";
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;
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

function writeNginxConf(username: string, port: number): void {
  const conf = `location /${username}/_vs/ {
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

async function spawnUser(username: string): Promise<{ info: UserInfo; created: boolean }> {
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
      `--server-base-path=/${username}/_vs/`,
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

  await waitForPort(port);

  return { info, created: true };
}

// --- Templates ---
const publicDir = path.join(import.meta.dirname, "public");
const LANDING_TEMPLATE = fs.readFileSync(path.join(publicDir, "landing.ejs"), "utf-8");
const SESSION_TEMPLATE = fs.readFileSync(path.join(publicDir, "session.ejs"), "utf-8");

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

app.get("/:username/", async (req: Request, res: Response) => {
  const username = req.params.username as string;
  if (!USERNAME_RE.test(username)) {
    res.status(404).send("Not found");
    return;
  }

  // Require login
  if (!req.user) {
    res.redirect("/");
    return;
  }

  // Require matching username
  const loggedInUser = (req.user as UserRow).username;
  if (loggedInUser !== username) {
    res.status(403).send("Forbidden: you can only access your own session.");
    return;
  }

  // Auto-spawn the user's VS Code session
  try {
    await spawnUser(username);
  } catch (err) {
    res.status(500).send("Failed to spawn session: " + (err as Error).message);
    return;
  }

  res.type("html").send(ejs.render(SESSION_TEMPLATE, { username }));
});

const HOST = "127.0.0.1";
const PORT = 3002;
app.listen(PORT, HOST, () => {
  console.log(`[spawner] Listening on ${HOST}:${PORT}`);
});
