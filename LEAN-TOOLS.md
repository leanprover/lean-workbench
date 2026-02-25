# Lean Tools Strategy

How the Lean toolchain, mathlib, and VS Code extension are installed,
shared, and presented to users inside bwrap sandboxes.

## Principles

1. **Read-only for users.** From the perspective of any user session,
   all shared Lean tooling (elan, toolchain binaries, pre-built
   library .oleans, VS Code extensions) is read-only. A user must not
   be able to corrupt a shared resource.

2. **Writable for admins.** From the perspective of an administrator
   (running scripts on the host machine), the tooling is writable.
   Admins install and manage Lean versions, build mathlib, and create
   project templates.

3. **Shared across users.** Lean toolchains and pre-built libraries
   are large (~1 GB per toolchain, ~2 GB for mathlib .oleans). They
   are stored once and shared read-only across all sessions that need
   them.

4. **Multiple versions.** Different projects may require different Lean
   versions and different mathlib builds. Elan's `toolchains/`
   directory holds multiple versions side by side. The right version is
   selected per-project via a `lean-toolchain` file in the workspace.

5. **No network in the sandbox.** User sessions cannot call
   `lake update` or `elan toolchain install`. Everything a project
   needs must be pre-mounted into the sandbox.

6. **One host directory.** All persistent state lives under a single
   configurable host directory (examples below use `/tmp/podserver`).
   This directory is mounted as a Docker volume.

## File layout

### Host machine

Everything lives under one directory. The admin controls this
directly (creating installations, managing toolchains, etc.).

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

  installations/                       # admin-created project templates
    mathlib-4.27/
      metadata.json                    # { "name": "Lean 4.27 + Mathlib" }
      lean-toolchain                   # "leanprover/lean4:v4.27.0"
      lakefile.toml
      Main.lean
      .lake/
        packages/                      # pre-fetched dependency sources
        build/                         # pre-compiled .oleans

  workspaces/                          # per-user, per-project work dirs
    alice/
      <project-uuid>/
        lean-toolchain
        lakefile.toml
        Main.lean
        .lake/build/                   # user's build artifacts
        .lake/packages/                # (may be overlaid read-only)
        .vscode-data/                  # openvscode-server state
    bob/
      <project-uuid>/
        ...
```

### Docker container

The host directory is volume-mounted. The Docker image also bakes in
read-only resources that don't need to be on the host.

```
/data/                                 # volume: /tmp/podserver (host)
  db/podserver.db
  elan/...
  installations/...
  workspaces/...

/home/.openvscode-server/              # baked into image (read-only)
  bin/openvscode-server
  ...

/home/extensions/                      # baked into image (read-only)
  lean4/                               # pre-installed lean4 VS Code ext
```

The container's `start.sh` seeds `/data/elan/` from a copy baked into
the image on first run, so that a fresh volume gets a working elan +
default toolchain without the admin needing to do anything.

### Bwrap sandbox (one user session)

Inside the sandbox, the user sees a carefully assembled filesystem.
Shared resources are read-only; only the project workspace is
writable.

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
    .lake/build/                       # rw — user's build output
    .lake/packages/                    # ro-bind overlay from installation
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

## Bwrap mount summary

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

# Pre-built dependencies overlay (read-only, optional)
--ro-bind  /data/installations/<id>/.lake/packages  /workspace/<project-uuid>/lean-project/.lake/packages

# Synthetic
--proc     /proc
--dev      /dev
--tmpfs    /tmp
```

The `.lake/packages` overlay is only present when the project is
associated with an installation that has pre-built dependencies.
Without it, the workspace's own `.lake/packages` (if any) is visible
via the normal workspace bind.

## How an admin adds an installation

An admin runs a script on the host:

```
scripts/create-installation.sh mathlib-4.27 leanprover/lean4:v4.27.0 "Lean 4.27 + Mathlib"
```

This:
1. Installs the toolchain via elan into `/tmp/podserver/elan/toolchains/`
2. Creates a template directory under `/tmp/podserver/installations/mathlib-4.27/`
   with `lean-toolchain`, `lakefile.toml` (with mathlib dep), starter `Main.lean`
3. Runs `lake build` in the template to pre-compile all dependencies
4. Writes `metadata.json` with the display name

The spawner discovers available installations by scanning for
`metadata.json` files and exposes them via `GET /api/installations`.
The project creation UI shows a picker. The chosen installation ID is
stored in the projects table. When creating a project, the spawner
copies the template files into the user's workspace directory.

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
