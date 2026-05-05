import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  text: { type: String, default: '' },

  // ✨ שדות חדשים למדיה בצ'אט
  mediaUrl: { type: String, default: null },
  mediaType: { type: String, enum: ['image', 'video', 'document', null], default: null },
  fileName: { type: String, default: null },

  relatedOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  
  isRead: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  isForwarded: { type: Boolean, default: false },

}, { timestamps: true });

messageSchema.index({ sender: 1, recipient: 1, createdAt: 1 });

export default mongoose.model('Message', messageSchema);