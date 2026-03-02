#!/usr/bin/env bash
set -euo pipefail

# Always run from this directory
cd "$(dirname "$0")"

# Kill anything bound to port 3001 (best-effort)
lsof -ti :3001 | xargs kill 2>/dev/null || true
sleep 1
lsof -ti :3001 | xargs kill -9 2>/dev/null || true

# Keep restarting on crash/exit
while true; do
  echo "[pawvy-backend] starting dev server ($(date -Is))"
  npm run dev
  echo "[pawvy-backend] dev server exited ($?). restarting in 1s..."
  sleep 1
done
