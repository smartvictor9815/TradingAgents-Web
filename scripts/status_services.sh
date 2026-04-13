#!/usr/bin/env bash
set -euo pipefail

# Show backend/frontend service status for scripts/start_services.sh.
# Usage:
#   bash scripts/status_services.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

print_status() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name: stopped (no pid file)"
    return
  fi

  local pid
  pid="$(<"$pid_file")"
  if [[ -z "$pid" ]]; then
    echo "$name: stopped (empty pid file)"
    return
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "$name: running (pid=$pid)"
  else
    echo "$name: stopped (stale pid=$pid)"
  fi

  if [[ -f "$log_file" ]]; then
    echo "  log: $log_file"
  fi
}

print_status "Backend" "$BACKEND_PID_FILE" "$BACKEND_LOG"
print_status "Frontend" "$FRONTEND_PID_FILE" "$FRONTEND_LOG"
