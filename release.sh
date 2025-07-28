#!/bin/bash

set -e

BUILD_DIR=".pio/build/esp32dev"
FIRMWARE_BIN="firmware.bin"
DEST_DIR="../bonsai-mqtt-dashboard/uploads/firmware"

echo "🔨 Compilazione firmware con PlatformIO..."
platformio run

echo "📁 Verifica esistenza del file: $BUILD_DIR/$FIRMWARE_BIN"
if [ ! -f "$BUILD_DIR/$FIRMWARE_BIN" ]; then
    echo "❌ Errore: $FIRMWARE_BIN non trovato in $BUILD_DIR"
    exit 1
fi

echo "📦 Copia del firmware in $DEST_DIR"
mkdir -p "$DEST_DIR"
cp "$BUILD_DIR/$FIRMWARE_BIN" "$DEST_DIR/esp32.bin"

echo "✅ Firmware copiato correttamente!"
