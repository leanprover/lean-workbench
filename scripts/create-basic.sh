#!/bin/bash
# Create a minimal Lean template
# usage: create-basic.sh WORK_DIR TEMPLATE_ID TOOLCHAIN
#
# example:
# create-basic.sh /tmp/abcd new-template leanprover/lean4:v4.32.0
#
# expects $WORK_DIR/build/Main.lean must exist

set -euo pipefail

ROOT=${LEAN_WORKBENCH_DATA_DIR:?No data directory was specified}
export ELAN_HOME="$ROOT/elan"
export PATH="$ELAN_HOME/bin:$PATH"

WORK_DIR="$1"; shift 1
TEMPLATE_ID="$1"; shift 1
TOOLCHAIN="$1"; shift 1

trap 'rm -rf "$WORK_DIR"' EXIT

if [ -d "$ROOT/templates/$TEMPLATE_ID" ]; then
  echo "ERROR: template '$TEMPLATE_ID' already exists"
  exit 1
fi

echo "[[ progress 1/4 Constructing project ]]"
BUILD_DIR="$WORK_DIR/build"
cd "$BUILD_DIR"

echo "$TOOLCHAIN" > lean-toolchain

cat > lakefile.toml <<EOF
name = "$TEMPLATE_ID"
version = "0.1.0"
defaultTargets = ["Main"]

[[lean_lib]]
name = "Main"
EOF

echo "[[ progress 2/4 Building project ]]"
lake --no-ansi --keep-toolchain build

echo "[[ progress 3/4 Constructing template ]]"
TEMPLATE_DIR="$WORK_DIR/template"
mkdir "$TEMPLATE_DIR"

mv "$BUILD_DIR/metadata.json" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/lean-toolchain" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/lakefile.toml" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/lake-manifest.json" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/Main.lean" "$TEMPLATE_DIR/"

echo "[[ progress 4/4 Placing template ]]"
TEMPLATE_PLACED="$ROOT/templates/$TEMPLATE_ID"
mv "$TEMPLATE_DIR" "$TEMPLATE_PLACED"

echo "Template $TEMPLATE_ID created successfully!"