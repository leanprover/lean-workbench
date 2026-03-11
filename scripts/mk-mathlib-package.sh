#!/bin/bash
#
# Create a shared mathlib package set for podserver.
#
# This prepares pre-built mathlib and its transitive dependencies so they
# can be mounted into user sandboxes via --tmp-overlay.
#
# Run this on the host (outside Docker). If elan is not already installed
# at $ROOT/elan/, the script installs it.
#
# Outputs:
#   $ROOT/package-sets/mathlib-<version>/
#     mathlib/          source + .lake/build/ oleans
#     batteries/        source + .lake/build/ oleans
#     Qq/               ...
#     ...
#     packages.txt      list of package directory names
#
#   $ROOT/templates/mathlib-<version>/
#     lean-toolchain
#     lakefile.toml
#     lake-manifest.json
#     Main.lean
#     metadata.json
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: mk-mathlib-package.sh [OPTIONS]

Create a shared mathlib package set for podserver.

Options:
  --root DIR          Root directory for podserver state
                      (default: $PODSERVER_ROOT or /tmp/podserver)
  --lean-version VER  Lean version to use, e.g. v4.28.0
                      (default: auto-detect from elan stable)
  --help              Show this help message

The script installs elan if needed, fetches mathlib and its dependencies,
downloads pre-compiled .olean files, and copies the results into the
package-sets/ and templates/ directories under ROOT.
EOF
  exit 0
}

ROOT="${PODSERVER_ROOT:-/tmp/podserver}"
LEAN_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --lean-version) LEAN_VERSION="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; echo "Try --help"; exit 1 ;;
  esac
done

ELAN_HOME="$ROOT/elan"

# Install elan if not present
if [ ! -x "$ELAN_HOME/bin/elan" ]; then
  echo "[mk-mathlib-package] elan not found at $ELAN_HOME, installing..."
  mkdir -p "$ELAN_HOME"
  curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
    | ELAN_HOME="$ELAN_HOME" sh -s -- -y --default-toolchain leanprover/lean4:stable --no-modify-path
fi

export ELAN_HOME
export PATH="$ELAN_HOME/bin:$PATH"

# Force toolchain download
echo "[mk-mathlib-package] Ensuring toolchain is downloaded..."
lean --version

# Resolve version
if [ -z "$LEAN_VERSION" ]; then
  RESOLVED_DIR=$(ls "$ELAN_HOME/toolchains/" | grep -v '\.lock$' | head -1)
  LEAN_VERSION=$(echo "$RESOLVED_DIR" | sed 's/.*---//')
  echo "[mk-mathlib-package] Auto-detected Lean version: $LEAN_VERSION"
else
  echo "[mk-mathlib-package] Using specified Lean version: $LEAN_VERSION"
fi

TOOLCHAIN="leanprover/lean4:$LEAN_VERSION"

# Pin elan's default to the concrete version
sed -i "s|^default_toolchain = .*|default_toolchain = \"$TOOLCHAIN\"|" "$ELAN_HOME/settings.toml"
echo "[mk-mathlib-package] Pinned elan default to $TOOLCHAIN"

# Mathlib versions are tagged to match Lean versions
MATHLIB_REV="$LEAN_VERSION"
echo "[mk-mathlib-package] Will use mathlib rev: $MATHLIB_REV"

# Output directories
PACKAGE_SET_DIR="$ROOT/package-sets/mathlib-$LEAN_VERSION"
TEMPLATE_DIR="$ROOT/templates/mathlib-$LEAN_VERSION"

# Work in a temp directory
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
echo "[mk-mathlib-package] Working in $WORK_DIR"

# Generate project files
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

echo "[mk-mathlib-package] Running lake update..."
lake update

echo "[mk-mathlib-package] Fetching pre-compiled mathlib oleans..."
lake exe cache get

# --- Install package set ---
echo "[mk-mathlib-package] Installing package set to $PACKAGE_SET_DIR"
rm -rf "$PACKAGE_SET_DIR"
mkdir -p "$PACKAGE_SET_DIR"

# Copy each package directory from .lake/packages/
for pkg_dir in "$WORK_DIR/.lake/packages"/*/; do
  pkg_name=$(basename "$pkg_dir")
  echo "[mk-mathlib-package]   copying package: $pkg_name"
  cp -a "$pkg_dir" "$PACKAGE_SET_DIR/$pkg_name"
done

# Write manifest of package names (directories only)
ls -d "$PACKAGE_SET_DIR"/*/ | xargs -n1 basename > "$PACKAGE_SET_DIR/packages.txt"
echo "[mk-mathlib-package] Package manifest:"
cat "$PACKAGE_SET_DIR/packages.txt"

# --- Install template ---
echo "[mk-mathlib-package] Installing template to $TEMPLATE_DIR"
rm -rf "$TEMPLATE_DIR"
mkdir -p "$TEMPLATE_DIR"

cp "$WORK_DIR/lean-toolchain" "$TEMPLATE_DIR/"
cp "$WORK_DIR/lakefile.toml" "$TEMPLATE_DIR/"
cp "$WORK_DIR/lake-manifest.json" "$TEMPLATE_DIR/"
cp "$WORK_DIR/Main.lean" "$TEMPLATE_DIR/"

cat > "$TEMPLATE_DIR/metadata.json" <<EOF
{ "name": "Lean $LEAN_VERSION + Mathlib", "description": "Pre-built Mathlib dependency", "packageSet": "mathlib-$LEAN_VERSION" }
EOF

# --- Summary ---
OLEAN_COUNT=$(find "$PACKAGE_SET_DIR" -name "*.olean" | wc -l)
TOTAL_SIZE=$(du -sh "$PACKAGE_SET_DIR" | cut -f1)
PKG_COUNT=$(wc -l < "$PACKAGE_SET_DIR/packages.txt")

echo ""
echo "[mk-mathlib-package] Done."
echo "  Package set: $PACKAGE_SET_DIR"
echo "  Template:    $TEMPLATE_DIR"
echo "  Packages:    $PKG_COUNT"
echo "  .olean files: $OLEAN_COUNT"
echo "  Total size:  $TOTAL_SIZE"

if [ "$OLEAN_COUNT" -lt 100 ]; then
  echo "[mk-mathlib-package] WARNING: Very few .olean files. The mathlib cache may not have downloaded correctly."
fi
