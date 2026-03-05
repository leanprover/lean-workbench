# Lean Workbench

Multi-user sandboxed VS Code server. Each user gets an isolated
[OpenVSCode Server](https://github.com/gitpod-io/openvscode-server)
instance inside a bubblewrap sandbox, reverse-proxied through nginx.

The code here is still very much in progress and experimental!

## Architecture

- **spawner.ts** — Express app (Node 22, ESM). Spawns per-user
  `openvscode-server` processes inside `bwrap` sandboxes, writes nginx
  route configs, and serves the landing page / session wrapper.
  Authentication uses GitHub OAuth via Passport.
- **nginx.conf** — Front-door reverse proxy on port 3000. Routes
  `/user/<name>/_vs/` to the user's VS Code backend; everything else
  goes to the spawner API on port 3002.
- **start.sh** — Entrypoint: starts the spawner, then runs nginx in
  the foreground.
- **public/** — EJS templates. `landing.ejs` (login / welcome page) and
  `session.ejs` (rendered per-user with VS Code iframe).

## Configuration

Authentication uses GitHub OAuth. Create a `.env` file with your app credentials:

    cp .env.example .env
    # fill in GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET

These come from a GitHub OAuth App (Settings → Developer settings → OAuth Apps).
The app's "Authorization callback URL" should be `http://localhost:3000/auth/github/callback`.

## Usage

```
mkdir /tmp/podserver
# some invocation of ./scripts/mk-mathlib-installation.sh
# that has not yet been tested would go here
make # build docker image
make serve # run docker container
```

Then visit `http://localhost:3000`.

## Development

The spawner runs directly with `--experimental-strip-types` (no build
step). To iterate locally without Docker:

```
npm install
node --experimental-strip-types spawner.ts
```

## Archive

Earlier experiments (direct gitpod base image, manual VS Code build)
live in `archive/`.
