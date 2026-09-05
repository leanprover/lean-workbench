#!/bin/bash
# Create a Mathlib or closely-related-to-Mathlib (e.g. CSLib) project

set -euo pipefail
ROOT=${LEAN_WORKBENCH_DATA_DIR:?No data directory was specified}
export ELAN_HOME="$ROOT/elan"
export PATH="$ELAN_HOME/bin:$PATH"

WORK_DIR="$1"; shift 1
TEMPLATE_ID="$1"; shift 1
LIBRARY_GITHUB="$1"; shift 1
LIBRARY_ID="$1"; shift 1
LIBRARY_GIT_TAG="$1"; shift 1
TOOLCHAIN="leanprover/lean4:$LIBRARY_GIT_TAG"
PACKAGE_SET_DIR="$ROOT/package-sets/$TEMPLATE_ID"
TEMPLATE_DIR="$ROOT/templates/$TEMPLATE_ID"

trap 'rm -rf "$WORK_DIR"' EXIT

if [ -d "$TEMPLATE_DIR" ]; then
  echo "ERROR: template '$TEMPLATE_ID' already exists"
  exit 1
fi

if [ -d "$PACKAGE_SET_DIR" ]; then
  echo "ERROR: package set '$TEMPLATE_ID' already exists"
  exit 1
fi

echo "[[ progress 1/7 Constructing project template ]]"
cd "$WORK_DIR"

echo "$TOOLCHAIN" > lean-toolchain

cat > "$WORK_DIR/lakefile.toml" <<EOF
name = "$TEMPLATE_ID"
version = "0.1.0"
defaultTargets = ["Main"]

[[require]]
name = "$LIBRARY_ID"
git = "https://github.com/$LIBRARY_GITHUB"
rev = "$LIBRARY_GIT_TAG"

[[lean_lib]]
name = "Main"
EOF

echo "[[ progress 2/7 Acquiring source for $LIBRARY_ID ]]"
mkdir -p .lake/packages
git clone --filter=tree:0 --branch "$LIBRARY_GIT_TAG" --progress "https://github.com/$LIBRARY_GITHUB" ".lake/packages/$LIBRARY_ID"

echo "[[ progress 3/7 Acquiring project dependencies ]]"
MATHLIB_NO_CACHE_ON_UPDATE=1 lake --keep-toolchain --no-ansi update

echo "[[ progress 4/7 Downloading Mathlib cache ]]"
lake --no-ansi exe cache get

echo "[[ progress 5/7 Building project ]]"
lake --no-ansi build

echo "[[ progress 6/7 Creating package set ]]"
mkdir "$PACKAGE_SET_DIR"

for pkg_dir in "$WORK_DIR/.lake/packages"/*/; do
  pkg_name=$(basename "$pkg_dir")
  echo "[package set] copying package: $pkg_name"
  pkg_dest="$PACKAGE_SET_DIR/$pkg_name/.lake/packages/$pkg_name"
  mkdir -p "$(dirname "$pkg_dest")"
  mv --skip-trailing-slashes "$pkg_dir" "$pkg_dest"
done

ls -d "$PACKAGE_SET_DIR"/*/ | xargs -n1 basename > "$PACKAGE_SET_DIR/packages.txt"

echo "[[ progress 7/7 Placing completed template ]]"
mkdir -p "$TEMPLATE_DIR"

mv "$WORK_DIR/lean-toolchain" "$TEMPLATE_DIR/"
mv "$WORK_DIR/lakefile.toml" "$TEMPLATE_DIR/"
mv "$WORK_DIR/lake-manifest.json" "$TEMPLATE_DIR/"
mv "$WORK_DIR/Main.lean" "$TEMPLATE_DIR/"
mv "$WORK_DIR/metadata.json" "$TEMPLATE_DIR/"

# --- Summary ---
OLEAN_COUNT=$(find "$PACKAGE_SET_DIR" -name "*.olean" | wc -l)
TOTAL_SIZE=$(du -sh "$PACKAGE_SET_DIR" | cut -f1)
PKG_COUNT=$(wc -l < "$PACKAGE_SET_DIR/packages.txt")

echo ""
echo "[create-template] Done."
echo "  Package set: $PACKAGE_SET_DIR"
echo "  Template:    $TEMPLATE_DIR"
echo "  Packages:    $PKG_COUNT"
echo "  .olean files: $OLEAN_COUNT"
echo "  Total size:  $TOTAL_SIZE"
