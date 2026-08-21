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

- A Linux machine (or VM)
  - 3 GiB of RAM per concurrent user is recommended.
  - A dedicated machine (hosting nothing else) is recommended:
    the Workbench container runs with elevated privileges.
- Docker and Docker Compose.
  These both come with [Docker Engine](https://docs.docker.com/engine/install/),
  which we recommend over the [unofficial packages](https://docs.docker.com/engine/install/ubuntu/#uninstall-old-versions) that may come with the operating.
- A domain (or IP address) on which you will publish the Workbench.
  Whenever you see `your-domain.com` in these setup instructions, replace it with your actual domain.
- A GitHub account that will own the [OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
  used to authorize GitHub-based logins on the instance.

### Step 0: Configure the network

The networking features of Lean Workbench are intentionally minimal:
our HTTP server listens on a local interface and port of your choice,
but does not handle anything beyond that.
Supporting secure HTTPS connections (strongly recommended),
firewalled corporate/university networks, etc.,
is the instance administrator's responsibility.

Make a note of the **public URL** on which you will publish the instance (e.g. `https://lean.math.uni.edu`),
as well as the **local address and port** on which the Workbench HTTP server should listen.

Workflows for two common cases are described below.

#### Network Setup A: Cloudflare Tunnel

This is the easiest secure setup.
It requires a Cloudflare account with DNS administration privileges for `your-domain.com`.

1. Follow [Cloudflare instructions](https://developers.cloudflare.com/tunnel/setup/) to:
   - **Set up a tunnel** (`cloudflared`) on your machine.
   - **Publish an application** on your chosen hostname `your-domain.com`,
      with `http://127.0.0.1:8080` as the Service URL.
1. **Move to Step 1** below.
   Use `127.0.0.1:8080` as the local address and port,
   and `https://your-domain.com` as the public URL.

#### Network Setup B: Let's Encrypt with Nginx

In this setup,
you obtain an SSL certificate from Let's Encrypt
and launch an Nginx reverse proxy.
Nginx terminates SSL and forwards HTTP traffic to the Workbench via local loopback.

1. **Set up Nginx with HTTPS** on your Linux machine
   and publish it to `https://your-domain.com`.
   You can follow [DigitalOcean instructions](https://www.digitalocean.com/community/tutorials/how-to-configure-nginx-as-a-reverse-proxy-on-ubuntu-22-04
) to this end.

   Do not follow the "Testing your Reverse Proxy with Gunicorn" step in the DigitalOcean tutorial;
   you'll set up your reverse proxy to work with Lean Workbench.
   For now, visiting `https://your-domain.com` should result in a 502 Bad Gateway error.
   (If you don't even get a 502 Bad Gateway error, you may need to run `sudo ufw allow 'Nginx HTTPS'`)

1. **Configure Nginx**
   If you followed the DigitalOcean tutorial, you should now have a `/etc/nginx/sites-enabled/<your-site>` site that looks like this:

   ```
   server {
      server_name your-domain.com;

      location / {
         proxy_pass http://127.0.0.1:8080;
         include proxy_params;
      }

      listen [::]:443 ssl ipv6only=on; # managed by Certbot
      listen 443 ssl; # managed by Certbot
      ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem; # managed by Certbot
      ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem; # managed by Certbot
      include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
      ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

   }
   server {
      if ($host = your-domain.com) {
         return 301 https://$host$request_uri;
      } # managed by Certbot


      listen 80;
      listen [::]:80;

      server_name your-domain.com;
      return 404; # managed by Certbot
   }
   ```

   You will need to modify that file in two ways.
   First, at the beginning, before the first `server`, add:

   ```nginx
   # Needed for WebSockets
   map $http_upgrade $connection_upgrade {
       default upgrade;
       ''      close;
   }
   ```

   Second, **replace** the block beginning with `location /` with the following:

   ```nginx
       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_http_version 1.1;
           proxy_set_header Host              $host;
           proxy_set_header X-Forwarded-Host  $host;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

           # Proxy WebSocket traffic
           proxy_set_header Upgrade    $http_upgrade;
           proxy_set_header Connection $connection_upgrade;

           # Leave connections open for 24h
           proxy_read_timeout 86400;
           proxy_send_timeout 86400;

           # Stream SSE without delay
           proxy_buffering off;
       }
   ```
1. Save the changes to `/etc/nginx/sites-enabled/<your-site>`
1. Restart Nginx again (`sudo systemctl restart nginx.service`).
1. **Move to Step 1** below.
   Use the default `127.0.0.1:8080` as the local address and port,
   and `https://your-domain.com` as the public URL.

### Step 1: Install and launch

Run the installer on your Linux server:

```bash
bash <(curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh)
```

> [!TIP]
> If you get a message "ERROR: Cannot connect to Docker. Is the Docker daemon running? Is your user in the docker group?"
> then you may need to add the current user to the docker group (`sudo usermod -aG docker "$USER"`), log out, and log back in.

The installer will prompt for a **data directory** (default: `~/.lean-workbench`)
where all persistent data (database, users' projects, Lean toolchains) is stored,
as well as the local address, port, and public URL from Step 0.

> [!WARNING]
> The local address defaults to 127.0.0.1 instead of 0.0.0.0
> to prevent accidental exposure of the insecure HTTP service to the internet.

It will then download the Docker container image
and generate a `docker-compose.yml` file reflecting your network configuration.

The installer will print an **initial administrator password**.
Save it for Step 2.
(You can also find it in `data/config.json` in the data directory.)

Finally, the installer will offer to start the container for you.
You can either say "yes", or you can start it yourself:

```bash
docker compose -f ~/.lean-workbench up -d
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
   - Downloads Mathlib source and pre-compiled `.olean` files (~5 GB).
   - Creates project templates.

   A progress bar and log output are shown in real time.
   This takes 5–30 minutes depending on network speed.

Setup is now complete.
Click *Continue to Lean Workbench* or refresh to see the landing page.

### Updating

We recommend backing up the data directory before updating the container.

```bash
cd ~/.lean-workbench   # your data directory
docker compose pull
docker compose up -d
```

### Uninstalling

```bash
bash <(curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh) --uninstall
```

This stops the service and optionally removes the Docker image and data directory.

### Backups

All persistent state is in the data directory (default: `~/.lean-workbench`).
You can back up this directory to preserve users' projects, the database, and Lean toolchains.
Make sure to **stop the Workbench container** (`cd ~/.lean-workbench && docker compose down`)
before making the backup.
Otherwise, a partially written, corrupted database may be copied.

> [!CAUTION]
> The data directory contains authentication secrets.
> Backups should not be shared in whole with untrusted parties
> (individual project directories are fine to share).

## Development

See [doc/DEVELOPMENT.md](doc/DEVELOPMENT.md).
