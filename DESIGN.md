# Lean Workbench - Design Document

## Overview

Lean Workbench is a multi-user web application that gives each user an
isolated VS Code (OpenVSCode Server) instance running in a bubblewrap
sandbox, with a Lean 4 toolchain pre-installed. Users authenticate via
GitHub OAuth, manage named projects through a React UI, and edit code in
a full VS Code session embedded in an iframe.

## Architecture

```
Browser
  |
  | :3000
  v
nginx (reverse proxy, port 3000)
  |
  |-- /{user}/{project}/_vs/*  -->  openvscode-server (port 3010+N, inside bwrap)
  |-- everything else          -->  spawner (Express, port 3002)
```

Three processes run inside the container:

1. **nginx** (foreground, keeps container alive) - reverse proxy on port
   3000. Routes VS Code traffic to per-session openvscode-server
   instances. Routes everything else to the spawner.

2. **spawner** (background) - Express.js app on port 3002. Serves HTML
   pages, handles auth, project CRUD API, and spawns/manages
   openvscode-server processes.

3. **openvscode-server** (one per active project session) - spawned on
   demand inside a bwrap sandbox, listening on ports 3010, 3011, ...

## Request Flow

### Login

1. `GET /auth/github` -> Passport redirects to GitHub OAuth
2. GitHub calls back to `GET /auth/github/callback`
3. Passport upserts user in SQLite via `upsertGithubUser()`
4. Redirect to `/{username}/` (profile page)

In dev mode (NODE_ENV != "production"), `GET /dev-login` creates/logs in
a "dev" user without OAuth.

### Opening a Project Session

1. User clicks a project link on their profile page
2. `GET /{username}/{projectName}/` hits the spawner
3. Auth check: must be logged in, must own the username
4. DB lookup: find the project by (user_id, name), get its UUID
5. `spawnProject(username, projectName, projectId)`:
   a. If session already alive (in-memory map + kill(pid,0)), return it
   b. Allocate a port (incrementing counter from 3010)
   c. Create workspace directory on disk
   d. Write VS Code machine settings (disable workspace trust, etc.)
   e. `spawn("bwrap", [...])` with the openvscode-server binary
   f. Write an nginx location block to `/etc/nginx/user-routes/{user}-{id}.conf`
   g. `nginx -s reload`
   h. `waitForPort(port)` - poll TCP connect until server is ready (10s timeout)
6. Render `session.ejs` - an iframe pointing at `/{username}/{projectName}/_vs/`
7. nginx proxies the iframe traffic to the openvscode-server instance

## File Map

### Backend

**`spawner.ts`** (540 lines) - Main entry point. Express app with:
- GitHub OAuth via Passport
- Session management (express-session, in-memory store)
- bwrap process spawning and lifecycle
- Dynamic nginx config generation and reload
- HTML page rendering (EJS templates)
- Project CRUD REST API
- Dev login route

**`db.ts`** (191 lines) - SQLite layer (better-sqlite3). Schema:
- `users` (id, username, timestamps)
- `auth_github` (user_id, github_id, github_username, display_name, email, avatar_url)
- `admins` (user_id) - flag table
- `projects` (id [UUID], user_id, name, path, timestamps; unique on user_id+name)

### Frontend

**`client/src/profile.tsx`** - React entry point. Reads `window.__DATA__`
and mounts `ProfilePage`.

**`client/src/ProfilePage.tsx`** (302 lines) - Project management UI:
create, rename, delete projects. Admin section shows active sessions.

**`client/src/api.ts`** (66 lines) - Fetch wrappers for
`/api/projects` and `/api/status`.

**`client/vite.config.ts`** - Builds to `public/dist/profile.js`. Base
path `/static/dist/`. Dev server proxies API routes to spawner.

### Templates

**`public/landing.ejs`** - Homepage. Shows login link or welcome
message with link to profile.

**`public/profile.ejs`** - Profile page shell. Injects
`window.__DATA__` and loads the React bundle.

**`public/session.ejs`** - VS Code session wrapper. Navbar with
breadcrumbs + full-height iframe to the `_vs/` path.

**`public/style.css`** - All styling. Navbar, avatar dropdown, project
list, login button, session iframe layout.

### Infrastructure

**`Dockerfile`** (122 lines) - Single-stage build on
`buildpack-deps:22.04-curl`. Installs:
- Node 22 (via nvm), bubblewrap, nginx, build tools
- OpenVSCode Server v1.106.3 (gitpod release)
- Lean via elan (stable toolchain, pinned to concrete version)
- lean4 VS Code extension (v0.0.221)
- Builds the React client, installs spawner dependencies

**`nginx.conf`** - Listens on 3000, daemon off. Includes dynamic
per-user route files from `/etc/nginx/user-routes/*.conf`. Default
location proxies to spawner on 3002. WebSocket upgrade map for VS Code.

**`start.sh`** - Container entrypoint. Seeds the elan volume on first
run, starts spawner in background, runs nginx in foreground.

**`Makefile`** - Three targets:
- `build`: docker build
- `serve`: docker run with SYS_ADMIN + seccomp/apparmor/systempaths
  unconfined, three volumes (data, workspaces, elan), env file
- `dev`: runs spawner directly (no Docker/nginx/bwrap)

## Sandbox (bwrap) Configuration

Each openvscode-server runs inside bubblewrap with:

**Read-only mounts**: `/usr`, `/lib`, `/lib64`, `/bin`, `/etc`,
openvscode-server root, extensions dir

**Read-write mounts**: elan toolchain at `/home/elan`, project workspace
at `/workspace/{projectId}/lean-project`

**Synthetic mounts**: `/proc` (proc), `/dev` (dev), `/tmp` (tmpfs),
`/workspace` (tmpfs with project subdirectory)

**Environment**: cleared (`--clearenv`), then PATH (elan + system bins),
ELAN_HOME, HOME (set to `/workspace/{projectId}`)

**Namespace isolation**: `--unshare-user`, `--unshare-pid`,
`--unshare-uts`, `--unshare-cgroup`. Network is NOT unshared (the
server must listen on a TCP port visible to nginx).

**Docker requirements**: `--cap-add SYS_ADMIN` plus seccomp, apparmor,
and systempaths unconfined.

## Data Storage

**SQLite** (`/data/podserver.db`) - users, auth, projects. WAL mode.

**Workspace files** (`/home/workspace/{username}/{projectId}/`) -
persistent across container restarts via Docker volume. Contains the
Lean project files and `.vscode-data/` server state. Not cleaned up on
project delete (intentional).

**Elan volume** (`/home/elan-volume/`) - Lean toolchain. Seeded from
image on first run, persisted via Docker volume.

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | no | Landing page |
| GET | `/auth/github` | no | Start OAuth flow |
| GET | `/auth/github/callback` | no | OAuth callback |
| GET | `/logout` | no | Destroy session |
| GET | `/dev-login` | no | Dev-only login |
| GET | `/api/health` | no | Health check |
| GET | `/api/status` | admin | Active sessions |
| GET | `/api/projects` | yes | List user's projects |
| POST | `/api/projects` | yes | Create project |
| PUT | `/api/projects/:id` | yes | Rename project |
| DELETE | `/api/projects/:id` | yes | Delete project |
| GET | `/:username/` | owner | Profile page |
| GET | `/:username/:project/` | owner | Session page (spawns VS Code) |

## Known Limitations

- **In-memory session store**: doesn't survive restarts, won't scale
  to multiple processes.
- **Port allocation**: simple incrementing counter, no reuse. Ports
  are not reclaimed when sessions die.
- **No network isolation**: bwrap can't use `--unshare-net` because
  openvscode-server needs a TCP port visible to nginx. A Unix domain
  socket approach would fix this.
- **No session expiry**: idle sessions run forever until the container
  restarts.
- **No workspace cleanup**: deleting a project removes the DB row but
  leaves files on disk.
