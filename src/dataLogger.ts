import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB || 'bonsai';
const collectionName = process.env.MONGODB_COLLECTION || 'logs';
const ackCollectionName = process.env.MONGODB_ACK_COLLECTION || 'ota_acks';

let client: MongoClient;
let isConnected = false;

/* ---------- Connessione ---------- */
export async function connectMongo() {
    if (!isConnected) {
        client = new MongoClient(uri);
        await client.connect();
        isConnected = true;
        console.log('✅ Connessione MongoDB stabilita');
    }
}

async function getDb() {
    if (!isConnected) await connectMongo();
    return client.db(dbName);
}

/* ---------- Indici (performance) ---------- */
export async function ensureMongoIndexes() {
    const db = await getDb();

    // logs
    await db.collection(collectionName).createIndex({ timestamp: -1 });
    await db.collection(collectionName).createIndex({ topic: 1, timestamp: -1 });

    // ota_acks
    await db.collection(ackCollectionName).createIndex({ received_at: -1 });
    await db.collection(ackCollectionName).createIndex({ device: 1, received_at: -1 });
}

/* ---------- Log MQTT grezzi ---------- */
export async function saveMqttLog(topic: string, message: string) {
    try {
        const db = await getDb();
        const collection = db.collection(collectionName);

        await collection.insertOne({
            timestamp: new Date(),
            topic,
            message,
        });

        if (process.env.DEBUG === 'true') {
            console.log(`📝 Salvato su MongoDB: ${topic} => ${message}`);
        }
    } catch (error) {
        console.error('❌ Errore salvataggio MongoDB:', error);
    }
}

export async function getLatestLogs(limit = 100) {
    const db = await getDb();
    return db
        .collection(collectionName)
        .find({})
        .sort({ timestamp: -1 })
        .limit(Math.max(1, Math.min(1000, limit)))
        .toArray();
}

/* ---------- OTA ACK ---------- */
export interface OtaAck {
    device: string;
    version: string;
    status: 'applied' | 'failed' | 'skipped';
    duration_ms?: number;
    reason?: string;
    received_at?: Date;
    raw?: any;
}

export async function saveOtaAck(ack: OtaAck) {
    const db = await getDb();
    const col = db.collection(ackCollectionName);
    await col.insertOne({
        ...ack,
        received_at: ack.received_at ?? new Date(),
    });
}

export async function getOtaAcks(limit = 50, device?: string) {
    const db = await getDb();
    const col = db.collection(ackCollectionName);
    const query = device ? { device } : {};
    return col
        .find(query)
        .sort({ received_at: -1 })
        .limit(Math.max(1, Math.min(1000, limit)))
        .toArray();
}
