#!/usr/bin/env bash
set -euo pipefail

# Bootstrap installer for users who want to install directly from GitHub.
# Usage:
#   bash install_from_github.sh
# Optional:
#   REPO_URL=https://github.com/<user>/<repo>.git bash install_from_github.sh
#   TARGET_DIR=TradingAgents-Web bash install_from_github.sh
#   INSTALL_PDF_EXTRA=1 bash install_from_github.sh

REPO_URL="${REPO_URL:-https://github.com/smartvictor9815/TradingAgents-Web.git}"
TARGET_DIR="${TARGET_DIR:-TradingAgents-Web}"
BRANCH="${BRANCH:-main}"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required."
  exit 1
fi

if [[ -d "$TARGET_DIR/.git" ]]; then
  echo "==> Existing repo found at: $TARGET_DIR"
else
  echo "==> Cloning repository from GitHub..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

if [[ ! -f "scripts/install.sh" ]]; then
  echo "ERROR: scripts/install.sh not found in $TARGET_DIR"
  exit 1
fi

echo "==> Running project installer..."
bash scripts/install.sh
