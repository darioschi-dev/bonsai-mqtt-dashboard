import mqtt, { MqttClient } from 'mqtt';
import { saveMqttLog } from './dataLogger';

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
        client.subscribe('bonsai/status/#', (err) => {
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

    client.on('error', (err) => {
        console.error('❌ Errore MQTT:', err.message);
    });
}

export function publishMqttCommand(topic: string, payload: string) {
    if (client && client.connected) {
        client.publish(topic, payload, { retain: false }, (err) => {
            if (err) {
                console.error('❌ Errore pubblicazione comando MQTT:', err.message);
            } else {
                console.log(`📢 Comando pubblicato su ${topic}: ${payload}`);
            }
        });
    } else {
        console.warn('⚠️ MQTT non connesso. Impossibile pubblicare comando.');
    }
}
