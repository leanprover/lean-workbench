# Plan: Mathlib package/template/workspace/test scripts

Status: completed.

## Context

We're moving from the old `installations/` layout to the new layout
from LEAN-TOOLS.md: separate `package-sets/` (shared dep dirs with
source + oleans) and `templates/` (minimal project boilerplate). We
need bubblewrap 0.11.0 built from source in the Dockerfile for
`--tmp-overlay` support.

The overlay strategy: each shared package (mathlib, batteries, Qq, etc.)
gets its own `--tmp-overlay` mount into `.lake/packages/<name>/`. The
`.lake/packages/` directory itself is a normal writable directory, so
user-added packages persist normally. Writes to shared packages go to
tmpfs and are ephemeral.

## Files to create/modify

### 1. `scripts/mk-mathlib-package.sh` (new)

Replaces `mk-mathlib-installation.sh`. Key differences from the old
script:

- `--help` flag with usage docs.
- Args: `--root DIR` (default `$PODSERVER_ROOT` or `/tmp/podserver`),
  `--lean-version VERSION` (default: auto-detect from elan stable).
- Output goes to `$ROOT/package-sets/mathlib-<version>/` containing
  one subdirectory per package (mathlib, batteries, Qq, aesop, etc.)
  — each with source and `.lake/build/` oleans inside it.
- Also writes a `packages.txt` manifest listing the package names.
- Also writes template files to `$ROOT/templates/mathlib-<version>/`
  (lean-toolchain, lakefile.toml, lake-manifest.json, Main.lean,
  metadata.json).
- Procedure: create temp project, `lake update`, `lake exe cache get`,
  then copy each directory from `.lake/packages/` into the output.
  Also copy the template files (lean-toolchain, lakefile.toml,
  lake-manifest.json, Main.lean) into the templates dir.

**Existing `mk-mathlib-installation.sh`**: add a comment at top saying
it's superseded by `mk-mathlib-package.sh`.

### 2. `scripts/mk-mathlib-workspace.sh` (new)

Creates a test workspace using the mathlib template.

- `--help` flag.
- Args: `--root DIR` (default `/tmp/podserver`),
  `--user NAME` (default `testuser`),
  `--version VER` (default: auto-detect from available templates).
- Copies template files from `$ROOT/templates/mathlib-<version>/`
  into `$ROOT/workspaces/<user>/<uuid>/`.
- Creates `.lake/packages/` directory as a mount point.
- Prints the workspace path and uuid for use by the test script.

### 3. `scripts/mk-big-workspace.sh` (rename)

Rename `scripts/gen-workspace.sh` → `scripts/mk-big-workspace.sh`.
Update the internal usage line to match.

### 4. `scripts/test-mathlib-workspace.sh` (new)

End-to-end test. Runs `lake build` inside a bwrap sandbox inside
docker.

- `--help` flag.
- Args: `--root DIR`, `--workspace PATH` (or auto-detect most recent).
- Runs: `docker run --rm` with the podserver image, mounting
  `$ROOT` as `/data`.
- Inside docker, runs a bash script that:
  1. Reads the template to determine which package set to use.
  2. Reads `packages.txt` from the package set to get the list of
     shared packages.
  3. Assembles bwrap args:
     - System ro-binds (`/usr`, `/lib`, `/bin`, `/etc`)
     - Elan ro-bind (`/data/elan` → `/home/elan`)
     - Workspace bind (rw)
     - For each package in `packages.txt`:
       `--overlay-src /data/package-sets/<set>/<pkg>`
       `--tmp-overlay /workspace/project/.lake/packages/<pkg>`
  4. Runs `lake build` inside the sandbox.
- Reports success/failure and timing.

### 5. `Dockerfile` changes

Replace apt-installed bubblewrap with source-built 0.11.0:

- Remove `bubblewrap` from the apt-get line.
- Add build deps: `meson`, `ninja-build`, `pkg-config`, `libcap-dev`.
- Download bubblewrap 0.11.0 tarball, build with meson, install to
  `/usr`.
- Clean up build artifacts and build deps.

### 6. `start.sh` change

Change `mkdir -p /data/workspaces /data/db /data/installations` to
`mkdir -p /data/workspaces /data/db /data/package-sets /data/templates`.

## What we are NOT changing

- `spawner.ts` — still uses old `installations/` path and `--ro-bind`.
  Updating it to use `--tmp-overlay` and the new layout is a follow-up.
- `db.ts` — no schema changes.
- React client — no UI changes.

## Verification

```bash
# 1. Prepare shared mathlib package set (host, ~10-20 min)
./scripts/mk-mathlib-package.sh

# 2. Create a test workspace (host, instant)
./scripts/mk-mathlib-workspace.sh

# 3. Build docker image with bwrap 0.11.0 (host, ~5 min)
make build

# 4. Run the test (host, should complete in seconds)
./scripts/test-mathlib-workspace.sh
```

Step 4 should show `lake build` finding pre-built mathlib oleans and
only compiling the trivial `Main.lean`. Total time: seconds, not hours.
