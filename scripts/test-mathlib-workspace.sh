#!/bin/bash
#
# Test that lake build works inside a bwrap sandbox with overlaid mathlib
# packages. Runs a short-lived docker container.
#
# Prerequisites:
#   1. mk-mathlib-package.sh has been run (populates package-sets/ and templates/)
#   2. mk-mathlib-workspace.sh has been run (creates a workspace)
#   3. docker image "podserver" has been built (make build)
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: test-mathlib-workspace.sh [OPTIONS]

Test lake build inside a bwrap sandbox with shared mathlib packages.

Options:
  --root DIR          Root directory for podserver state
                      (default: $PODSERVER_ROOT or /tmp/podserver)
  --workspace PATH    Path to the workspace directory (relative to ROOT)
                      (default: workspaces/testuser/00000000-...)
  --shell             Drop into a bash shell inside the bwrap sandbox
                      instead of running lake build
  --help              Show this help message

Runs a short-lived docker container that executes bwrap with --tmp-overlay
mounts for shared packages, then runs `lake build` inside the sandbox.
EOF
  exit 0
}

ROOT="${PODSERVER_ROOT:-/tmp/podserver}"
WORKSPACE_REL=""
SHELL_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --workspace) WORKSPACE_REL="$2"; shift 2 ;;
    --shell) SHELL_MODE=true; shift ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; echo "Try --help"; exit 1 ;;
  esac
done

# Default to the predictable test workspace from mk-mathlib-workspace.sh
if [ -z "$WORKSPACE_REL" ]; then
  WORKSPACE_REL="workspaces/testuser/00000000-0000-0000-0000-000000000000"
  WORKSPACE_ABS="$ROOT/$WORKSPACE_REL"
  if [ ! -f "$WORKSPACE_ABS/lean-toolchain" ]; then
    echo "Error: No workspace found at $WORKSPACE_ABS"
    echo "Run mk-mathlib-workspace.sh first."
    exit 1
  fi
  echo "[test] Using default test workspace: $WORKSPACE_REL"
else
  WORKSPACE_ABS="$ROOT/$WORKSPACE_REL"
fi

if [ ! -f "$WORKSPACE_ABS/lean-toolchain" ]; then
  echo "Error: No lean-toolchain found at $WORKSPACE_ABS"
  exit 1
fi

# Determine which package set to use by reading the template's metadata
# or by matching the lean-toolchain version
TOOLCHAIN=$(cat "$WORKSPACE_ABS/lean-toolchain")
LEAN_VERSION=$(echo "$TOOLCHAIN" | sed 's|.*/lean4:||')
PACKAGE_SET="mathlib-$LEAN_VERSION"
PACKAGE_SET_DIR="$ROOT/package-sets/$PACKAGE_SET"

if [ ! -f "$PACKAGE_SET_DIR/packages.txt" ]; then
  echo "Error: Package set not found at $PACKAGE_SET_DIR"
  echo "Run mk-mathlib-package.sh first."
  exit 1
fi

echo "[test] Configuration:"
echo "  Root:        $ROOT"
echo "  Workspace:   $WORKSPACE_REL"
echo "  Toolchain:   $TOOLCHAIN"
echo "  Package set: $PACKAGE_SET"
echo "  Packages:    $(cat "$PACKAGE_SET_DIR/packages.txt" | tr '\n' ' ')"
echo ""

# Build the script that will run inside the docker container.
# This script assembles bwrap args and runs lake build.
INNER_SCRIPT=$(cat <<'DOCKER_SCRIPT'
#!/bin/bash
set -euo pipefail

WORKSPACE_REL="$1"
PACKAGE_SET="$2"
SHELL_MODE="$3"

WORKSPACE="/data/$WORKSPACE_REL"
PACKAGE_SET_DIR="/data/package-sets/$PACKAGE_SET"
PACKAGES_FILE="$PACKAGE_SET_DIR/packages.txt"
PROJECT_NAME="lean-project"

echo "[bwrap-test] Setting up sandbox..."

# Pre-create overlay mount point directories (must exist before bwrap runs)
mkdir -p "$WORKSPACE/.lake/packages"

# Build overlay args: one --overlay-src + --tmp-overlay per shared package
OVERLAY_ARGS=()
while IFS= read -r pkg; do
  [ -z "$pkg" ] && continue
  mkdir -p "$WORKSPACE/.lake/packages/$pkg"
  OVERLAY_ARGS+=(
    "--overlay-src" "$PACKAGE_SET_DIR/$pkg"
    "--tmp-overlay" "/workspace/$PROJECT_NAME/.lake/packages/$pkg"
  )
  echo "[bwrap-test]   overlay: $pkg"
done < "$PACKAGES_FILE"

if [ "$SHELL_MODE" = "true" ]; then
  BWRAP_CMD=("/bin/bash")
  echo "[bwrap-test] Dropping into shell inside sandbox..."
else
  BWRAP_CMD=("/home/elan/bin/lake" "build" "-v")
  echo "[bwrap-test] Running lake build inside sandbox..."
fi
echo ""

START_TIME=$(date +%s)

# FIXME: Git's "dubious ownership" check (CVE-2022-24765) rejects repos owned by a
# different uid. The overlay mounts cause an ownership mismatch that triggers
# this; safe.directory=* *should* be ok here since the sandbox is already isolated,
# but this should be considered more carefully.
bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind-try /lib64 /lib64 \
  --ro-bind /bin /bin \
  --ro-bind /etc /etc \
  --ro-bind /data/elan /home/elan \
  --bind "$WORKSPACE" "/workspace/$PROJECT_NAME" \
  "${OVERLAY_ARGS[@]}" \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --clearenv \
  --setenv HOME "/workspace/$PROJECT_NAME" \
  --setenv ELAN_HOME /home/elan \
  --setenv PATH "/home/elan/bin:/usr/local/bin:/usr/bin:/bin" \
  --setenv GIT_CONFIG_COUNT 1 \
  --setenv GIT_CONFIG_KEY_0 safe.directory \
  --setenv GIT_CONFIG_VALUE_0 '*' \
  --unshare-user \
  --uid 1000 \
  --gid 1000 \
  --unshare-pid \
  --unshare-uts \
  --unshare-cgroup \
  --die-with-parent \
  --new-session \
  --chdir "/workspace/$PROJECT_NAME" \
  -- \
  "${BWRAP_CMD[@]}"

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "[bwrap-test] Done in ${ELAPSED}s"
DOCKER_SCRIPT
)

echo "[test] Starting docker container..."
echo ""

DOCKER_IT=""
if [ "$SHELL_MODE" = "true" ]; then
  DOCKER_IT="-it"
fi

docker run --rm $DOCKER_IT \
  --cap-add SYS_ADMIN \
  --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined \
  -v "$ROOT:/data" \
  --entrypoint bash \
  podserver:latest \
  -c "$INNER_SCRIPT" -- "$WORKSPACE_REL" "$PACKAGE_SET" "$SHELL_MODE"
