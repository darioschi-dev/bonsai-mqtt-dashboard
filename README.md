# 🌿 Bonsai MQTT Dashboard

Sistema completo per il controllo e monitoraggio remoto di un bonsai tramite ESP32 e MQTT.
Questa applicazione permette di accendere/spegnere la pompa, visualizzare lo stato attuale e monitorare i dati di umidità dal terreno.

---

## 📆 Caratteristiche

* 🌐 **Frontend statico** (HTML/CSS/JS)
* 🚀 **Backend** Node.js + Express in TypeScript
* 📡 **MQTT via broker Docker interno** per comunicazione sicura e asincrona
* 🪫 Visualizzazione batteria, umidità, temperatura, stato pompa, segnale WiFi
* 📅 Salvataggio storico su **MongoDB o Redis** (a seconda della configurazione)
* 🔐 Gestione sicura delle credenziali tramite file `.env`
* 🐳 **Containerizzazione Docker** per deploy semplificato
* ⚙️ Deploy facile su VPS, Raspberry Pi o altri ambienti

---

## 📁 Struttura progetto

```txt
bonsai-mqtt-dashboard/
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
├── .env
├── .gitignore
├── README.md
├── install.sh                  # installazione automatica su Raspberry/server
├── scripts/
│   └── release.sh              # esportazione firmware da PlatformIO
├── uploads/
│   └── firmware/esp32.bin      # ultimo firmware compilato
├── public/                     # frontend statico
│   ├── index.html
│   ├── style.css
│   └── script.js
├── src/
│   ├── index.ts                # server Express
│   ├── mqttClient.ts           # gestione MQTT
│   ├── dataLogger.ts           # salvataggio su MongoDB o Redis
│   └── types.ts                # tipi condivisi
└── data/
    └── logs.json               # (opzionale) fallback locale
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

## 📄 Rilascio firmware (ESP32)

Usa lo script `scripts/release.sh` per compilare il firmware via PlatformIO e copiarlo nella cartella `uploads/firmware/esp32.bin`.
Questo file può essere scaricato via HTTP o aggiornato via OTA.

---

## 📌 To-do futuri

* [ ] Interfaccia PWA e fullscreen
* [ ] WebSocket lato frontend
* [ ] Grafico storico interattivo
* [ ] Aggiornamento configurazione ESP via MQTT/HTTP
