import mongoose from 'mongoose';
import app from './src/app.js';
import { env } from './src/config/env.js';

let mongoConnection;

function assertProductionConfig() {
  if (env.nodeEnv !== 'production') return;
  if (!env.authTokenSecret || env.authTokenSecret.length < 32 || /replace|change|example|secret/i.test(env.authTokenSecret)) {
    throw new Error('AUTH_TOKEN_SECRET (or legacy SESSION_SECRET) must be a random value of at least 32 characters.');
  }
  if (env.clientOrigin === 'http://localhost:5173') {
    throw new Error('CLIENT_ORIGIN must be set to the deployed client origin.');
  }
}

async function ensureMongoConnection() {
  if (mongoose.connection.readyState === 1) return;
  if (!env.mongoUri) throw new Error('MONGODB_URI is not configured.');

  if (!mongoConnection) {
    mongoConnection = mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 })
      .catch((error) => {
        mongoConnection = undefined;
        throw error;
      });
  }
  await mongoConnection;
}

export default async function handler(req, res) {
  try {
    assertProductionConfig();
    await ensureMongoConnection();
    return app(req, res);
  } catch (error) {
    // Avoid logging exception messages that could include deployment configuration.
    console.error('Vercel API request bootstrap failed:', error.name, error.code || 'configuration/database error');
    return res.status(503).json({ message: 'Database is temporarily unavailable.' });
  }
}
