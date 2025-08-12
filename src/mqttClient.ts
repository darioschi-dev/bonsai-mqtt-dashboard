// src/mqttClient.ts
import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { saveMqttLog, saveOtaAck } from './dataLogger.js';

let client: MqttClient | undefined;

// Stato in memoria per /status
let latestStatus: Record<string, any> = {
    pump: '-',
    humidity: '-',
    last_on: '-',
    last_seen: '-',
    battery: '-',
    temp: '-',
    wifi: '-',
    firmware: '-'
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
    const protocol = mqttUrl.startsWith('wss://')
        ? 'wss'
        : mqttUrl.startsWith('ws://')
            ? 'ws'
            : isSecure
                ? 'mqtts'
                : 'mqtt';

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

        client!.subscribe('bonsai/status/#', (err) => {
            if (err) console.error('❌ Sub bonsai/status/#:', err.message);
        });

        client!.subscribe('bonsai/info/firmware', (err) => {
            if (err) console.error('❌ Sub bonsai/info/firmware:', err.message);
        });

        client!.subscribe('bonsai/ota/ack/#', (err) => {
            if (err) console.error('❌ Sub bonsai/ota/ack/#:', err.message);
        });
    });

    client.on('reconnect', () => console.log('↩️  MQTT reconnecting…'));
    client.on('close', () => console.log('🔌 MQTT disconnected'));
    client.on('error', (err) => console.error('❌ Errore client MQTT:', err.message));

    client.on('message', async (topic: string, payload: Buffer) => {
        const message = payload.toString();

        // Log sul DB
        try {
            await saveMqttLog(topic, message);
        } catch (e: any) {
            console.warn('⚠️ saveMqttLog failed:', e?.message || e);
        }

        // Aggiorna stato in RAM
        if (topic.startsWith('bonsai/status/')) {
            const key = topic.replace('bonsai/status/', '');
            latestStatus[key] = isNaN(Number(message)) ? message : Number(message);
        }
        if (topic === 'bonsai/info/firmware') {
            latestStatus.firmware = message;
        }

        // Gestione ACK OTA
        if (topic.startsWith('bonsai/ota/ack/')) {
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
                console.log('📬 OTA ACK salvato:', { device, version: parsed.version, status: parsed.status });
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
    });
}

export function publishMqttCommand(topic: string, payload: string): void {
    if (!client || !client.connected) {
        console.warn('⚠️ MQTT non connesso. Impossibile pubblicare:', topic);
        return;
    }
    client.publish(topic, payload, { qos: 0, retain: false }, (err?: Error) => {
        if (err) console.error('❌ Errore publish command:', err.message);
        else console.log(`📤 Pub (${topic}): ${payload}`);
    });
}

export function publishRetained(topic: string, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!client || !client.connected) {
            const e = new Error('MQTT non connesso');
            console.warn('⚠️', e.message);
            return reject(e);
        }
        client.publish(topic, payload, { qos: 0, retain: true }, (err?: Error) => {
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
