#!/bin/bash
# Create a template from a repository
# usage: create-github.sh WORK_DIR TEMPLATE_ID GIT_URL GIT_REV
#
# example:
# create-github.sh /tmp/abcd new-teamplte https://github.com/gancherj/Lait-Starter.git main
#
# expects the following to exist:
#  - $WORK_DIR/build/metadata.json
#
# Note: only works when the template uses at least one external dependency

set -euo pipefail
ROOT=${LEAN_WORKBENCH_DATA_DIR:?No data directory was specified}
export ELAN_HOME="$ROOT/elan"
export PATH="$ELAN_HOME/bin:$PATH"

WORK_DIR="$1"; shift 1
TEMPLATE_ID="$1"; shift 1
GIT_URL="$1"; shift 1
GIT_REV="$1"; shift 1
BUILD_DIR="$WORK_DIR/build"

trap 'rm -rf "$WORK_DIR"' EXIT

if [ -d "$ROOT/templates/$TEMPLATE_ID" ]; then
  echo "ERROR: template '$TEMPLATE_ID' already exists"
  exit 1
fi

if [ -d "$ROOT/package-sets/$TEMPLATE_ID" ]; then
  echo "ERROR: package set '$TEMPLATE_ID' already exists"
  exit 1
fi

echo "[[ progress 1/6 Checking out project ]]"
REPO_DIR="$WORK_DIR/repo"
git clone -- "$GIT_URL" "$REPO_DIR"
cd "$REPO_DIR"
git checkout "$GIT_REV"
git submodule update --init --recursive

echo "[[ progress 2/6 Acquiring project dependencies ]]"
if [ ! -f lake-manifest.json ]; then
  MATHLIB_NO_CACHE_ON_UPDATE=1  lake --keep-toolchain --no-ansi update
fi

if ! lake --no-ansi exe @mathlib/cache get; then
  echo "Mathlib cache unavailable (or not a Mathlib-using project)"
fi

echo "[[ progress 3/6 Building project (default target) ]]"
lake --no-ansi build

echo "[[ progress 4/6 Constructing package set ]]"
PACKAGE_SET_DIR="$WORK_DIR/package-set"
mkdir "$PACKAGE_SET_DIR"

touch "$PACKAGE_SET_DIR/packages.txt"
shopt -s nullglob # Work with zero-package repos too
for pkg_dir in "$REPO_DIR/.lake/packages"/*/; do
  pkg_name=$(basename "$pkg_dir")
  echo "[package set] copying package: $pkg_name"
  pkg_dest="$PACKAGE_SET_DIR/$pkg_name/.lake/packages/$pkg_name"
  mkdir -p "$(dirname "$pkg_dest")"
  mv --strip-trailing-slashes "$pkg_dir" "$pkg_dest"
  echo "$pkg_name" >> "$PACKAGE_SET_DIR/packages.txt"
done

echo "[[ progress 5/6 Constructing template ]]"
TEMPLATE_DIR="$WORK_DIR/template"
mkdir -p "$TEMPLATE_DIR"
rsync -a --exclude='.git' --exclude='.github' --exclude='.lake' "$REPO_DIR"/ "$TEMPLATE_DIR"/

mv "$BUILD_DIR/metadata.json" "$TEMPLATE_DIR/"

echo "[[ progress 6/6 Placing package set and template ]]"
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
echo "  Package set:  $PACKAGE_SET_PLACED"
echo "  Template:     $TEMPLATE_PLACED"
echo "  Packages:     $PKG_COUNT"
echo "  .olean files: $OLEAN_COUNT"
echo "  Total size:   $TOTAL_SIZE"
