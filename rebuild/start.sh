#!/bin/bash
set -e

OPENVSCODE_SERVER_ROOT="/home/.openvscode-server"
WORKSPACE="/home/workspace"

# Start openvscode-server inside bubblewrap sandbox
bwrap \
    --ro-bind /usr /usr \
    --ro-bind /lib /lib \
    --ro-bind-try /lib64 /lib64 \
    --ro-bind /bin /bin \
    --ro-bind /etc /etc \
    --ro-bind "$OPENVSCODE_SERVER_ROOT" "$OPENVSCODE_SERVER_ROOT" \
    --bind "$WORKSPACE" "$WORKSPACE" \
    --dev /dev \
    --tmpfs /tmp \
    --unshare-pid \
    --die-with-parent \
    --new-session \
    -- "$OPENVSCODE_SERVER_ROOT/bin/openvscode-server" \
        --host 127.0.0.1 \
        --port 3001 \
        --without-connection-token \
        "$@" &

VSCODE_PID=$!

# Give VS Code a moment to start
sleep 2

# Start nginx in foreground
exec nginx -c /etc/nginx/nginx.conf
