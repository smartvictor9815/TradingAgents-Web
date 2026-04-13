#!/usr/bin/env bash
set -euo pipefail

# One-click setup for macOS/Linux.
# Usage:
#   bash scripts/install.sh
# Optional:
#   INSTALL_PDF_EXTRA=1 bash scripts/install.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PDF_EXTRA_ENABLED="${INSTALL_PDF_EXTRA:-0}"

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

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0
}

ensure_python_venv_support() {
  # Quick probe: can this interpreter create a venv?
  set +e
  "$PYTHON_BIN" -m venv --help >/dev/null 2>&1
  local has_venv=$?
  set -e
  if [[ "$has_venv" -eq 0 ]]; then
    return 0
  fi

  echo "==> Python venv module missing. Attempting auto-install..."
  if [[ ! -f "/etc/os-release" ]]; then
    echo "ERROR: Cannot auto-install python venv support on this OS."
    echo "Please install python3-venv manually, then rerun."
    exit 1
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  local distro="${ID:-}"
  local distro_like="${ID_LIKE:-}"
  if [[ "$distro" != "ubuntu" && "$distro" != "debian" && "$distro_like" != *"debian"* ]]; then
    echo "ERROR: Auto-install for python venv support currently supports Ubuntu/Debian only."
    echo "Please install python3-venv manually, then rerun."
    exit 1
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    echo "ERROR: sudo is required to auto-install python venv support."
    echo "Please install python3-venv manually, then rerun."
    exit 1
  fi

  local py_ver py_minor_pkg
  py_ver="$("$PYTHON_BIN" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
)"
  py_minor_pkg="python${py_ver}-venv"

  sudo apt-get update
  set +e
  sudo apt-get install -y python3-venv "$py_minor_pkg"
  local apt_rc=$?
  set -e
  if [[ "$apt_rc" -ne 0 ]]; then
    echo "WARNING: Could not install $py_minor_pkg; retrying with python3-venv only..."
    sudo apt-get install -y python3-venv
  fi

  set +e
  "$PYTHON_BIN" -m venv --help >/dev/null 2>&1
  has_venv=$?
  set -e
  if [[ "$has_venv" -ne 0 ]]; then
    echo "ERROR: Python venv support still unavailable after installation attempt."
    echo "Please run: sudo apt-get install -y python3-venv $py_minor_pkg"
    exit 1
  fi
}

auto_install_node_if_needed() {
  local major
  major="$(node_major)"
  if [[ "$major" -ge 20 ]] && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  echo "==> Node.js >=20 not detected. Attempting auto-install..."
  if [[ ! -f "/etc/os-release" ]]; then
    echo "ERROR: Cannot detect Linux distribution automatically."
    echo "Please install Node.js >=20 manually, then rerun."
    exit 1
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  local distro="${ID:-}"
  local distro_like="${ID_LIKE:-}"

  if [[ "$distro" != "ubuntu" && "$distro" != "debian" && "$distro_like" != *"debian"* ]]; then
    echo "ERROR: Auto-install currently supports Ubuntu/Debian only."
    echo "Please install Node.js >=20 manually, then rerun."
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required for NodeSource setup."
    echo "Run: sudo apt-get update && sudo apt-get install -y curl"
    exit 1
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "ERROR: sudo is required for automatic Node installation."
    echo "Please install Node.js >=20 manually, then rerun."
    exit 1
  fi

  set +e
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  local setup_rc=$?
  if [[ "$setup_rc" -ne 0 ]]; then
    set -e
    echo "ERROR: Failed to configure NodeSource repository."
    echo "Please install Node.js >=20 manually, then rerun."
    exit 1
  fi

  sudo apt-get install -y nodejs
  local install_rc=$?
  set -e
  if [[ "$install_rc" -ne 0 ]]; then
    echo "ERROR: Failed to install nodejs package."
    echo "Please install Node.js >=20 manually, then rerun."
    exit 1
  fi

  major="$(node_major)"
  if [[ "$major" -lt 20 ]] || ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: Node installation finished but version is still <20 or npm missing."
    echo "Current node: $(node -v 2>/dev/null || echo 'not found')"
    exit 1
  fi

  echo "Node installed successfully: $(node -v), npm $(npm -v)"
}

ensure_pdf_extra_deps_if_needed() {
  if [[ "$PDF_EXTRA_ENABLED" != "1" ]]; then
    return 0
  fi

  echo "==> INSTALL_PDF_EXTRA=1 detected, checking native PDF dependencies..."

  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -x "/opt/homebrew/bin/brew" ]] && ! command -v brew >/dev/null 2>&1; then
      export PATH="/opt/homebrew/bin:$PATH"
    fi
    if [[ -x "/usr/local/bin/brew" ]] && ! command -v brew >/dev/null 2>&1; then
      export PATH="/usr/local/bin:$PATH"
    fi
    if ! command -v brew >/dev/null 2>&1; then
      echo "WARNING: Homebrew not found; cannot auto-install macOS PDF deps."
      echo "         Falling back to base install (fpdf2-only)."
      PDF_EXTRA_ENABLED=0
      return 0
    fi
    brew list pkg-config >/dev/null 2>&1 || brew install pkg-config
    brew list cairo >/dev/null 2>&1 || brew install cairo
    brew list cmake >/dev/null 2>&1 || brew install cmake
    # Help pycairo locate brew-installed pkgconfig metadata.
    local brew_prefix
    brew_prefix="$(brew --prefix)"
    export PKG_CONFIG_PATH="$brew_prefix/lib/pkgconfig:$brew_prefix/share/pkgconfig:${PKG_CONFIG_PATH:-}"
    return 0
  fi

  if [[ -f "/etc/os-release" ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    local distro="${ID:-}"
    local distro_like="${ID_LIKE:-}"
    if [[ "$distro" == "ubuntu" || "$distro" == "debian" || "$distro_like" == *"debian"* ]]; then
      if ! command -v sudo >/dev/null 2>&1; then
        echo "WARNING: sudo not found; cannot install native PDF deps automatically."
        echo "         Falling back to base install (fpdf2-only)."
        PDF_EXTRA_ENABLED=0
        return 0
      fi
      sudo apt-get update
      sudo apt-get install -y pkg-config libcairo2-dev python3-dev cmake
      return 0
    fi
  fi

  echo "WARNING: Unsupported OS for auto native PDF deps install."
  echo "         Falling back to base install (fpdf2-only)."
  PDF_EXTRA_ENABLED=0
}

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

ensure_python_venv_support

auto_install_node_if_needed
echo "Node OK: $(node -v)"

echo "==> Setting up Python virtual environment"
if [[ ! -d ".venv" ]]; then
  "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source ".venv/bin/activate"

echo "==> Upgrading pip/build tools"
python -m pip install --upgrade pip setuptools wheel

ensure_pdf_extra_deps_if_needed

echo "==> Installing backend package (editable)"
if [[ "$PDF_EXTRA_ENABLED" == "1" ]]; then
  set +e
  pip install -e ".[pdf]"
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    echo "WARNING: PDF extra install failed. Falling back to base install (fpdf2-only)."
    pip install -e .
  fi
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
