import mqtt, { MqttClient } from 'mqtt';
import { saveMqttLog } from './dataLogger.js';

let client: MqttClient;

export function setupMqttClient() {
    const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';

    client = mqtt.connect(mqttUrl, {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        protocol: mqttUrl.startsWith('mqtts') ? 'mqtts' : 'mqtt',
    });

    client.on('connect', () => {
        console.log('📡 MQTT connesso');
        client.subscribe('bonsai/status/#', (err: Error | null) => {
            if (err) {
                console.error('❌ Errore sottoscrizione topic:', err.message);
            }
        });
    });

    client.on('message', async (topic: string, payload: Buffer) => {
        const message = payload.toString();
        console.log(`[MQTT] ${topic} => ${message}`);

        // salva su MongoDB
        await saveMqttLog(topic, message);
    });

    client.on('error', (err: Error) => {
        console.error('❌ Errore client MQTT:', err.message);
    });
}

export function publishMqttCommand(topic: string, payload: string) {
    if (client && client.connected) {
        client.publish(topic, payload, { retain: false }, (err?: Error) => {
            if (err) console.error('Errore invio comando MQTT:', err.message);
            else console.log(`📤 Comando pubblicato su ${topic}: ${payload}`);
        });
    } else {
        console.warn('⚠️ MQTT non connesso. Impossibile pubblicare comando.');
    }
}
