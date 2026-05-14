#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="${GWORKSPACE_MCP_DOWNLOAD_DIR:-$HOME/Downloads/gworkspace-mcp}"
LOCAL_DIR="$ROOT_DIR/.local"

log() {
  printf '[setup] %s\n' "$*"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

install_with_brew() {
  local package="$1"
  local cask="${2:-}"

  if ! has_command brew; then
    log "Homebrew not found. Install manually: $package"
    return 0
  fi

  if [[ "$cask" == "cask" ]]; then
    log "Installing cask: $package"
    brew install --cask "$package"
  else
    log "Installing package: $package"
    brew install "$package"
  fi
}

ensure_command() {
  local command_name="$1"
  local brew_package="$2"
  local cask="${3:-}"

  if has_command "$command_name"; then
    log "$command_name found: $(command -v "$command_name")"
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      install_with_brew "$brew_package" "$cask"
      ;;
    *)
      log "$command_name missing. Install $brew_package with your OS package manager, then rerun this script."
      ;;
  esac
}

write_configs() {
  mkdir -p "$LOCAL_DIR"

  cat > "$LOCAL_DIR/cursor-mcp.json" <<JSON
{
  "mcpServers": {
    "gworkspace": {
      "command": "node",
      "args": ["$ROOT_DIR/dist/server.js"],
      "env": {
        "GWORKSPACE_MCP_DOWNLOAD_DIR": "$DOWNLOAD_DIR"
      }
    }
  }
}
JSON

  cat > "$LOCAL_DIR/claude-code-mcp.json" <<JSON
{
  "mcpServers": {
    "gworkspace": {
      "command": "node",
      "args": ["$ROOT_DIR/dist/server.js"],
      "env": {
        "GWORKSPACE_MCP_DOWNLOAD_DIR": "$DOWNLOAD_DIR"
      }
    }
  }
}
JSON

  cat > "$LOCAL_DIR/stdio-command.sh" <<SH
#!/usr/bin/env bash
GWORKSPACE_MCP_DOWNLOAD_DIR="$DOWNLOAD_DIR" node "$ROOT_DIR/dist/server.js"
SH
  chmod +x "$LOCAL_DIR/stdio-command.sh"
}

main() {
  log "Project: $ROOT_DIR"
  log "Download directory: $DOWNLOAD_DIR"

  ensure_command node node
  ensure_command npm node
  ensure_command jq jq
  ensure_command python3 python
  ensure_command gws googleworkspace-cli
  ensure_command gcloud google-cloud-sdk cask

  log "Installing npm dependencies"
  (cd "$ROOT_DIR" && npm install)

  log "Building MCP server"
  (cd "$ROOT_DIR" && npm run build)

  mkdir -p "$DOWNLOAD_DIR"

  if has_command gws; then
    if gws auth status >/dev/null 2>&1; then
      log "gws auth status succeeded"
    else
      log "gws is not authenticated yet. Run one of:"
      log "  gws auth setup"
      log "  gws auth login"
    fi
  fi

  write_configs

  log "Wrote local config examples:"
  log "  $LOCAL_DIR/cursor-mcp.json"
  log "  $LOCAL_DIR/claude-code-mcp.json"
  log "  $LOCAL_DIR/stdio-command.sh"
  log "Launch command:"
  log "  GWORKSPACE_MCP_DOWNLOAD_DIR=\"$DOWNLOAD_DIR\" node \"$ROOT_DIR/dist/server.js\""
}

main "$@"
