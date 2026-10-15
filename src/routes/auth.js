import { Router } from 'express';
import { SiweMessage, generateNonce } from 'siwe';
import User from '../models/User.js';
import AuthNonce from '../models/AuthNonce.js';
import { env } from '../config/env.js';
import { createAuthToken } from '../utils/authToken.js';

const router = Router();
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/me', asyncRoute(async (req, res) => {
  if (!req.auth?.userId) return res.status(401).json({ message: 'Not authenticated.' });
  const user = await User.findById(req.auth.userId).select('walletAddress displayAddress profile telegramChatId telegramHandle').lean();
  if (!user || user.walletAddress.toLowerCase() !== req.auth.walletAddress) {
    return res.status(401).json({ message: 'Authentication token is no longer valid.' });
  }
  res.json({ userId: String(user._id), walletAddress: user.walletAddress, displayAddress: user.displayAddress, profile: user.profile, telegramHandle: user.telegramHandle || '' });
}));

router.get('/nonce', asyncRoute(async (_req, res) => {
  const nonce = generateNonce();
  await AuthNonce.create({ nonce, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  res.set('Cache-Control', 'no-store');
  res.json({ nonce });
}));

router.post('/verify', asyncRoute(async (req, res) => {
  const { message, signature, nonce } = req.body || {};
  if (typeof message !== 'string' || typeof signature !== 'string' || typeof nonce !== 'string') {
    return res.status(400).json({ message: 'Request requires a fresh nonce, SIWE message, and signature.' });
  }

  let siweMessage;
  try { siweMessage = new SiweMessage(message); }
  catch { return res.status(400).json({ message: 'Invalid SIWE message.' }); }

  const challenge = await AuthNonce.findOneAndUpdate(
    { nonce, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }
  );
  if (!challenge || siweMessage.nonce !== nonce) {
    return res.status(400).json({ message: 'Sign-in request expired or already used. Please retry.' });
  }

  let siweUri;
  try { siweUri = new URL(siweMessage.uri); }
  catch { return res.status(401).json({ message: 'SIWE URI is invalid.' }); }

  const configuredOrigin = new URL(env.clientOrigin).origin;
  const isConfiguredClient = siweUri.origin === configuredOrigin && siweMessage.domain === env.siweDomain;
  // Local Vite development reaches the production API through its /api proxy.
  const localDevOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  const isLocalDevClient = localDevOrigins.has(siweUri.origin) && siweMessage.domain === siweUri.host;
  if ((!isConfiguredClient && !isLocalDevClient) || Number(siweMessage.chainId) !== env.chainId) {
    return res.status(401).json({ message: 'SIWE domain or blockchain network does not match this application.' });
  }

  const verification = await siweMessage.verify({ signature, nonce, domain: siweMessage.domain });
  if (!verification.success) return res.status(401).json({ message: 'Wallet signature verification failed.' });

  const walletAddress = siweMessage.address.toLowerCase();
  const user = await User.findOneAndUpdate(
    { walletAddress },
    { $set: { walletAddress, displayAddress: siweMessage.address } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json({ authenticated: true, walletAddress, userId: String(user._id), authToken: createAuthToken(user) });
}));

// Bearer tokens are stateless; logout is completed by deleting the browser's token.
router.post('/logout', (_req, res) => res.json({ ok: true }));

export default router;
