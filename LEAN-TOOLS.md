# Lean Tools Strategy

How the Lean toolchain, mathlib, and VS Code extension are installed,
shared, and presented to users inside bwrap sandboxes.

## Principles

1. **Read-only shared resources.** From the perspective of any user
   session, all shared Lean tooling (elan, toolchain binaries, pre-built
   library source and .oleans, VS Code extensions) is backed by
   admin-owned storage that users cannot modify. Users interact with
   shared packages through copy-on-write overlay mounts, so accidental
   writes are harmless.

2. **Writable for admins.** From the perspective of an administrator
   (running scripts on the host machine), the tooling is writable.
   Admins install and manage Lean versions, build/cache mathlib, and
   create project templates.

3. **Shared across users.** Lean toolchains and pre-built libraries
   are large (~1 GB per toolchain, ~5 GB for mathlib .oleans). They
   are stored once and shared across all sessions that need them.
   Disk usage does not grow linearly with the number of projects.

4. **Multiple versions.** Different projects may require different Lean
   versions and different mathlib builds. Elan's `toolchains/`
   directory holds multiple versions side by side. The `packages/`
   directory holds multiple versions of mathlib (and other large deps).
   The right toolchain is selected per-project via `lean-toolchain`.

5. **Network is allowed but minimized.** Sandboxes have network access,
   so users can `lake update` or install their own dependencies.
   However, pre-mounted shared packages mean that common operations
   (building a project that depends on mathlib) don't require any
   network traffic. Minimizing network traffic is a convenience and
   performance goal, not a security boundary.

6. **One host directory.** All persistent state lives under a single
   configurable host directory (examples below use `/tmp/podserver`).
   This directory is mounted as a Docker volume.

## Where Lean stores things (background)

For context on the decisions below, here's where Lean's tooling puts
files:

- **Toolchains** live under `$ELAN_HOME/toolchains/`, one directory per
  installed version (e.g. `leanprover--lean4---v4.27.0/`). Each is
  ~1 GB and contains the compiler, stdlib .oleans, and Lake.

- **Dependency source code** is fetched by `lake update` into each
  project's `.lake/packages/` directory. Each dependency (e.g.
  `mathlib/`) is a git checkout at the commit pinned in
  `lake-manifest.json`.

- **Compiled .oleans** for a dependency live *inside* that dependency's
  package directory, at `.lake/packages/<dep>/.lake/build/lib/lean/`.
  They do NOT live in the root project's `.lake/build/`. (The root
  project's `.lake/build/` contains only the root project's own build
  output.)

- **`lake exe cache get`** (Mathlib's custom cache tool) downloads
  pre-built .olean archives and unpacks them into the dependency's
  build directory (i.e. `.lake/packages/mathlib/.lake/build/`).

This means that a single copy of a package directory under
`.lake/packages/<dep>/` contains both source and .oleans — sharing
that one directory is sufficient to avoid duplicating either.

## File layout

### Host machine

Everything lives under one directory. The admin controls this
directly (managing toolchains, packages, templates, etc.).

```
/tmp/podserver/                        # root of all persistent state
  db/
    podserver.db                       # SQLite database

  elan/                                # shared elan home
    bin/elan                           # elan binary
    bin/lean                           # symlink managed by elan
    settings.toml
    toolchains/                        # one subdir per installed version
      leanprover--lean4---v4.27.0/
      leanprover--lean4---v4.28.0/

  packages/                            # admin-managed shared packages
    mathlib-4.27/                      # mathlib at a specific version
      Mathlib/                         # source tree
      Mathlib.lean
      lakefile.toml
      lean-toolchain
      lake-manifest.json
      .lake/
        build/
          lib/lean/
            Mathlib/
              *.olean                  # pre-compiled .oleans (~5 GB)
    mathlib-4.28/                      # another version
      ...
    batteries-4.27/                    # other large deps if needed
      ...

  templates/                           # boilerplate project starters
    mathlib-4.27/
      metadata.json                    # { "name": "Lean 4.27 + Mathlib" }
      lean-toolchain                   # "leanprover/lean4:v4.27.0"
      lakefile.toml                    # requires mathlib
      lake-manifest.json               # pinned to match packages/mathlib-4.27
      Main.lean

  workspaces/                          # per-user, per-project work dirs
    alice/
      <project-uuid>/
        lean-toolchain
        lakefile.toml
        lake-manifest.json
        Main.lean
        .lake/packages/                # overlaid from shared packages
        .lake/build/                   # user's own build artifacts
        .vscode-data/                  # openvscode-server state
    bob/
      <project-uuid>/
        ...
```

**Key difference from the old layout:** There is no `installations/`
directory with a full project skeleton containing `.lake/build/` and
`.lake/packages/` side by side. Instead:

- `packages/` holds the *dependency* directories themselves (source +
  oleans), named by version. These are what get overlaid into each
  project's `.lake/packages/`.
- `templates/` holds minimal project boilerplate (lakefile, manifest,
  lean-toolchain, starter code). These are copied into new workspaces.

### Docker container

The host directory is volume-mounted. The Docker image also bakes in
read-only resources that don't need to be on the host.

```
/data/                                 # volume: /tmp/podserver (host)
  db/podserver.db
  elan/...
  packages/...
  templates/...
  workspaces/...

/home/.openvscode-server/              # baked into image (read-only)
  bin/openvscode-server
  ...

/home/elan-seed/                       # baked into image (read-only)
  bin/elan                             # elan binary only — no toolchains
  settings.toml

/home/extensions/                      # baked into image (read-only)
  lean4/                               # pre-installed lean4 VS Code ext
```

**What the Docker image contains (Lean-specific):**
- The **elan binary** (the Lean version manager) — a small seed copy
  at `/home/elan-seed/`.
- The **lean4 VS Code extension** at `/home/extensions/`.

**What the Docker image does not contain:**
- Any Lean toolchain. Specific toolchain versions (the large ~1 GB
  directories under `elan/toolchains/`) live exclusively on the host
  volume and are managed by the admin.
- Mathlib source/oleans, shared packages, or templates.

The container's `start.sh` seeds `/data/elan/` from `/home/elan-seed/`
on first run, so that a fresh volume gets a working elan binary
without the admin needing to do anything. The admin then installs
toolchains into `/data/elan/toolchains/` on the host.

### Bwrap sandbox (one user session)

Inside the sandbox, the user sees a carefully assembled filesystem.
Shared resources are protected by copy-on-write overlays; the project
workspace is writable.

```
/usr, /lib, /lib64, /bin, /etc        # ro-bind from container
/proc                                  # --proc
/dev                                   # --dev
/tmp                                   # tmpfs

/home/elan/                            # ro-bind from /data/elan
  bin/elan, bin/lean
  settings.toml
  toolchains/...

/home/extensions/                      # ro-bind from image
  lean4/

/workspace/<project-uuid>/             # HOME for this session
  lean-project/                        # bind (rw) from host workspace dir
    lean-toolchain
    lakefile.toml
    Main.lean
    .lake/build/                       # rw — user's own build output
    .lake/packages/
      mathlib/                         # tmp-overlay from shared package
      batteries/                       # tmp-overlay from shared package
      ...                              # user-added deps land here too
    .vscode-data/                      # rw — server state
```

Environment inside the sandbox:
```
HOME=/workspace/<project-uuid>
ELAN_HOME=/home/elan
PATH=/home/elan/bin:/usr/local/bin:/usr/bin:/bin
```

Elan reads `lean-toolchain` in the project directory, resolves it to a
toolchain under `/home/elan/toolchains/`, and runs the corresponding
`lean` binary. No write access to elan is needed.

## Bwrap overlay strategy

### Copy-on-write with `--tmp-overlay`

Bubblewrap supports overlayfs mounts via `--overlay-src` and
`--tmp-overlay`. This provides copy-on-write semantics: reads come
from the admin-managed shared directory, but writes go to an ephemeral
tmpfs layer that is invisible to the host and other sandboxes.

This is used for shared packages (e.g. mathlib). The benefits:

- **No corruption risk.** Writes go to tmpfs, not the shared storage.
  Even if Lake or the user writes into a package directory, other
  users are unaffected.
- **Debugging flexibility.** A user can temporarily modify mathlib
  source for debugging purposes. Changes are ephemeral — lost on
  sandbox restart — which is the right default.
- **User-added dependencies coexist.** Because `.lake/packages/` as a
  whole is writable (via the overlay upper layer), `lake update` can
  add new packages alongside the shared ones. Small user-added deps
  land in the tmpfs layer; the shared mathlib is served from the
  lower layer.

### Bwrap mount summary

```
# System (read-only)
--ro-bind  /usr                       /usr
--ro-bind  /lib                       /lib
--ro-bind-try /lib64                  /lib64
--ro-bind  /bin                       /bin
--ro-bind  /etc                       /etc

# Lean tooling (read-only, shared)
--ro-bind  /data/elan                 /home/elan
--ro-bind  /home/extensions           /home/extensions

# User workspace (read-write)
--tmpfs    /workspace
--dir      /workspace/<project-uuid>
--bind     /data/workspaces/<user>/<project-uuid>   /workspace/<project-uuid>/lean-project

# Shared packages (copy-on-write overlay)
# Each shared package is overlaid into .lake/packages/ via --tmp-overlay.
# Reads come from the shared admin directory; writes go to tmpfs.
--overlay-src /data/packages/mathlib-4.27
--tmp-overlay /workspace/<project-uuid>/lean-project/.lake/packages/mathlib

--overlay-src /data/packages/batteries-4.27
--tmp-overlay /workspace/<project-uuid>/lean-project/.lake/packages/batteries

# (repeat for each shared package the project depends on)

# Synthetic
--proc     /proc
--dev      /dev
--tmpfs    /tmp
```

The overlay mounts are only present for packages that the project
actually depends on (determined from the template or manifest). If a
user adds a new dependency via `lake update`, it lands in the writable
workspace directory normally — no overlay is needed for user-managed
deps.

## Network access and user-managed dependencies

Sandboxes have network access. This means users can:

- Run `lake update` to add new dependencies or upgrade existing ones.
- Fetch small packages that aren't pre-cached.

Pre-mounted shared packages (via copy-on-write overlays) ensure that
the common case — building a project that depends on mathlib — doesn't
require any network traffic. The pre-built .oleans are already present
in the overlay lower layer.

### What happens when a user runs `lake update`

If a user runs `lake update` in a project that has shared mathlib
overlaid:

1. Lake fetches new source and writes a new `lake-manifest.json`.
2. The new package source lands in the tmpfs overlay upper layer of
   `.lake/packages/`. For mathlib, this means the user now has a
   *different* version in the upper layer that shadows the shared one.
3. The user will need to rebuild .oleans for the new version (or use
   `lake exe cache get` to download them). This is potentially
   expensive, but it's the user's explicit choice.
4. On sandbox restart, the tmpfs is lost and the project reverts to
   seeing the shared version. However, the updated `lake-manifest.json`
   persists in the workspace. On the next `lake build`, Lake will
   notice the mismatch and re-fetch — so the user may want to also
   revert `lake-manifest.json` if they didn't intend to upgrade.

This is an acceptable trade-off: upgrading mathlib is an intentional,
heavyweight operation, and users who do it accept the cost. For the
common case, no network or rebuilding is needed.

### Persistent upgrades

If a user wants to *persistently* upgrade to a new mathlib version
(surviving sandbox restarts), the spawner could be extended to use
`--overlay RWSRC DEST` instead of `--tmp-overlay`, with `RWSRC`
pointing to a per-user writable directory on the host. This is a
future enhancement — `--tmp-overlay` is sufficient for now.

## Template and package management

Admins manage the contents of `/tmp/podserver/elan/`,
`/tmp/podserver/packages/`, and `/tmp/podserver/templates/` outside of
the running application (e.g. via host-side scripts, or a future admin
UI). The exact mechanism is out of scope for this document.

### Preparing a shared package

To prepare a shared mathlib for a given toolchain version:

1. Create a temporary project depending on mathlib at the desired
   version.
2. Run `lake update` to fetch sources into `.lake/packages/mathlib/`.
3. Run `lake exe cache get` (or `lake build` if no cache is available)
   to populate `.lake/packages/mathlib/.lake/build/`.
4. Copy the resulting `mathlib/` directory (source + oleans) into
   `/tmp/podserver/packages/mathlib-<version>/`.
5. Repeat for transitive dependencies (batteries, Qq, aesop, etc.)
   that are large enough to be worth sharing.

### Preparing a template

A template is a minimal project skeleton:

- `lean-toolchain` — pinned to the appropriate version.
- `lakefile.toml` — declares the dependency on mathlib (and any
  others).
- `lake-manifest.json` — pinned to match the shared packages.
- `Main.lean` — starter code.
- `metadata.json` — display name for the UI.

When a user creates a new project from a template, these files are
copied into their workspace directory. The spawner then sets up overlay
mounts for the shared packages listed in the manifest.

## VS Code extension

The lean4 VS Code extension is baked into the Docker image at
`/home/extensions/` during the image build (installed via
`openvscode-server --install-extension`). It is mounted read-only into
every sandbox and passed to openvscode-server via `--extensions-dir`.

Users do not install their own extensions. If the extension version
needs updating, a new Docker image is built.

## VS Code machine settings

Each project workspace gets a `.vscode-data/data/Machine/settings.json`
written by the spawner before first launch:

```json
{
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none",
  "files.watcherExclude": { "/home/elan/**": true }
}
```

- Workspace trust is disabled (every workspace is pre-approved).
- The startup editor is suppressed (no "Welcome" tab).
- The file watcher excludes the elan directory (large, read-only,
  no reason to watch).
