# Lean Workbench

⚠️ Warning: in progress and experimental. There are not yet guarantees
of stable interfaces.

This project aims to provide an online experience that facilitates
familiar (i.e. vscode with the lean4 extension) and novel interfaces
to the Lean proof assistant.

A core part of the system is a multi-user sandboxed VS Code server.
Each user gets an isolated [OpenVSCode
Server](https://github.com/gitpod-io/openvscode-server) instance
inside a [bubblewrap](https://github.com/containers/bubblewrap)
sandbox, reverse-proxied through nginx.

## Production setup

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
  The right choice for this may depend on other aspects of your particular configuration,
  e.g. whether you have a proxy terminating SSL for you.

It pulls the Docker image, and generates two Docker Compose files in
the data directory:
- `docker-compose.yml` — binds to `127.0.0.1` only (for initial
  setup, so the setup page is not exposed to the internet).
- `docker-compose.prod.yml` — binds to `0.0.0.0` (for production).

The installer should offer to start the service for you. Otherwise:

```bash
cd ~/.lean-workbench   # where the data directory is
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
(default `~/.lean-workbench/data/`). You can back up this directory to
preserve all user workspaces, the database, and Lean toolchains.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).
