import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { setupMqttClient, publishMqttCommand } from './mqttClient.js';
import { getLatestLogs } from './dataLogger.js';
import multer from 'multer';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Ricrea __dirname (ESM compatibile)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carica le variabili d'ambiente da .env
dotenv.config();

// Configurazione IP e porta da .env
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0'; // Ascolta su tutte le interfacce per default

const app = express();

// Serve frontend statico da /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// API: ultimi log MQTT
app.get('/api/logs', async (_req, res) => {
    const logs = await getLatestLogs(100);
    res.json(logs);
});

// Upload firmware OTA
const upload = multer({ dest: '/tmp' });

app.post('/upload-firmware', upload.single('firmware'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File mancante' });

    const destPath = path.resolve(__dirname, '..', 'uploads', 'firmware', 'esp32.bin');

    fs.rename(req.file.path, destPath, (err) => {
        if (err) return res.status(500).json({ error: 'Errore salvataggio file' });

        console.log('✅ Firmware ricevuto e salvato come esp32.bin');

        // Pubblica comando reboot via MQTT
        publishMqttCommand('bonsai/command/reboot', '1');

        res.json({ success: true });
    });
});

// Config per frontend
app.get('/config/frontend', (_req, res) => {
    res.json({
        mqtt_ws_host: process.env.MQTT_WS_HOST || '',
        mqtt_username: process.env.MQTT_USERNAME || '',
        mqtt_password: process.env.MQTT_PASSWORD || '',
    });
});

// Avvio MQTT
setupMqttClient();

// Avvio server
app.listen(PORT, HOST, () => {
    console.log(`🌱 Dashboard server avviato su http://${HOST}:${PORT}`);
});
