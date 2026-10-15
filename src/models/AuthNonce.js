import mongoose from 'mongoose';

const authNonceSchema = new mongoose.Schema({
  nonce: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null }
}, { timestamps: true });

export default mongoose.model('AuthNonce', authNonceSchema);
