# Lean Workbench

Multi-user sandboxed VS Code server. Each user gets an isolated
[OpenVSCode Server](https://github.com/gitpod-io/openvscode-server)
instance inside a bubblewrap sandbox, reverse-proxied through nginx.

## Architecture

- **spawner.ts** — Express app (Node 22, ESM). Spawns per-user
  `openvscode-server` processes inside `bwrap` sandboxes, writes nginx
  route configs, and serves the landing page / session wrapper.
- **nginx.conf** — Front-door reverse proxy on port 3000. Routes
  `/user/<name>/_vs/` to the user's VS Code backend; everything else
  goes to the spawner API on port 3002.
- **start.sh** — Entrypoint: starts the spawner, then runs nginx in
  the foreground.
- **public/** — HTML templates. `landing.html` (static) and
  `session.ejs` (rendered with EJS per-user).

## Usage

```
docker build -t lean-workbench .
docker run -it --init -p 3000:3000 lean-workbench
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
