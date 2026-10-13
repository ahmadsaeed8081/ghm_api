import mongoose from 'mongoose';
const taskLikeSchema = new mongoose.Schema({
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskSubmission', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
taskLikeSchema.index({ task: 1, user: 1 }, { unique: true });
export default mongoose.model('TaskLike', taskLikeSchema);
