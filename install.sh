#!/bin/bash

set -e
REPO_URL="https://github.com/tuo-utente/bonsai-mqtt-dashboard.git"
PROJECT_DIR="bonsai-mqtt-dashboard"
FIRMWARE_FILE="esp32.bin"

echo "🔧 Installazione dashboard Bonsai in corso..."

# Installa Docker se assente
if ! command -v docker &> /dev/null; then
  echo "📦 Docker non trovato. Installazione in corso..."
  curl -fsSL https://get.docker.com | sh
fi

# Clona il progetto solo se non esiste
if [ ! -d "$PROJECT_DIR" ]; then
  echo "📁 Clonazione repo..."
  git clone "$REPO_URL"
else
  echo "📁 Repo già presente. Salto clonazione."
fi

cd "$PROJECT_DIR" || exit

# Prepara directory firmware
mkdir -p uploads/firmware

# Copia firmware locale se presente
if [ -f "../$FIRMWARE_FILE" ]; then
  echo "📦 Copia firmware $FIRMWARE_FILE in uploads/firmware/"
  cp "../$FIRMWARE_FILE" "uploads/firmware/esp32.bin"
fi

# Build e avvio
echo "🐳 Costruzione immagini Docker..."
docker compose build

echo "🚀 Avvio dei container..."
docker compose up -d

# Mostra IP locale
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "✅ Installazione completata!"
echo "🌐 Dashboard disponibile su:"
echo "   → http://localhost:3000"
echo "   → http://$LOCAL_IP:3000"
