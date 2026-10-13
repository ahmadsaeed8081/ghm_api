import mongoose from 'mongoose';
const taskTipSchema = new mongoose.Schema({
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskSubmission', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transactionHash: { type: String, required: true, unique: true, lowercase: true }
}, { timestamps: true });
export default mongoose.model('TaskTip', taskTipSchema);
