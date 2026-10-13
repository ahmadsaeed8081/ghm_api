import mongoose from 'mongoose';
import app from './app.js';
import { env } from './config/env.js';

if (!env.mongoUri) {
  console.error('MONGODB_URI is required. Copy .env.example to .env and configure it.');
  process.exit(1);
}
if (env.nodeEnv === 'production' && (!env.sessionSecret || env.sessionSecret.length < 32 || /replace|change|example|secret/i.test(env.sessionSecret))) {
  console.error('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
  process.exit(1);
}
await mongoose.connect(env.mongoUri);
console.log('MongoDB connected');
app.listen(env.port, () => console.log(`GHM21 API listening on port ${env.port}`));
