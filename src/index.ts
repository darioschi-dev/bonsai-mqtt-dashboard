// index.ts
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { setupMqttClient, publishRetained } from './mqttClient.js';
import { getLatestLogs } from './dataLogger.js';

// __dirname compat ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL_ENV = process.env.BASE_URL || ''; // opzionale override assoluto
const UPDATE_HOST = (process.env.UPDATE_HOST || 'bonsai-iot-update.darioschiavano.it').toLowerCase();
const OTA_TOKEN = process.env.OTA_TOKEN || '';   // opzionale: auth bearer per /upload-firmware

const app = express();

/* ---------- Helpers ---------- */

function resolveBaseUrl(req: express.Request): string {
    if (BASE_URL_ENV) return BASE_URL_ENV.replace(/\/+$/, '');
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = ((req.headers['x-forwarded-host'] as string) || req.headers.host || '').split(',')[0].trim();
    return `${proto}://${host}`;
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

/* ---------- Static / routing policy ---------- */

// Espone asset frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Espone i bin OTA sotto /firmware (NON /uploads) per coerenza con il gate UPDATE_HOST
// Directory firmware e temporanea, entrambe nello stesso volume
const firmwareDir = path.resolve(__dirname, '..', 'uploads', 'firmware');
const tmpDir = path.resolve(__dirname, '..', 'uploads', 'tmp');

await fsp.mkdir(firmwareDir, { recursive: true }).catch(() => {});
await fsp.mkdir(tmpDir, { recursive: true }).catch(() => {});

// Multer salva direttamente nel volume condiviso
const upload = multer({ dest: tmpDir });

const binPath = path.join(firmwareDir, 'esp32.bin');
const manifestPath = path.join(firmwareDir, 'manifest.json');

app.use('/firmware', express.static(firmwareDir)); // serve /firmware/esp32.bin e /firmware/manifest.json

// Se la richiesta arriva all'host di update, consenti SOLO le rotte OTA
app.use((req, res, next) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const host = rawHost.split(',')[0].trim().toLowerCase();
    if (host === UPDATE_HOST) {
        if (
            req.path === '/upload-firmware' ||
            req.path.startsWith('/firmware') ||
            req.path === '/api/ota/announce'
        ) return next();
        return res.status(404).send('Not found');
    }
    return next();
});

/* ---------- API utili ---------- */

// Ultimi log MQTT
app.get('/api/logs', async (_req, res) => {
    const logs = await getLatestLogs(100);
    res.json(logs);
});

// Config per frontend (MQTT over WS)
app.get('/config/frontend', (_req, res) => {
    res.json({
        mqtt_ws_host: process.env.MQTT_WS_HOST || '',
        mqtt_username: process.env.MQTT_USERNAME || '',
        mqtt_password: process.env.MQTT_PASSWORD || '',
    });
});

/* ---------- OTA upload & announce ---------- */

// Upload firmware OTA (+ genera manifest + publish retained)
app.post('/upload-firmware', upload.single('firmware'), async (req, res) => {
    console.log('[OTA] Inizio upload');
    try {
        if (OTA_TOKEN) {
            const auth = (req.headers.authorization || '').trim();
            if (!auth.startsWith('Bearer ') || auth.slice(7) !== OTA_TOKEN) {
                console.log('[OTA] Token non valido');
                return res.status(401).json({ error: 'Unauthorized' });
            }
        }

        if (!req.file) {
            console.log('[OTA] Nessun file');
            return res.status(400).json({ error: 'File mancante (campo "firmware")' });
        }
        console.log('[OTA] File ricevuto:', req.file);

        // 🔹 Aggiungi qui per debug
        console.log('[OTA] req.file.path:', req.file.path);
        console.log('[OTA] binPath:', binPath);

        const version = (req.body?.version || '').toString().trim();
        if (!version) {
            console.log('[OTA] Version mancante');
            return res.status(400).json({ error: 'Version mancante' });
        }
        console.log('[OTA] Version:', version);

        // move con fallback
        try {
            console.log('[OTA] Tentativo rename');
            await fsp.rename(req.file.path, binPath);
        } catch (e: any) {
            console.warn('[OTA] rename fallita:', e?.message);
            console.log('[OTA] Tentativo copy+unlink');
            await fsp.copyFile(req.file.path, binPath);
            await fsp.unlink(req.file.path).catch(() => {});
        }

        console.log('[OTA] Stat file destinazione');
        const stat = await fsp.stat(binPath);
        console.log('[OTA] File size:', stat.size);

        const sha256 = await sha256File(binPath);
        console.log('[OTA] SHA256:', sha256);

        const base = resolveBaseUrl(req);
        const url = `${base}/firmware/esp32.bin`;
        const manifest = { version, url, sha256, size: stat.size, created_at: new Date().toISOString() };

        console.log('[OTA] Scrittura manifest');
        await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

        console.log('[OTA] Publish retained');
        await publishRetained('bonsai/ota/available', JSON.stringify(manifest));

        console.log('[OTA] Success');
        res.json({ success: true, manifest });
    } catch (err: any) {
        console.error('❌ Errore upload OTA:', err);
        res.status(500).json({ error: 'Errore interno upload OTA' });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) {
            try { await fsp.unlink(req.file.path); } catch {}
        }
    }
});

// Legge il manifest (utile per verifica)
app.get('/firmware/manifest.json', async (_req, res) => {
    try {
        const data = await fsp.readFile(manifestPath, 'utf-8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } catch {
        res.status(404).json({ error: 'Manifest non trovato' });
    }
});

// Ripubblica ultimo manifest (retain) su richiesta
app.post('/api/ota/announce', async (_req, res) => {
    try {
        const data = await fsp.readFile(manifestPath, 'utf-8');
        await publishRetained('bonsai/ota/available', data);
        res.json({ ok: true });
    } catch {
        res.status(404).json({ error: 'Manifest non trovato' });
    }
});

/* ---------- Avvio ---------- */

setupMqttClient();

app.listen(PORT, HOST, () => {
    console.log(`🌱 Dashboard server avviato su http://${HOST}:${PORT}`);
});
