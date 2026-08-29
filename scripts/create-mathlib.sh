#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="/data"
export ELAN_HOME="$ROOT/elan"
export PATH="$ELAN_HOME/bin:$PATH"

WORK_DIR="$1"; shift 1
PROJECT_ID="$1"; shift 1
LEAN_VERSION="$1"; shift 1
TOOLCHAIN="leanprover/lean4:$LEAN_VERSION"

trap 'rm -rf "$WORK_DIR"' EXIT

echo "[Step 1/5: Checking out mathlib]"
cd "$WORK_DIR"
mkdir -p .lake/packages
git clone  --filter=tree:0 --branch "$LEAN_VERSION" --progress https://github.com/leanprover-community/mathlib4 .lake/packages/mathlib

# We have to use the exact mathlib revision to make the depth-1 clone work
echo "$TOOLCHAIN" > "$WORK_DIR/lean-toolchain"
cat > "$WORK_DIR/lakefile.toml" <<EOF
name = "mathlib-project"
version = "0.1.0"

[[require]]
name = "mathlib"
git = "https://github.com/leanprover-community/mathlib4"
rev = "$LEAN_VERSION"
EOF
cat > "$WORK_DIR/Main.lean" <<'EOF'
import Mathlib

#check Nat.add_comm
EOF

echo ""
echo "[Step 2/5: Checking out mathlib dependencies]"
lake update --keep-toolchain --no-ansi

echo ""
echo "[Step 3/5: Downloading pre-compiled modules]"
lake --no-ansi exe cache get

echo ""
echo "[Step 4/5: Create package set for this project]"
PACKAGE_SET_DIR="$ROOT/package-sets/$PROJECT_ID"
rm -rf "$PACKAGE_SET_DIR"
mkdir -p "$PACKAGE_SET_DIR"

for pkg_dir in "$WORK_DIR/.lake/packages"/*/; do
  pkg_name=$(basename "$pkg_dir")
  echo "[store-packages]  copying package: $pkg_name"
  # Store each package at the .lake/packages/<pkg> path it occupies in a project;
  # see buildProjectMount.
  pkg_dest="$PACKAGE_SET_DIR/$pkg_name/.lake/packages/$pkg_name"
  mkdir -p "$(dirname "$pkg_dest")"
  cp -a "$pkg_dir" "$pkg_dest"
done

ls -d "$PACKAGE_SET_DIR"/*/ | xargs -n1 basename > "$PACKAGE_SET_DIR/packages.txt"

echo ""
echo "[5/5: Build template]"
TEMPLATE_DIR="$ROOT/templates/$PROJECT_ID"
rm -rf "$TEMPLATE_DIR"
mkdir -p "$TEMPLATE_DIR"

cp "$WORK_DIR/lean-toolchain" "$TEMPLATE_DIR/"
cp "$WORK_DIR/lakefile.toml" "$TEMPLATE_DIR/"
cp "$WORK_DIR/lake-manifest.json" "$TEMPLATE_DIR/"
cp "$WORK_DIR/Main.lean" "$TEMPLATE_DIR/"
cp "$WORK_DIR/metadata.json" "$TEMPLATE_DIR/"
echo "Template $PROJECT_ID created"