# Lean Workbench

Multi-user sandboxed VS Code server for Lean 4. Each user gets an
isolated [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server)
instance inside a [bubblewrap](https://github.com/containers/bubblewrap)
sandbox, reverse-proxied through nginx.

The code here is still very much in progress and experimental!

## Architecture

- **spawner.ts** — Express app (Node 22, TypeScript via
  `--experimental-strip-types`). Spawns per-user `openvscode-server`
  processes inside `bwrap` sandboxes with overlayfs copy-on-write,
  writes nginx route configs, and serves the landing/session/setup pages.
  Authentication via GitHub OAuth (Passport) or dev-login.
- **db.ts** — SQLite database (via `better-sqlite3`). Stores users,
  projects, admin status, and authentication configuration. The
  `first_run` table tracks whether initial setup is complete.
- **nginx.conf** — Front-door reverse proxy on port 3000. Routes
  `/user/<name>/_vs/` to per-user VS Code backends; everything else
  goes to the spawner on port 3002.
- **start.sh** — Container entrypoint. Seeds elan from the image-baked
  copy on first run, then starts the spawner and nginx.
- **scripts/seed-volume.sh** — First-time setup script (run via the
  setup UI). Installs elan, downloads pre-compiled Mathlib, and sets up
  package sets and project templates on the data volume.
- **public/** — EJS templates (`landing.ejs`, `session.ejs`,
  `profile.ejs`, `setup.ejs`) plus a React client for project management.
- **install.sh** — End-user installer. Uses whiptail TUI to configure
  data directory and port, pulls the Docker image, and generates
  Docker Compose files (localhost-only for setup, 0.0.0.0 for production).

## Quick Start (Production)

```bash
# Download and run the installer
curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh | bash
```

The installer prompts for a data directory and port, pulls the Docker
image, and generates two Docker Compose files:

- `docker-compose.yml` — binds to localhost only (for initial setup)
- `docker-compose.prod.yml` — binds to all interfaces (for production)

Start with the localhost-only file, visit `http://localhost:<port>` to
configure GitHub OAuth and seed the data volume, then switch to production:

```bash
cd ~/.lean-workbench
docker compose down
docker compose -f docker-compose.prod.yml up -d
```

To uninstall:

```bash
./install.sh --uninstall
```

## Development

### Prerequisites

Docker must be installed and running.

### Configuration

In production, GitHub OAuth is configured through the web-based setup
UI on first run. No `.env` file is needed.

For development, you can optionally create a `.env` file to override
the database config:

    cp .env.example .env
    # fill in GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET

In development mode (`NODE_ENV=development`), a dev-login is available
that bypasses OAuth entirely.

### Build and Run

```bash
make        # build Docker image
make dev    # run in development mode (enables dev-login)
make serve  # run in production mode
make enter  # open a shell inside the container
```

Then visit `http://localhost:3000`. On first run you'll see the setup
page, where you can configure authentication and seed the data volume
with Lean toolchains and Mathlib.

### Data Volume

All persistent state lives under the data directory (mounted at `/data`
inside the container, defaults to `/tmp/lean-workbench` in the Makefile):

- `db/` — SQLite database
- `elan/` — Elan toolchain manager
- `package-sets/` — Pre-built Mathlib and other Lake dependencies
- `templates/` — Project templates
- `workspaces/` — Per-user workspace files

### Security Model

Docker is used for packaging and convenience. **Bubblewrap is the
security boundary** — each user session runs in a `bwrap` sandbox with
`--unshare-user`, overlayfs copy-on-write (`--tmp-overlay`), and
read-only bind mounts for shared toolchains. Package-set files are
root-owned on the host so that overlayfs copy-up works correctly inside
the user namespace.

## Archive

Earlier experiments (direct gitpod base image, manual VS Code build)
live in `archive/`.
