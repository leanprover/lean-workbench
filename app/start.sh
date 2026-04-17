#!/bin/bash
# Runs the Next.js app and the Nginx reverse proxy.
# Docker container entrypoint (see ENTRYPOINT in Dockerfile).
# Path envvars default to their values in the Docker container.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

DATA_DIR="${DATA_DIR:-/data}"
OPENVSCODE_SERVER_DIR="${OPENVSCODE_SERVER_DIR:-/app/.openvscode-server}"
VSCODE_EXTENSIONS_DIR="${VSCODE_EXTENSIONS_DIR:-/app/.vscode-extensions}"
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx}"
NGINX_LOG_DIR="${NGINX_LOG_DIR:-/var/log/nginx}"

# Derived paths
NGINX_PID_PATH="${NGINX_LOG_DIR}/nginx.pid"
NGINX_ERROR_LOG_PATH="${NGINX_LOG_DIR}/error.log"
NGINX_ACCESS_LOG_PATH="${NGINX_LOG_DIR}/access.log"

# Ensure data subdirs exist
mkdir -p "${DATA_DIR}/workspaces" "${DATA_DIR}/db" "${DATA_DIR}/package-sets" "${DATA_DIR}/templates"

# Start the Next.js app in the background
export DATA_DIR OPENVSCODE_SERVER_DIR VSCODE_EXTENSIONS_DIR NGINX_CONF_DIR NGINX_LOG_DIR
cd "${SCRIPT_DIR}" && node_modules/.bin/next start -p 3002 &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null' EXIT

# Prepare Nginx config from template
mkdir -p "${NGINX_CONF_DIR}"
export NGINX_PID_PATH NGINX_ERROR_LOG_PATH NGINX_ACCESS_LOG_PATH NGINX_CONF_DIR
envsubst '$NGINX_PID_PATH $NGINX_ERROR_LOG_PATH $NGINX_ACCESS_LOG_PATH $NGINX_CONF_DIR' \
    < "${SCRIPT_DIR}/nginx.conf.template" \
    > "${NGINX_CONF_DIR}/nginx.conf"

# Start nginx in the background
nginx -e "${NGINX_ERROR_LOG_PATH}" -c "${NGINX_CONF_DIR}/nginx.conf" &
NGINX_PID=$!
trap 'kill $NGINX_PID 2>/dev/null' EXIT

echo "[start.sh] Frontend listening on http://localhost:3000"

wait $APP_PID
wait $NGINX_PID
