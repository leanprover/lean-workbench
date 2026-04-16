#!/bin/bash
#
# Seed the lean-workbench data volume with everything needed to run.
#
# This is the one-stop setup script. Run it before `make build` / `make serve`.
# It is idempotent — safe to re-run.
#
# What it does:
#   1. Creates the directory structure under $ROOT
#   2. Runs mk-mathlib-package.sh to populate package-sets/ and templates/
#   3. Seeds the "hello" template into templates/
#
# Progress markers:
#   Lines matching [progress STEP/TOTAL LABEL] are parsed by the setup UI
#   to drive a progress bar.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: seed-volume.sh [OPTIONS]

Seed the lean-workbench data volume with elan, mathlib packages, and templates.

Options:
  --data-dir DIR      Data directory for lean-workbench state
                      (default: $DATA_DIR or /tmp/lean-workbench/data)
  --help              Show this help message
EOF
  exit 0
}

ROOT="${DATA_DIR:-/tmp/lean-workbench/data}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) ROOT="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; echo "Try --help"; exit 1 ;;
  esac
done

echo "[seed-volume] Data directory: $ROOT"
echo ""

TOTAL=7

# --- Step 1: Create directory structure ---
echo "[progress 1/$TOTAL Creating directories]"
mkdir -p "$ROOT"/{workspaces,db,package-sets,templates}

# --- Step 2: Resolve mathlib version ---
# Mathlib tags lag behind Lean releases, so let the latest mathlib tag
# drive the Lean toolchain version rather than the other way around.
echo "[progress 2/$TOTAL Resolving mathlib version]"
MATHLIB_REV=$(git ls-remote --tags https://github.com/leanprover-community/mathlib4 'v4.*' \
  | sed 's|.*refs/tags/||' \
  | grep -v '\^{}' \
  | sort -V | tail -1)
LEAN_VERSION="$MATHLIB_REV"
TOOLCHAIN="leanprover/lean4:$LEAN_VERSION"
echo "[seed-volume] Latest mathlib tag: $MATHLIB_REV (Lean $LEAN_VERSION)"

# --- Step 3: Install elan ---
echo "[progress 3/$TOTAL Installing elan]"
ELAN_HOME="$ROOT/elan"
if [ ! -x "$ELAN_HOME/bin/elan" ]; then
  echo "[seed-volume] Downloading elan + Lean toolchain..."
  mkdir -p "$ELAN_HOME"
  curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
    | ELAN_HOME="$ELAN_HOME" sh -s -- -y --default-toolchain "$TOOLCHAIN" --no-modify-path
else
  echo "[seed-volume] elan already installed."
fi

export ELAN_HOME
export PATH="$ELAN_HOME/bin:$PATH"
if ! elan toolchain list | grep -q "$LEAN_VERSION"; then
  elan toolchain install "$TOOLCHAIN"
fi
echo "[seed-volume] Using Lean $LEAN_VERSION"

# --- Step 4: Fetch mathlib source ---
echo "[progress 4/$TOTAL Fetching mathlib source]"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "$TOOLCHAIN" > "$WORK_DIR/lean-toolchain"
cat > "$WORK_DIR/lakefile.toml" <<EOF
name = "mathlib-project"
version = "0.1.0"

[[require]]
name = "mathlib"
git = "https://github.com/leanprover-community/mathlib4"
rev = "$MATHLIB_REV"
EOF
cat > "$WORK_DIR/Main.lean" <<'EOF'
import Mathlib

#check Nat.add_comm
EOF

cd "$WORK_DIR"
mkdir -p .lake/packages
git clone --depth 1 --branch "$MATHLIB_REV" --progress https://github.com/leanprover-community/mathlib4 .lake/packages/mathlib
lake update

# --- Step 5: Download pre-compiled oleans ---
echo "[progress 5/$TOTAL Downloading pre-compiled oleans]"
lake exe cache get

# --- Step 6: Install package set ---
echo "[progress 6/$TOTAL Installing package set]"
PACKAGE_SET_DIR="$ROOT/package-sets/mathlib-$LEAN_VERSION"
TEMPLATE_DIR="$ROOT/templates/mathlib-$LEAN_VERSION"

rm -rf "$PACKAGE_SET_DIR"
mkdir -p "$PACKAGE_SET_DIR"

for pkg_dir in "$WORK_DIR/.lake/packages"/*/; do
  pkg_name=$(basename "$pkg_dir")
  echo "[seed-volume]   copying package: $pkg_name"
  cp -a "$pkg_dir" "$PACKAGE_SET_DIR/$pkg_name"
done

ls -d "$PACKAGE_SET_DIR"/*/ | xargs -n1 basename > "$PACKAGE_SET_DIR/packages.txt"

# Install mathlib template
rm -rf "$TEMPLATE_DIR"
mkdir -p "$TEMPLATE_DIR"
cp "$WORK_DIR/lean-toolchain" "$TEMPLATE_DIR/"
cp "$WORK_DIR/lakefile.toml" "$TEMPLATE_DIR/"
cp "$WORK_DIR/lake-manifest.json" "$TEMPLATE_DIR/"
cp "$WORK_DIR/Main.lean" "$TEMPLATE_DIR/"
cat > "$TEMPLATE_DIR/metadata.json" <<EOF
{ "name": "Lean $LEAN_VERSION + Mathlib", "description": "Pre-built Mathlib dependency", "packageSet": "mathlib-$LEAN_VERSION" }
EOF

# --- Step 7: Seed hello template ---
echo "[progress 7/$TOTAL Installing templates]"
HELLO_DIR="$ROOT/templates/hello"
if [ -d "$HELLO_DIR" ]; then
  echo "[seed-volume] hello template already exists, skipping."
else
  # Find hello template source: repo checkout (host) or Docker image
  HELLO_SRC="$SCRIPT_DIR/../templates/hello"
  if [ ! -d "$HELLO_SRC" ] && [ -d "/app/templates/hello" ]; then
    HELLO_SRC="/app/templates/hello"
  fi
  if [ ! -d "$HELLO_SRC" ]; then
    echo "[seed-volume] WARNING: hello template source not found, skipping."
  else
    mkdir -p "$HELLO_DIR"
    cp "$HELLO_SRC/lean-toolchain" "$HELLO_DIR/"
    cp "$HELLO_SRC/lakefile.toml" "$HELLO_DIR/"
    cp "$HELLO_SRC/Main.lean" "$HELLO_DIR/"
    cat > "$HELLO_DIR/metadata.json" <<'ENDJSON'
{ "name": "Hello World", "description": "Minimal Lean project" }
ENDJSON
    echo "[seed-volume] hello template installed."
  fi
fi

# --- Summary ---
OLEAN_COUNT=$(find "$PACKAGE_SET_DIR" -name "*.olean" | wc -l)
TOTAL_SIZE=$(du -sh "$PACKAGE_SET_DIR" | cut -f1)
PKG_COUNT=$(wc -l < "$PACKAGE_SET_DIR/packages.txt")

echo ""
echo "[seed-volume] Done."
echo "  Package set: $PACKAGE_SET_DIR"
echo "  Template:    $TEMPLATE_DIR"
echo "  Packages:    $PKG_COUNT"
echo "  .olean files: $OLEAN_COUNT"
echo "  Total size:  $TOTAL_SIZE"
