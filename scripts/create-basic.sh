#!/bin/bash
# Create a minimal Lean teamplate

set -euo pipefail

ROOT="/data"
export ELAN_HOME="$ROOT/elan"
export PATH="$ELAN_HOME/bin:$PATH"

WORK_DIR="$1"; shift 1
TEMPLATE_ID="$1"; shift 1
TOOLCHAIN="$1"; shift 1
TEMPLATE_DIR="$ROOT/templates/$TEMPLATE_ID"

trap 'rm -rf "$WORK_DIR"' EXIT

if [ -d "$TEMPLATE_DIR" ]; then
  echo "ERROR: template '$TEMPLATE_ID' already exists"
  exit 1
fi

echo "[[ progress 1/3 Constructing project template ]]"
cd "$WORK_DIR"
echo "$TOOLCHAIN" > lean-toolchain

cat > lakefile.toml <<EOF
name = "$TEMPLATE_ID"
version = "0.1.0"
defaultTargets = ["Main"]

[[lean_lib]]
name = "Main"
EOF

cat > Main.lean <<EOF
#check Nat.add_comm

#eval show IO Unit from
  IO.println "Hello, world!"
EOF

echo "[[ progress 2/3 Building project ]]"
lake --no-ansi --keep-toolchain build

echo "[[ progress 3/3 Placing completed template ]]"
TEMPLATE_DIR="$ROOT/templates/$TEMPLATE_ID"
mkdir "$TEMPLATE_DIR"
mv "$WORK_DIR/metadata.json" "$TEMPLATE_DIR/"
mv "$WORK_DIR/lean-toolchain" "$TEMPLATE_DIR/"
mv "$WORK_DIR/lakefile.toml" "$TEMPLATE_DIR/"
mv "$WORK_DIR/lake-manifest.json" "$TEMPLATE_DIR/"
mv "$WORK_DIR/Main.lean" "$TEMPLATE_DIR/"

echo "Template $TEMPLATE_ID created successfully!"