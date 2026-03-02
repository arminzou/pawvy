#!/bin/bash
set -e

# Resolve deployment directory.
# - APP_DIR is used by CI/remote deploy jobs.
# - Fallback is the repository root for local/manual usage.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="${APP_DIR:-$REPO_ROOT}"

cd "$DEPLOY_DIR"

# Optional personal override (not tracked in this repo).
# If present and executable, it fully controls deployment behavior.
OVERRIDE_SCRIPT="${PAWVY_DEPLOY_OVERRIDE:-$HOME/.pawvy/deploy.override.sh}"
if [ -x "$OVERRIDE_SCRIPT" ]; then
  echo "[deploy] Using override script: $OVERRIDE_SCRIPT"
  APP_DIR="$DEPLOY_DIR" PAWVY_DEPLOY_DIR="$DEPLOY_DIR" "$OVERRIDE_SCRIPT"
  exit 0
fi

# Default OSS/local deployment
docker compose up -d --build

echo "[deploy] Deployment successful (default mode)"
