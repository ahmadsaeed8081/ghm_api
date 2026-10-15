import { Router } from 'express';
import mongoose from 'mongoose';
import Post from '../models/Post.js';
import Like from '../models/Like.js';
import { requireAuth } from '../middleware/auth.js';
const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
    const page = Math.max(Number(req.query.page || 1), 1);
    const posts = await Post.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('author', 'walletAddress displayAddress').lean();
    const ids = posts.map(p => p._id);
    const counts = await Like.aggregate([{ $match: { post: { $in: ids } } }, { $group: { _id: '$post', count: { $sum: 1 } } }]);
    res.json({ items: posts.map(p => ({ ...p, likeCount: counts.find(c => String(c._id) === String(p._id))?.count || 0 })), page, limit });
  } catch (e) { next(e); }
});
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 5000) return res.status(400).json({ message: 'Content must be 1–5000 characters.' });
    const post = await Post.create({ author: new mongoose.Types.ObjectId(req.auth.userId), content });
    res.status(201).json({ item: post });
  } catch (e) { next(e); }
});
router.put('/:postId/like', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.postId)) return res.status(400).json({ message: 'Invalid post ID.' });
    const post = await Post.exists({ _id: req.params.postId });
    if (!post) return res.status(404).json({ message: 'Post not found.' });
    const user = new mongoose.Types.ObjectId(req.auth.userId);
    const existing = await Like.findOne({ post: post._id, user });
    if (existing) { await existing.deleteOne(); return res.json({ liked: false }); }
    try { await Like.create({ post: post._id, user }); } catch (e) { if (e.code !== 11000) throw e; }
    res.json({ liked: true });
  } catch (e) { next(e); }
});
export default router;
