import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB || 'bonsai';
const collectionName = process.env.MONGODB_COLLECTION || 'logs';

let client: MongoClient;
let isConnected = false;

export async function connectMongo() {
    if (!isConnected) {
        client = new MongoClient(uri);
        await client.connect();
        isConnected = true;
        console.log('✅ Connessione MongoDB stabilita');
    }
}

export async function saveMqttLog(topic: string, message: string) {
    try {
        if (!isConnected) await connectMongo();

        const db = client.db(dbName);
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
    if (!isConnected) await connectMongo();
    const db = client.db(dbName);
    return db.collection(collectionName)
        .find({})
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
}

// ===== OTA ACK logging =====
const ackCollectionName = process.env.MONGODB_ACK_COLLECTION || 'ota_acks';

async function getDb() {
    if (!isConnected) await connectMongo();
    return client.db(dbName);
}

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
    const doc = {
        ...ack,
        received_at: ack.received_at ?? new Date(),
    };
    await col.insertOne(doc);
}

export async function getOtaAcks(limit = 50) {
    const db = await getDb();
    const col = db.collection(ackCollectionName);
    return col
        .find({})
        .sort({ received_at: -1 })
        .limit(limit)
        .toArray();
}
