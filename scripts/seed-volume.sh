#!/bin/bash
#
# Seed the lean-workbench data volume with everything needed to run.
#
# This is the one-stop setup script. Run it before `make build` / `make serve`.
# It is idempotent — safe to re-run.
#
# What it does:
#   1. Creates the directory structure under $ROOT
#   2. Populates package-sets/ and templates/
#   3. Seeds the "hello" template into templates/
#
# Progress markers:
#   Lines matching [[ progress STEP/TOTAL LABEL ]] are parsed by the setup UI
#   to drive a progress bar.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: seed-volume.sh [OPTIONS]

Seed the lean-workbench data volume with elan and a blank template.

Options:
  --data-dir DIR       Data directory for lean-workbench state
                       (default: /data)
  --install-toolchain  Install the latest stable lake toolchain
                       (default: latest v4.* tag on mathlib4)
  --help               Show this help message
EOF
  exit 0
}

ROOT="/data"
INSTALL_TOOLCHAIN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) ROOT="$2"; shift 2 ;;
    --install-toolchain) INSTALL_TOOLCHAIN=1; shift 1 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; echo "Try --help"; exit 1 ;;
  esac
done

echo "[seed-volume] Data directory: $ROOT"
echo ""

STEP=0
TOTAL=3
if (( INSTALL_TOOLCHAIN )); then
  TOTAL=4
fi

# ------
STEP=$(( STEP + 1 ))
echo "[[ progress $STEP/$TOTAL Creating directory structure ]]"
mkdir -p "$ROOT"/{workspaces,db,package-sets,templates}

# ------
STEP=$(( STEP + 1 ))
echo "[[ progress $STEP/$TOTAL Installing elan ]]"
ELAN_HOME="$ROOT/elan"
if [ ! -x "$ELAN_HOME/bin/elan" ]; then
  echo "[seed-volume] Downloading elan + Lean toolchain..."
  mkdir -p "$ELAN_HOME"
  curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
    | ELAN_HOME="$ELAN_HOME" sh -s -- -y --no-modify-path
else
  echo "[seed-volume] elan already installed."
fi

# ------
if (( INSTALL_TOOLCHAIN )); then
  STEP=$(( STEP + 1 ))
  echo "[[ progress $STEP/$TOTAL Installing latest toolchain ]]"
  ELAN_HOME="$ELAN_HOME" "$ELAN_HOME/bin/elan" install stable
fi

# -----
STEP=$(( STEP + 1 ))
echo "[[ progress $STEP/$TOTAL Creating a blank template ]]"
BLANK_TEMPLATE_DIR="$ROOT/templates/blank"
mkdir -p "$BLANK_TEMPLATE_DIR"
cat > "$BLANK_TEMPLATE_DIR/metadata.json" <<EOF
{ "name": "Blank", "description": "Empty workspace" }
EOF

echo "Finished seeding Workbench"
