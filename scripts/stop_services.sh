#!/usr/bin/env bash
set -euo pipefail

# Stop backend + frontend dev services started by scripts/start_services.sh.
# Usage:
#   bash scripts/stop_services.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

stop_by_pid_file() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name not running (no pid file)"
    return 0
  fi

  local pid
  pid="$(<"$pid_file")"
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "$name pid file empty; cleaned"
    return 0
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    echo "$name stopped (pid=$pid)"
  else
    echo "$name already stopped (stale pid=$pid)"
  fi

  rm -f "$pid_file"
}

stop_by_pid_file "Backend" "$BACKEND_PID_FILE"
stop_by_pid_file "Frontend" "$FRONTEND_PID_FILE"
