# 🌿 Bonsai MQTT Dashboard

Sistema completo per il controllo e monitoraggio remoto di un bonsai tramite **ESP32** e **MQTT**.  
Consente di accendere/spegnere la pompa, monitorare stato e dati (umidità, temperatura, batteria, segnale WiFi) e gestire aggiornamenti firmware **OTA** in modo sicuro e tracciabile.

---

## 📆 Funzionalità implementate

### 🌐 **Frontend**
- Interfaccia web responsive (HTML/CSS/JS) con:
    - Stato pompa (manuale/automatico)
    - Umidità terreno (gauge + storico)
    - Batteria, temperatura, segnale WiFi
    - Tema chiaro/scuro
- Configurazione completa ESP32 via form
- Upload firmware OTA dal browser
- Autenticazione via PIN temporaneo (sessionStorage)

### 🚀 **Backend (Node.js + Express + TypeScript)**
- API REST per:
    - `/api/logs` — ultimi log MQTT
    - `/config/frontend` — parametri MQTT WS per frontend
    - `/api/ota/acks` — ultimi ACK OTA (tutti o filtrati per device)
    - `/api/ota/announce` — ripubblica ultimo manifest OTA
- **Gestione OTA sicura**:
    - Upload protetto via token Bearer (`OTA_TOKEN`)
    - Salvataggio firmware con **scrittura atomica** (`.tmp` → rename definitivo)
    - Calcolo SHA256 e dimensione file
    - Generazione `manifest.json` con metadata
    - Pubblicazione retained su `bonsai/ota/available`
    - Middleware `Cache-Control`:
        - `manifest.json` → `no-store`
        - `esp32.bin` → `no-cache` (o immutable se versionato)
    - Gestione upload concorrenti (blocco fino a fine scrittura)
    - Pulizia file temporanei su errore
- **MQTT**:
    - Sottoscrizione a `bonsai/status/#` (stato device)
    - Sottoscrizione a `bonsai/ota/ack/#` (risposta a OTA)
    - Salvataggio log MQTT (`logs`) e ACK OTA (`ota_acks`) su MongoDB
    - Funzioni `publishMqttCommand()` e `publishRetained()`
- **MongoDB**:
    - Collezione `logs` — messaggi MQTT generici
    - Collezione `ota_acks` — conferme OTA con:
        - `device`, `version`, `status` (`applied` / `failed` / `skipped`), `duration_ms`, `reason`, timestamp
    - Funzioni `saveOtaAck()` e `getOtaAcks()`
    - Indici ottimizzati:
        - `logs`: `{ timestamp: -1 }`, `{ topic: 1, timestamp: -1 }`
        - `ota_acks`: `{ received_at: -1 }`, `{ device: 1, received_at: -1 }`

### 🐳 **Containerizzazione Docker**
- `dashboard`: backend Node.js
- `mqtt`: broker Eclipse Mosquitto 2.0
- `mongo`: database MongoDB 6
- Volumi persistenti per `uploads`, `mosquitto/data`, `data/mongodb`

### 🔧 **CI/CD e OTA automatico**
- **GitHub Actions**:
    - Build firmware ESP32 (`esp32-prod`)
    - Upload come artifact
    - Upload automatico a server OTA via `curl -F firmware=@...`
    - Supporto token Bearer e versione automatica (`YYYYMMDD_HHMM`)
- Aggiornamento OTA anche da interfaccia web

---

## 📁 Struttura progetto

```txt
bonsai-mqtt-dashboard/
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── install.sh                  # installazione automatica su Raspberry/server
├── scripts/
│   └── release.sh              # build e rilascio firmware da PlatformIO
├── uploads/
│   └── firmware/esp32.bin      # ultimo firmware disponibile per OTA
├── public/                     # frontend statico
│   ├── index.html
│   ├── style.css
│   └── script.js
├── src/
│   ├── index.ts                # server Express + API OTA
│   ├── mqttClient.ts           # gestione MQTT + salvataggio log/ACK
│   ├── dataLogger.ts           # gestione MongoDB, log e ACK OTA
│   └── types.ts                # tipi condivisi
└── data/
    └── logs.json               # fallback locale (opzionale)
```

---

## ▶️ Comandi utili

```bash
# Avvio in modalità sviluppo
npx nodemon src/index.ts

# Compilazione e avvio manuale
npx tsc && node dist/index.js

# Avvio via Docker
docker compose up -d --build
```

---

## 📄 Flusso OTA

1. **Build firmware** (locale o via GitHub Actions)
2. **Upload** via interfaccia web o CI:
    - `curl -F firmware=@firmware.bin -F version=... -H "Authorization: Bearer $OTA_TOKEN" $OTA_UPLOAD_URL`
3. Server:
    - Scrive `.tmp`, calcola SHA256, rename su `esp32.bin`
    - Genera `manifest.json` (`version`, `url`, `sha256`, `size`, `created_at`)
    - Pubblica su MQTT retained (`bonsai/ota/available`)
4. Device:
    - Riceve manifest → scarica bin → applica update
    - Pubblica `bonsai/ota/ack/<device>` con esito
5. Server:
    - Salva ACK in MongoDB
    - API `/api/ota/acks` consultabile via frontend

---

## 📌 To-do futuri

* [ ] Interfaccia PWA e fullscreen
* [ ] WebSocket lato frontend per aggiornamenti real-time
* [ ] Grafico storico interattivo (umidità/temperatura)
* [ ] Aggiornamento configurazione ESP via MQTT/HTTP
* [ ] Visualizzazione e filtro ACK OTA in dashboard
* [ ] Gestione OTA forzati (`force: true`)
* [ ] TLS pinning sull’ESP32 per download sicuro
