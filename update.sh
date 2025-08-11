#!/usr/bin/env bash
set -euo pipefail

STACK_DIR="/opt/bonsai-stack"
APP_DIR="$STACK_DIR"

echo "==> Pull Git"
cd "$APP_DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"
git fetch --all --prune
git reset --hard "origin/$BRANCH"

echo "==> Rebuild dashboard (multi-stage) & restart"
cd "$STACK_DIR"

mkdir -p "$STACK_DIR/uploads"
mkdir -p "$STACK_DIR/app/uploads"

# Aggiorna eventuali immagini di base (solo se vuoi aggiornare anche mongo/mqtt)
docker compose pull --ignore-buildable

# Ricostruisce solo l'immagine dashboard, senza cache
docker compose build --no-cache dashboard

# Riavvia dashboard mantenendo mqtt e mongo attivi
docker compose up -d dashboard

echo "==> Versione sorgenti:"
git -C "$APP_DIR" --no-pager log -1 --oneline

echo "==> Stato container:"
docker compose ps
