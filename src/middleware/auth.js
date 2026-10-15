import { verifyAuthToken } from '../utils/authToken.js';

export function optionalAuth(req, _res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  req.auth = match ? verifyAuthToken(match[1]) : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.auth?.userId || !req.auth?.walletAddress) {
    return res.status(401).json({ message: 'Sign in with your wallet before continuing.' });
  }
  next();
}
