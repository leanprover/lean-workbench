#!/bin/bash
#
# SUPERSEDED by mk-mathlib-package.sh — kept for reference.
#
# Create a mathlib installation for podserver.
#
# Run this on the host (outside Docker). If elan is not already
# installed at $PODSERVER_ROOT/elan/, the script installs it.
#
# Usage:
#   ./scripts/mk-mathlib-installation.sh
#
# This populates /tmp/podserver/installations/mathlib/ with:
#   lean-toolchain          (pinned version, e.g. leanprover/lean4:v4.28.0)
#   lakefile.toml           (with mathlib pinned to matching version)
#   Main.lean
#   lake-manifest.json      (resolved dependency lock file)
#   .lake/packages/         (dependency sources + pre-compiled oleans)
#
set -euo pipefail

PODSERVER_ROOT="${PODSERVER_ROOT:-/tmp/podserver}"
ELAN_HOME="$PODSERVER_ROOT/elan"
INSTALL_DIR="$PODSERVER_ROOT/installations/mathlib"

# Install elan if not present
if [ ! -x "$ELAN_HOME/bin/elan" ]; then
  echo "[mk-mathlib] elan not found at $ELAN_HOME, installing..."
  mkdir -p "$ELAN_HOME"
  curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
    | ELAN_HOME="$ELAN_HOME" sh -s -- -y --default-toolchain leanprover/lean4:stable --no-modify-path
fi

export ELAN_HOME
export PATH="$ELAN_HOME/bin:$PATH"

# Force toolchain download (elan installs lazily)
echo "[mk-mathlib] Ensuring toolchain is downloaded..."
lean --version

# Resolve the concrete version from the installed toolchain
# e.g. "leanprover--lean4---v4.28.0" -> "v4.28.0"
RESOLVED_DIR=$(ls "$ELAN_HOME/toolchains/")
LEAN_VERSION=$(echo "$RESOLVED_DIR" | sed 's/.*---//')
echo "[mk-mathlib] Resolved Lean version: $LEAN_VERSION"

# Pin elan's default to the concrete version
TOOLCHAIN="leanprover/lean4:$LEAN_VERSION"
sed -i "s|^default_toolchain = .*|default_toolchain = \"$TOOLCHAIN\"|" "$ELAN_HOME/settings.toml"
echo "[mk-mathlib] Pinned elan default to $TOOLCHAIN"

# Mathlib versions are in sync with Lean versions
MATHLIB_REV="$LEAN_VERSION"
echo "[mk-mathlib] Will use mathlib rev: $MATHLIB_REV"

# Work in a temp directory
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
echo "[mk-mathlib] Working in $WORK_DIR"

# Generate project files with pinned versions
echo "$TOOLCHAIN" > "$WORK_DIR/lean-toolchain"

cat > "$WORK_DIR/lakefile.toml" <<EOF
name = "mathlib-project"
version = "0.1.0"

[[require]]
name = "mathlib"
scope = "leanprover-community"
rev = "$MATHLIB_REV"
EOF

cat > "$WORK_DIR/Main.lean" <<'EOF'
import Mathlib

#check Nat.add_comm
EOF

cd "$WORK_DIR"

echo "[mk-mathlib] Running lake update..."
lake update

echo "[mk-mathlib] Fetching pre-compiled mathlib oleans..."
lake exe cache get

# Install results
echo "[mk-mathlib] Installing to $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/.lake"
cp "$WORK_DIR/lean-toolchain" "$INSTALL_DIR/"
cp "$WORK_DIR/lakefile.toml" "$INSTALL_DIR/"
cp "$WORK_DIR/Main.lean" "$INSTALL_DIR/"
cp "$WORK_DIR/lake-manifest.json" "$INSTALL_DIR/"
mv "$WORK_DIR/.lake/packages" "$INSTALL_DIR/.lake/packages"

OLEAN_COUNT=$(find "$INSTALL_DIR/.lake/packages" -name "*.olean" | wc -l)
echo "[mk-mathlib] Done. Installation at $INSTALL_DIR"
echo "[mk-mathlib] Contents:"
echo "  lean-toolchain: $(cat "$INSTALL_DIR/lean-toolchain")"
echo "  lake-manifest.json ($(wc -c < "$INSTALL_DIR/lake-manifest.json") bytes)"
echo "  .lake/packages/ ($(du -sh "$INSTALL_DIR/.lake/packages" | cut -f1))"
echo "  .olean files: $OLEAN_COUNT"
if [ "$OLEAN_COUNT" -lt 100 ]; then
  echo "[mk-mathlib] WARNING: Very few .olean files found. The mathlib cache may not have downloaded correctly."
fi
