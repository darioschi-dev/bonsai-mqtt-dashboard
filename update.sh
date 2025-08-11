#!/usr/bin/env bash
set -euo pipefail

STACK_DIR="/opt/bonsai-stack"
APP_DIR="$STACK_DIR/app"

echo "==> Pull Git"
cd "$APP_DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"
git fetch --all --prune
git reset --hard "origin/$BRANCH"

echo "==> Rebuild & restart (pull base images)"
cd "$STACK_DIR"
docker compose pull --ignore-buildable || true
docker compose build --no-cache
docker compose up -d --force-recreate

echo "==> Versione sorgenti:"
git -C "$APP_DIR" --no-pager log -1 --oneline

echo "==> Stato container:"
docker compose ps
