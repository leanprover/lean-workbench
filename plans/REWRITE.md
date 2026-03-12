# Implementation Plan

Status: Completed. Might be of historical interest.

Incremental reconstruction of Lean Workbench from scratch. Each step
produces a working system that the user will manually tested before
moving on.

Reference code is in `old-version/`. Follow `DESIGN.md` for structure.
Put the new version in `new-version/`.

---

## Step 1 — Bare openvscode-server in Docker

**Goal**: Minimal Dockerfile that runs openvscode-server directly (no
nginx, no spawner, no bwrap). Single user, single session. Workspace
is a host directory bind-mounted in.

**Files to create**:
- `Dockerfile` — based on `buildpack-deps:22.04-curl`, install Node 22
  (via nvm or nodesource), download openvscode-server v1.106.3 release
  tarball. Entrypoint runs openvscode-server directly on port 3000 with
  `--without-connection-token`.
- `Makefile` — `build` and `serve` targets. `serve` bind-mounts
  `/tmp/lean-workbench-workspace` to the server's default folder.

**What to test**: Browse to `localhost:3000`. VS Code should load and
you can edit files in the mounted workspace. Record baseline startup
time.

**What this isolates**: Whether openvscode-server itself is slow to
start, independent of everything we layer on top.

---

## Step 1b — Workspace file-count stress test

**Goal**: Test whether VS Code startup time scales with the number of
files in the workspace. Run Step 1 multiple times against workspaces
of varying sizes.

**Files to create**:
- `scripts/gen-workspace.sh` — takes one argument: a target directory.
  Clears the directory, then generates 1000 text files (~2–4 KB each)
  spread across a nested hierarchy resembling a real project: e.g.
  `src/`, `lib/`, `test/`, with 3–4 levels of nesting. Files contain
  lorem ipsum filler (not empty stubs — VS Code may behave differently
  on empty files).

**How to test**:
1. `scripts/gen-workspace.sh /tmp/lean-workbench-workspace`
2. `make serve`
3. Browse to `localhost:3000`, record time to interactive.
4. Stop the container.

Compare against the empty-workspace time from Step 1. If startup is
significantly slower, the file watcher or indexer is likely the
bottleneck (and the fix may be a `files.watcherExclude` setting or
similar). If it's about the same, workspace size is not the issue.

---

## Step 2 — Add nginx reverse proxy

**Goal**: Put nginx in front of openvscode-server. The spawner doesn't
exist yet; openvscode-server is still started directly by the
entrypoint. This introduces the proxy layer.

**Files to create/modify**:
- `nginx.conf` — listen on 3000, proxy to openvscode-server on 3001.
  Include WebSocket upgrade map. Include the
  `/etc/nginx/user-routes/*.conf` pattern (empty for now).
- `start.sh` — start openvscode-server on port 3001 in background,
  then `exec nginx` in foreground.
- `Dockerfile` — add nginx install, copy nginx.conf and start.sh.

**What to test**: Browse to `localhost:3000`, VS Code loads through
nginx. Compare startup time to Step 1.

**What this isolates**: Latency added by the nginx proxy layer.

---

## Step 3 — Add the spawner (single hardcoded session, no auth)

**Goal**: Introduce the Express spawner that dynamically spawns
openvscode-server on demand, writes the nginx route config, and
reloads nginx. No auth, no database, no bwrap — just a single session
at a hardcoded path like `/session/_vs/`.

**Files to create/modify**:
- `spawner.ts` — minimal Express app on port 3002. One route
  `GET /session/` that spawns openvscode-server (bare, no bwrap),
  writes an nginx conf for `/session/_vs/`, reloads nginx, waits for
  port, then serves an HTML page with an iframe. Include `waitForPort`.
  Use `stdio: "inherit"` on the child process.
- `package.json` — express dependency, `"type": "module"`.
- `start.sh` — start spawner in background, then nginx in foreground
  (no longer starts openvscode-server directly).
- `nginx.conf` — default location proxies to spawner on 3002.
- `Dockerfile` — copy spawner files, npm install.

**What to test**: Browse to `localhost:3000/session/`. Spawner starts
openvscode-server, VS Code loads in iframe. Compare startup time.

**What this isolates**: Overhead of on-demand spawning + nginx reload +
waitForPort.

---

## Step 4 — Add bwrap sandboxing

**Goal**: Wrap the openvscode-server spawn in bubblewrap. No Lean
toolchain yet — just the minimal bwrap mounts needed for
openvscode-server to function.

**Files to modify**:
- `spawner.ts` — change `spawn("openvscode-server", ...)` to
  `spawn("bwrap", [...])` with the sandbox mounts from DESIGN.md
  (ro-bind system dirs, proc, dev, tmpfs /tmp, --unshare-user/pid/uts/cgroup,
  --clearenv, --setenv HOME/PATH). Workspace bind-mounted into sandbox.
- `Dockerfile` — add `bubblewrap` to apt install.
- `Makefile` — `serve` target needs `--cap-add SYS_ADMIN
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined
  --security-opt systempaths=unconfined`.

**What to test**: Same as Step 3 but openvscode-server is now inside
bwrap. Compare startup time.

**What this isolates**: Overhead of bwrap namespace setup and
restricted filesystem.

---

Notes: this worked, and had acceptable startup time, although there were errors such as

[15:34:55] Kt [Error]: Unable to resolve nonexistent file '/workspace/.openvscode-server/extensions'

perhaps these are expected.

## Step 5 — Add Lean toolchain and VS Code extension

**Goal**: Install elan/Lean and the lean4 VS Code extension in the
Docker image. Mount the toolchain into the bwrap sandbox. Switch from
ad-hoc workspace volume to the unified `/tmp/lean-workbench` host directory
described in `LEAN-TOOLS.md`.

**Files to modify**:
- `Dockerfile` — install elan, pin the stable toolchain, install
  lean4 extension into `/home/extensions`. Add strace and other debug
  tools.
- `spawner.ts` — add `--ro-bind /data/elan /home/elan` (read-only),
  `--ro-bind /home/extensions /home/extensions`, `--setenv ELAN_HOME
  /home/elan`. Add `--extensions-dir`, `--server-data-dir`, and
  `--default-folder` flags to openvscode-server args. Write machine
  settings to `.vscode-data/data/Machine/settings.json` inside the
  workspace (disable workspace trust, suppress Welcome tab, exclude
  elan from file watcher). If the project is associated with an
  installation, add a `--ro-bind` overlay for `.lake/packages`.
- `start.sh` — seed `/data/elan/` from the image-baked copy on first
  run (so a fresh volume gets a working elan + default toolchain).
- `Makefile` — replace the old workspace volume with a single volume:
  `-v /tmp/lean-workbench:/data`. Create `/tmp/lean-workbench/workspaces/` on
  the host if needed.

**What to test**: Open a session, verify Lean extension loads, create a
`.lean` file, verify Lean LSP starts. Compare startup time.

**What this isolates**: Whether the Lean toolchain / extension is the
source of startup slowness.

---

Testing notes: seems ok, although the multitude of files are no longer
present in the user's workspace. TODO: We aren't really exercising the
lean tooling by default, I'll have to manually follow the steps above.

## Step 6 — Multi-session support with port allocation

**Goal**: Support multiple concurrent sessions, each on its own port.
Still no auth — sessions are keyed by a username in the URL path
(`/{username}/_vs/`). Each user gets a workspace directory under
`/data/workspaces/<username>/` (created on demand by the spawner).

**Files to modify**:
- `spawner.ts` — in-memory session map (username -> {port, pid}).
  Port allocation counter from 3010. `isAlive()` check. Route pattern
  `GET /:username/` spawns or reuses session. Workspace bind is now
  `/data/workspaces/<username>/<project-uuid>` on the Docker side,
  mounted rw into the bwrap sandbox. Dynamic nginx conf per user.
  `killSession()` for cleanup.

**What to test**: Open `localhost:3000/alice/` and
`localhost:3000/bob/` in separate tabs. Each gets their own VS Code
instance with a separate workspace under `/data/workspaces/`. Verify
nginx routes correctly.

---

## Step 7 — SQLite database and dev-login auth

**Goal**: Add the database layer and authentication, but only dev-login
(no GitHub OAuth yet). Users and projects stored in SQLite.

**Files to create/modify**:
- `db.ts` — full schema from DESIGN.md (users, auth_github, admins,
  projects tables). All query functions.
- `spawner.ts` — add express-session middleware, dev-login route,
  requireAuth/requireOwner helpers. Sessions keyed by
  `username/projectId` instead of just username. Workspace dirs are
  `/data/workspaces/<username>/<project-uuid>/`. Landing page
  (`GET /`) with EJS. Profile page (`GET /:username/`). Session page
  (`GET /:username/:projectName/`).
- `package.json` — add better-sqlite3, dotenv, ejs, express-session.
- `public/landing.ejs`, `public/session.ejs`, `public/profile.ejs` —
  templates (can copy from old-version, stripping GitHub-specific UI).
- `public/style.css` — copy from old-version.
- `Makefile` — add `dev` target. (The `/data` volume already exists
    from Step 5; SQLite goes to `/data/db/lean-workbench.db`.)

**What to test**: `localhost:3000` shows landing page, `/dev-login`
logs in as "dev" user, profile page shows empty project list (no React
yet — server-rendered list is fine as placeholder), creating a project
via curl and navigating to it spawns VS Code.

---

## Step 8 — React project management UI

**Goal**: Add the React frontend for project CRUD.

**Files to create/modify**:
- `client/` directory — `package.json`, `vite.config.ts`,
  `tsconfig.json`, `src/profile.tsx`, `src/ProfilePage.tsx`,
  `src/api.ts`.
- `spawner.ts` — project CRUD API routes (GET/POST/PUT/DELETE
  `/api/projects`), static file serving for `/static`.
- `public/profile.ejs` — inject `window.__DATA__`, load React bundle.
- `Dockerfile` — build React client during image build.

**What to test**: Profile page renders React UI. Create, rename, delete
projects. Click a project to open its VS Code session.

---

## Step 9 — GitHub OAuth

**Goal**: Add real authentication via GitHub.

**Files to modify**:
- `spawner.ts` — Passport GitHub strategy, serialize/deserialize via
  DB user id, `/auth/github` and callback routes, logout route. Guard
  profile and session pages behind auth + ownership check.
- `package.json` — add passport, passport-github2.
- `.env.example` — document GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET.
- `public/landing.ejs` — login with GitHub button, avatar menu when
  logged in.

**What to test**: Full OAuth flow — login, redirect to profile, access
projects, logout. Verify another user can't access your sessions.

---

## Step 10 — Admin features and final polish

**Goal**: Admin status page, remaining UI polish, parity with
old-version.

**Files to modify**:
- `spawner.ts` — `GET /api/status` (admin-only), workspace volume
  mount in Makefile.
- `client/src/ProfilePage.tsx` — ActiveSessions component for admins.
- `public/landing.ejs`, `public/session.ejs` — avatar dropdown with
  profile/logout links, breadcrumb navigation.
- `public/style.css` — any remaining styling from old-version.
- `Dockerfile` — set `NODE_ENV=production`, final cleanup.
- `Makefile` — finalize all three targets (build, serve, dev).

**What to test**: Full feature parity with old-version. Admin can see
active sessions. All UI matches. Confirm final startup time and compare
against baseline from Step 1.
