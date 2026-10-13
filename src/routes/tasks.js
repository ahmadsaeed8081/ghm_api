import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { GridFSBucket, ObjectId } from 'mongodb';
import { Readable } from 'node:stream';
import { Interface, JsonRpcProvider, id as functionId } from 'ethers';
import TaskSubmission from '../models/TaskSubmission.js';
import TaskLike from '../models/TaskLike.js';
import TaskTip from '../models/TaskTip.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 5 }, fileFilter(_req, file, cb) { cb(null, /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/.test(file.mimetype)); } });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const polygonChainName = 'Polygon Mainnet';
const polygonProvider = new JsonRpcProvider(env.polygonRpcUrl);
const polygonTraceProvider = new JsonRpcProvider(env.polygonTraceRpcUrl);
const taskInterface = new Interface(['function submitTask(string _taskTitle,string _proofLink)', 'function getTaskSubmissionsCount() view returns (uint256)']);

function findSuccessfulNestedProtocolCall(trace, protocolAddress, selector, walletAddress) {
  const visit = (frame, ancestors = []) => {
    if (!frame || frame.error || frame.revertReason) return false;
    const targetMatches = String(frame.to || '').toLowerCase() === protocolAddress;
    const selectorMatches = String(frame.input || '').slice(0, 10).toLowerCase() === selector;
    const calledByWallet = ancestors.some(parent => String(parent.to || '').toLowerCase() === walletAddress);
    if (targetMatches && selectorMatches && calledByWallet) return frame;
    for (const child of frame.calls || []) {
      const match = visit(child, [...ancestors, frame]);
      if (match) return match;
    }
    return null;
  };
  return visit(trace);
}

export async function verifyProtocolTransaction(hash, walletAddress, functionSignature) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.polygonProtocolAddress)) {
    const error = new Error('Configure POLYGON_PROTOCOL_ADDRESS in server/.env before saving on-chain tasks.'); error.status = 503; throw error;
  }
  const network = await polygonProvider.getNetwork();
  if (Number(network.chainId) !== env.chainId) { const error = new Error(`The configured RPC is not ${polygonChainName} (chain ID ${env.chainId}).`); error.status = 503; throw error; }
  const receipt = await polygonProvider.getTransactionReceipt(hash);
  const transaction = await polygonProvider.getTransaction(hash);
  if (!receipt || !transaction || Number(receipt.status) !== 1) { const error = new Error(`Transaction is not confirmed successfully on ${polygonChainName}.`); error.status = 400; throw error; }
  if (transaction.from.toLowerCase() !== String(walletAddress).toLowerCase()) { const error = new Error('Transaction sender does not match the signed-in wallet.'); error.status = 403; throw error; }
  const protocolAddress = env.polygonProtocolAddress.toLowerCase();
  const selector = functionId(functionSignature).slice(0, 10).toLowerCase();
  let protocolCallData = '';
  const directCallMatches = String(transaction.to || '').toLowerCase() === protocolAddress &&
    String(transaction.data || '').slice(0, 10).toLowerCase() === selector;
  if (directCallMatches) {
    protocolCallData = transaction.data;
  } else {
    // Smart wallets can wrap a contract call in a delegation/execution transaction.
    // Inspect the trace and accept only a successful nested call from this wallet
    // to the configured protocol with the exact expected function selector.
    try {
      const traceNetwork = await polygonTraceProvider.getNetwork();
      if (Number(traceNetwork.chainId) !== env.chainId) throw new Error('The trace RPC is not Polygon Mainnet.');
      const trace = await polygonTraceProvider.send('debug_traceTransaction', [hash, { tracer: 'callTracer' }]);
      const nestedCall = findSuccessfulNestedProtocolCall(
        trace,
        protocolAddress,
        selector,
        String(walletAddress).toLowerCase()
      );
      if (!nestedCall) {
        const error = new Error(String(transaction.to || '').toLowerCase() !== protocolAddress
          ? 'Transaction does not call the configured Polygon protocol contract.'
          : 'Transaction method does not match the expected protocol action.');
        error.status = 400;
        throw error;
      }
      protocolCallData = nestedCall.input;
    } catch (cause) {
      if (cause?.status) throw cause;
      const error = new Error('Could not verify the smart-wallet execution trace on Polygon Mainnet. Retry saving this confirmed transaction without sending it again.');
      error.status = 503;
      throw error;
    }
  }
  return { receipt, protocolCallData };
}
function bucket() { return new GridFSBucket(mongoose.connection.db, { bucketName: 'taskAttachments' }); }
async function recoverOnChainTaskId(receipt) {
  if (!receipt.blockNumber) return null;
  try {
    const data = taskInterface.encodeFunctionData('getTaskSubmissionsCount');
    const [beforeResult, afterResult] = await Promise.all([
      polygonProvider.call({ to: env.polygonProtocolAddress, data }, receipt.blockNumber - 1),
      polygonProvider.call({ to: env.polygonProtocolAddress, data }, receipt.blockNumber)
    ]);
    const beforeCount = taskInterface.decodeFunctionResult('getTaskSubmissionsCount', beforeResult)[0];
    const afterCount = taskInterface.decodeFunctionResult('getTaskSubmissionsCount', afterResult)[0];
    return afterCount === beforeCount + 1n ? String(beforeCount) : null;
  } catch { return null; }
}

async function saveAttachment(file, metadata) {
  if (!file) return { gridFsId: null, filename: '', contentType: '', size: 0 };
  const id = new ObjectId();
  const stream = bucket().openUploadStream(file.originalname.slice(0, 180), { id, contentType: file.mimetype, metadata });
  await new Promise((resolve, reject) => { stream.once('finish', resolve); stream.once('error', reject); Readable.from([file.buffer]).pipe(stream); });
  return { gridFsId: id, filename: file.originalname.slice(0, 180), contentType: file.mimetype, size: file.size };
}
async function saveAttachments(files, metadata) {
  const attachments = [];
  for (const file of files || []) attachments.push(await saveAttachment(file, metadata));
  return attachments;
}
async function sendTaskToTelegram(task, files) {
  if (!env.telegramBotToken || !env.telegramTaskChannel) return 'not-configured';
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(env.telegramBotToken)) {
    task.telegramDeliveryError = 'Telegram bot token is incomplete or malformed. Set the full token from BotFather in server/.env.';
    return 'failed';
  }
  try {
    const caption = `Task submitted\nTask: ${task.taskTitle}\nPerformer: ${task.performerWallet}\nTelegram: ${task.telegramHandle || 'not provided'}\nProof: ${task.proofLink}`.slice(0, 1000);
    const file = (files || [])[0];
    if (file) {
      const form = new FormData(); form.append('chat_id', env.telegramTaskChannel); form.append('caption', caption);
      const blob = new Blob([file.buffer], { type: file.mimetype });
      form.append(file.mimetype.startsWith('video/') ? 'video' : 'photo', blob, file.originalname);
      const endpoint = file.mimetype.startsWith('video/') ? 'sendVideo' : 'sendPhoto';
      const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${endpoint}`, { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok !== false) return 'sent';
      task.telegramDeliveryError = String(result.description || `Telegram API returned HTTP ${response.status}.`).slice(0, 240);
      return 'failed';
    }
    const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.telegramTaskChannel, text: caption }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok !== false) return 'sent';
    task.telegramDeliveryError = String(result.description || `Telegram API returned HTTP ${response.status}.`).slice(0, 240);
    return 'failed';
  } catch (error) {
    task.telegramDeliveryError = String(error?.message || 'Telegram request failed.').slice(0, 240);
    return 'failed';
  }
}
router.post('/recover', requireAuth, upload.array('attachments', 5), asyncRoute(async (req, res) => {
  const transactionHash = String(req.body?.transactionHash || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(transactionHash)) return res.status(400).json({ message: 'A confirmed Polygon Mainnet task transaction hash is required.' });
  const user = await User.findById(req.session.userId).select('walletAddress telegramHandle').lean();
  if (!user) return res.status(401).json({ message: 'Wallet profile not found. Sign in again.' });

  const existing = await TaskSubmission.findOne({ transactionHash }).lean();
  if (existing) {
    if (String(existing.author) !== String(user._id)) return res.status(409).json({ message: 'This transaction has already been saved to another wallet profile.' });
    return res.json({ item: { ...existing, id: String(existing._id), attachmentUrls: (existing.attachments || []).filter(file => file?.gridFsId).map(file => ({ filename: file.filename, url: `/api/tasks/${existing._id}/attachments/${file.gridFsId}` })) }, alreadySaved: true });
  }

  const { receipt, protocolCallData } = await verifyProtocolTransaction(transactionHash, user.walletAddress, 'submitTask(string,string)');
  let decoded;
  try { decoded = taskInterface.decodeFunctionData('submitTask(string,string)', protocolCallData); }
  catch { return res.status(400).json({ message: 'The confirmed protocol call does not contain recoverable task details.' }); }
  const taskTitle = String(decoded[0] || '').trim();
  const proofLink = String(decoded[1] || '').trim();
  if (!taskTitle || taskTitle.length > 180) return res.status(400).json({ message: 'The on-chain task title is invalid.' });
  let parsedUrl;
  try { parsedUrl = new URL(proofLink); } catch { return res.status(400).json({ message: 'The on-chain proof link is not a valid URL.' }); }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) return res.status(400).json({ message: 'The on-chain proof link must use HTTP or HTTPS.' });

  const attachments = await saveAttachments(req.files, { walletAddress: user.walletAddress, taskTitle });
  const task = await TaskSubmission.create({
    author: user._id,
    performerWallet: user.walletAddress,
    taskTitle,
    proofLink: parsedUrl.href,
    telegramHandle: user.telegramHandle || '',
    transactionHash,
    onChainTaskId: await recoverOnChainTaskId(receipt),
    chainId: env.chainId,
    attachments
  });
  task.telegramDeliveryStatus = await sendTaskToTelegram(task, req.files);
  await task.save();
  res.status(201).json({ item: { ...task.toObject(), id: String(task._id), telegramHandle: undefined, attachmentUrls: attachments.filter(file => file?.gridFsId).map(file => ({ filename: file.filename, url: `/api/tasks/${task._id}/attachments/${file.gridFsId}` })) }, recovered: true });
}));

router.get('/', asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const [items, total] = await Promise.all([
    TaskSubmission.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('author', 'walletAddress displayAddress').lean(),
    TaskSubmission.countDocuments()
  ]);
  const ids = items.map(item => item._id);
  const [likes, myLikes] = await Promise.all([
    TaskLike.aggregate([{ $match: { task: { $in: ids } } }, { $group: { _id: '$task', count: { $sum: 1 } } }]),
    req.session?.userId ? TaskLike.find({ task: { $in: ids }, user: req.session.userId }).select('task').lean() : []
  ]);
  const likeMap = new Map(likes.map(row => [String(row._id), row.count]));
  const likedSet = new Set(myLikes.map(row => String(row.task)));
  // Telegram identifiers are stored privately on the task document but not exposed in the public feed.
  res.json({ items: items.map(item => ({ ...item, id: String(item._id), telegramHandle: undefined, telegramDeliveryStatus: undefined, likeCount: likeMap.get(String(item._id)) || 0, likedByMe: likedSet.has(String(item._id)), attachmentUrls: (item.attachments || []).filter(file => file?.gridFsId).map(file => ({ filename: file.filename, url: `/api/tasks/${item._id}/attachments/${file.gridFsId}` })) })), total, page, limit });
}));
async function streamTaskAttachment(req, res) {
  if (!mongoose.isValidObjectId(req.params.taskId)) return res.status(400).json({ message: 'Invalid task ID.' });
  const task = await TaskSubmission.findById(req.params.taskId).select('attachments').lean();
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  const requestedId = req.params.attachmentId;
  const attachment = requestedId
    ? (task.attachments || []).find(item => String(item.gridFsId) === String(requestedId))
    : (task.attachments || [])[0];
  if (!attachment?.gridFsId) return res.status(404).json({ message: 'Attachment not found.' });
  const file = await bucket().find({ _id: attachment.gridFsId }).limit(1).next();
  if (!file) return res.status(404).json({ message: 'Attachment not found.' });
  res.set('Content-Type', attachment.contentType || file.contentType || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename || file.filename)}"`);
  bucket().openDownloadStream(attachment.gridFsId).on('error', () => { if (!res.headersSent) res.status(404).end(); }).pipe(res);
}
router.get('/:taskId/attachment', asyncRoute(async (req, res) => streamTaskAttachment(req, res)));
router.get('/:taskId/attachments/:attachmentId', asyncRoute(async (req, res) => streamTaskAttachment(req, res)));
router.post('/', requireAuth, upload.array('attachments', 5), asyncRoute(async (req, res) => {
  const taskTitle = String(req.body?.taskTitle || '').trim();
  const proofLink = String(req.body?.proofLink || '').trim();
  const transactionHash = String(req.body?.transactionHash || '').trim();
  const onChainTaskId = String(req.body?.onChainTaskId || '').trim();
  if (!taskTitle || taskTitle.length > 180) return res.status(400).json({ message: 'Task title is required (maximum 180 characters).' });
  let parsedUrl; try { parsedUrl = new URL(proofLink); } catch { return res.status(400).json({ message: 'A valid proof URL is required.' }); }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) return res.status(400).json({ message: 'Proof URL must use HTTP or HTTPS.' });
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return res.status(400).json({ message: `A confirmed ${polygonChainName} transaction hash is required.` });
  const user = await User.findById(req.session.userId).select('walletAddress telegramHandle').lean();
  if (!user) return res.status(401).json({ message: 'Wallet profile not found. Sign in again.' });
  await verifyProtocolTransaction(transactionHash, user.walletAddress, 'submitTask(string,string)');
  const attachments = await saveAttachments(req.files, { walletAddress: user.walletAddress, taskTitle });
  const task = await TaskSubmission.create({ author: user._id, performerWallet: user.walletAddress, taskTitle, proofLink, telegramHandle: user.telegramHandle || '', transactionHash, onChainTaskId: /^\d+$/.test(onChainTaskId) ? onChainTaskId : null, chainId: env.chainId, attachments });
  task.telegramDeliveryStatus = await sendTaskToTelegram(task, req.files);
  await task.save();
  res.status(201).json({ item: { ...task.toObject(), id: String(task._id), telegramHandle: undefined, attachmentUrls: attachments.filter(file => file?.gridFsId).map(file => ({ filename: file.filename, url: `/api/tasks/${task._id}/attachments/${file.gridFsId}` })) } });
}));
router.post('/:taskId/like', requireAuth, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.taskId)) return res.status(400).json({ message: 'Invalid task ID.' });
  const task = await TaskSubmission.exists({ _id: req.params.taskId });
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  const existing = await TaskLike.findOne({ task: task._id, user: req.session.userId });
  if (existing) { await existing.deleteOne(); return res.json({ liked: false }); }
  try { await TaskLike.create({ task: task._id, user: req.session.userId }); } catch (error) { if (error.code !== 11000) throw error; }
  res.json({ liked: true });
}));
router.post('/:taskId/verify-record', requireAuth, asyncRoute(async (req, res) => {
  if (req.session.walletAddress !== env.auditorWallet) return res.status(403).json({ message: 'Only the configured auditor wallet can verify a task.' });
  if (!mongoose.isValidObjectId(req.params.taskId)) return res.status(400).json({ message: 'Invalid task ID.' });
  const transactionHash = String(req.body?.transactionHash || '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return res.status(400).json({ message: 'Confirmed verification transaction hash is required.' });
  await verifyProtocolTransaction(transactionHash, req.session.walletAddress, 'verifyTask(uint256)');
  const task = await TaskSubmission.findByIdAndUpdate(req.params.taskId, { $set: { isVerified: true, rejectionReason: '', verificationTransactionHash: transactionHash } }, { new: true });
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  res.json({ verified: true, id: String(task._id) });
}));
router.post('/:taskId/reject', requireAuth, asyncRoute(async (req, res) => {
  if (req.session.walletAddress !== env.auditorWallet) return res.status(403).json({ message: 'Only the configured auditor wallet can reject a task.' });
  if (!mongoose.isValidObjectId(req.params.taskId)) return res.status(400).json({ message: 'Invalid task ID.' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 1000) return res.status(400).json({ message: 'A rejection reason (maximum 1000 characters) is required.' });
  const task = await TaskSubmission.findByIdAndUpdate(req.params.taskId, { $set: { isVerified: false, rejectionReason: reason } }, { new: true }).populate('author', 'telegramChatId');
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  if (env.telegramBotToken && task.author?.telegramChatId) {
    try { await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: task.author.telegramChatId, text: `GHM21 task rejected: ${task.taskTitle}\nReason: ${reason}` }) }); } catch { /* DB decision remains saved if Telegram is unavailable. */ }
  }
  res.json({ rejected: true, id: String(task._id) });
}));
router.post('/:taskId/tip-record', requireAuth, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.taskId)) return res.status(400).json({ message: 'Invalid task ID.' });
  const transactionHash = String(req.body?.transactionHash || '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return res.status(400).json({ message: 'Confirmed transaction hash is required.' });
  await verifyProtocolTransaction(transactionHash, req.session.walletAddress, 'tipTask(uint256,uint256)');
  const task = await TaskSubmission.findById(req.params.taskId);
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  try {
    await TaskTip.create({ task: task._id, user: req.session.userId, transactionHash: transactionHash.toLowerCase() });
    const updatedTask = await TaskSubmission.findByIdAndUpdate(task._id, { $inc: { tipCount: 1 } }, { new: true });
    task.tipCount = updatedTask.tipCount;
  } catch (error) {
    if (error.code !== 11000) throw error;
    return res.json({ tipCount: task.tipCount, alreadyRecorded: true });
  }
  res.json({ tipCount: task.tipCount });
}));
export default router;
