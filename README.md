# Lean Workbench

This project aims to provide an online experience that facilitates
familiar (i.e. vscode with the lean4 extension) and novel interfaces
to the Lean proof assistant.

A core part of this is a multi-user sandboxed VS Code server. Each
user gets an isolated [OpenVSCode
Server](https://github.com/gitpod-io/openvscode-server) instance
inside a [bubblewrap](https://github.com/containers/bubblewrap)
sandbox, reverse-proxied through nginx.

The code here is still very much in progress and experimental!

## Table of contents

- [For administrators: production setup](#for-administrators-production-setup)
- [For developers: local setup](#for-developers-local-setup)
- [Architecture](#architecture)
- [Data volume layout](#data-volume-layout)
- [Security model](#security-model)

---

## For administrators: production setup

This section walks through setting up a Lean Workbench instance that
real users will connect to.

### Prerequisites

- A Linux server (or VM) with [Docker](https://docs.docker.com/get-docker/) installed
- A domain name or IP address that users will use to reach the server
- A [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) (created during setup below)

### Step 1: Install

Run the installer on your server:

```bash
curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh | bash
```

The installer will prompt for:
- **Data directory** (default: `~/.lean-workbench`) — where all
  persistent data (database, workspaces, Lean toolchains) is stored.
- **Port** (default: `8080`) — the port the server listens on.

It pulls the Docker image, and generates two Docker Compose files in
the data directory:
- `docker-compose.yml` — binds to `127.0.0.1` only (for initial
  setup, so the setup page is not exposed to the internet).
- `docker-compose.prod.yml` — binds to `0.0.0.0` (for production).

If the installer offers to start the service, say yes. Otherwise:

```bash
cd ~/.lean-workbench   # or wherever you chose
docker compose up -d
```

### Step 2: First-run setup (web UI)

Open `http://localhost:<port>` in a browser on the server (or via SSH
tunnel). You'll see the setup page, which has two steps:

**2a. Configure GitHub OAuth.** You need a GitHub OAuth App.
[Create one here](https://github.com/settings/developers) with these
settings:
- **Homepage URL:** `https://your-domain.example.com` (or your actual
  URL).
- **Authorization callback URL:**
  `https://your-domain.example.com/auth/github/callback` — the setup
  page shows the exact URL to use.

Copy the **Client ID** and **Client Secret** from GitHub into the
setup form and click **Save Configuration**.

**2b. Seed the data volume.** Click **Start Setup**. This runs a
script inside the container that:
1. Installs the [elan](https://github.com/leanprover/elan) Lean
   version manager.
2. Downloads Mathlib source and pre-compiled `.olean` files (~5 GB).
3. Creates project templates.

A progress bar and log output are shown in real time. This takes
5--30 minutes depending on network speed. When it finishes, the setup
page redirects to the landing page.

### Step 3: Switch to production

Stop the localhost-only service and start the production one:

```bash
cd ~/.lean-workbench
docker compose down
docker compose -f docker-compose.prod.yml up -d
```

The server is now accessible on all network interfaces. Put it behind
a reverse proxy (nginx, Caddy, etc.) with TLS if you want HTTPS.

### Updating

```bash
cd ~/.lean-workbench
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Uninstalling

```bash
./install.sh --uninstall
```

This stops the service and optionally removes the Docker image and
data directory.

### Backups

All persistent state is in the data directory
(default `~/.lean-workbench/data/`). Back up this directory to
preserve all user workspaces, the database, and Lean toolchains.

---

## For developers: local setup

### Prerequisites

- Docker installed and running.

### Option A: Dev mode without GitHub OAuth (simplest)

This is the fastest way to get a running instance for development.
No GitHub credentials needed.

```bash
make          # build the Docker image (~5 min first time)
make dev      # run in development mode
```

Open `http://localhost:3000`. You'll see the setup page.

1. **Skip the OAuth section** — it's optional in dev mode.
2. Click **Start Setup** to seed the data volume (downloads Mathlib,
   takes 5--30 min on first run).
3. When seeding finishes, you're redirected to the landing page.
4. Click **Dev Login** (top of the landing page) to log in as a
   user named "dev". The first user to log in automatically becomes
   an admin.
5. You're now on the profile page. Create a project, click it, and
   you'll get a full VS Code session with the Lean 4 extension.

Data is stored in `/tmp/lean-workbench/` on the host.

### Option B: Dev mode with GitHub OAuth

If you want to test the real OAuth flow locally:

1. [Create a GitHub OAuth App](https://github.com/settings/developers)
   with callback URL `http://localhost:3000/auth/github/callback`.

2. Create a `.env` file:

   ```bash
   cp .env.example .env
   ```

   Fill in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from the
   GitHub OAuth App you created.

3. Build and run:

   ```bash
   make          # build Docker image
   make dev      # run in development mode (auto-loads .env)
   ```

4. Open `http://localhost:3000`. On the setup page, enter the same
   Client ID and Secret, click **Save Configuration**, then **Start
   Setup** to seed.

5. After setup, click **Sign in with GitHub** on the landing page.

Both dev-login and GitHub login are available simultaneously in dev
mode.

### Makefile targets

| Target | What it does |
|--------|-------------|
| `make` or `make build` | Build the Docker image |
| `make dev` | Run with `NODE_ENV=development` (enables dev-login) |
| `make serve` | Run with `NODE_ENV=production` |
| `make enter` | Open a bash shell inside a fresh container (for debugging) |
| `make clean-install` | Rebuild image, wipe data volume, and reinstall from scratch |

### Resetting local state

To start completely fresh (wipe all projects, database, seeded
packages):

```bash
sudo rm -rf /tmp/lean-workbench
make dev    # will need to re-run setup
```

Or use `make clean-install`, which does the above plus a rebuild.

### Rebuilding after code changes

The application code is baked into the Docker image, so after editing
`spawner.ts`, `db.ts`, client code, etc., you need to rebuild:

```bash
make && make dev
```

Your data volume (`/tmp/lean-workbench/`) is preserved across
rebuilds, so you don't need to re-run the setup/seeding step unless
you wipe it.

---

## Architecture

```
Browser (port 3000)
    |
    v
nginx (reverse proxy, port 3000)
    |
    |-- /{user}/{project}/_vs/*  -->  openvscode-server (port 3010+N, in bwrap)
    |-- everything else          -->  spawner (Express, port 3002)
```

Three processes run inside the Docker container:

1. **nginx** (foreground, keeps container alive) — reverse proxy on
   port 3000. Routes VS Code WebSocket/HTTP traffic to per-session
   openvscode-server instances. Everything else goes to the spawner.

2. **spawner** (background) — Express.js app on port 3002. Handles
   authentication, project CRUD API, the setup UI, and spawning
   openvscode-server processes inside bwrap sandboxes.

3. **openvscode-server** (one per active session) — spawned on demand
   by the spawner when a user opens a project. Each runs inside its
   own bwrap sandbox on a dynamically allocated port (3010, 3011, ...).

### Key files

| File | Purpose |
|------|---------|
| `spawner.ts` | Express app: auth, project API, session spawning, nginx config |
| `db.ts` | SQLite schema and queries (users, projects, auth config, setup state) |
| `nginx.conf` | Reverse proxy config with dynamic per-session includes |
| `start.sh` | Container entrypoint: seeds elan, starts spawner + nginx |
| `scripts/seed-volume.sh` | First-run data volume setup (elan, Mathlib, templates) |
| `client/src/` | React frontend for project management (ProfilePage) |
| `public/*.ejs` | Server-rendered pages (landing, session, setup) |
| `install.sh` | End-user installer (generates Docker Compose files) |

### Request flow

**Login (dev mode):** `GET /dev-login` creates a "dev" user in the
database and sets a session cookie.

**Login (GitHub):** `GET /auth/github` redirects to GitHub OAuth.
The callback upserts the user in the database and sets a session
cookie.

**Opening a project:** `GET /{username}/{projectName}/` checks auth,
looks up the project in the database, then calls `spawnProject()`:
1. If a session is already alive (in-memory map + PID liveness check),
   reuse it.
2. Otherwise: allocate a port, create the workspace directory, write
   VS Code machine settings, spawn `bwrap` with openvscode-server
   inside, write an nginx route config, reload nginx, wait for the
   port to accept connections.
3. Render `session.ejs` — an iframe pointing at
   `/{username}/{projectName}/_vs/`.

---

## Data volume layout

All persistent state lives under a single host directory (mounted as
`/data` inside the container). Default: `/tmp/lean-workbench` for
`make dev`/`make serve`, or `~/.lean-workbench/data/` for
`install.sh` deployments.

```
/data/
  db/
    lean-workbench.db           SQLite database (users, projects, auth config)

  elan/                         Lean version manager (shared across all sessions)
    bin/elan, bin/lean
    toolchains/
      leanprover--lean4---v4.X.Y/

  package-sets/                 Pre-built shared dependencies (admin-managed)
    mathlib-v4.X.Y/
      mathlib/                  Source + compiled .oleans
      batteries/
      packages.txt              List of included packages

  templates/                    Project templates (discovered at runtime)
    hello/
      metadata.json             { "name": "Hello World", ... }
      lean-toolchain
      lakefile.toml
      Main.lean
    mathlib-v4.X.Y/
      metadata.json             { "name": "Lean + Mathlib", "packageSet": "mathlib-v4.X.Y" }
      lean-toolchain
      lakefile.toml
      lake-manifest.json
      Main.lean

  workspaces/                   Per-user project files
    alice/
      <project-uuid>/
        lean-toolchain
        lakefile.toml
        Main.lean
        .lake/packages/         Overlaid from shared package-sets
        .lake/build/            User's own build artifacts
        .vscode-data/           OpenVSCode Server state
```

---

## Security model

**Docker is used for packaging. Bubblewrap is the security
boundary.** Each user session runs in a `bwrap` sandbox with:

- **User namespace isolation** (`--unshare-user`, `--unshare-pid`,
  `--unshare-uts`, `--unshare-cgroup`). UID/GID are remapped to
  1000 inside the sandbox.
- **Read-only system mounts** (`/usr`, `/lib`, `/bin`, `/etc`).
- **Read-only Lean toolchain** (elan mounted at `/home/elan`).
- **Copy-on-write overlays** for shared packages (`--tmp-overlay`).
  Reads come from admin-managed package-set directories; writes go to
  an ephemeral tmpfs layer. Package-set files are root-owned on the
  host for overlayfs copy-up to work correctly inside the user
  namespace.
- **Writable workspace** for the user's project files.
- Network is **not** currently isolated (`openvscode-server` needs a
  TCP port visible to nginx).

The Docker container runs with `--cap-add SYS_ADMIN` and relaxed
seccomp/apparmor settings because bwrap needs these capabilities to
create user namespaces and overlay mounts.

---

## Archive

Earlier experiments (direct gitpod base image, manual VS Code build)
live in `archive/`.
