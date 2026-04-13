#!/usr/bin/env bash
set -euo pipefail

# Start backend + frontend dev services in background.
# Usage:
#   bash scripts/start_services.sh
# Optional env:
#   API_HOST=127.0.0.1 API_PORT=18000 FRONTEND_HOST=127.0.0.1 FRONTEND_PORT=3000 bash scripts/start_services.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-18000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

mkdir -p "$LOG_DIR"

is_pid_alive() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  kill -0 "$pid" >/dev/null 2>&1
}

start_backend() {
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(<"$BACKEND_PID_FILE")"
    if is_pid_alive "$existing_pid"; then
      echo "Backend already running (pid=$existing_pid)"
      return 0
    fi
    rm -f "$BACKEND_PID_FILE"
  fi

  local py_bin=""
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    py_bin="$ROOT_DIR/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    py_bin="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    py_bin="$(command -v python)"
  else
    echo "ERROR: Python not found. Run bash scripts/install.sh first."
    exit 1
  fi

  nohup "$py_bin" -m uvicorn app.api.main:app --host "$API_HOST" --port "$API_PORT" >"$BACKEND_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$BACKEND_PID_FILE"
  echo "Backend started: pid=$pid url=http://$API_HOST:$API_PORT"
}

start_frontend() {
  if [[ -f "$FRONTEND_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(<"$FRONTEND_PID_FILE")"
    if is_pid_alive "$existing_pid"; then
      echo "Frontend already running (pid=$existing_pid)"
      return 0
    fi
    rm -f "$FRONTEND_PID_FILE"
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found. Install Node.js >=20 first."
    exit 1
  fi

  nohup npm --prefix "$ROOT_DIR/frontend" run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" >"$FRONTEND_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$FRONTEND_PID_FILE"
  echo "Frontend started: pid=$pid url=http://$FRONTEND_HOST:$FRONTEND_PORT"
}

start_backend
start_frontend

echo
echo "Logs:"
echo "  Backend:  $BACKEND_LOG"
echo "  Frontend: $FRONTEND_LOG"
