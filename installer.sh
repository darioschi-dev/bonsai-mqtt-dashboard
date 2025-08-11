#!/usr/bin/env bash
# Bonsai MQTT Dashboard stack installer per Raspberry Pi (Pi 3B+ friendly)
# - Docker + Compose plugin
# - Clona/aggiorna repo GitHub (branch master)
# - Mosquitto con credenziali generate
# - MongoDB ottimizzato per 1GB RAM
# - .env per Compose e per l'app
# - Firmware opzionale (file locale o URL)

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# ---------- Config (override via env) ----------
STACK_DIR="${STACK_DIR:-/opt/bonsai-stack}"
REPO_URL="${REPO_URL:-https://github.com/darioschi-dev/bonsai-mqtt-dashboard.git}"
BRANCH="${BRANCH:-master}"
APP_DIR="${APP_DIR:-$STACK_DIR/app}"

MQTT_USER="${MQTT_USER:-bonsai}"
# Prova openssl, fallback a /dev/urandom
MQTT_PASS="${MQTT_PASS:-$( (openssl rand -base64 24 2>/dev/null || head -c 24 /dev/urandom | base64) | tr -d '\n' )}"
# JWT segreto esadecimale, evita dipendenze esterne (hexdump)
JWT_SECRET="${JWT_SECRET:-$( (head -c 32 /dev/urandom | hexdump -v -e '1/1 "%02x"') 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 256 )}"

PORT="${PORT:-3000}"
MONGO_DB="${MONGO_DB:-bonsai}"
MONGO_PORT="${MONGO_PORT:-27017}"
MOSQ_MQTT_PORT="${MOSQ_MQTT_PORT:-1883}"
MOSQ_WS_PORT="${MOSQ_WS_PORT:-9001}"

# opzionale firmware
FIRMWARE_FILE="${FIRMWARE_FILE:-}"   # es: /home/pi/esp32.bin
FIRMWARE_URL="${FIRMWARE_URL:-}"     # es: https://example/esp32.bin

MOSQ_DIR="$STACK_DIR/mosquitto"
DATA_DIR="$STACK_DIR/data/mongodb"
ENV_FILE="$APP_DIR/.env"
COMPOSE_FILE="$STACK_DIR/compose.yaml"
COMPOSE_ENV="$STACK_DIR/.env"        # usato da docker compose per la sostituzione variabili

# ---------- Helper ----------
need_cmd(){ command -v "$1" >/dev/null 2>&1; }
say(){ printf "\033[1;32m==>\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m[!]\033[0m %s\n" "$*"; }
die(){ printf "\033[1;31m[✗]\033[0m %s\n" "$*"; exit 1; }

require_sudo(){
  if [ "$(id -u)" -ne 0 ]; then
    if need_cmd sudo; then sudo -v || true; else die "Serve sudo o esegui come root."; fi
  fi
}

# Usa sudo docker se l'utente non è nel gruppo docker
DOCKER="docker"
if ! $DOCKER info >/dev/null 2>&1; then DOCKER="sudo docker"; fi

compose_up(){
  if docker compose version >/dev/null 2>&1; then
    docker compose --ansi never up -d --build
  else
    sudo docker compose --ansi never up -d --build
  fi
}

# ---------- System prep ----------
say "Preparazione sistema..."
require_sudo

if ! need_cmd curl || ! need_cmd git || ! need_cmd jq; then
  say "Installo pacchetti base (curl git jq)"
  sudo apt-get update -y
  sudo apt-get install -y --no-install-recommends curl git jq ca-certificates
fi

if ! need_cmd docker; then
  say "Installo Docker Engine"
  curl -fsSL https://get.docker.com | sh
  if getent group docker >/dev/null; then sudo usermod -aG docker "$USER" || true; fi
fi

if ! docker compose version >/dev/null 2>&1; then
  say "Installo docker-compose plugin"
  sudo apt-get install -y docker-compose-plugin
fi

if systemctl list-unit-files | grep -q "^docker.service"; then
  sudo systemctl enable docker || true
  sudo systemctl start docker || true
fi

# ---------- Folders ----------
say "Creo cartelle in $STACK_DIR"
sudo mkdir -p "$STACK_DIR" && sudo chown -R "$USER:$USER" "$STACK_DIR"
mkdir -p "$MOSQ_DIR"/{config,data,log} "$STACK_DIR/uploads" "$DATA_DIR"

# ---------- Mosquitto ----------
MOSQ_CONF="$MOSQ_DIR/config/mosquitto.conf"
if [ ! -f "$MOSQ_CONF" ]; then
  say "Scrivo mosquitto.conf"
  cat >"$MOSQ_CONF" <<EOF_CONF
persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log

listener ${MOSQ_MQTT_PORT}
allow_anonymous false
password_file /mosquitto/config/passwd

listener ${MOSQ_WS_PORT}
protocol websockets
EOF_CONF
fi

say "Genero credenziali MQTT per utente '${MQTT_USER}'"
$DOCKER run --rm -i -v "$MOSQ_DIR/config":/mosquitto/config eclipse-mosquitto:2.0 \
  sh -c "touch /mosquitto/config/passwd && mosquitto_passwd -b /mosquitto/config/passwd '${MQTT_USER}' '${MQTT_PASS}'"

# ---------- App clone/update ----------
if [ -d "$APP_DIR/.git" ]; then
  say "Aggiorno repo esistente in $APP_DIR"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
else
  say "Clono repo in $APP_DIR (branch ${BRANCH})"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

mkdir -p "$APP_DIR/uploads"

# firmware opzionale
if [ -n "$FIRMWARE_FILE" ] && [ -f "$FIRMWARE_FILE" ]; then
  say "Copia firmware da ${FIRMWARE_FILE}"
  mkdir -p "$APP_DIR/uploads/firmware"
  cp -f "$FIRMWARE_FILE" "$APP_DIR/uploads/firmware/esp32.bin"
elif [ -n "$FIRMWARE_URL" ]; then
  if need_cmd curl; then
    say "Scarico firmware da ${FIRMWARE_URL}"
    mkdir -p "$APP_DIR/uploads/firmware"
    curl -fsSL "$FIRMWARE_URL" -o "$APP_DIR/uploads/firmware/esp32.bin" || warn "Download firmware fallito"
  fi
fi

# ---------- Compose ----------
say "Scrivo docker compose in $COMPOSE_FILE"
cat >"$COMPOSE_FILE" << "YAML"
services:
  mqtt:
    image: eclipse-mosquitto:2.0
    container_name: mqtt
    ports:
      - "${MOSQ_MQTT_PORT:-1883}:1883"
      - "${MOSQ_WS_PORT:-9001}:9001"
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - ./mosquitto/data:/mosquitto/data
      - ./mosquitto/log:/mosquitto/log
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  mongo:
    image: mongo:6
    container_name: mongodb
    ports:
      - "${MONGO_PORT:-27017}:27017"
    command:
      - "--wiredTigerCacheSizeGB"
      - "0.25"
      - "--setParameter"
      - "wiredTigerConcurrentReadTransactions=32"
      - "--setParameter"
      - "wiredTigerConcurrentWriteTransactions=16"
    volumes:
      - ./data/mongodb:/data/db
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  dashboard:
    build:
      context: ./app
    container_name: bonsai-backend
    env_file:
      - ./app/.env
    environment:
      - NODE_OPTIONS=--max-old-space-size=192
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - ./app/public:/app/public
      - ./app/uploads:/app/uploads
    depends_on:
      - mqtt
      - mongo
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
YAML

say "Scrivo Compose .env in $COMPOSE_ENV"
cat >"$COMPOSE_ENV" <<EOF_ENV
PORT=${PORT}
MONGO_DB=${MONGO_DB}
MONGO_PORT=${MONGO_PORT}
MOSQ_MQTT_PORT=${MOSQ_MQTT_PORT}
MOSQ_WS_PORT=${MOSQ_WS_PORT}
EOF_ENV

# ---------- App .env ----------
say "Preparo app .env"
if [ -f "$APP_DIR/.env.example" ] && [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
fi
touch "$ENV_FILE"

set_kv(){
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|g" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$val" >> "$ENV_FILE"
  fi
}

BROKER_URL="mqtt://mqtt:${MOSQ_MQTT_PORT}"
MONGO_URL="mongodb://mongodb:${MONGO_PORT}/${MONGO_DB}"
set_kv "PORT" "${PORT}"
set_kv "MQTT_URL" "${BROKER_URL}"
set_kv "MQTT_BROKER_URL" "${BROKER_URL}"
set_kv "MQTT_HOST" "mqtt"
set_kv "MQTT_PORT" "${MOSQ_MQTT_PORT}"
set_kv "MQTT_USERNAME" "${MQTT_USER}"
set_kv "MQTT_PASSWORD" "${MQTT_PASS}"
set_kv "MONGO_URL" "${MONGO_URL}"
set_kv "JWT_SECRET" "${JWT_SECRET}"

# ---------- Up ----------
say "Avvio stack con Docker Compose"
cd "$STACK_DIR"
compose_up

say "Test publish MQTT (una volta)"
$DOCKER run --rm --network host eclipse-mosquitto:2.0 \
  mosquitto_pub -h 127.0.0.1 -p "${MOSQ_MQTT_PORT}" -u "${MQTT_USER}" -P "${MQTT_PASS}" -t "test/hello" -m "ok" || \
  warn "Publish di test fallito (broker forse ancora in startup)."

cat <<EONOTE

✅ Fatto.
- Dashboard:        http://$(hostname -I | awk "{print \$1}"):${PORT}
- MQTT (TCP):       127.0.0.1:${MOSQ_MQTT_PORT}
- MQTT (WebSocket): 127.0.0.1:${MOSQ_WS_PORT}
- MongoDB:          127.0.0.1:${MONGO_PORT}/${MONGO_DB}

Credenziali (salvale):
  MQTT_USERNAME=${MQTT_USER}
  MQTT_PASSWORD=${MQTT_PASS}

File:
  Compose:        ${COMPOSE_FILE}
  Compose .env:   ${COMPOSE_ENV}
  App .env:       ${ENV_FILE}
  Mosquitto conf: ${MOSQ_CONF}

Comandi utili:
  cd ${STACK_DIR}
  docker compose ps
  docker compose logs -f dashboard
  docker compose restart dashboard

Se hai appena aggiunto l'utente al gruppo docker, potresti dover riloggarti o eseguire: newgrp docker

EONOTE