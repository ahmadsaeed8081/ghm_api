import { Router } from 'express';
import TransactionHistory from '../models/TransactionHistory.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
const router = Router();
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const items = await TransactionHistory.find({ user: req.auth.userId }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ items });
  } catch (error) { next(error); }
});
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { type, amount = '', status = '', transactionHash = '' } = req.body || {};
    if (typeof type !== 'string' || !type.trim() || type.length > 100) return res.status(400).json({ message: 'Transaction type is required.' });
    if (transactionHash && !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return res.status(400).json({ message: 'Invalid transaction hash.' });
    const item = await TransactionHistory.create({ user: req.auth.userId, walletAddress: req.auth.walletAddress, type: type.trim(), amount: String(amount).slice(0, 120), status: String(status).slice(0, 100), transactionHash, chainId: env.chainId });
    res.status(201).json({ item });
  } catch (error) { next(error); }
});
export default router;
