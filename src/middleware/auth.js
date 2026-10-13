export function requireAuth(req, res, next) {
  if (!req.session?.userId || !req.session?.walletAddress) {
    return res.status(401).json({ message: 'Sign in with your wallet before continuing.' });
  }
  next();
}
