Fix the following inconsistencies between DESIGN.md and new-version, by changing DESIGN.md.

1. **File paths** — DESIGN.md references `/home/workspace/`,
   `/home/elan-volume/`, `/data/podserver.db`. New-version uses
   `/data/workspaces/`, `/data/elan/`, `/data/db/podserver.db`.

2. **Workspace bwrap structure** — DESIGN.md describes
   `--tmpfs /workspace` with a `--dir` and nested `lean-project/`
   subdirectory. New-version binds directly to `/workspace`.

3. **Line counts** — Eliminate any line count estimates in DESIGN.md.
   These are not important to discuss in a design document.

4. **Makefile targets** — DESIGN.md describes only `build` and `serve`.
    New-version also has `dev`.
