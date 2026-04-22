#!/bin/bash
# Runs the Next.js app and the Nginx reverse proxy.
# Docker container entrypoint (see ENTRYPOINT in Dockerfile).
# Path envvars default to their values in the Docker container.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

LEAN_WORKBENCH_DATA_DIR="${LEAN_WORKBENCH_DATA_DIR:-/data}"
OPENVSCODE_SERVER_DIR="${OPENVSCODE_SERVER_DIR:-/app/.openvscode-server}"
VSCODE_EXTENSIONS_DIR="${VSCODE_EXTENSIONS_DIR:-/app/.vscode-extensions}"
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx}"
NGINX_LOG_DIR="${NGINX_LOG_DIR:-/var/log/nginx}"

# Derived paths
NGINX_PID_PATH="${NGINX_LOG_DIR}/nginx.pid"
NGINX_ERROR_LOG_PATH="${NGINX_LOG_DIR}/error.log"
NGINX_ACCESS_LOG_PATH="${NGINX_LOG_DIR}/access.log"

# Ensure data subdirs exist
mkdir -p "${LEAN_WORKBENCH_DATA_DIR}/workspaces" "${LEAN_WORKBENCH_DATA_DIR}/db" "${LEAN_WORKBENCH_DATA_DIR}/package-sets" "${LEAN_WORKBENCH_DATA_DIR}/templates"

# Start the Next.js app in the background
export LEAN_WORKBENCH_DATA_DIR OPENVSCODE_SERVER_DIR VSCODE_EXTENSIONS_DIR NGINX_CONF_DIR NGINX_LOG_DIR
if [ "${NODE_ENV}" = "production" ]; then
    cd "${SCRIPT_DIR}" && node_modules/.bin/next start --port 3002 &
else
    # Dev mode: ${SCRIPT_DIR} is mounted read-only by the host.
    # Make build-time container writes succeed by putting them on tmpfs.
    for d in node_modules .next src/prisma/generated; do
        mount -t tmpfs tmpfs "${SCRIPT_DIR}/$d"
    done
    mkdir -p /tmp/workbench.tmpfs
    for f in package.json package-lock.json next-env.d.ts; do
        cp "${SCRIPT_DIR}/$f" "/tmp/workbench.tmpfs/$f"
        mount --bind "/tmp/workbench.tmpfs/$f" "${SCRIPT_DIR}/$f"
    done

    cd "${SCRIPT_DIR}" && npm install && npm run dev -- --port 3002 &
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

wait -n $APP_PID $NGINX_PID
