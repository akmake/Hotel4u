import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
    adults: { type: Number, required: true, min: 0 },
    teens: { type: Number, required: true, min: 0 },
    children: { type: Number, required: true, min: 0 },
    babies: { type: Number, required: true, min: 0 },
    price_list_names: [String],
    price: { type: Number, required: true },
    roomType: { type: String, required: true, default: 'רגיל' },
    roomSupplement: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true }
}, { _id: false });

const extraSchema = new mongoose.Schema({
    extraType: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, required: true, min: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: Number, unique: true, required: true },
    hotel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true },
    
    // הבעלים הנוכחי של ההזמנה (לצורך הרשאות עריכה)
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    salespersonName: { type: String, required: true },

    // === ✨ שדות חדשים לחישוב עמלות מפוצל ===
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // מי יצר
    createdByName: { type: String }, // גיבוי שם היוצר
    
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // מי סגר (שינה לבוצע)
    closedByName: { type: String, default: null },
    
    optimaNumber: { type: String, trim: true, default: null }, // המספר מאופטימה לאימות
    // ==========================================

    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    eventDate: { type: Date, default: Date.now },

    status: {
      type: String,
      // ✨ הרחבתי את הרשימה כדי לתמוך גם באנגלית וגם בעברית למניעת קריסות
      enum: [
          'sent', 'placed', 'not_relevant', 
          'בהמתנה', 'בוצע', 'לא רלוונטי', 'בטיפול', 'בוטל',
          'cancelled', 'in_progress', 
          'new', 'won', 'lost', 'bozaa', 'cancel' // תוספות מהקונטרולר
      ],
      default: 'בהמתנה',
    },
    rejectionReason: { type: String, trim: true, default: null },

    numberOfNights: { type: Number, required: true, default: 1 },
    rooms: [roomSchema],
    extras: [extraSchema],
    discountPercent: { type: Number, default: 0 },
    total_price: { type: Number, required: true },
    notes: { type: String, trim: true },

    // ✨✨✨ השדה הקריטי שהיה חסר להיסטוריה! ✨✨✨
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

export default mongoose.models.Order || mongoose.model('Order', orderSchema);