#!/bin/bash
#
# Lean Workbench installer.
#
# Usage:
#   ./install.sh              Install Lean Workbench
#   ./install.sh --uninstall  Remove Lean Workbench
#
set -euo pipefail

IMAGE="ghcr.io/leanprover/lean-workbench:latest"

# --- Helpers ---

has_whiptail() { command -v whiptail &>/dev/null; }

ask_input() {
  local prompt="$1" default="$2" result
  if has_whiptail; then
    result=$(whiptail --inputbox "$prompt" 10 60 "$default" 3>&1 1>&2 2>&3) || exit 1
    echo "$result"
  else
    read -p "$prompt [$default]: " value
    echo "${value:-$default}"
  fi
}

ask_yesno() {
  local prompt="$1"
  if has_whiptail; then
    whiptail --yesno "$prompt" 10 60 3>&1 1>&2 2>&3
  else
    read -p "$prompt [y/N]: " yn
    [[ "$yn" =~ ^[Yy] ]]
  fi
}

info() { echo "==> $1"; }
error() { echo "ERROR: $1" >&2; exit 1; }

# --- Uninstall ---

do_uninstall() {
  local data_dir="${1:-}"

  if [ -z "$data_dir" ]; then
    # Determine the installation directory
    local default="$HOME/.lean-workbench"
    data_dir=$(ask_input "Where is Lean Workbench installed?" "$default")
    data_dir="${data_dir/#\~/$HOME}"
  fi

  if [ ! -f "$data_dir/docker-compose.yml" ]; then
    error "No Lean Workbench installation found at $data_dir"
  fi

  info "Uninstalling Lean Workbench from $data_dir..."

  # Stop the service if running
  docker compose -f "$data_dir/docker-compose.yml" down 2>/dev/null || true

  # Optionally remove image
  if docker image inspect "$IMAGE" &>/dev/null; then
    if ask_yesno "Remove Docker image ($IMAGE)?"; then
      docker rmi "$IMAGE"
      info "Removed Docker image."
    fi
  fi

  # Optionally remove data
  if ask_yesno "Remove data directory at $data_dir?\n(THIS WILL DELETE ALL USERS AND PROJECTS!)"; then
    rm -rf "$data_dir"
    info "Removed $data_dir"
  else
    # At minimum remove the compose file
    rm "$data_dir/docker-compose.yml"
    info "Removed docker-compose.yml (data preserved)."
  fi

  info "Uninstall complete."
  exit 0
}

# --- Install ---

do_install() {
  # Check prerequisites
  if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Install Docker first: https://docs.docker.com/get-docker/"
  fi
  if ! docker info &>/dev/null 2>&1; then
    error "Cannot connect to Docker. Is the Docker daemon running? Is your user in the docker group?"
  fi
  if ! docker compose version &>/dev/null 2>&1; then
    error "Docker Compose is not installed. Install it first: https://docs.docker.com/compose/install"
  fi

  # Prompt for configuration (skip if provided via flags)
  WORKBENCH_ROOT="${OPT_DIR:-$(ask_input "Where should Lean Workbench store its data?" "$HOME/.lean-workbench")}"

  # Expand ~ if present
  WORKBENCH_ROOT="${WORKBENCH_ROOT/#\~/$HOME}"

  # Refuse to overwrite an existing installation
  if [ -e "$WORKBENCH_ROOT" ]; then
    error "$WORKBENCH_ROOT already exists. Uninstall first (--uninstall), move the directory, or pick a different directory."
  fi

  ADDR="${OPT_ADDR:-$(ask_input "Which address should the HTTP server listen on?" "127.0.0.1")}"

  PORT="${OPT_PORT:-$(ask_input "Which port should the HTTP server listen on?" "8080")}"

  # Validate port
  if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    error "Invalid port: $PORT"
  fi

  URL="${OPT_URL:-$(ask_input "At which URL will you publish the Lean Workbench?" "https://your-domain.com")}"

  # Remove trailing slash if present.
  URL="${URL%/}"

  # The app expects baseUrl to be an HTTP(S) origin: scheme, hostname, optional port (see zServerConfig).
  # The restricted character set here keeps the config.json below as valid JSON.
  if ! [[ "$URL" =~ ^https?://[A-Za-z0-9._-]+(:[0-9]+)?$ ]]; then
    error "Invalid URL \"$URL\". Expected an alphanumeric HTTP(S) URL (optionally with a port), e.g. \"https://your-domain.com\"."
  fi

  info "Configuration:"
  echo "  Workbench directory: $WORKBENCH_ROOT"
  echo "  Address: $ADDR"
  echo "  Port: $PORT"
  echo "  Public URL: $URL"
  echo ""

  # Pull image (skip with --dev if using a locally-built image)
  if [ "${NO_PULL:-}" != "1" ]; then
    info "Pulling Docker image..."
    docker pull "$IMAGE"
  else
    info "Skipping docker pull, using local image."
  fi

  # Create installation directory
  mkdir -p "$WORKBENCH_ROOT"

  # Copy env file if provided (dev only — credentials end up on disk in
  # the data directory, so don't use this in production)
  local ENV_FILE_SECTION=""
  if [ -n "$OPT_ENV_FILE" ]; then
    cp "$OPT_ENV_FILE" "$WORKBENCH_ROOT/.env"
    chmod 600 "$WORKBENCH_ROOT/.env"
    info "Copied $OPT_ENV_FILE to $WORKBENCH_ROOT/.env"
    ENV_FILE_SECTION=$'\n    env_file:\n      - .env'
  fi

  # Create installation directory and data subdirectory
  # (docker-compose mounts $WORKBENCH_ROOT/data, not $WORKBENCH_ROOT)
  mkdir -p "$WORKBENCH_ROOT/data"

  info "Generating initial admin password..."
  INIT_ADMIN_PASSWORD=$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 24)

  info "Writing config.json..."
  cat > "$WORKBENCH_ROOT/data/config.json" <<EOF
{
  "isSetupComplete": false,
  "baseUrl": "$URL",
  "initAdminPassword": "$INIT_ADMIN_PASSWORD"
}
EOF
  chmod 600 "$WORKBENCH_ROOT/data/config.json"

  info "Writing docker-compose.yml..."
  cat > "$WORKBENCH_ROOT/docker-compose.yml" <<EOF
services:
  lean-workbench:
    image: $IMAGE
    container_name: lean-workbench
    ports:
      - "${ADDR}:${PORT}:3000"
    volumes:
      - ./data:/data${ENV_FILE_SECTION}
    cap_add:
      - SYS_ADMIN
    security_opt:
      - seccomp=unconfined
      - apparmor=unconfined
      - systempaths=unconfined
    restart: unless-stopped
EOF

  echo ""
  info "Lean Workbench is installed!"
  echo ""
  echo "  Initial admin password: $INIT_ADMIN_PASSWORD"
  echo "    (also stored in $WORKBENCH_ROOT/data/config.json)"
  echo ""
  local_url="http://$ADDR:$PORT"
  if [[ "$URL" == "$local_url" ]]; then
    echo "  Then connect to $URL to configure authentication and complete the setup."
  else
    echo "  Then set up a tunnel or reverse proxy forwarding $URL to $local_url,"
    echo "  and connect to $URL to configure authentication and complete the setup."
  fi
  echo ""
  echo "  Useful commands:"
  echo "    docker compose -f $WORKBENCH_ROOT/docker-compose.yml up -d   # start the workbench"
  echo "    docker compose -f $WORKBENCH_ROOT/docker-compose.yml down    # stop a running workbench"
  echo "    docker compose -f $WORKBENCH_ROOT/docker-compose.yml logs -f # see live logs"
  echo "    docker compose -f $WORKBENCH_ROOT/docker-compose.yml pull    # update image"
  echo ""
  echo "  To uninstall:"
  echo "    bash <(curl -sSf https://raw.githubusercontent.com/leanprover/lean-workbench/main/install.sh) --uninstall"
  echo ""

  # Offer to start now
  if ask_yesno "Start Lean Workbench now?"; then
    docker compose -f "$WORKBENCH_ROOT/docker-compose.yml" up -d
    echo ""
    info "Lean Workbench is listening on http://$ADDR:$PORT."
  fi
}

# --- Main ---

OPT_DIR="" OPT_URL="" OPT_ADDR="" OPT_PORT="" NO_PULL="" OPT_ENV_FILE="" ACTION="install"

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) ACTION="uninstall"; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    --dir) OPT_DIR="$2"; shift 2 ;;
    --pub-url) OPT_URL="$2"; shift 2 ;;
    --addr) OPT_ADDR="$2"; shift 2 ;;
    --port) OPT_PORT="$2"; shift 2 ;;
    --env-file) OPT_ENV_FILE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Install Lean Workbench with Docker Compose."
      echo ""
      echo "Options:"
      echo "  --dir DIR       Directory where Lean Workbench stores its data (default: ~/.lean-workbench)"
      echo "  --pub-url URL   URL on which you will publish the Lean Workbench (e.g. https://your-domain.com)"
      echo "  --addr ADDR     Address on which the HTTP server will listen (default: 127.0.0.1)"
      echo "  --port PORT     Port on which the HTTP server will listen (default: 8080)"
      echo "  --no-pull       Skip docker pull, use locally installed image"
      echo "  --env-file FILE Copy env file into workbench directory (dev only, not for production)"
      echo "  --uninstall     Stop and remove Lean Workbench"
      exit 0
      ;;
    *) error "Unknown option: $1. Try --help." ;;
  esac
done

case "$ACTION" in
  install) do_install ;;
  uninstall) do_uninstall "$OPT_DIR" ;;
esac
