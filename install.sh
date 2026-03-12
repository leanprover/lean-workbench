#!/bin/bash
#
# Lean Workbench installer.
#
# Usage:
#   ./install.sh              Install and start Lean Workbench
#   ./install.sh --uninstall  Stop and remove Lean Workbench
#
set -euo pipefail

IMAGE="ghcr.io/leanprover/lean-workbench:latest"
SERVICE_NAME="lean-workbench"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/$SERVICE_NAME.service"

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
    # Returns 0 for Yes, 1 for No/Cancel — caller decides meaning
  else
    read -p "$prompt [y/N]: " yn
    [[ "$yn" =~ ^[Yy] ]]
  fi
}

info() { echo "==> $1"; }
error() { echo "ERROR: $1" >&2; exit 1; }

# --- Uninstall ---

do_uninstall() {
  info "Uninstalling Lean Workbench..."

  # Read data dir from unit file before removing it
  local data_dir=""
  if [ -f "$UNIT_FILE" ]; then
    data_dir=$(grep -oP '(?<=-v )\S+(?=:/data)' "$UNIT_FILE" || true)
  fi

  # Stop and disable
  systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true

  # Remove unit file
  if [ -f "$UNIT_FILE" ]; then
    rm "$UNIT_FILE"
    info "Removed $UNIT_FILE"
  fi
  systemctl --user daemon-reload 2>/dev/null || true

  # Optionally remove image
  if docker image inspect "$IMAGE" &>/dev/null; then
    if ask_yesno "Remove Docker image ($IMAGE)?"; then
      docker rmi "$IMAGE"
      info "Removed Docker image."
    fi
  fi

  # Optionally remove data
  if [ -n "$data_dir" ] && [ -d "$data_dir" ]; then
    if ask_yesno "Remove data directory at $data_dir?\n(This will delete all workspaces and projects)"; then
      rm -rf "$data_dir"
      info "Removed $data_dir"
    fi
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
  if ! command -v systemctl &>/dev/null; then
    error "systemctl not found. This installer requires systemd."
  fi

  # Prompt for configuration
  DATA_DIR=$(ask_input "Where should Lean Workbench store its data?" "$HOME/.lean-workbench")
  PORT=$(ask_input "Which port should the server listen on?" "8080")

  # Validate port
  if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    error "Invalid port: $PORT"
  fi

  # Expand ~ if present
  DATA_DIR="${DATA_DIR/#\~/$HOME}"

  info "Configuration:"
  echo "  Data directory: $DATA_DIR"
  echo "  Port: $PORT"
  echo ""

  # Create data directory
  mkdir -p "$DATA_DIR"

  # Pull image
  info "Pulling Docker image..."
  docker pull "$IMAGE"

  # Write systemd unit
  info "Installing systemd service..."
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Lean Workbench
After=docker.service
Requires=docker.service

[Service]
Type=simple
ExecStartPre=-/usr/bin/docker rm -f $SERVICE_NAME
ExecStart=/usr/bin/docker run --rm --name $SERVICE_NAME \\
  --cap-add SYS_ADMIN \\
  --security-opt seccomp=unconfined \\
  --security-opt apparmor=unconfined \\
  --security-opt systempaths=unconfined \\
  -p $PORT:3000 \\
  -v $DATA_DIR:/data \\
  $IMAGE
ExecStop=/usr/bin/docker stop $SERVICE_NAME
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

  # Enable and start
  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"

  echo ""
  info "Lean Workbench is running!"
  echo ""
  echo "  Open http://localhost:$PORT to complete setup."
  echo ""
  echo "  Manage the service:"
  echo "    systemctl --user status $SERVICE_NAME"
  echo "    systemctl --user stop $SERVICE_NAME"
  echo "    systemctl --user start $SERVICE_NAME"
  echo "    systemctl --user restart $SERVICE_NAME"
  echo ""
  echo "  To uninstall:"
  echo "    $(realpath "$0") --uninstall"
}

# --- Main ---

case "${1:-}" in
  --uninstall) do_uninstall ;;
  --help|-h)
    echo "Usage: $0 [--uninstall]"
    echo ""
    echo "Install and configure Lean Workbench as a systemd user service."
    echo "Re-run with --uninstall to remove."
    exit 0
    ;;
  "") do_install ;;
  *) error "Unknown option: $1. Try --help." ;;
esac
