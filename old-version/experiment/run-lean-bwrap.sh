#!/bin/bash
set -euo pipefail

LEAN_PREFIX=$(cat /home/lean/lean-prefix.txt)
echo "=== Lean toolchain prefix ==="
echo "$LEAN_PREFIX"
echo

echo "=== Diagnostics ==="
echo "--- file output on lean binary ---"
file "$LEAN_PREFIX/bin/lean"
echo
echo "--- lean --version (outside sandbox) ---"
"$LEAN_PREFIX/bin/lean" --version
echo

# Helper: run a bwrap command and report success/failure
try_bwrap() {
    local label="$1"
    shift
    echo "=== $label ==="
    echo "Command: bwrap $*"
    echo
    if bwrap "$@"; then
        echo ">>> SUCCESS: $label"
        echo
        return 0
    else
        echo ">>> FAILED: $label (exit code $?)"
        echo
        return 1
    fi
}

# Common filesystem args (no /proc — that varies per attempt)
FS_ARGS=(
    --ro-bind /usr /usr
    --ro-bind /lib /lib
    --ro-bind-try /lib64 /lib64
    --ro-bind /bin /bin
    --ro-bind /etc /etc
    --ro-bind "$LEAN_PREFIX" /lean
    --dev /dev
    --tmpfs /tmp
    --clearenv
    --setenv PATH "/lean/bin:/usr/bin:/bin"
    --setenv HOME "/tmp"
    --die-with-parent
    --new-session
)

# Track which attempt succeeded for the --run test
WORKING_ATTEMPT=""
WORKING_ARGS=()

# --- Attempt 1: Full isolation matching lean4web ---
# Uses --proc /proc (new procfs) + all --unshare-* flags.
# This is exactly what lean4web does on bare metal.
# Requires: docker run --cap-add SYS_ADMIN --security-opt apparmor=unconfined --security-opt seccomp=unconfined
ARGS_1=(
    "${FS_ARGS[@]}"
    --proc /proc
    --unshare-user
    --unshare-pid
    --unshare-net
    --unshare-uts
    --unshare-cgroup
    -- lean --version
)

if try_bwrap "Attempt 1: Full isolation (lean4web-style, --proc /proc)" "${ARGS_1[@]}"; then
    WORKING_ATTEMPT="1"
    WORKING_ARGS=(
        "${FS_ARGS[@]}"
        --proc /proc
        --unshare-user
        --unshare-pid
        --unshare-net
        --unshare-uts
        --unshare-cgroup
    )
fi

# --- Attempt 2: Full unshare but --ro-bind /proc instead of --proc ---
# Fallback if --proc /proc is blocked (e.g. AppArmor still active).
# Uses --unshare-user to make --unshare-net work.
# --unshare-pid is skipped because --ro-bind /proc breaks /proc/self/exe
# in a new PID namespace.
if [ -z "$WORKING_ATTEMPT" ]; then
    ARGS_2=(
        "${FS_ARGS[@]}"
        --ro-bind /proc /proc
        --unshare-user
        --unshare-net
        --unshare-uts
        --unshare-cgroup
        -- lean --version
    )

    if try_bwrap "Attempt 2: --ro-bind /proc, unshare user/net/uts/cgroup (no pid)" "${ARGS_2[@]}"; then
        WORKING_ATTEMPT="2"
        WORKING_ARGS=(
            "${FS_ARGS[@]}"
            --ro-bind /proc /proc
            --unshare-user
            --unshare-net
            --unshare-uts
            --unshare-cgroup
        )
    fi
fi

# --- Attempt 3: Minimal — filesystem isolation only ---
# Known to work. No namespace isolation.
if [ -z "$WORKING_ATTEMPT" ]; then
    ARGS_3=(
        "${FS_ARGS[@]}"
        --ro-bind /proc /proc
        -- lean --version
    )

    if try_bwrap "Attempt 3: Minimal (filesystem only)" "${ARGS_3[@]}"; then
        WORKING_ATTEMPT="3"
        WORKING_ARGS=(
            "${FS_ARGS[@]}"
            --ro-bind /proc /proc
        )
    fi
fi

# --- Run actual Lean code with the working config ---
if [ -n "$WORKING_ATTEMPT" ]; then
    echo "=== Run Lean code (using config from attempt $WORKING_ATTEMPT) ==="

    # Write test file outside the sandbox, then bind-mount it in
    mkdir -p /tmp/lean-test
    cat > /tmp/lean-test/test.lean <<'EOF'
def main : IO Unit :=
  IO.println "Hello from bwrap"
EOF

    ARGS_RUN=(
        "${WORKING_ARGS[@]}"
        --ro-bind /tmp/lean-test /tmp/lean-test
        -- lean --run /tmp/lean-test/test.lean
    )

    echo "Command: bwrap ${ARGS_RUN[*]}"
    echo
    if bwrap "${ARGS_RUN[@]}"; then
        echo ">>> SUCCESS: Lean --run inside bwrap!"
    else
        echo ">>> FAILED: Lean --run inside bwrap (exit code $?)"
    fi
    echo
else
    echo "=== All bwrap attempts failed ==="
    echo "Try running with more Docker permissions:"
    echo "  docker run --rm -it --cap-add SYS_ADMIN --security-opt apparmor=unconfined --security-opt seccomp=unconfined lean-bwrap-experiment"
    echo
fi

echo "=== Done ==="
