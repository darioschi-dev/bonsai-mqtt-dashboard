// index.ts
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { setupMqttClient, publishRetained } from './mqttClient.js';
import { getLatestLogs } from './dataLogger.js';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// __dirname compat ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
// ↑ Se sei dietro reverse proxy, metti qualcosa tipo https://pi0.local

const app = express();

// index.ts
const UPDATE_HOST = process.env.UPDATE_HOST || 'bonsai-iot-update.darioschiavano.it';

app.use((req, res, next) => {
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const onUpdateHost = host.split(',')[0].trim().toLowerCase() === UPDATE_HOST;

    if (onUpdateHost) {
        // consenti solo OTA + upload
        if (req.path.startsWith('/firmware') || req.path === '/upload-firmware') return next();
        return res.status(404).send('Not found');
    }
    next();
});

// Statici: frontend + uploads (per servire /uploads/firmware/esp32.bin)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// API: ultimi log MQTT
app.get('/api/logs', async (_req, res) => {
    const logs = await getLatestLogs(100);
    res.json(logs);
});

// === OTA ===
const upload = multer({ dest: '/tmp' });
const firmwareDir = path.resolve(__dirname, '..', 'uploads', 'firmware');
const binPath = path.join(firmwareDir, 'esp32.bin');
const manifestPath = path.join(firmwareDir, 'manifest.json');

async function ensureDirs() {
    await fsp.mkdir(firmwareDir, { recursive: true });
}

async function sha256File(filePath: string) {
    return new Promise<string>((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const s = fs.createReadStream(filePath);
        s.on('data', (d) => h.update(d));
        s.on('end', () => resolve(h.digest('hex')));
        s.on('error', reject);
    });
}

// Upload firmware OTA (+ publish annuncio)
app.post('/upload-firmware', upload.single('firmware'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'File mancante (campo "firmware")' });
        const version = (req.body?.version || '').trim();
        const notes = (req.body?.notes || '').toString();

        if (!version) return res.status(400).json({ error: 'Version mancante' });

        await ensureDirs();

        // Salva come esp32.bin (puoi anche versionare, ma qui teniamo alias fisso)
        await fsp.rename(req.file.path, binPath);

        // Calcola metadati
        const stat = await fsp.stat(binPath);
        const sha256 = await sha256File(binPath);

        // URL pubblico del bin (via static /uploads)
        const url = `${BASE_URL}/uploads/firmware/esp32.bin`;

        const manifest = {
            version,
            url,
            sha256,
            size: stat.size,
            created_at: new Date().toISOString(),
            notes,
        };

        await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

        console.log('✅ Firmware ricevuto e salvato come esp32.bin');
        console.log('📝 Manifest aggiornato:', manifest);

        // Annuncio OTA (retain=true, così i device che si collegano dopo lo vedono)
        await publishRetained('bonsai/ota/available', JSON.stringify(manifest));

        // (opzionale) reboot broadcast se vuoi forzare subito:
        // publishMqttCommand('bonsai/command/reboot', '1');

        res.json({ success: true, manifest });
    } catch (err: any) {
        console.error('❌ Errore upload OTA:', err?.message || err);
        res.status(500).json({ error: 'Errore interno upload OTA' });
    } finally {
        // Pulisci eventuale tmp residuo
        if (req.file && fs.existsSync(req.file.path)) {
            try { await fsp.unlink(req.file.path); } catch {}
        }
    }
});

// Serve manifest (comodo anche per test manuali)
app.get('/firmware/manifest.json', async (_req, res) => {
    try {
        const data = await fsp.readFile(manifestPath, 'utf-8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } catch {
        res.status(404).json({ error: 'Manifest non trovato' });
    }
});

// Ripubblica ultimo manifest su MQTT (retain) – utile per test
app.post('/api/ota/announce', async (_req, res) => {
    try {
        const data = await fsp.readFile(manifestPath, 'utf-8');
        await publishRetained('bonsai/ota/available', data);
        res.json({ ok: true });
    } catch {
        res.status(404).json({ error: 'Manifest non trovato' });
    }
});

// Config per frontend
app.get('/config/frontend', (_req, res) => {
    res.json({
        mqtt_ws_host: process.env.MQTT_WS_HOST || '',
        mqtt_username: process.env.MQTT_USERNAME || '',
        mqtt_password: process.env.MQTT_PASSWORD || '',
    });
});

// Avvio MQTT + server
setupMqttClient();
app.listen(PORT, HOST, () => {
    console.log(`🌱 Dashboard server avviato su http://${HOST}:${PORT}`);
});
