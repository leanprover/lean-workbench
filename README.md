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
  - A significant swap disk (at least 12 GiB, and up to half the available RAM):
    while the default for web servers is often to not configure swap,
    this interacts badly with Lean's reliance on large memory-mapped files.
- Docker and Docker Compose

  These both come with [Docker Engine](https://docs.docker.com/engine/install/),
  which we recommend over [unofficial packages](https://docs.docker.com/engine/install/ubuntu/#uninstall-old-versions) that may come with the Linux distribution.
- A domain on which you will publish the Workbench.
  Whenever you see `your-domain.com` in these setup instructions, replace it with your actual domain.
  You will need to be able to set wildcard DNS for `*.your-domain.com`,
  and obtain TLS certificates covering both `your-domain.com` and `*.your-domain.com`.
  (The Network Setup examples below give two examples of how this can be done.)
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
The **wildcard URL** `https://*.lean.math.uni.edu` should resolve to the same machine.

> [!IMPORTANT]
> Whatever terminates HTTPS in front of the Workbench must send the actual requested public hostname in the `Host` header that it forwards to Workbench.
> Workbench needs to know if a request was made to `your-domain.com`, to `pub.your-domain.com`, or to `session-2e39443c-42fa-40ad-8bed-2ce26aaf5945.your-domain.com`.

Workflows for two common cases are described below.

#### Network Setup A: Cloudflare Tunnel

This is the easiest secure setup, but it requires full use of a registered domain name:
`example.com` works, `lean.example.com` does not.
It requires a Cloudflare account with DNS administration privileges for `your-domain.com`.

1. Follow [Cloudflare instructions](https://developers.cloudflare.com/tunnel/setup/) to:
   - **Set up a tunnel** (`cloudflared`) on your machine.
   - **Publish an application** on your chosen URL `your-domain.com`,
      with `http://127.0.0.1:8080` as the Service URL.
1. **Publish a second application** on the wildcard URL `*.your-domain.com` (subdomain `*`),
   with the same `http://127.0.0.1:8080` as the Service URL.
1. **Move to Step 1** below.
   Use `127.0.0.1:8080` as the local address and port and `https://your-domain.com` as the public URL.

#### Network Setup B: Let's Encrypt with Nginx

In this setup,
you obtain an SSL certificate from Let's Encrypt
and launch an Nginx reverse proxy.
Nginx terminates SSL and forwards HTTP traffic to the Workbench via local loopback.

1. **Point DNS records at your machine**
   These instructions assume that domain `your-domain.com` and the wildcard domain `*.your-domain.com` both point at the IP address of your machine.

1. **Set up your machine**
   Follow [DigitalOcean's instructions](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu) to set up a user `workbench` with admin access.

1. **Install Nginx** on your Linux machine
   ```sh
   sudo apt update
   sudo apt install nginx
   sudo ufw allow 'Nginx Full'
   ```

   You should now be able to go to `http://your-domain.com` (note the `http`, not `https`), and see "Welcome to nginx!"

1. **Obtain certificates from Let's Encrypt**
   In order to issue a certificate for `*.your-domain.com`, Let's Encrypt requires you to demonstrate control over `your-domain.com`'s DNS records.
   (The process is called a [DNS-01 challenge](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge).)

   To get certificates that renew automatically, you'll need to use a [Certbot DNS plugin](https://eff-certbot.readthedocs.io/en/stable/using.html#dns-plugins) that works with your DNS provider.

   - First, follow that link and select your DNS provider (`certbot-dns-cloudflare` if Cloudflare manages your DNS, etc).

   - You will be directed to <https://certbot.eff.org/instructions#wildcard>.
     From that page, pick "Nginx" as your Software and "Linux (snap)" as your System, and then switch from the "default" tab to the "wildcard" tab and follow the directions.

   - In step 10, follow the instructions to "just get a certificate."
     The call to `certbot` must include both `-d your-domain.com` and `-d '*.your-domain.com'`.

   - Step 12, "Confirm that Certbot worked," won't work until after the next step.

     For now, run `sudo certbot certificates` and check that
     - There is a certificate listed for `your-domain.com`,
     - "Identifiers" mentions *both* `your-domain.com` and `*.your-domain.com`, and
     - The "Expiry Date" includes `VALID`.

1. **Set up Nginx to use HTTPS**

   Add the following file as `/etc/nginx/sites-available/lean-workbench`

   ```nginx
   # Needed for WebSockets
   map $http_upgrade $connection_upgrade {
      default upgrade;
      ''      close;
   }

   server {
      server_name your-domain.com *.your-domain.com;

      listen 443 ssl;
      listen [::]:443 ssl;
      ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

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
   }

   server {
      listen 80;
      listen [::]:80;
      server_name your-domain.com *.your-domain.com;
      return 301 https://$host$request_uri;
   }
   ```

   Enable the site, and check that the configuration is valid:

   ```sh
   sudo ln -s /etc/nginx/sites-available/lean-workbench /etc/nginx/sites-enabled
   sudo nginx -t
   ```

1. **Test Certificate Renewal**

   Configure certbot to reload nginx whenever there is a new certificate, and restart Nginx now so that it uses the new certificate.

   ```sh
   sudo certbot reconfigure --cert-name your-domain.com --deploy-hook "systemctl reload nginx" --run-deploy-hooks
   sudo certbot renew --dry-run
   sudo systemctl restart nginx
   ```

1. **Check Website**

   At this point, visiting `your-domain.com` with `http` or `https` should take you to `https://your-domain.com`, where you should see "502 Bad Gateway."

   To check that the wildcard domain is working go to `https://whatever.your-domain.com`, where you should also see "502 Bad Gateway."

1. **Move to Step 1** below.
   Use the default `127.0.0.1:8080` as the local address and port and `https://your-domain.com` as the public URL.

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
as well as the local address, port and public URL from Step 0.

> [!WARNING]
> The local address defaults to 127.0.0.1 instead of 0.0.0.0
> to prevent accidental exposure of the insecure HTTP service to the internet.

It will then download the Docker container image
and generate a `docker-compose.yml` file reflecting your network configuration.

The installer will print an **initial administrator password**.
**Save it for Step 2.**

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

## Administration

Workbench setup creates a built-in password-protected admin user.
To log in as this user, go to `/admin` while not logged in as another user.

## Updating

We recommend backing up the data directory before updating the container.

```bash
cd ~/.lean-workbench   # your data directory
docker compose pull
docker compose up -d
```

## Uninstalling

```bash
bash <(curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh) --uninstall
```

This stops the service and optionally removes the Docker image and data directory.

## Backups

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

## Migration Notes

### v0.0.20

 - **Warning:** if your publication URL was anything besides `pub.your-domain.com`, this update will not work.
 - **Deprecation:** a future release of lean-workbench will require a wildcard domain and a wildcard TLS certificate (`*.your-domain.com`).
   Setup instructions have been changed to describe wildcard domain setup for Cloudflare and Let's Encrypt.
   The wildcard domain and TLS certificate replace the `pub.your-domain.com` domain and TLS certificate for now.
 - Lean Workbench no longer supports running from an IP address.

Please reach out to us via Lean Zulip if you encounter any of these issues.

### v0.0.19

 - While unlikely, database migration will fail if a user managed to create two accounts attached to the same GitHub provider.
 - If your application's hostname was misconfigured, or if the `Host` header is not being correctly passed through your network setup, all Lean Workbench URLs will 404.
 - Long base URLs may cause errors due to a new forward-compatibility check.

Please reach out to us via Lean Zulip if you encounter any of these issues.