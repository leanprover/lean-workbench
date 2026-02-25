# Debrief

Summary of the incremental rebuild debugging session. The goal was to
bisect a performance problem where VS Code startup took 10–30 seconds
in old-version/. We rebuilt the application from scratch in 10 steps,
testing startup time at each step.

## Result

The anomalous 10–30s startup time is gone. No single step introduced
a measurable regression. The new-version has occasional 1–2s delays
on first load of the file explorer pane, but this is intermittent and
not reproducible — likely cold-start caching effects.

The exact cause of the old-version slowdown remains unknown. Likely
candidates:
- Accumulated state in the workspace or .vscode-data directories
- The more complex bwrap mount structure (tmpfs + nested subdirs)
- Interaction between multiple volumes and filesystem layering
- Something in the old Dockerfile's heavier dependency set

## Functional differences: old-version vs new-version

### Features present in both
- GitHub OAuth login
- Dev-login for local testing
- Per-user, per-project workspaces with bwrap sandboxing
- Lean toolchain (elan) and lean4 VS Code extension
- React project management UI (create, rename, delete)
- Admin active sessions view
- nginx reverse proxy with dynamic per-session routes
- Machine settings (workspace trust disabled, Welcome tab suppressed,
  elan excluded from file watcher)

### Missing from new-version
- **Lean logo SVG** — old-version uses `/static/lean-logo.svg` in the
  navbar. New-version uses text only ("Lean Workbench").
- **Google Fonts** — old-version loads Open Sans from Google Fonts.
  New-version relies on system fonts.
- **`GET /api/health`** — simple health check route present in
  old-version, not implemented in new-version.
- **Port reuse** — old-version reuses ports when a session process
  dies. New-version always allocates a fresh port.
- **Graceful spawn failure** — old-version creates a session entry
  with pid -1 on spawn failure (degraded mode). New-version fails
  fast with a 500 error.

### Intentional changes in new-version
- **Unified volume** — single `-v /tmp/podserver:/data` replaces
  three separate volumes (`/data`, `/home/workspace`,
  `/home/elan-volume`).
- **Simplified workspace mount** — workspace is bound directly to
  `/workspace` inside bwrap, rather than old-version's
  `--tmpfs /workspace` + `--dir /workspace/{id}` +
  `--bind ... /workspace/{id}/lean-project` structure.
- **Database path** — moved from `/data/podserver.db` to
  `/data/db/podserver.db` (in its own subdirectory under the unified
  volume).
- **Elan mounted read-only** — `--ro-bind /data/elan /home/elan`
  instead of old-version's `--bind` (read-write).
- **Conditional GitHub OAuth** — strategy and routes only registered
  when `GITHUB_CLIENT_ID` is set. Old-version required it.
- **Passport-based auth** — uses `req.isAuthenticated()` and
  `req.login()` instead of manual `req.session.userId`.
- **Express view engine** — `res.render()` instead of manual
  `fs.readFileSync` + `ejs.render`.
- **Faster port polling** — `waitForPort` retries every 200ms instead
  of 1000ms.
- **Lighter Docker image** — does not install python3, make, g++,
  libatomic1, or sudo.
- **API error format** — new-version returns plain text errors instead
  of JSON `{ error: "..." }` objects.

## IMPLEMENTATION.md completion

All 10 steps are complete:

| Step | Description | Status |
|------|-------------|--------|
| 1 | Bare openvscode-server | Done |
| 1b | Workspace file-count stress test | Done |
| 2 | nginx reverse proxy | Done |
| 3 | Spawner (single session, no auth) | Done |
| 4 | bwrap sandboxing | Done |
| 5 | Lean toolchain + extension | Done |
| 6 | Multi-session support | Done |
| 7 | SQLite + dev-login auth | Done |
| 8 | React project management UI | Done |
| 9 | GitHub OAuth | Done |
| 10 | Admin features + final polish | Done |

## DESIGN.md inconsistencies

DESIGN.md was written to describe old-version/ and has not been
updated to reflect new-version/. The following are now out of date:

1. **File paths** — DESIGN.md references `/home/workspace/`,
   `/home/elan-volume/`, `/data/podserver.db`. New-version uses
   `/data/workspaces/`, `/data/elan/`, `/data/db/podserver.db`.

2. **Workspace bwrap structure** — DESIGN.md describes
   `--tmpfs /workspace` with a `--dir` and nested `lean-project/`
   subdirectory. New-version binds directly to `/workspace`.

3. **Line counts** — DESIGN.md claims spawner.ts is 540 lines.
   New-version is ~425 lines.

4. **`GET /api/health`** — listed in DESIGN.md's API routes table but
   not implemented in new-version.

5. **Makefile targets** — DESIGN.md describes only `build` and `serve`.
   New-version also has `dev`.

## LEAN-TOOLS.md inconsistencies

LEAN-TOOLS.md is the forward-looking strategy document and is mostly
consistent with new-version, but there are discrepancies between what
it describes as the target architecture and what is currently
implemented.

### Naming

- LEAN-TOOLS.md says the image-baked elan copy is at
  `/home/elan-seed/`. The Dockerfile uses `/home/elan-image/` and
  start.sh references `/home/elan-image/.`. One of these should be
  updated for consistency.

### Implemented but different from doc

1. **Elan seed contents** — LEAN-TOOLS.md says the Docker image
   contains "the elan binary only — no toolchains." The current
   Dockerfile installs a full stable toolchain
   (`--default-toolchain leanprover/lean4:stable`) and seeds the
   entire thing to the volume. This is an intentional shortcut for
   the current implementation; the long-run plan per LEAN-TOOLS.md is
   to bake only the binary.

2. **Workspace mount structure** — LEAN-TOOLS.md describes a nested
   structure: `/workspace/<project-uuid>/lean-project/` with HOME set
   to `/workspace/<project-uuid>`. The implementation mounts directly
   to `/workspace` with HOME=/workspace. The nested structure is part
   of the future plan for supporting the `.lake/packages` overlay.

3. **HOME environment variable** — LEAN-TOOLS.md says
   `HOME=/workspace/<project-uuid>`. Implementation sets
   `HOME=/workspace`.

### Not yet implemented (future work per LEAN-TOOLS.md)

4. **`.lake/packages` read-only overlay** — LEAN-TOOLS.md describes
   mounting pre-built dependencies from
   `/data/installations/<id>/.lake/packages` into the workspace.
   This is not implemented. No code references `/data/installations/`.

5. **Installations directory** — LEAN-TOOLS.md describes
   `/tmp/podserver/installations/` with admin-created project
   templates (metadata.json, pre-compiled .oleans, etc.). This entire
   subsystem does not exist yet.

6. **`--unshare-net`** — LEAN-TOOLS.md's Principle 5 says "No network
   in the sandbox." The implementation does not pass `--unshare-net`
   to bwrap. The "Network access and user-managed dependencies"
   section acknowledges this is an open decision, and the current
   implementation effectively follows Option 2 (network allowed).

### Consistent

- Elan mounted read-only into bwrap (`--ro-bind`)
- Extensions at `/home/extensions/`, read-only
- Machine settings path and content
- Single host directory at `/tmp/podserver` mounted as `/data`
- VS Code extension installation mechanism
- `start.sh` seeding logic (aside from the path name)

## Recommendations

1. **Update DESIGN.md** to reflect new-version's paths and structure,
   or mark it as describing old-version only.

2. **Rename `/home/elan-image/` to `/home/elan-seed/`** (or update
   LEAN-TOOLS.md) to make the naming consistent.

3. **Add `GET /api/health`** — trivial to implement, useful for
   monitoring.

4. **Add `.lake` and `.vscode-data` to `files.watcherExclude`** in
   machine settings. No meaningful downside, may help with the
   intermittent file explorer delay.

5. **Decide on `--unshare-net`** — the current implementation allows
   network access. If this is intentional, update Principle 5 in
   LEAN-TOOLS.md. If not, add `--unshare-net` to bwrap args.

6. The installations system and `.lake/packages` overlay described in
   LEAN-TOOLS.md are future work and not blocking.
