#!/bin/bash
#
# Docker container entrypoint (see ENTRYPOINT in Dockerfile).
# Seeds the data volume on first run, then starts the spawner and nginx.
#
set -e

# Ensure data subdirs exist
mkdir -p /data/workspaces /data/db /data/package-sets /data/templates

# Start the spawner API in the background
node --experimental-transform-types /usr/local/lib/server/src/spawner.ts &

# Give spawner a moment to bind
sleep 1

# Start nginx in the foreground (keeps container alive)
echo "[start.sh] Frontend listening on http://localhost:3000"
exec nginx -c /etc/nginx/nginx.conf
