#!/bin/bash
#
# Seed the podserver data volume with everything needed to run.
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

Seed the podserver data volume with elan, mathlib packages, and templates.

Options:
  --root DIR          Root directory for podserver state
                      (default: $PODSERVER_ROOT or /tmp/podserver)
  --help              Show this help message
EOF
  exit 0
}

ROOT="${PODSERVER_ROOT:-/tmp/podserver}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; echo "Try --help"; exit 1 ;;
  esac
done

echo "[seed-volume] Root: $ROOT"
echo ""

TOTAL=7

# --- Step 1: Create directory structure ---
echo "[progress 1/$TOTAL Creating directories]"
mkdir -p "$ROOT"/{workspaces,db,package-sets,templates}

# --- Step 2: Install elan ---
echo "[progress 2/$TOTAL Installing elan]"
ELAN_HOME="$ROOT/elan"
if [ ! -x "$ELAN_HOME/bin/elan" ]; then
  # Prefer the image-baked copy if available, otherwise download
  if [ -d "/home/elan-image/bin" ]; then
    echo "[seed-volume] Copying elan from Docker image..."
    mkdir -p "$ELAN_HOME"
    cp -a /home/elan-image/. "$ELAN_HOME/"
  else
    echo "[seed-volume] Downloading elan..."
    mkdir -p "$ELAN_HOME"
    curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
      | ELAN_HOME="$ELAN_HOME" sh -s -- -y --default-toolchain leanprover/lean4:stable --no-modify-path
  fi
else
  echo "[seed-volume] elan already installed."
fi

export ELAN_HOME
export PATH="$ELAN_HOME/bin:$PATH"

# --- Step 3: Resolve Lean version ---
echo "[progress 3/$TOTAL Resolving Lean version]"
lean --version
RESOLVED_DIR=$(ls "$ELAN_HOME/toolchains/" | grep -v '\.lock$' | head -1)
LEAN_VERSION=$(echo "$RESOLVED_DIR" | sed 's/.*---//')
TOOLCHAIN="leanprover/lean4:$LEAN_VERSION"
sed -i "s|^default_toolchain = .*|default_toolchain = \"$TOOLCHAIN\"|" "$ELAN_HOME/settings.toml"
echo "[seed-volume] Using Lean $LEAN_VERSION"

# --- Step 4: Fetch mathlib source ---
echo "[progress 4/$TOTAL Fetching mathlib source]"
MATHLIB_REV="$LEAN_VERSION"
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
  if [ ! -d "$HELLO_SRC" ] && [ -d "/home/templates/hello" ]; then
    HELLO_SRC="/home/templates/hello"
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
