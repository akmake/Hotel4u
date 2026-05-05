// server/models/CustomerCard.js
// ✅ שודרג: דירוג לקוח, לקוח חוזר, תגיות, סה"כ הוצאות, מקור, הנחות

import mongoose from 'mongoose';

const timelineEventSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'message_in',      // הודעה נכנסת (וואטסאפ)
      'order_created',   // הזמנה חדשה
      'status_change',   // שינוי סטטוס הזמנה
      'order_updated',   // עדכון פרטי הזמנה
      'note_added',      // הערה כללית (Legacy)
      'quote_sent',      // נשלחה הצעת מחיר
      'call_out',        // שיחה יזומה
      'call_in',         // ✅ חדש: שיחה נכנסת (מהמרכזיה)
      'meeting',         // פגישה
      'note',            // הערה ידנית חדשה
      'general',         // כללי
      'discount_given',  // ✅ חדש: הנחה ניתנה
      'rating_changed'   // ✅ חדש: דירוג השתנה
    ],
    required: true
  },
  description: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  metadata: {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'InboundEmail' },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isManual: { type: Boolean, default: false },
    callDuration: { type: Number },         // ✅ חדש: משך שיחה בשניות
    discountPercent: { type: Number },       // ✅ חדש: אחוז הנחה שניתן
  },

  date: { type: Date, default: Date.now },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });


const customerCardSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true, index: true },
  name: { type: String },
  email: { type: String },

  // תאריך עדכון אחרון למיון הלקוחות
  lastEventDate: { type: Date, default: Date.now },

  // סטטוס לקוח
  lifecycleStage: {
    type: String,
    enum: ['new', 'active_order', 'past_customer', 'cold', 'vip'],
    default: 'new'
  },

  // ✅ חדש: דירוג לקוח (1-5 כוכבים)
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },

  // ✅ חדש: לקוח חוזר — נספר אוטומטית
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  isReturning: { type: Boolean, default: false },

  // ✅ חדש: הנחה קבועה ללקוח חוזר
  autoDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },

  // ✅ חדש: תגיות חופשיות (VIP, תלונן, ממליץ, דורש, וכו')
  tags: [{ type: String, trim: true }],

  // ✅ חדש: מקור הלקוח
  source: {
    type: String,
    enum: ['phone', 'whatsapp', 'website', 'referral', 'walk_in', 'facebook', 'google', 'other', ''],
    default: ''
  },

  // ✅ חדש: הערות פנימיות (לא מוצגות ללקוח)
  internalNotes: { type: String, default: '' },

  // ✅ חדש: מלון מועדף (על בסיס הזמנות קודמות)
  preferredHotel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' },

  // ✅ חדש: תאריך הזמנה אחרונה (לחישוב "קרירות")
  lastOrderDate: { type: Date },

  timeline: [timelineEventSchema],
}, { timestamps: true });

// ✅ Indexes לביצועים
customerCardSchema.index({ lifecycleStage: 1, lastEventDate: -1 });
customerCardSchema.index({ tags: 1 });
customerCardSchema.index({ isReturning: 1 });

export default mongoose.models.CustomerCard || mongoose.model('CustomerCard', customerCardSchema);