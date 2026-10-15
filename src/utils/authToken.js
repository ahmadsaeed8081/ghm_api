import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 365;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function signatureFor(value) {
  return createHmac('sha256', env.authTokenSecret).update(value).digest();
}

export function createAuthToken(user) {
  if (!env.authTokenSecret || env.authTokenSecret.length < 32) {
    throw new Error('AUTH_TOKEN_SECRET must be configured with at least 32 characters.');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({
    sub: String(user._id),
    walletAddress: user.walletAddress.toLowerCase(),
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS
  });
  const unsigned = `v1.${payload}`;
  return `${unsigned}.${signatureFor(unsigned).toString('base64url')}`;
}

export function verifyAuthToken(token) {
  if (typeof token !== 'string' || !env.authTokenSecret || env.authTokenSecret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  let supplied;
  let payload;
  try {
    supplied = Buffer.from(parts[2], 'base64url');
    const expected = signatureFor(unsigned);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.sub || !/^0x[0-9a-f]{40}$/.test(payload.walletAddress || '') || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) return null;
  return { userId: payload.sub, walletAddress: payload.walletAddress };
}
