#!/usr/bin/env bash
set -euo pipefail

# One-click setup for macOS/Linux.
# Usage:
#   bash scripts/install.sh
# Optional:
#   INSTALL_PDF_EXTRA=1 bash scripts/install.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> TradingAgents-Web one-click installer"

if [[ ! -f "pyproject.toml" || ! -f "frontend/package.json" ]]; then
  echo "ERROR: Run this script from the repository root context."
  exit 1
fi

if [[ "${OSTYPE:-}" == "msys" || "${OSTYPE:-}" == "cygwin" || "${OS:-}" == "Windows_NT" ]]; then
  echo "ERROR: This script targets macOS/Linux shells."
  echo "Use WSL (Ubuntu) on Windows, then run this script again."
  exit 1
fi

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "ERROR: Python 3.10+ is required but not found."
  exit 1
fi

"$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("ERROR: Python 3.10+ is required.")
print(f"Python OK: {sys.version.split()[0]}")
PY

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required (>=20)."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required."
  exit 1
fi

node - <<'JS'
const major = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(major) || major < 20) {
  console.error(`ERROR: Node.js >=20 required. Current: ${process.versions.node}`);
  process.exit(1);
}
console.log(`Node OK: ${process.versions.node}`);
JS

echo "==> Setting up Python virtual environment"
if [[ ! -d ".venv" ]]; then
  "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source ".venv/bin/activate"

echo "==> Upgrading pip/build tools"
python -m pip install --upgrade pip setuptools wheel

echo "==> Installing backend package (editable)"
if [[ "${INSTALL_PDF_EXTRA:-0}" == "1" ]]; then
  pip install -e ".[pdf]"
else
  pip install -e .
fi

if [[ ! -f ".env" && -f ".env.example" ]]; then
  cp ".env.example" ".env"
  echo "==> Created .env from .env.example"
fi

echo "==> Installing frontend dependencies"
cd frontend
if [[ -f "package-lock.json" ]]; then
  npm ci
else
  npm install
fi
cd "$ROOT_DIR"

echo
echo "Installation complete."
echo
echo "Next steps:"
echo "1) Edit .env with your API keys"
echo "2) Start backend:"
echo "   source .venv/bin/activate && python -m uvicorn app.api.main:app --host 127.0.0.1 --port 18000"
echo "3) Start frontend (new terminal):"
echo "   cd frontend && npm run dev"
