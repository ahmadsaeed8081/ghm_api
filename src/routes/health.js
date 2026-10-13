import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
const router = Router();
router.get('/', (_req, res) => res.json({
  ok: true,
  service: 'ghm21-api',
  chainId: env.chainId,
  database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  timestamp: new Date().toISOString()
}));
export default router;
