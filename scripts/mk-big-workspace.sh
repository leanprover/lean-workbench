#!/bin/bash
set -e

TARGET="${1:?Usage: mk-big-workspace.sh <target-directory>}"

LOREM="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip
ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur
sint occaecat cupidatat non proident, sunt in culpa qui officia
deserunt mollit anim id est laborum.

Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam
varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus
magna felis sollicitudin mauris. Integer in mauris eu nibh euismod
gravida. Duis ac tellus et risus vulputate vehicula. Donec lobortis
risus a elit. Etiam tempor. Ut ullamcorper, ligula ut dictum pharetra,
nisi nunc fringilla magna, in commodo elit erat nec turpis. Ut pharetra
augue nec augue. Nam elit agna, endrerit sit amet, tincidunt ac,
viverra sed, nulla."

DIRS=(
  "src/components/auth"
  "src/components/ui"
  "src/components/layout"
  "src/services/api"
  "src/services/db"
  "src/utils/helpers"
  "src/utils/validators"
  "src/models"
  "src/config"
  "lib/core/engine"
  "lib/core/parser"
  "lib/plugins/ext"
  "lib/plugins/hooks"
  "lib/shared"
  "test/unit/components"
  "test/unit/services"
  "test/unit/utils"
  "test/integration"
  "docs/api"
  "docs/guides"
)

NUM_DIRS=${#DIRS[@]}
FILE_COUNT=1000

echo "Clearing $TARGET..."
rm -rf "$TARGET"
mkdir -p "$TARGET"

for dir in "${DIRS[@]}"; do
  mkdir -p "$TARGET/$dir"
done

echo "Generating $FILE_COUNT files..."
for i in $(seq 1 $FILE_COUNT); do
  dir_idx=$((i % NUM_DIRS))
  dir="${DIRS[$dir_idx]}"

  # Vary file extensions
  case $((i % 5)) in
    0) ext="ts" ;;
    1) ext="js" ;;
    2) ext="json" ;;
    3) ext="md" ;;
    4) ext="txt" ;;
  esac

  filename="$TARGET/$dir/file-$(printf '%04d' $i).$ext"

  # Write 3-6 copies of the lorem block to get 2-4 KB
  repeats=$(( (i % 4) + 3 ))
  {
    echo "// File $i — $(date -Iseconds)"
    echo ""
    for _ in $(seq 1 $repeats); do
      echo "$LOREM"
      echo ""
    done
  } > "$filename"
done

total=$(find "$TARGET" -type f | wc -l)
size=$(du -sh "$TARGET" | cut -f1)
echo "Done: $total files, $size total in $TARGET"
