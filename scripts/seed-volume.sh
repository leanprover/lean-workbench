#!/bin/bash
# Seed the lean-workbench data volume with everything needed to run.

set -euo pipefail

ROOT="/data"
INSTALL_TOOLCHAIN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-toolchain) INSTALL_TOOLCHAIN=1; shift 1 ;;
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
    | ELAN_HOME="$ELAN_HOME" sh -s -- -y --no-modify-path --default-toolchain none
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
