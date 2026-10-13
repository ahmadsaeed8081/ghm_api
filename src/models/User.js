import mongoose from 'mongoose';
const userSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  displayAddress: { type: String, required: true },
  profile: { type: mongoose.Schema.Types.Mixed, default: {} },
  telegramHandle: { type: String, default: '', trim: true, maxlength: 100 },
  telegramChatId: { type: String, default: null },
  legacyMigratedAt: { type: Date, default: null }
}, { timestamps: true, strict: true });
export default mongoose.model('User', userSchema);
