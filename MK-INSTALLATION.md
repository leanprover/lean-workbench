# Making a Mathlib Installation

## Goal

Provide a host-side script that an admin runs (outside Docker) to create
a complete mathlib installation under `/tmp/podserver/installations/mathlib/`.
Then update the spawner so that new mathlib projects use this installation
for instant startup — no network fetches, no hour-long builds.

## Background

A mathlib project needs three categories of files to start without
network access or compilation:

1. **Source files** — `lean-toolchain`, `lakefile.toml`, `Main.lean`.
   Already handled by the template mechanism.

2. **`lake-manifest.json`** — the resolved dependency lock file. Without
   it, Lake tries to resolve dependencies over the network. This file
   is the same for every project using the same mathlib version.

3. **`.lake/packages/`** — contains two things per dependency:
   - Source `.lean` files (needed for jump-to-definition)
   - Pre-compiled `.olean` files at `<dep>/.lake/build/lib/lean/`
     (needed to avoid hour-long recompilation)

   These are produced by `lake update` (clones sources, and mathlib's
   post-update hook runs `lake exe cache get` to download oleans).
   They are identical across all projects using the same mathlib version
   and should be shared read-only.

## Part 1: Host-side script (`scripts/mk-mathlib-installation.sh`)

The script uses elan/lake already seeded at `/tmp/podserver/elan/`:

1. Create a temporary working directory.
2. Copy the mathlib template files (`templates/mathlib/`) into it:
   `lean-toolchain`, `lakefile.toml`, `Main.lean`.
3. Run `lake update` with `ELAN_HOME=/tmp/podserver/elan` and
   `PATH=/tmp/podserver/elan/bin:$PATH`. This:
   - Resolves dependencies and writes `lake-manifest.json`
   - Clones dependency sources into `.lake/packages/`
   - Triggers mathlib's post-update hook, which runs
     `lake exe cache get`, downloading pre-compiled `.olean` files
     into `.lake/packages/<dep>/.lake/build/`
4. Move the results into `/tmp/podserver/installations/mathlib/`:
   - `lake-manifest.json`
   - `.lake/packages/` (the entire tree — sources + oleans)
5. Clean up the temp directory.

The script is idempotent — re-running it replaces the installation.

## Part 2: Spawner changes

### A. `seedTemplate` copies `lake-manifest.json` for mathlib projects

Currently `seedTemplate` copies `lean-toolchain`, `lakefile.toml`,
`Main.lean` from `/home/templates/<template>/`. For the mathlib
template, it must also copy `lake-manifest.json` from the installation
directory (`/data/installations/mathlib/lake-manifest.json`) into the
workspace. This tells Lake that dependencies are already resolved.

### B. The `.lake/packages` ro-bind is already correct

The existing ro-bind mounts the installation's `.lake/packages` over
the workspace's `.lake/packages`. Since the oleans live inside this
tree (at `<dep>/.lake/build/`), they're included automatically. The
sources are also included, so jump-to-definition works. No additional
mounts are needed — the code just needs the installation to exist on
the host (Part 1).

## Summary of data flow

```
Admin runs mk-mathlib-installation.sh (once, on host)
  └─> /tmp/podserver/installations/mathlib/
        lake-manifest.json
        .lake/packages/
          mathlib/           (source + .lake/build/)
          batteries/         (source + .lake/build/)
          ...

User creates mathlib project
  └─> seedTemplate copies into workspace:
        lean-toolchain       (from /home/templates/mathlib/)
        lakefile.toml        (from /home/templates/mathlib/)
        Main.lean            (from /home/templates/mathlib/)
        lake-manifest.json   (from /data/installations/mathlib/)

User opens mathlib project
  └─> spawnProject adds bwrap args:
        --ro-bind /data/installations/mathlib/.lake/packages
                  /workspace/<project>/.lake/packages

Inside sandbox, Lean server starts:
  - Reads lake-manifest.json → deps already resolved, no network
  - Finds .olean files in .lake/packages/*/..lake/build/ → no build
  - Finds .lean sources in .lake/packages/*/ → jump-to-def works
```
