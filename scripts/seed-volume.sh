#!/bin/bash
#
# Seed the podserver data volume with everything needed to run.
#
# This is the one-stop setup script. Run it before `make build` / `make serve`.
# It is idempotent — safe to re-run.
#
# What it does:
#   1. Creates the directory structure under $ROOT
#   2. Installs elan (if not present)
#   3. Runs mk-mathlib-package.sh to populate package-sets/ and templates/
#   4. Seeds the "hello" template into templates/
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

# --- 1. Create directory structure ---
echo "[seed-volume] Creating directories..."
mkdir -p "$ROOT"/{workspaces,db,package-sets,templates}

# --- 2. Run mk-mathlib-package.sh (installs elan + builds mathlib package set) ---
echo ""
echo "[seed-volume] Running mk-mathlib-package.sh..."
"$SCRIPT_DIR/mk-mathlib-package.sh" --root "$ROOT"

# --- 3. Seed the "hello" template ---
HELLO_DIR="$ROOT/templates/hello"
if [ -d "$HELLO_DIR" ]; then
  echo ""
  echo "[seed-volume] hello template already exists, skipping."
else
  echo ""
  echo "[seed-volume] Seeding hello template..."
  mkdir -p "$HELLO_DIR"
  cp "$SCRIPT_DIR/../templates/hello/lean-toolchain" "$HELLO_DIR/"
  cp "$SCRIPT_DIR/../templates/hello/lakefile.toml" "$HELLO_DIR/"
  cp "$SCRIPT_DIR/../templates/hello/Main.lean" "$HELLO_DIR/"
  cat > "$HELLO_DIR/metadata.json" <<'EOF'
{ "name": "Hello World", "description": "Minimal Lean project" }
EOF
  echo "[seed-volume] hello template installed."
fi

# --- Summary ---
echo ""
echo "[seed-volume] Done. Volume contents:"
echo "  Elan:         $ROOT/elan/"
echo "  Package sets: $(ls "$ROOT/package-sets/" 2>/dev/null | tr '\n' ' ')"
echo "  Templates:    $(ls "$ROOT/templates/" 2>/dev/null | tr '\n' ' ')"
echo ""
echo "Next steps:"
echo "  make build    # build docker image"
echo "  make serve    # start the server"
