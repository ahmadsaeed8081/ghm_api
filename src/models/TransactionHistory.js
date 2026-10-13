import mongoose from 'mongoose';
const transactionHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  walletAddress: { type: String, required: true, lowercase: true, index: true },
  type: { type: String, required: true, trim: true, maxlength: 100 },
  amount: { type: String, default: '', maxlength: 120 },
  status: { type: String, default: '', maxlength: 100 },
  transactionHash: { type: String, default: '', maxlength: 80 },
  chainId: { type: Number, required: true, enum: [137], immutable: true },
  legacyImportKey: { type: String, default: undefined, unique: true, sparse: true }
}, { timestamps: true });
transactionHistorySchema.index({ user: 1, createdAt: -1 });
export default mongoose.model('TransactionHistory', transactionHistorySchema);
