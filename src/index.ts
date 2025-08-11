// index.ts
import express, {Request, Response, NextFunction} from 'express';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import {fileURLToPath} from 'url';

import {setupMqttClient, publishRetained} from './mqttClient.js';
import {getLatestLogs, getOtaAcks} from './dataLogger.js';

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

function resolveBaseUrl(req: Request): string {
    if (BASE_URL_ENV) return BASE_URL_ENV.replace(/\/+$/, '');
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = ((req.headers['x-forwarded-host'] as string) || req.headers.host || '').split(',')[0].trim();
    return `${proto}://${host}`;
}

async function sha256File(filePath: string): Promise<string> {
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

// Directory firmware e temporanea nello stesso volume bind-mountato
const firmwareDir = path.resolve(__dirname, '..', 'uploads', 'firmware');
const tmpDir = path.resolve(__dirname, '..', 'uploads', 'tmp');

await fsp.mkdir(firmwareDir, {recursive: true});
await fsp.mkdir(tmpDir, {recursive: true});

// Multer salva direttamente nel volume condiviso
const upload = multer({
    dest: tmpDir,
    limits: {fileSize: 4 * 1024 * 1024},
    fileFilter: (_req, file, cb) => {
        if (file.fieldname !== 'firmware') {
            return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE'));
        }
        cb(null, true);
    }
});

const binPath = path.join(firmwareDir, 'esp32.bin');
const manifestPath = path.join(firmwareDir, 'manifest.json');

// Cache-Control OTA
app.get('/firmware/manifest.json', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});
app.get('/firmware/esp32.bin', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
    next();
});
app.use('/firmware', express.static(firmwareDir));

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

app.get('/api/logs', async (_req, res) => {
    const logs = await getLatestLogs(100);
    res.json(logs);
});

app.get('/config/frontend', (_req, res) => {
    res.json({
        mqtt_ws_host: process.env.MQTT_WS_HOST || '',
        mqtt_username: process.env.MQTT_USERNAME || '',
        mqtt_password: process.env.MQTT_PASSWORD || '',
    });
});

/* ---------- OTA upload & announce ---------- */

let uploading = false;

app.post('/upload-firmware', upload.single('firmware'), async (req: Request, res: Response) => {
    console.log('[OTA] Inizio upload');

    if (uploading) {
        return res.status(409).json({error: 'Upload già in corso'});
    }
    uploading = true;

    try {
        if (OTA_TOKEN) {
            const auth = (req.headers.authorization || '').trim();
            if (!auth.startsWith('Bearer ') || auth.slice(7) !== OTA_TOKEN) {
                console.log('[OTA] Token non valido');
                return res.status(401).json({error: 'Unauthorized'});
            }
        }

        if (!req.file) {
            console.log('[OTA] Nessun file');
            return res.status(400).json({error: 'File mancante (campo "firmware")'});
        }
        console.log('[OTA] File ricevuto:', req.file);

        const version = (req.body?.version || '').toString().trim();
        if (!version) {
            console.log('[OTA] Version mancante');
            return res.status(400).json({error: 'Version mancante'});
        }
        console.log('[OTA] Version:', version);

        const tmpAtomic = path.join(firmwareDir, `.esp32.bin.tmp`);
        console.log('[OTA] Tentativo rename atomico');
        await fsp.rename(req.file.path, tmpAtomic);

        console.log('[OTA] Calcolo SHA256 e size');
        const sha256 = await sha256File(tmpAtomic);
        const stat = await fsp.stat(tmpAtomic);

        console.log('[OTA] Rename finale su esp32.bin');
        await fsp.rename(tmpAtomic, binPath);

        const base = resolveBaseUrl(req);
        const url = `${base}/firmware/esp32.bin`;
        const manifest = {version, url, sha256, size: stat.size, created_at: new Date().toISOString()};

        console.log('[OTA] Scrittura manifest');
        await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

        console.log('[OTA] Publish retained');
        await publishRetained('bonsai/ota/available', JSON.stringify(manifest));

        console.log('[OTA] Success');
        res.json({success: true, manifest});
    } catch (err: any) {
        console.error('❌ Errore upload OTA:', err);
        await fsp.rm(path.join(firmwareDir, `.esp32.bin.tmp`), {force: true});
        res.status(500).json({error: 'Errore interno upload OTA'});
    } finally {
        uploading = false;
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                await fsp.unlink(req.file.path);
            } catch {
            }
        }
    }
});

app.post('/api/ota/announce', async (_req, res) => {
    try {
        const data = await fsp.readFile(manifestPath, 'utf-8');
        await publishRetained('bonsai/ota/available', data);
        res.json({ok: true});
    } catch {
        res.status(404).json({error: 'Manifest non trovato'});
    }
});

app.get('/firmware/manifest.json', async (_req, res) => {
    try {
        const data = await fsp.readFile(manifestPath, 'utf-8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } catch {
        res.status(404).json({error: 'Manifest non trovato'});
    }
});

app.get('/api/ota/acks', async (req, res) => {
    const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    res.json(await getOtaAcks(limit));
});
/* ---------- Avvio ---------- */

setupMqttClient();

// Error handler tipizzato
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({error: 'MulterError', code: err.code});
    }
    res.status(500).json({error: 'Errore interno', details: (err as Error)?.message});
});

app.listen(PORT, HOST, () => {
    console.log(`🌱 Dashboard server avviato su http://${HOST}:${PORT}`);
});
