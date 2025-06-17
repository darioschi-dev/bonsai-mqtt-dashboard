// server.js
import express from 'express';
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Serve frontend statico da /public
app.use(express.static('public'));

// Connessione MQTT
const mqttUrl = process.env.MQTT_URL;
const mqttOptions = {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocol: 'mqtts',
};

const client = mqtt.connect(mqttUrl, mqttOptions);

let latestData = {
    pump: '-',
    humidity: '-',
    last_on: '-',
    last_seen: '-',
    battery: '-',
    temp: '-',
    wifi: '-',
    firmware: '-',
};

client.on('connect', () => {
    console.log('MQTT connesso');
    client.subscribe('bonsai/status/#');
    client.subscribe('bonsai/info/firmware');
});

client.on('message', (topic, message) => {
    const value = message.toString();
    if (topic === 'bonsai/status/pump') latestData.pump = value;
    if (topic === 'bonsai/status/pump/last_on') latestData.last_on = value;
    if (topic === 'bonsai/status/last_seen') latestData.last_seen = value;
    if (topic === 'bonsai/status/humidity') latestData.humidity = value;
    if (topic === 'bonsai/status/battery') latestData.battery = value;
    if (topic === 'bonsai/status/temp') latestData.temp = value;
    if (topic === 'bonsai/status/wifi') latestData.wifi = value;
    if (topic === 'bonsai/info/firmware') latestData.firmware = value;
});

// API comando pompa
app.post('/pump', (req, res) => {
    const { action } = req.body;
    if (!['on', 'off'].includes(action)) {
        return res.status(400).json({ error: 'Azione non valida' });
    }

    // ✅ Usa retain: true per mantenere il comando nel broker
    client.publish('bonsai/command/pump', action, { retain: true });

    // Salvataggio stato locale
    if (action === 'on') {
        latestData.last_on = new Date().toISOString();
    }
    latestData.pump = action;

    return res.json({ status: action });
});

// API per ottenere l'ultimo stato
app.get('/status', (req, res) => {
    res.json(latestData);
});

// Configurazione ricevuta via MQTT
let currentConfig = null;
let configRequestedAt = null;

// Ricezione config
client.on('message', (topic, message) => {
    const value = message.toString();

    // 🧠 Nuovo: salva config ricevuta via MQTT
    if (topic === 'bonsai/status/config') {
        try {
            currentConfig = JSON.parse(value);
            console.log("✅ Config ricevuta:", currentConfig);
        } catch (e) {
            console.error("Errore parsing config MQTT:", e);
        }
    }

    // ✅ Già esistente: aggiorna latestData
    if (topic === 'bonsai/status/pump') latestData.pump = value;
    if (topic === 'bonsai/status/pump/last_on') latestData.last_on = value;
    if (topic === 'bonsai/status/last_seen') latestData.last_seen = value;
    if (topic === 'bonsai/status/humidity') latestData.humidity = value;
    if (topic === 'bonsai/status/battery') latestData.battery = value;
    if (topic === 'bonsai/status/temp') latestData.temp = value;
    if (topic === 'bonsai/status/wifi') latestData.wifi = value;
    if (topic === 'bonsai/info/firmware') latestData.firmware = value;
});


// API: ottieni config da ESP via MQTT
app.get('/api/config', async (req, res) => {
    currentConfig = null;
    configRequestedAt = Date.now();
    client.publish('bonsai/command/config:get', '1');

    // Attendi risposta max 3s
    const timeout = 3000;
    const interval = 100;
    const maxTries = timeout / interval;
    let tries = 0;

    const waitForConfig = () =>
        new Promise((resolve, reject) => {
            const check = () => {
                if (currentConfig) return resolve(currentConfig);
                if (tries++ >= maxTries) return reject('Timeout');
                setTimeout(check, interval);
            };
            check();
        });

    try {
        const config = await waitForConfig();
        res.json(config);
    } catch (err) {
        res.status(504).json({ error: 'Timeout ricezione config via MQTT' });
    }
});

app.post('/api/config', (req, res) => {
    const payload = JSON.stringify(req.body);
    client.publish('bonsai/command/config:set', payload, { retain: true });
    res.json({ success: true });
});


app.listen(port, () => {
    console.log(`Server in ascolto su http://localhost:${port}`);
});
