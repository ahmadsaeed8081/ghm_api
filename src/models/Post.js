import mongoose from 'mongoose';
const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, required: true, trim: true, maxlength: 5000 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });
postSchema.index({ createdAt: -1 });
export default mongoose.model('Post', postSchema);
