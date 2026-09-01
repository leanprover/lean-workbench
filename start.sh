#!/bin/bash
# Runs the Next.js app and the Nginx reverse proxy.
# Docker container entrypoint (see ENTRYPOINT in Dockerfile).
# Path envvars default to their values in the Docker container.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

LEAN_WORKBENCH_DATA_DIR="${LEAN_WORKBENCH_DATA_DIR:-/data}"
VSCODE_SERVER_DIR="${VSCODE_SERVER_DIR:-/app/vscode-server}"
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx}"
NGINX_LOG_DIR="${NGINX_LOG_DIR:-/var/log/nginx}"

# Derived paths
NGINX_PID_PATH="${NGINX_LOG_DIR}/nginx.pid"
NGINX_ERROR_LOG_PATH="${NGINX_LOG_DIR}/error.log"
NGINX_ACCESS_LOG_PATH="${NGINX_LOG_DIR}/access.log"

# Ensure data subdirs exist
mkdir -p "${LEAN_WORKBENCH_DATA_DIR}/workspaces" "${LEAN_WORKBENCH_DATA_DIR}/db" "${LEAN_WORKBENCH_DATA_DIR}/package-sets" "${LEAN_WORKBENCH_DATA_DIR}/templates"

# Without this, `lake` invocations will loudly complain
git config --global advice.detachedHead false

# Start the Next.js app in the background
export LEAN_WORKBENCH_DATA_DIR VSCODE_SERVER_DIR NGINX_CONF_DIR NGINX_LOG_DIR
if [ "${NODE_ENV}" = "production" ]; then
    cd "${SCRIPT_DIR}" && node_modules/.bin/next start --port 3002 &
else
    # Dev mode: ${SCRIPT_DIR} is mounted read-only by the host.
    # Make build-time container writes succeed by directing them to a tmpfs.
    # NOTE: also tried a tmpfs overlay on all of ${SCRIPT_DIR};
    # but inotify events for HMR don't propagate in that case;
    # and per https://github.com/vercel/next.js/issues/80665, polling doesn't work.
    mkdir -p /tmp/workbench.tmpfs
    mountpoint -q /tmp/workbench.tmpfs || mount -t tmpfs tmpfs /tmp/workbench.tmpfs
    for d in node_modules .next; do
        mkdir -p "/tmp/workbench.tmpfs/$d.upper" "/tmp/workbench.tmpfs/$d.work"
        mount -t overlay overlay \
            -o "lowerdir=${SCRIPT_DIR}/$d,upperdir=/tmp/workbench.tmpfs/$d.upper,workdir=/tmp/workbench.tmpfs/$d.work" \
            "${SCRIPT_DIR}/$d"
    done
    for f in package.json package-lock.json next-env.d.ts; do
        cp "${SCRIPT_DIR}/$f" "/tmp/workbench.tmpfs/$f"
        mount --bind "/tmp/workbench.tmpfs/$f" "${SCRIPT_DIR}/$f"
    done

    # Rebuild native SQLite bindings before starting in case Docker and host are different platforms
    # Build node-pty because its binaries aren't shipped for Linux systems
    cd "${SCRIPT_DIR}" && npm rebuild better-sqlite3 node-pty && node_modules/.bin/next dev --port 3002 &
fi
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null' EXIT

# Prepare Nginx config from template
mkdir -p "${NGINX_CONF_DIR}"
export NGINX_PID_PATH NGINX_ERROR_LOG_PATH NGINX_ACCESS_LOG_PATH NGINX_CONF_DIR
envsubst '$NGINX_PID_PATH $NGINX_ERROR_LOG_PATH $NGINX_ACCESS_LOG_PATH $NGINX_CONF_DIR' \
    < "${SCRIPT_DIR}/nginx.conf.template" \
    > "${NGINX_CONF_DIR}/nginx.conf"

# Start Nginx in the background
nginx -e "${NGINX_ERROR_LOG_PATH}" -c "${NGINX_CONF_DIR}/nginx.conf" &
NGINX_PID=$!
# Replaces previous trap
trap 'kill $APP_PID $NGINX_PID 2>/dev/null' EXIT

echo "[start.sh] Nginx listening on http://localhost:3000"

wait -n $APP_PID $NGINX_PID || true

# Show oom-killer events from the last 10 seconds, in case that is what caused us to exit
dmesg --ctime --since '10 sec ago' 2>/dev/null | grep --ignore-case 'killed process' | tail -5