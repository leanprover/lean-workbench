# Lean Workbench

⚠️ Warning: in progress and experimental. There are not yet guarantees
of stable interfaces. A more careful security audit is forthcoming.
Running unsandboxed or with confidential data is at your own risk.

This project aims to provide an online experience that facilitates
familiar (i.e. VS Code with the Lean 4 extension) and novel interfaces
to the Lean proof assistant.

A core part of the system is a multi-user sandboxed VS Code server:
each user gets an isolated [Code Server](https://github.com/coder/code-server) instance
inside a [bubblewrap](https://github.com/containers/bubblewrap) sandbox.

## Setup

This section walks you through setting up a Lean Workbench instance.
It is written with IT staff/system administrators in mind.

### Prerequisites

- A Linux machine (or VM) with [Docker](https://docs.docker.com/get-docker/) installed.
  - 3GiB of RAM per concurrent user is recommended.
- A domain or IP address on which you will publish the Workbench.
- A GitHub account that will own the [OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
  used to authorize GitHub-based logins on the instance.

### Step 0: Configure the network

The networking features of Lean Workbench are intentionally minimal:
our HTTP server listens on a local interface and port of your choice,
but does not handle anything beyond that.
Supporting secure HTTPS connections (strongly recommended),
firewalled corporate/university networks, etc,
is the instance administrator's responsibility.

Make a note of the **public URL** on which you will publish the instance
(e.g. `https://lean.math.uni.edu` or `http://lean.internal-lan.uni.edu`),
as well as the **local address and port** on which the Workbench HTTP server should listen.

Workflows for two common cases are described below.

#### Network Setup A: Cloudflare Tunnel

This is the easiest secure setup.
It requires a Cloudflare account with DNS administration privileges for `your-domain.com`.

1. Follow [Cloudflare instructions](https://developers.cloudflare.com/tunnel/setup/) to:
   - **Set up a tunnel** (`cloudflared`) on your machine.
   - **Publish an application** on your chosen hostname `subdomain.your-domain.com`,
      with `http://127.0.0.1:8080` as the Service URL.
1. **Move to Step 1** below.
   Use `https://subdomain.your-domain.com` as the public URL,
   and `127.0.0.1:8080` as the local address and port.

#### Network Setup B: Let's Encrypt with Nginx

In this setup,
you obtain an SSL certificate from Let's Encrypt
and launch an Nginx reverse proxy.
Nginx terminates SSL and forwards HTTP traffic to the Workbench via local loopback.

1. Follow [certbot instructions](https://certbot.eff.org/instructions?ws=nginx&os=snap)
   to **set up Nginx with HTTPS** on your Linux machine
   and publish it to `https://your-domain.com`.
1. **Configure Nginx** to proxy traffic to `http://127.0.0.1:8080`.
   Your configuration should probably include:
   ```nginx
   http {
       # Needed for WebSockets
       map $http_upgrade $connection_upgrade {
           default upgrade;
           ''      close;
       }

       server {
           ... HTTPS configuration ...

           location / {
               proxy_pass http://127.0.0.1:8080;
               proxy_http_version 1.1;
               proxy_set_header Host       $http_host;
           
               # Proxy WebSocket traffic
               proxy_set_header Upgrade    $http_upgrade;
               proxy_set_header Connection $connection_upgrade;
           
               # Leave connections open for 24h
               proxy_read_timeout 86400;
               proxy_send_timeout 86400;
           
               # Stream SSE without delay
               proxy_buffering off;
           }
       }
   }
   ```
1. **Move to Step 1** below.
   Use `https://your-domain.com` as the public URL,
   and `127.0.0.1:8080` as the local address and port.

### Step 1: Install and launch

Run the installer on your Linux server:

```bash
curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh | bash
```
The installer will prompt for the public URL, local address and port from Step 0,
as well as a **data directory** (default: `~/.lean-workbench`)
where all persistent data (database, users' projects, Lean toolchains) is stored.

It will then download the Docker container image
and generate a `docker-compose.yml` file reflecting your network configuration.

The installer will print an **initial administrator password**.
Save it for Step 2.

Finally, the installer will offer to start the container for you.
Otherwise, to start it yourself:

```bash
cd ~/.lean-workbench   # your data directory
docker compose up -d
```

### Step 2: Complete setup via web UI

> [!TIP]
> This step uses the Workbench web interface;
> it does not require SSH access to the Linux machine.

Open the public URL in a browser.
You'll see the setup page, which has three steps:

1. **Set the administrator password.**
   When prompted, provide the initial password printed by the installer in Step 1.
1. **Configure GitHub OAuth.**
   An OAuth App is needed to authorize GitHub-based logins.
   [Create one here](https://github.com/settings/developers) with these settings:
   - *Homepage URL:* your public URL.
   - *Redirect URI:* the setup page shows the exact URI to use.

   Copy the *Client ID* and *Client Secret* from GitHub into the setup form
   and click *Save Configuration*.
1. **Seed the data volume.**
   Click *Start Setup*.
   This runs a script inside the container that:

   - Installs the [elan](https://github.com/leanprover/elan) Lean version manager.
   - Downloads Mathlib source and pre-compiled `.olean` files (~5 GB) for the latest Lean release.
   - Creates project templates.

   A progress bar and log output are shown in real time.
   This takes 5–30 minutes depending on network speed.
   
Setup is now complete.
Click *Continue to the Lean Workbench* or refresh to see the landing page.

### Updating

```bash
cd ~/.lean-workbench   # your data directory
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
```

### Uninstalling

```bash
bash <(curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh) --uninstall
```

This stops the service and optionally removes the Docker image and data directory.

### Backups

All persistent state is in the data directory
(default: `~/.lean-workbench`). You can back up this directory to
preserve all user workspaces, the database, and Lean toolchains.

## Development

See [doc/DEVELOPMENT.md](doc/DEVELOPMENT.md).
