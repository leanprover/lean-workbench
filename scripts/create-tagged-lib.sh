#!/bin/bash
# Create a Mathlib or closely-related-to-Mathlib (e.g. CSLib) project
# usage: create-tagged-lib.sh WORK_DIR TEMPLATE_ID LIBRARY_GITHUB LIBRARY_ID LIBRARY_GIT_TAG
#
# example:
# create-tagged-lib.sh /tmp/abcd new-template leanprover/cslib cslib v4.32.0
#
# expects $WORK_DIR/build/Main.lean to exist

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

trap 'rm -rf "$WORK_DIR"' EXIT

if [ -d "$ROOT/templates/$TEMPLATE_ID" ]; then
  echo "ERROR: template '$TEMPLATE_ID' already exists"
  exit 1
fi

if [ -d "$ROOT/package-sets/$TEMPLATE_ID" ]; then
  echo "ERROR: package set '$TEMPLATE_ID' already exists"
  exit 1
fi

echo "[[ progress 1/8 Constructing project ]]"
BUILD_DIR="$WORK_DIR/build"
cd "$BUILD_DIR"

echo "$TOOLCHAIN" > lean-toolchain

cat > lakefile.toml <<EOF
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

echo "[[ progress 2/8 Acquiring source for $LIBRARY_ID ]]"
mkdir -p .lake/packages
git clone --filter=tree:0 --branch "$LIBRARY_GIT_TAG" --progress "https://github.com/$LIBRARY_GITHUB" ".lake/packages/$LIBRARY_ID"

echo "[[ progress 3/8 Acquiring project dependencies ]]"
MATHLIB_NO_CACHE_ON_UPDATE=1 lake --keep-toolchain --no-ansi update

echo "[[ progress 4/8 Downloading Mathlib cache ]]"
lake --no-ansi exe cache get

echo "[[ progress 5/8 Building project ]]"
lake --no-ansi build

echo "[[ progress 6/8 Constructing package set ]]"
PACKAGE_SET_DIR="$WORK_DIR/package-set"
mkdir "$PACKAGE_SET_DIR"

for pkg_dir in "$BUILD_DIR/.lake/packages"/*/; do
  pkg_name=$(basename "$pkg_dir")
  echo "[package set] copying package: $pkg_name"
  pkg_dest="$PACKAGE_SET_DIR/$pkg_name/.lake/packages/$pkg_name"
  mkdir -p "$(dirname "$pkg_dest")"
  mv --strip-trailing-slashes "$pkg_dir" "$pkg_dest"
done

ls -d "$PACKAGE_SET_DIR"/*/ | xargs -n1 basename > "$PACKAGE_SET_DIR/packages.txt"

echo "[[ progress 7/8 Constructing template ]]"
TEMPLATE_DIR="$WORK_DIR/template"
mkdir -p "$TEMPLATE_DIR"

mv "$BUILD_DIR/lean-toolchain" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/lakefile.toml" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/lake-manifest.json" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/Main.lean" "$TEMPLATE_DIR/"
mv "$BUILD_DIR/metadata.json" "$TEMPLATE_DIR/"

echo "[[ progress 8/8 Placing package set and template ]]"
# NOTE: it's possible for the first placement to succeed and the second to fail;
# the package set placement won't be rolled back if this happens.
PACKAGE_SET_PLACED="$ROOT/package-sets/$TEMPLATE_ID"
TEMPLATE_PLACED="$ROOT/templates/$TEMPLATE_ID"

mv "$PACKAGE_SET_DIR" "$PACKAGE_SET_PLACED"
mv "$TEMPLATE_DIR" "$TEMPLATE_PLACED"

# --- Summary ---
OLEAN_COUNT=$(find "$PACKAGE_SET_PLACED" -name "*.olean" | wc -l)
TOTAL_SIZE=$(du -sh "$PACKAGE_SET_PLACED" | cut -f1)
PKG_COUNT=$(wc -l < "$PACKAGE_SET_PLACED/packages.txt")

echo ""
echo "[create-template] Done."
echo "  Package set: $PACKAGE_SET_PLACED"
echo "  Template:    $TEMPLATE_PLACED"
echo "  Packages:    $PKG_COUNT"
echo "  .olean files: $OLEAN_COUNT"
echo "  Total size:  $TOTAL_SIZE"
