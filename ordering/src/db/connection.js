'use strict';

const { MongoClient } = require('mongodb');

const DEFAULT_URI = 'mongodb://127.0.0.1:27017,127.0.0.1:27018/ordering_db?replicaSet=rs0';
const FALLBACK_URI = 'mongodb://127.0.0.1:27017/ordering_db';
const DB_NAME = process.env.MONGO_DB_NAME || 'ordering_db';

let client = null;
let dbInstance = null;

async function connectDB() {
  if (dbInstance) {
    return dbInstance;
  }

  const primaryUri = process.env.MONGO_URI || DEFAULT_URI;

  try {
    client = new MongoClient(primaryUri, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    dbInstance = client.db(DB_NAME);
    return dbInstance;
  } catch (err) {
    if (process.env.MONGO_URI) {
      throw err;
    }
    client = new MongoClient(FALLBACK_URI, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    dbInstance = client.db(DB_NAME);
    return dbInstance;
  }
}

function getDB() {
  if (!dbInstance) {
    throw new Error('データベースが未接続です。connectDB() を先に呼び出してください。');
  }
  return dbInstance;
}

async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    dbInstance = null;
  }
}

module.exports = {
  connectDB,
  getDB,
  closeDB,
  DB_NAME
};
