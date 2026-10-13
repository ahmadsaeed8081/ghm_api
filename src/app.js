import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { env } from './config/env.js';
import health from './routes/health.js';
import auth from './routes/auth.js';
import feed from './routes/feed.js';
import profile from './routes/profile.js';
import tasks from './routes/tasks.js';
import transactions from './routes/transactions.js';

const app = express();
app.disable('x-powered-by');
if (env.nodeEnv === 'production') app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Safari/macOS may resolve localhost differently from 127.0.0.1. Allow
    // both loopback origins in development; production stays exact-origin only.
    const developmentOrigins = env.nodeEnv === 'development'
      ? ['http://localhost:5173', 'http://127.0.0.1:5173']
      : [];
    const allowed = !origin || origin === env.clientOrigin || developmentOrigins.includes(origin);
    callback(allowed ? null : new Error('Origin not allowed by CORS'), allowed);
  },
  credentials: true
}));
app.use(express.json({ limit: '256kb' }));
app.use(session({
  name: 'ghm21.sid',
  secret: env.sessionSecret || 'development-only-change-this-secret',
  store: env.mongoUri ? MongoStore.create({ mongoUrl: env.mongoUri, collectionName: 'sessions', ttl: 60 * 60 * 12 }) : undefined,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/health', health);
app.use('/api/auth', auth);
app.use('/api/feed', feed);
app.use('/api/profile', profile);
app.use('/api/tasks', tasks);
app.use('/api/transactions', transactions);
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = Number(err.status || err.statusCode) || 500;
  res.status(status).json({ message: status < 500 ? err.message : 'Internal server error.' });
});
export default app;
