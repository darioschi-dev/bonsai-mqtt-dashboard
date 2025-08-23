// index.ts
import express, {Request, Response, NextFunction} from 'express';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import {fileURLToPath} from 'url';

import {
    setupMqttClient,
    publishRetained,
    getLatestStatus,
    publishMqttCommand,
    sendConfigUpdate,
    clearRetained
} from './mqttClient.js';
import {ensureMongoIndexes, getLatestLogs, getOtaAcks} from './dataLogger.js';

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
app.use(express.json()); // per leggere { action: "on" | "off" }

const configFile = path.resolve(__dirname, '..', 'uploads', 'config.json');

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
    limits: {fileSize: 4 * 1024 * 1024}, // 4 MB: ampio per ESP32
    fileFilter: (_req, file, cb) => {
        // accettiamo "firmware" e (opzionale) "version_file"
        if (file.fieldname !== 'firmware' && file.fieldname !== 'version_file') {
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

/** Comando manuale pompa */
app.post('/api/pump', (req, res) => {
    const action = String(req.body?.action || '').toLowerCase(); // "on" | "off"
    if (!['on', 'off'].includes(action)) {
        return res.status(400).json({error: "Invalid 'action'. Use 'on' or 'off'."});
    }
    // Pubblica verso l’ESP32 (adegua topic/payload a ciò che il firmware ascolta)
    publishMqttCommand('bonsai/command/pump', action.toUpperCase()); // ON | OFF
    return res.json({ok: true});
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

app.get('/status', (_req, res) => {
    res.json(getLatestStatus());
});

const defaultDeviceConfig = {
    wifi_ssid: "", wifi_password: "",
    mqtt_broker: "", mqtt_port: 8883, mqtt_username: "", mqtt_password: "",
    sensor_pin: 32, pump_pin: 26, relay_pin: 27, battery_pin: 34,
    moisture_threshold: 25, pump_duration: 5, measurement_interval: 1800000,
    debug: false, use_pump: false, sleep_hours: 0,
    use_dhcp: true, ip_address: "", gateway: "", subnet: ""
};

// GET config (per la UI)
app.get('/api/config', async (_req, res) => {
    try {
        const buf = await fsp.readFile(configFile, 'utf-8');
        return res.json(JSON.parse(buf));
    } catch {
        return res.json(defaultDeviceConfig);
    }
});

// POST config: salva + MQTT retained
app.post('/api/config', express.json({limit: '256kb'}), async (req, res) => {
    try {
        // 1) merge con default e validazione minima
        const cfg = {...defaultDeviceConfig, ...(req.body || {})};
        if (cfg.mqtt_port <= 0 || cfg.mqtt_port > 65535) {
            return res.status(400).json({error: 'invalid_mqtt_port'});
        }

        // 2) salva su disco (audit/backup)
        await fsp.writeFile(configFile, JSON.stringify(cfg, null, 2), 'utf-8');

         // 3) imposta una versione per la config (diversa dalla firmware version)
             const now = new Date();
         const ts = now.toISOString().replace(/[-:TZ.]/g, '').slice(0,14); // YYYYMMDDHHmmss
         cfg.config_version = ts;

             // 4) LIVE: prova ad applicare subito se il device è online (non-retained)
                 await sendConfigUpdate(cfg);

             // 5) MAILBOX: pubblica anche lo snapshot retained (per il prossimo wake)
                 await publishRetained('bonsai/config', JSON.stringify(cfg));
        // 4) (opzionale) eco stato lato dashboard: se vuoi che la UI rilegga subito la config
        //    puoi lasciare che sia l'ESP a ripubblicare bonsai/config (retained),
        //    altrimenti decommenta la riga sotto per “riempire” lo snapshot lato broker:
        // await publishRetained('bonsai/config', JSON.stringify(cfg));

        return res.json({ok: true});
    } catch (e: any) {
        console.error('❌ /api/config failed:', e?.message || e);
        return res.status(500).json({error: 'config_write_or_publish_failed'});
    }
});

// Ripubblica l’ultima config senza riscrivere file
app.post('/api/config/push', async (_req, res) => {
    try {
        const buf = await fsp.readFile(configFile, 'utf-8');
        await publishRetained('bonsai/config', buf);
        return res.json({ok: true});
    } catch {
        // se non esiste, manda default
        await publishRetained('bonsai/config', JSON.stringify(defaultDeviceConfig));
        return res.json({ok: true, default: true});
    }
});

// Admin: bonifica retained pericolosi
app.post('/api/admin/clear-retained', async (_req, res) => {
    try {
        await clearRetained('bonsai/command/pump'); // sempre
        // opzionale:
        // await clearRetained('bonsai/config'); // se vuoi cancellare lo snapshot
        return res.json({ok: true});
    } catch (e: any) {
        return res.status(500).json({ok: false, error: e?.message || String(e)});
    }
});

/* ---------- OTA upload & announce ---------- */

let uploading = false;

app.post('/upload-firmware',
    upload.fields([
        {name: 'firmware', maxCount: 1},
        {name: 'version_file', maxCount: 1}
    ]),
    async (req: Request, res: Response) => {
        console.log('[OTA] Inizio upload');

        if (uploading) return res.status(409).json({error: 'Upload già in corso'});
        uploading = true;

        try {
            if (OTA_TOKEN) {
                const auth = (req.headers.authorization || '').trim();
                if (!auth.startsWith('Bearer ') || auth.slice(7) !== OTA_TOKEN) {
                    console.log('[OTA] Token non valido');
                    return res.status(401).json({error: 'Unauthorized'});
                }
            }

            const fw = (req.files as any)?.firmware?.[0];
            if (!fw) {
                console.log('[OTA] Nessun file firmware');
                return res.status(400).json({error: 'File mancante (campo "firmware")'});
            }
            console.log('[OTA] File ricevuto:', fw.originalname, fw.size, 'bytes');

            // Version: priorità a version_file, fallback a "version" form
            let version = '';
            const versionFile = (req.files as any)?.version_file?.[0];
            if (versionFile) {
                try {
                    version = (await fsp.readFile(versionFile.path, 'utf-8')).trim();
                } catch { /* ignora, si userà req.body.version */
                }
            }
            if (!version) version = (req.body?.version || '').toString().trim();

            if (!version) {
                console.log('[OTA] Version mancante');
                return res.status(400).json({error: 'Version mancante'});
            }

            // Regex: semver (vX.Y.Z), timestamp (YYYYMMDDHHMM) o combined (vX.Y.Z+YYYYMMDDHHMM)
            const reSemver = /^v\d+\.\d+\.\d+$/;
            const reTs = /^\d{12}$/;
            const reComb = /^v\d+\.\d+\.\d+\+\d{12}$/;

            if (!(reSemver.test(version) || reTs.test(version) || reComb.test(version))) {
                return res.status(400).json({error: 'Version non valida. Attesi: vX.Y.Z | YYYYMMDDHHMM | vX.Y.Z+YYYYMMDDHHMM'});
            }
            // Limite pratico per campo version (esp_app_desc_t version è 32B incl. terminatore)
            if (version.length > 31) {
                return res.status(400).json({error: 'Version troppo lunga (max 31 caratteri)'});
            }

            // Move atomico nel medesimo FS
            const tmpAtomic = path.join(firmwareDir, `.esp32.bin.tmp`);
            await fsp.rename(fw.path, tmpAtomic);

            // SHA256 + size
            const sha256 = await sha256File(tmpAtomic);
            const stat = await fsp.stat(tmpAtomic);

            // Rename finale
            await fsp.rename(tmpAtomic, binPath);

            const base = resolveBaseUrl(req);
            const url = `${base}/firmware/esp32.bin`;
            const manifest = {
                version, url, sha256, size: stat.size,
                created_at: new Date().toISOString()
            };

            await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

            // Annuncio su MQTT (retained)
            await publishRetained('bonsai/ota/available', JSON.stringify(manifest));

            console.log('[OTA] Success', version);
            res.json({success: true, manifest});
        } catch (err: any) {
            console.error('❌ Errore upload OTA:', err?.message || err);
            // pulizia tmp
            try {
                await fsp.rm(path.join(firmwareDir, `.esp32.bin.tmp`), {force: true});
            } catch {
            }
            res.status(500).json({error: 'Errore interno upload OTA'});
        } finally {
            uploading = false;
            // cleanup multer tmp
            const files: any = req.files || {};
            for (const key of Object.keys(files)) {
                for (const f of files[key] as Array<{ path: string }>) {
                    try {
                        if (f?.path && fs.existsSync(f.path)) await fsp.unlink(f.path);
                    } catch {
                    }
                }
            }
        }
    }
);

app.get('/api/firmware/version', async (_req, res) => {
    try {
        const data = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));
        res.json({
            version: data.version,
            size: data.size,
            sha256: data.sha256,
            url: data.url,
            created_at: data.created_at
        });
    } catch {
        res.status(404).json({error: 'Manifest non trovato'});
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

ensureMongoIndexes().catch(err => console.warn('⚠️ ensureMongoIndexes:', err));

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
