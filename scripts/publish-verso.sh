#!/bin/bash
# Build a Verso document and write the generated site into the staging directory.
# Runs inside a bwrap sandbox, with the project as its working directory.
#
# usage: publish-verso.sh OUT_DIR EXE
#
# example:
# publish-verso.sh /publish/out generate-book

set -euo pipefail

OUT_DIR="$1"; shift 1
EXE="$1"; shift 1

# The staging directory persists if the server was interrupted during an earlier build.
find "$OUT_DIR" -mindepth 1 -delete

echo "[[ progress 1/2 Building Lean project ]]"
lake --no-ansi --keep-toolchain build

echo "[[ progress 2/2 Generating document ]]"
lake --no-ansi exe "$EXE" --output "$OUT_DIR"
