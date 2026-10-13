import mongoose from 'mongoose';
const taskSubmissionSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  performerWallet: { type: String, required: true, lowercase: true, index: true },
  taskTitle: { type: String, required: true, trim: true, maxlength: 180 },
  proofLink: { type: String, required: true, trim: true, maxlength: 2048 },
  telegramHandle: { type: String, default: '', trim: true, maxlength: 100 },
  telegramDeliveryStatus: { type: String, enum: ['not-configured', 'sent', 'failed'], default: 'not-configured' },
  telegramDeliveryError: { type: String, default: '', maxlength: 240 },
  onChainTaskId: { type: String, default: null },
  transactionHash: { type: String, default: '', trim: true, maxlength: 80 },
  verificationTransactionHash: { type: String, default: '', trim: true, maxlength: 80 },
  chainId: { type: Number, required: true, enum: [137], immutable: true },
  attachments: [{
    gridFsId: { type: mongoose.Schema.Types.ObjectId, default: null },
    filename: { type: String, default: '' },
    contentType: { type: String, default: '' },
    size: { type: Number, default: 0 }
  }],
  isVerified: { type: Boolean, default: false },
  legacyImported: { type: Boolean, default: false },
  rejectionReason: { type: String, default: '' },
  tipCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });
taskSubmissionSchema.index({ createdAt: -1 });
export default mongoose.model('TaskSubmission', taskSubmissionSchema);
