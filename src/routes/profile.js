import { Router } from 'express';
import User from '../models/User.js';
import TaskSubmission from '../models/TaskSubmission.js';
import TransactionHistory from '../models/TransactionHistory.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId).select('walletAddress displayAddress telegramHandle profile').lean();
    if (!user) return res.status(404).json({ message: 'User profile not found.' });
    res.json({ user: { ...user, id: String(user._id) } });
  } catch (error) { next(error); }
});

router.put('/me', requireAuth, async (req, res, next) => {
  try {
    const update = {};
    if (req.body?.telegramHandle !== undefined) {
      const telegramHandle = typeof req.body.telegramHandle === 'string' ? req.body.telegramHandle.trim() : '';
      if (telegramHandle.length > 100) return res.status(400).json({ message: 'Telegram name/ID must be 100 characters or fewer.' });
      update.telegramHandle = telegramHandle;
      update.telegramChatId = /^-?\d{5,20}$/.test(telegramHandle) ? telegramHandle : null;
    }
    if (req.body?.selectedTier !== undefined) {
      const selectedTier = Number(req.body.selectedTier);
      if (!Number.isFinite(selectedTier) || selectedTier < 1 || selectedTier > 10000) return res.status(400).json({ message: 'Selected tier must be between 1 and 10000.' });
      update['profile.selectedTier'] = selectedTier;
    }
    const user = await User.findByIdAndUpdate(req.session.userId, { $set: update }, { new: true, runValidators: true }).select('walletAddress displayAddress telegramHandle profile').lean();
    if (!user) return res.status(404).json({ message: 'User profile not found.' });
    res.json({ user: { ...user, id: String(user._id) } });
  } catch (error) { next(error); }
});

// One-time, authenticated import of a user's own legacy browser records.
// Only tasks whose performer matches the signed-in wallet are imported; old local likes/tips
// were keyed by array position and cannot be safely mapped to database task IDs.
router.post('/migrate-legacy', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).json({ message: 'Wallet profile not found.' });
    if (user.legacyMigratedAt) return res.json({ migrated: true, alreadyMigrated: true });
    const payload = req.body || {};
    if (!user.telegramHandle && typeof payload.telegramHandle === 'string' && payload.telegramHandle.trim().length <= 100) {
      user.telegramHandle = payload.telegramHandle.trim();
      user.telegramChatId = /^-?\d{5,20}$/.test(user.telegramHandle) ? user.telegramHandle : null;
    }
    const migratedProfile = { ...(user.profile || {}) };
    if (payload.selectedTier !== undefined && Number.isFinite(Number(payload.selectedTier)) && Number(payload.selectedTier) >= 1 && Number(payload.selectedTier) <= 10000) migratedProfile.selectedTier = Number(payload.selectedTier);
    user.profile = migratedProfile;
    const transactions = Array.isArray(payload.transactions) ? payload.transactions.slice(0, 100) : [];
    let importedTransactions = 0;
    for (const [index, tx] of transactions.entries()) {
      if (!tx || typeof tx.type !== 'string' || !tx.type.trim()) continue;
      const legacyImportKey = `legacy:${user.walletAddress}:${index}:${String(tx.type).slice(0, 30)}`;
      try {
        await TransactionHistory.create({ user: user._id, walletAddress: user.walletAddress, type: tx.type.trim().slice(0, 100), amount: String(tx.amount || '').slice(0, 120), status: String(tx.status || 'Imported legacy record').slice(0, 100), chainId: env.chainId, legacyImportKey });
        importedTransactions++;
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    const tasks = Array.isArray(payload.tasks) ? payload.tasks.slice(0, 50) : [];
    let importedTasks = 0;
    for (const item of tasks) {
      if (!item || String(item.performer || item.performerWallet || '').toLowerCase() !== user.walletAddress.toLowerCase()) continue;
      const title = String(item.taskTitle || '').trim().slice(0, 180);
      let proofUrl; try { proofUrl = new URL(String(item.proofLink || '')); } catch { continue; }
      if (!title || !['http:', 'https:'].includes(proofUrl.protocol)) continue;
      const alreadyExists = await TaskSubmission.exists({ author: user._id, taskTitle: title, proofLink: proofUrl.href, legacyImported: true });
      if (alreadyExists) continue;
      await TaskSubmission.create({ author: user._id, performerWallet: user.walletAddress, taskTitle: title, proofLink: proofUrl.href, telegramHandle: user.telegramHandle || '', chainId: env.chainId, legacyImported: true, isVerified: false });
      importedTasks++;
    }
    user.legacyMigratedAt = new Date();
    await user.save();
    res.json({ migrated: true, importedTransactions, importedTasks, profileSaved: true });
  } catch (error) { next(error); }
});
export default router;
