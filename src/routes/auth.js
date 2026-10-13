import { Router } from 'express';
import { SiweMessage, generateNonce } from 'siwe';
import User from '../models/User.js';
import { env } from '../config/env.js';

const router = Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/me', asyncRoute(async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated.' });
  const user = await User.findById(req.session.userId).select('walletAddress displayAddress profile telegramChatId telegramHandle').lean();
  if (!user) return res.status(401).json({ message: 'Session user no longer exists.' });
  res.json({ userId: String(user._id), walletAddress: user.walletAddress, displayAddress: user.displayAddress, profile: user.profile, telegramHandle: user.telegramHandle || '' });
}));

router.get('/nonce', (req, res) => {
  req.session.siweNonce = generateNonce();
  res.set('Cache-Control', 'no-store');
  res.json({ nonce: req.session.siweNonce });
});

router.post('/verify', asyncRoute(async (req, res) => {
  const { message, signature } = req.body || {};
  const expectedNonce = req.session?.siweNonce;
  if (typeof message !== 'string' || typeof signature !== 'string' || !expectedNonce) {
    return res.status(400).json({ message: 'Request requires a fresh nonce, SIWE message, and signature.' });
  }

  let siweMessage;
  try { siweMessage = new SiweMessage(message); }
  catch { return res.status(400).json({ message: 'Invalid SIWE message.' }); }

  if (siweMessage.domain !== env.siweDomain || Number(siweMessage.chainId) !== env.chainId) {
    return res.status(401).json({ message: 'SIWE domain or blockchain network does not match this application.' });
  }
  const allowedOrigin = new URL(env.clientOrigin).origin;
  if (new URL(siweMessage.uri).origin !== allowedOrigin) {
    return res.status(401).json({ message: 'SIWE origin does not match the configured client origin.' });
  }

  const verification = await siweMessage.verify({ signature, nonce: expectedNonce, domain: env.siweDomain });
  if (!verification.success) return res.status(401).json({ message: 'Wallet signature verification failed.' });

  const walletAddress = siweMessage.address.toLowerCase();
  const user = await User.findOneAndUpdate(
    { walletAddress },
    { $set: { walletAddress, displayAddress: siweMessage.address } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = String(user._id);
  req.session.walletAddress = walletAddress;
  req.session.chainId = env.chainId;
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  res.json({ authenticated: true, walletAddress, userId: String(user._id) });
}));

router.post('/logout', (req, res, next) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('ghm21.sid', { httpOnly: true, secure: env.nodeEnv === 'production', sameSite: 'lax' });
    res.json({ ok: true });
  });
});
export default router;
