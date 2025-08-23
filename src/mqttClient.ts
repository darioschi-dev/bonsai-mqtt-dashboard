// src/mqttClient.ts
import mqtt, { MqttClient, IClientOptions, IClientPublishOptions } from 'mqtt';
import { saveMqttLog, saveOtaAck } from './dataLogger.js';
import type { IPublishPacket } from 'mqtt-packet';

let client: MqttClient | undefined;

// Stato in memoria per /status + info utili
let latestStatus: Record<string, any> = {
    pump: '-',
    humidity: '-',
    last_on: '-',
    last_seen: '-',   // retro-compat
    last_seen_ts: 0,  // timestamp locale ultimo msg visto
    battery: '-',
    temp: '-',
    wifi: '-',
    firmware: '-',
    config: undefined, // snapshot ultima config (da bonsai/config)
    config_ack: undefined as undefined | { ok: boolean; ts: number; raw: any },
};

export function getLatestStatus() {
    return latestStatus;
}

function buildClientId() {
    const base = process.env.MQTT_CLIENT_ID || 'bonsai-dashboard';
    const rand = Math.random().toString(16).slice(2, 8);
    return `${base}-${process.pid}-${rand}`;
}

export function setupMqttClient(): void {
    const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';

    const isSecure = mqttUrl.startsWith('mqtts://') || mqttUrl.startsWith('wss://');
    const protocol =
        mqttUrl.startsWith('wss://') ? 'wss' :
            mqttUrl.startsWith('ws://')  ? 'ws'  :
                isSecure ? 'mqtts' : 'mqtt';

    const options: IClientOptions = {
        clientId: buildClientId(),
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        protocol,
        reconnectPeriod: 2000,
        clean: true,
        keepalive: 60,
    };

    client = mqtt.connect(mqttUrl, options);

    client.on('connect', () => {
        console.log('📡 MQTT connesso');

        // Stati dispositivo
        client!.subscribe('bonsai/status/#', (err) => {
            if (err) console.error('❌ Sub bonsai/status/#:', err.message);
        });

        // Info firmware
        client!.subscribe('bonsai/info/firmware', (err) => {
            if (err) console.error('❌ Sub bonsai/info/firmware:', err.message);
        });

        // ACK OTA
        client!.subscribe('bonsai/ota/ack/#', (err) => {
            if (err) console.error('❌ Sub bonsai/ota/ack/#:', err.message);
        });

        // Config corrente (retained, VOLUTO)
        client!.subscribe('bonsai/config', (err) => {
            if (err) console.error('❌ Sub bonsai/config:', err.message);
        });

        // ACK salvataggio config
        client!.subscribe('bonsai/config/ack', (err) => {
            if (err) console.error('❌ Sub bonsai/config/ack:', err.message);
        });
    });

    client.on('reconnect', () => console.log('↩️  MQTT reconnecting…'));
    client.on('close',     () => console.log('🔌 MQTT disconnected'));
    client.on('error', (err) => console.error('❌ Errore client MQTT:', err.message));

    client.on('message', async (topic: string, payload: Buffer, packet: IPublishPacket) => {
        const message = payload.toString();
        const isRetained = !!packet?.retain;

        // Log DB (con metadati minimi)
        try {
            await saveMqttLog(topic, message);
        } catch (e: any) {
            console.warn('⚠️ saveMqttLog failed:', e?.message || e);
        }

        // Aggiornamenti RAM
        try {
            if (topic.startsWith('bonsai/status/')) {
                const key = topic.replace('bonsai/status/', '');
                // numerico se sensato
                const n = Number(message);
                latestStatus[key] = Number.isFinite(n) && message.trim() !== '' ? n : message;
                latestStatus.last_seen_ts = Date.now();
            }
            else if (topic === 'bonsai/info/firmware') {
                latestStatus.firmware = message;
                latestStatus.last_seen_ts = Date.now();
            }
            else if (topic === 'bonsai/config') {
                // retained atteso: è lo snapshot di stato config
                try {
                    latestStatus.config = JSON.parse(message);
                } catch {
                    latestStatus.config = message;
                }
                latestStatus.last_seen_ts = Date.now();
            }
            else if (topic === 'bonsai/config/ack') {
                // l’ESP dovrebbe pubblicare qualcosa tipo {"ok":true,"ts":...}
                let parsed: any = message;
                try { parsed = JSON.parse(message); } catch { /* keep raw */ }
                latestStatus.config_ack = {
                    ok: !!(parsed?.ok ?? true),
                    ts: Date.now(),
                    raw: parsed,
                };
                latestStatus.last_seen_ts = Date.now();
            }
            else if (topic.startsWith('bonsai/ota/ack/')) {
                const parts = topic.split('/');
                const device = parts[3] || 'unknown';

                try {
                    const parsed = JSON.parse(message);
                    await saveOtaAck({
                        device,
                        version: String(parsed.version ?? ''),
                        status: (parsed.status as 'applied' | 'failed' | 'skipped') ?? 'failed',
                        duration_ms: parsed.duration_ms,
                        reason: parsed.reason,
                        raw: parsed,
                    });
                    console.log(`📬 OTA ACK salvato (${isRetained ? 'retained' : 'live'}):`, { device, version: parsed.version, status: parsed.status });
                } catch {
                    await saveOtaAck({
                        device,
                        version: '',
                        status: 'failed',
                        reason: 'invalid_json',
                        raw: message,
                    });
                    console.warn('⚠️ OTA ACK non JSON:', message);
                }
            }
        } catch (e: any) {
            console.warn('⚠️ OnMessage handler error:', e?.message || e);
        }
    });
}

/** Pubblica un comando (mai retained) */
export function publishMqttCommand(topic: string, payload: string): void {
    if (!client || !client.connected) {
        console.warn('⚠️ MQTT non connesso. Impossibile pubblicare:', topic);
        return;
    }
    const opts: IClientPublishOptions = { qos: 0, retain: false };
    client.publish(topic, payload, opts, (err?: Error) => {
        if (err) console.error('❌ Errore publish command:', err.message);
        else console.log(`📤 Pub (${topic}): ${payload}`);
    });
}

/** Pubblica RETAINED (da usare solo per stati/snapshot come bonsai/config) */
export function publishRetained(topic: string, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!client || !client.connected) {
            const e = new Error('MQTT non connesso');
            console.warn('⚠️', e.message);
            return reject(e);
        }
        const opts: IClientPublishOptions = { qos: 0, retain: true };
        client.publish(topic, payload, opts, (err?: Error) => {
            if (err) {
                console.error('❌ Errore publish retain:', err.message);
                reject(err);
            } else {
                console.log(`📌 Pub retain (${topic}): ${payload}`);
                resolve();
            }
        });
    });
}

/** Pulisce un retained (pubblica payload vuoto con retain=true) */
export function clearRetained(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!client || !client.connected) {
            const e = new Error('MQTT non connesso');
            console.warn('⚠️', e.message);
            return reject(e);
        }
        client.publish(topic, '', { qos: 0, retain: true }, (err?: Error) => {
            if (err) {
                console.error('❌ Errore clear retained:', err.message);
                reject(err);
            } else {
                console.log(`🧹 Cleared retained on ${topic}`);
                resolve();
            }
        });
    });
}

/** Helper specifici del progetto (comodi nel resto della dashboard) */
export function sendPumpCommand(state: 'on' | 'off') {
    publishMqttCommand('bonsai/command/pump', state);
}

export function sendConfigUpdate(partialConfig: Record<string, any>) {
    // IMPORTANTE: config/set NON deve essere retained
    publishMqttCommand('bonsai/config/set', JSON.stringify(partialConfig));
}
