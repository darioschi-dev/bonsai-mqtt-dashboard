#!/bin/bash

set -e

# === CONFIGURAZIONE ===
PROJECT_NAME="bonsai-mqtt-dashboard"
DATE_TAG=$(date +"%Y%m%d_%H%M")
ARCHIVE_NAME="${PROJECT_NAME}_${DATE_TAG}.zip"
PARENT_DIR=$(dirname "$(pwd)")
TMP_BUILD_DIR="${PARENT_DIR}/${PROJECT_NAME}_${DATE_TAG}"

# DESTINAZIONE REMOTA
REMOTE_USER="pi"
REMOTE_HOST="raspberrypi.local"  # o IP es. 192.168.1.100
REMOTE_PATH="/home/$REMOTE_USER/$PROJECT_NAME"

echo "📦 Preparazione pacchetto di deploy..."

# 1. Copia i contenuti nella cartella temporanea
mkdir -p "$TMP_BUILD_DIR"
cp -r . "$TMP_BUILD_DIR"

# 2. Crea archivio ZIP
cd "$PARENT_DIR"
zip -rq "$ARCHIVE_NAME" "${PROJECT_NAME}_${DATE_TAG}"
rm -rf "${PROJECT_NAME}_${DATE_TAG}"

echo "📤 Copia dell’archivio $ARCHIVE_NAME su $REMOTE_HOST..."

# 3. Copia lo zip nella home del Raspberry
scp "$ARCHIVE_NAME" "$REMOTE_USER@$REMOTE_HOST:~"

echo "🖥️  Connessione a $REMOTE_HOST ed esecuzione setup..."

# 4. Connessione SSH e installazione
ssh "$REMOTE_USER@$REMOTE_HOST" bash <<EOF
set -e

echo "🧰 Installazione pacchetto..."
sudo apt-get update -y
sudo apt-get install -y unzip curl git docker.io docker-compose

echo "📁 Estrazione archivio..."
unzip -o ~/$ARCHIVE_NAME -d ~
rm ~/$ARCHIVE_NAME

echo "🚀 Avvio Docker da $(basename $REMOTE_PATH)..."
cd ~/${PROJECT_NAME}_${DATE_TAG}
docker compose down || true
docker compose build
docker compose up -d

echo "✅ Deploy completato!"
EOF

echo "🧹 Pulizia locale..."
rm "$ARCHIVE_NAME"

echo "✅ Completato. Progetto attivo su http://$REMOTE_HOST:3000"
