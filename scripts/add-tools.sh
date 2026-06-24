#!/bin/bash
#
# Add extra Lean-library package sets + templates to an already-seeded
# lean-workbench data volume (created by seed-volume.sh).
#
# This assumes the baseline seed already exists and only layers on the
# requested tools. Each tool becomes its own package set under
# package-sets/ and a template under templates/, which then appears in
# the New Project UI automatically.
#
# It is idempotent: a tool whose package set already exists is skipped unless
# --force is given (each build takes minutes).
#
# Typical use against a running container:
#   docker cp scripts/add-tools.sh <container>:/tmp/
#   docker exec <container> /tmp/add-tools.sh        # adds the default tools
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: add-tools.sh [OPTIONS] [TOOL...]

Add Lean-library package sets + templates to a seeded lean-workbench data volume.
With no TOOL arguments, adds every tool in the registry.

Options:
  --data-dir DIR   Data directory for lean-workbench state (default: /data)
  --force          Rebuild a tool even if its package set already exists
  --help           Show this help message

Tools: verbose yalep
EOF
  exit 0
}

ROOT="/data"
FORCE=0
TOOLS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) ROOT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --help) usage ;;
    -*) echo "Unknown option: $1"; echo "Try --help"; exit 1 ;;
    *) TOOLS+=("$1"); shift ;;
  esac
done

# --- Tool registry ---------------------------------------------------------
# Each tool's require `name` is its package name, which equals the tool id here.
# Both tools pin leanprover/lean4:v4.31.0 and pull Mathlib transitively, so the
# generated lakefile must NOT also require mathlib (version conflict).
ALL_TOOLS=(verbose yalep)
declare -A GIT REV TOOLCHAIN IMPORT TNAME TDESC

GIT[verbose]="https://github.com/PatrickMassot/verbose-lean4.git"
REV[verbose]="v4.31.0"
TOOLCHAIN[verbose]="leanprover/lean4:v4.31.0"
IMPORT[verbose]="Verbose.English.All"
TNAME[verbose]="Lean v4.31.0 + Verbose"
TDESC[verbose]="Pre-built Verbose-Lean (natural-language tactics) + Mathlib"

# Fork of gricad-gitlab.univ-grenoble-alpes.fr/yalep/Yalep (upstream access is flaky).
# The fork has no tags; main tracks upstream's in-development 0.2.5-rc.
GIT[yalep]="https://github.com/jcreedcmu/yalep.git"
REV[yalep]="main"
TOOLCHAIN[yalep]="leanprover/lean4:v4.31.0"
IMPORT[yalep]="Yalep.English"
TNAME[yalep]="Lean v4.31.0 + Yalep"
TDESC[yalep]="Pre-built Yalep (natural-language proof tactics for teaching) + Mathlib"

[[ ${#TOOLS[@]} -eq 0 ]] && TOOLS=("${ALL_TOOLS[@]}")
for tool in "${TOOLS[@]}"; do
  [[ -v GIT[$tool] ]] || { echo "Unknown tool: $tool (known: ${ALL_TOOLS[*]})"; exit 1; }
done

# --- Verify the workbench is seeded ----------------------------------------
echo "[add-tools] Data directory: $ROOT"
ELAN_HOME="$ROOT/elan"
if [[ ! -x "$ELAN_HOME/bin/elan" ]]; then
  echo "[add-tools] ERROR: no elan at $ELAN_HOME." >&2
  echo "[add-tools] Is $ROOT a seeded workbench data dir? Run seed-volume.sh first." >&2
  exit 1
fi
if ! compgen -G "$ROOT/package-sets/mathlib-*" >/dev/null; then
  echo "[add-tools] ERROR: no mathlib package set under $ROOT/package-sets." >&2
  echo "[add-tools] Run seed-volume.sh first." >&2
  exit 1
fi
export ELAN_HOME
export PATH="$ELAN_HOME/bin:$PATH"

WORK_DIRS=()
cleanup() { for d in "${WORK_DIRS[@]:-}"; do rm -rf "$d"; done; }
trap cleanup EXIT

ensure_toolchain() {
  local tc="$1"
  if ! elan toolchain list | grep -Fq -- "${tc#leanprover/lean4:}"; then
    echo "[add-tools] Installing toolchain $tc"
    elan toolchain install "$tc"
  fi
}

# Copy every resolved dependency from a built project into a read-only package
# set, then materialize a template that requires it. Mirrors seed-volume.sh's
# inline mathlib block.
# Args: SET_ID TEMPLATE_ID SRC_DIR TMPL_NAME TMPL_DESC
materialize_package_set() {
  local set_id="$1" template_id="$2" src_dir="$3" tmpl_name="$4" tmpl_desc="$5"
  local pkgset_dir="$ROOT/package-sets/$set_id"
  local template_dir="$ROOT/templates/$template_id"

  rm -rf "$pkgset_dir"
  mkdir -p "$pkgset_dir"
  for pkg_dir in "$src_dir/.lake/packages"/*/; do
    local pkg_name; pkg_name=$(basename "$pkg_dir")
    echo "[add-tools]   copying package: $pkg_name"
    # Store each package at the .lake/packages/<pkg> path it occupies in a
    # project; see buildProjectMount.
    local pkg_dest="$pkgset_dir/$pkg_name/.lake/packages/$pkg_name"
    mkdir -p "$(dirname "$pkg_dest")"
    cp -a "$pkg_dir" "$pkg_dest"
  done
  ls -d "$pkgset_dir"/*/ | xargs -n1 basename > "$pkgset_dir/packages.txt"

  rm -rf "$template_dir"
  mkdir -p "$template_dir"
  cp "$src_dir/lean-toolchain" "$src_dir/lakefile.toml" \
     "$src_dir/lake-manifest.json" "$src_dir/Main.lean" "$template_dir/"
  cat > "$template_dir/metadata.json" <<EOF
{ "name": "$tmpl_name", "description": "$tmpl_desc", "packageSet": "$set_id" }
EOF
}

# Build one tool into a fresh package set + template.
build_tool() {
  local tool="$1"
  local rev="${REV[$tool]}"
  local set_id="$tool-$rev"
  # The template ID is the dir basename, so must satisfy TEMPLATE_ID_RE (no dots).
  local template_id="$tool-${rev//./-}"

  if [[ -f "$ROOT/package-sets/$set_id/packages.txt" && "$FORCE" -eq 0 ]]; then
    echo "[add-tools] $set_id already present, skipping (use --force to rebuild)."
    return
  fi

  echo "[add-tools] Building $tool $rev (toolchain ${TOOLCHAIN[$tool]})"
  ensure_toolchain "${TOOLCHAIN[$tool]}"

  local work; work=$(mktemp -d)
  WORK_DIRS+=("$work")

  echo "${TOOLCHAIN[$tool]}" > "$work/lean-toolchain"
  cat > "$work/lakefile.toml" <<EOF
name = "$tool-project"
version = "0.1.0"

[[require]]
name = "$tool"
git = "${GIT[$tool]}"
rev = "$rev"

[[lean_lib]]
name = "Main"
EOF
  cat > "$work/Main.lean" <<EOF
import ${IMPORT[$tool]}
EOF

  (
    cd "$work"
    lake update "$tool"
    # Mathlib oleans come from the cache; building Main forces the tool to compile.
    lake exe cache get
    lake build Main
  )

  materialize_package_set "$set_id" "$template_id" "$work" "${TNAME[$tool]}" "${TDESC[$tool]}"
  echo "[add-tools] Done $tool: package set '$set_id', template '$template_id'."
}

for tool in "${TOOLS[@]}"; do
  build_tool "$tool"
done

echo ""
echo "[add-tools] Finished. Added: ${TOOLS[*]}"
