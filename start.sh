#!/bin/bash
set -e

# Start the spawner API in the background
node --experimental-strip-types /usr/local/lib/spawner/spawner.ts &

# Give spawner a moment to bind
sleep 1

# Start nginx in the foreground (keeps container alive)
exec nginx -c /etc/nginx/nginx.conf
