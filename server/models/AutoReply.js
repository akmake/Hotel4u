import mongoose from 'mongoose';

const stepSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'document', 'link'],
    required: true
  },
  content: { type: String, required: true }, 
  caption: { type: String } 
}, { _id: false });

const autoReplySchema = new mongoose.Schema({
  triggerText: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  steps: [stepSchema],
  isActive: { type: Boolean, default: true },
  minDelayMinutes: { type: Number, default: 3 },
  maxDelayMinutes: { type: Number, default: 10 },
  
  // ✨ השינוי: מונה שימושים
  usageCount: { type: Number, default: 0 } 
}, { timestamps: true });

export default mongoose.model('AutoReply', autoReplySchema);