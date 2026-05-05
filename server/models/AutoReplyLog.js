import mongoose from 'mongoose';

const autoReplyLogSchema = new mongoose.Schema({
  senderName: String,
  senderPhone: String,
  triggerText: String, // המילה שנתפסה
  fullMessage: String, // ההודעה המלאה של הלקוח
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending'
  },
  scheduledFor: Date, // מתי זה אמור להישלח (אחרי ההשהייה)
  sentAt: Date,      // מתי נשלח בפועל
  errorMessage: String // אם נכשל - למה?
}, { timestamps: true });

export default mongoose.model('AutoReplyLog', autoReplyLogSchema);