import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { setupMqttClient } from './mqttClient';
import { getLatestLogs } from './dataLogger';
import multer from 'multer';
import fs from 'fs';
// Importa le variabili d'ambiente
// Assicurati di avere un file .env nella root del progetto con le variabili necessarie
// come MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, MONGODB_URI, MONGODB
// DB, MONGODB_COLLECTION, PORT, DEBUG

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Serve frontend statico da /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// API: ultimi log MQTT
app.get('/api/logs', async (_req, res) => {
    const logs = await getLatestLogs(100);
    res.json(logs);
});

// Avvio MQTT client
setupMqttClient();

app.listen(PORT, () => {
    console.log(`🌱 Dashboard server avviato su http://localhost:${PORT}`);
});

// Upload firmware OTA
const upload = multer({ dest: '/tmp' });

app.post('/upload-firmware', upload.single('firmware'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File mancante' });

    const destPath = path.resolve(__dirname, '..', 'uploads', 'firmware', 'esp32.bin');

    fs.rename(req.file.path, destPath, (err) => {
        if (err) return res.status(500).json({ error: 'Errore salvataggio file' });

        console.log('✅ Firmware ricevuto e salvato come esp32.bin');

        // ✅ Pubblica comando reboot via MQTT
        publishMqttCommand('bonsai/command/reboot', '1');

        res.json({ success: true });
    });
});

app.get('/config/frontend', (_req, res) => {
    res.json({
        mqtt_ws_host: process.env.MQTT_WS_HOST || '',
        mqtt_username: process.env.MQTT_USERNAME || '',
        mqtt_password: process.env.MQTT_PASSWORD || '',
    });
});
