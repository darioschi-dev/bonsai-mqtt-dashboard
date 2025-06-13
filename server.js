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

app.listen(port, () => {
    console.log(`Server in ascolto su http://localhost:${port}`);
});
