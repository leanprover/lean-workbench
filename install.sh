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
  if ask_yesno "Remove data directory at $data_dir?\n(This will delete all workspaces and projects)"; then
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

  # Prompt for configuration (skip if provided via flags)
  WORKBENCH_ROOT="${OPT_DIR:-$(ask_input "Where should Lean Workbench store its data?" "$HOME/.lean-workbench")}"
  PORT="${OPT_PORT:-$(ask_input "Which port should the server listen on?" "8080")}"

  # Validate port
  if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    error "Invalid port: $PORT"
  fi

  # Expand ~ if present
  WORKBENCH_ROOT="${WORKBENCH_ROOT/#\~/$HOME}"

  info "Configuration:"
  echo "  Workbench root: $WORKBENCH_ROOT"
  echo "  Port: $PORT"
  echo ""

  # Create data directory
  mkdir -p "$WORKBENCH_ROOT"

  # Pull image (skip with --dev if using a locally-built image)
  if [ "${NO_PULL:-}" != "1" ]; then
    info "Pulling Docker image..."
    docker pull "$IMAGE"
  else
    info "Skipping docker pull, using local image."
  fi

  # Copy env file if provided (dev only — credentials end up on disk in
  # the data directory, so don't use this in production)
  local ENV_FILE_SECTION=""
  if [ -n "$OPT_ENV_FILE" ]; then
    cp "$OPT_ENV_FILE" "$WORKBENCH_ROOT/.env"
    chmod 600 "$WORKBENCH_ROOT/.env"
    info "Copied $OPT_ENV_FILE to $WORKBENCH_ROOT/.env"
    ENV_FILE_SECTION=$'\n    env_file:\n      - .env'
  fi

  # Helper to write a compose file
  write_compose() {
    local file="$1" bind_addr="$2"
    cat > "$file" <<EOF
services:
  lean-workbench:
    image: $IMAGE
    container_name: lean-workbench
    ports:
      - "${bind_addr}:${PORT}:3000"
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
  }

  # Write compose files: localhost-only for setup, 0.0.0.0 for production
  info "Writing docker-compose.yml (localhost-only, for setup)..."
  write_compose "$WORKBENCH_ROOT/docker-compose.yml" "127.0.0.1"

  info "Writing docker-compose.prod.yml (all interfaces, for production)..."
  write_compose "$WORKBENCH_ROOT/docker-compose.prod.yml" "0.0.0.0"

  # Create data subdirectory (compose mounts ./data, not the workbench root)
  mkdir -p "$WORKBENCH_ROOT/data"

  echo ""
  info "Lean Workbench is installed!"
  echo ""
  echo "  To start (localhost-only, for initial setup):"
  echo "    cd $WORKBENCH_ROOT && docker compose up -d"
  echo ""
  echo "  Then open http://localhost:$PORT to configure authentication"
  echo "  and complete setup."
  echo ""
  echo "  After setup, you can switch to production mode:"
  echo "    cd $WORKBENCH_ROOT && docker compose down"
  echo "    docker compose -f docker-compose.prod.yml up -d"
  echo ""
  echo "  Other commands:"
  echo "    docker compose -f $WORKBENCH_ROOT/docker-compose.yml logs -f     # view logs"
  echo "    docker compose -f $WORKBENCH_ROOT/docker-compose.yml pull        # update image"
  echo ""
  echo "  To uninstall:"
  echo "    $(realpath "$0") --uninstall"

  # Offer to start now
  if ask_yesno "Start Lean Workbench now?"; then
    docker compose -f "$WORKBENCH_ROOT/docker-compose.yml" up -d
    echo ""
    info "Lean Workbench is running at http://localhost:$PORT"
    echo "  Open http://localhost:$PORT to configure authentication and complete setup."
  fi
}

# --- Main ---

OPT_DIR="" OPT_PORT="" NO_PULL="" OPT_ENV_FILE="" ACTION="install"

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) ACTION="uninstall"; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    --dir) OPT_DIR="$2"; shift 2 ;;
    --port) OPT_PORT="$2"; shift 2 ;;
    --env-file) OPT_ENV_FILE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Install Lean Workbench with Docker Compose."
      echo ""
      echo "Options:"
      echo "  --dir DIR    Workbench root directory (default: ~/.lean-workbench)"
      echo "  --port PORT  Server port (default: 8080)"
      echo "  --no-pull    Skip docker pull (use locally-built image)"
      echo "  --env-file F Copy env file into workbench root directory (dev only, not for production)"
      echo "  --uninstall  Stop and remove Lean Workbench"
      exit 0
      ;;
    *) error "Unknown option: $1. Try --help." ;;
  esac
done

case "$ACTION" in
  install) do_install ;;
  uninstall) do_uninstall "$OPT_DIR" ;;
esac
