# Development

This document is meant for people developing the Lean workbench.
It describes how to locally run and test the workbench software.

## Prerequisites

- Docker installed and running.

## Running the workbench server

```bash
npm clean-install # install dependencies and generate types
make dev # build and run the container in development mode
```

Open `http://localhost:3000`. You'll see the setup page.

1. - **Skip the OAuth section** — it's optional in dev mode.
     This is the fastest way to get a running instance
   - **Or** [create a GitHub OAuth App](https://github.com/settings/developers)
     with callback URL `http://localhost:3000/api/auth/github/callback`.
     Enter the resulting credentials on the setup page.
2. Click **Start Setup** to seed the data volume (downloads Mathlib,
   takes 5--30 min on first run).
3. When seeding finishes, you're redirected to the landing page.

## Updating NPM packages

Make sure to pass `--install-strategy=nested` to `npm install`.
This ensures that `package-lock.json` places `node_modules` in package folders
as opposed to hoisting them out to the root directory;
we rely on this in the dev container.

## Makefile targets

| Target | What it does |
|--------|-------------|
| `make` or `make container` | Build the production-mode Docker image |
| `make serve` | Start a production-mode container |
| `make enter` | Shell into a fresh production-mode container (for debugging) |
| `make container-dev` | Build the development-mode Docker image |
| `make dev` | Start a development-mode container with the host source code mounted for HMR |

The data volume is stored in `/tmp/lean-workbench/` on the host by default.
Set the `WORKBENCH_ROOT` Makefile argument to customize this.

## Debugging

In dev mode (`make dev`),
the first VSCode server to start up will have its [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)
start a debugger on port 9229.
Use the "Attach to vscode-workbench" VSCode launch target to attach.
You can set breakpoints in the `vscode-workbench/` extension.

## Resetting the data volume

The data volume is preserved on the host across development sessions,
so you don't need to re-run the setup/seeding step unless you wipe it.

To start completely fresh (wipe all projects, database, seeded packages):

```bash
make clean
```

## Architecture

```
Browser
    |
    v
nginx (reverse proxy, port 3000)
    |
    |-- /_vs/{viewer}/{owner}/{project}/* --> openvscode-server (port 3010+N, in bwrap)
    |-- everything else                   --> Next.js server (port 3002)
```

Three processes run inside the Docker container:

1. **nginx** (background) — reverse proxy on port 3000.
   Routes VS Code WebSocket/HTTP traffic to per-session openvscode-server instances.
   Everything else goes to the Next.js server.

2. **Next.js server** (background) — Next.js app on port 3002.
   Handles authentication, project CRUD API, the setup UI,
   and spawning openvscode-server processes inside bwrap sandboxes.

3. **openvscode-server** (one per active editing session) — spawned on demand by Next.js when a user opens a project.
   Each runs inside its own bwrap sandbox on a dynamically allocated port (3010, 3011, ...).

### Key paths

| Path | Purpose |
|------|---------|
| `src/instrumentation.ts` | Runs once at startup to initialize the Next.js server |
| `src/prisma/migrations/` | Numbered SQL migration files, run in order at server startup |
| `nginx.conf.template` | Reverse proxy config with dynamic per-session includes |
| `start.sh` | Container entrypoint: starts app + nginx |
| `scripts/seed-volume.sh` | First-run data volume setup (elan, Mathlib, templates) |
| `install.sh` | End-user installer (generates Docker Compose files) |

## Data volume layout

All persistent state lives under a single host directory (mounted as `/data` inside the container).
Default: `/tmp/lean-workbench` for `make dev`/`make serve`,
and `~/.lean-workbench/data/` for `install.sh` deployments.

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
      vscode-remote/            VSCode server state and configuration
      <project-uuid>/
        lean-toolchain
        lakefile.toml
        Main.lean
        .lake/packages/         Overlaid from shared package-sets
        .lake/build/            User's own build artifacts
```

---

## Security considerations

Docker is used for convenience of deployment, not principally as a security boundary.
Bubblewrap is the mechanism by which we isolate users from one another.
Each user session runs in a `bwrap` sandbox with:

- **User namespace isolation** (`--unshare-user`, `--unshare-pid`,
  `--unshare-uts`, `--unshare-cgroup`). UID/GID are remapped to
  1000 inside the sandbox.
- **Read-only system mounts** (`/usr`, `/lib`, `/bin`, `/etc`).
- **Read-only Lean toolchain** (elan mounted at `/workspace/.elan`).
- **Copy-on-write overlays** for shared packages (`--tmp-overlay`).
  Reads come from admin-managed package-set directories; writes go to
  an ephemeral tmpfs layer. Package-set files are root-owned on the
  host for overlayfs copy-up to work correctly inside the user
  namespace.
- **Writable workspace** for the user's project files.
- Network is **not** currently isolated (`openvscode-server` needs a TCP port visible to nginx).

The Docker container runs with `--cap-add SYS_ADMIN` and relaxed seccomp/apparmor settings
because bwrap needs these capabilities to create user namespaces and overlay mounts.
