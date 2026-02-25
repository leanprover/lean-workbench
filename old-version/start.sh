#!/bin/bash
set -e

# Seed elan volume if empty (first run)
ELAN_VOLUME="/home/elan-volume"
if [ ! -f "$ELAN_VOLUME/bin/elan" ]; then
  echo "[start.sh] Seeding elan volume from image..."
  cp -a /home/elan/. "$ELAN_VOLUME/"
fi

# Start the spawner API in the background
node --experimental-strip-types /usr/local/lib/spawner/spawner.ts &

# Give spawner a moment to bind
sleep 1

# Start nginx in the foreground (keeps container alive)
exec nginx -c /etc/nginx/nginx.conf
