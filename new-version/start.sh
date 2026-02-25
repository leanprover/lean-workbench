#!/bin/bash
set -e

# Seed elan from the image-baked copy on first run
if [ ! -d /data/elan/bin ]; then
  echo "[start.sh] Seeding /data/elan/ from image..."
  mkdir -p /data/elan
  cp -a /home/elan-image/. /data/elan/
fi

# Ensure data subdirs exist
mkdir -p /data/workspaces /data/db

# Start the spawner API in the background
node --experimental-strip-types /usr/local/lib/spawner/spawner.ts &

# Give spawner a moment to bind
sleep 1

# Start nginx in the foreground (keeps container alive)
exec nginx -c /etc/nginx/nginx.conf
