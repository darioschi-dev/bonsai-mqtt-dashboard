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
