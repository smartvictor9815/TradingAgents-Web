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
  cd "$TARGET_DIR"
  set +e
  git fetch origin "$BRANCH"
  fetch_rc=$?
  git checkout "$BRANCH"
  checkout_rc=$?
  git pull --ff-only origin "$BRANCH"
  pull_rc=$?
  set -e
  if [[ "$fetch_rc" -ne 0 || "$checkout_rc" -ne 0 || "$pull_rc" -ne 0 ]]; then
    echo "WARNING: Failed to fast-forward existing repo to latest $BRANCH."
    echo "         Continuing with local checkout as-is."
  fi
  cd ..
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
