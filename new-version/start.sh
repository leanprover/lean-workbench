#!/bin/bash
set -e

# Start openvscode-server in the background
/home/.openvscode-server/bin/openvscode-server \
    --host 127.0.0.1 \
    --port 3001 \
    --without-connection-token \
    "$@" &

# Give it a moment to bind
sleep 1

# Start nginx in the foreground (keeps container alive)
exec nginx -c /etc/nginx/nginx.conf
