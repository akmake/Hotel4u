import mongoose from 'mongoose';

const inboundEmailSchema = new mongoose.Schema(
  {
    from: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
    receivedAt: { type: Date, default: Date.now, index: true },

    status: {
      type: String,
      enum: ['new', 'handled', 'contact_saved', 'not_relevant', 'bot', 'processed', 'closed', 'in_progress', 'converted'],
      default: 'new',
      index: true,
    },
    
    rejectionReason: { type: String, trim: true, default: null },
    
    parsedName: { type: String, trim: true },
    parsedPhone: { type: String, trim: true },
    parsedNote: { type: String, trim: true },
    conversationLink: { type: String, trim: true },

    referrer: { type: String, trim: true, index: true, default: null },

    hotel: { type: String, trim: true, default: null },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    internalNotes: { type: String, trim: true },

    // ✨✨✨ זה החלק שהיה חסר לך! בלי זה אין תיעוד! ✨✨✨
    interactions: [{
      type: { type: String }, // למשל 'status_change'
      date: { type: Date, default: Date.now },
      description: { type: String },
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      metadata: { type: Object }
    }]
  },
  { timestamps: true }
);

export default mongoose.models.InboundEmail || mongoose.model('InboundEmail', inboundEmailSchema);