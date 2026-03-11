#!/bin/bash
#
# Create a test workspace that uses the mathlib template.
#
# This copies template files into a new workspace directory under
# $ROOT/workspaces/<user>/<uuid>/ and creates the .lake/packages/
# mount point for overlay mounts.
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: mk-mathlib-workspace.sh [OPTIONS]

Create a test workspace from the mathlib template.

Options:
  --root DIR       Root directory for podserver state
                   (default: $PODSERVER_ROOT or /tmp/podserver)
  --user NAME      Username for the workspace (default: testuser)
  --version VER    Lean version suffix, e.g. v4.28.0
                   (default: auto-detect from available templates)
  --help           Show this help message

The workspace is created at $ROOT/workspaces/<user>/<uuid>/ with
template files copied from $ROOT/templates/mathlib-<version>/.
EOF
  exit 0
}

ROOT="${PODSERVER_ROOT:-/tmp/podserver}"
USER_NAME="testuser"
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --user) USER_NAME="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; echo "Try --help"; exit 1 ;;
  esac
done

# Auto-detect version from available templates
if [ -z "$VERSION" ]; then
  TEMPLATE_DIR=$(ls -d "$ROOT/templates/mathlib-"* 2>/dev/null | head -1)
  if [ -z "$TEMPLATE_DIR" ]; then
    echo "Error: No mathlib template found under $ROOT/templates/"
    echo "Run mk-mathlib-package.sh first."
    exit 1
  fi
  VERSION=$(basename "$TEMPLATE_DIR" | sed 's/^mathlib-//')
  echo "[mk-mathlib-workspace] Auto-detected version: $VERSION"
else
  TEMPLATE_DIR="$ROOT/templates/mathlib-$VERSION"
fi

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "Error: Template not found at $TEMPLATE_DIR"
  echo "Run mk-mathlib-package.sh first."
  exit 1
fi

# Generate a UUID for the workspace
UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')

WORKSPACE="$ROOT/workspaces/$USER_NAME/$UUID"
mkdir -p "$WORKSPACE"

# Copy template files
for f in lean-toolchain lakefile.toml lake-manifest.json Main.lean; do
  if [ -f "$TEMPLATE_DIR/$f" ]; then
    cp "$TEMPLATE_DIR/$f" "$WORKSPACE/$f"
  fi
done

# Create .lake/packages/ mount point (overlay targets will be mounted here)
mkdir -p "$WORKSPACE/.lake/packages"

echo "[mk-mathlib-workspace] Created workspace:"
echo "  Path:     $WORKSPACE"
echo "  UUID:     $UUID"
echo "  User:     $USER_NAME"
echo "  Version:  $VERSION"
echo "  Template: $TEMPLATE_DIR"
echo ""
echo "Files:"
ls -la "$WORKSPACE"
