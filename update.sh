#!/bin/bash

set -e

RASPBERRY_HOST="pi@192.168.1.42"
PROJECT_DIR="/home/pi/bonsai-mqtt-dashboard"

echo "🔧 Build del progetto TypeScript..."
npm run build

echo "📦 Copia dei file al Raspberry Pi..."
rsync -avz --delete   --exclude node_modules   --exclude .git   ./ "$RASPBERRY_HOST:$PROJECT_DIR"

echo "🚀 Riavvio del servizio sul Raspberry..."
ssh $RASPBERRY_HOST <<EOF
cd $PROJECT_DIR
docker compose down
docker compose up -d
EOF

echo "✅ Deploy completato con successo!"
