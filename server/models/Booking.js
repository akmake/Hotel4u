// server/models/Booking.js
import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  hotel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
  room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  roomNumber: { type: String, required: true },
  
  // שדות המידע של האורח (חדש/מעודכן)
  guestName: { type: String, trim: true, default: 'אורח' }, // מיפוי מ-guest_name
  guestPhone: { type: String, default: '' },              // שדה אופציונלי
  optimaNumber: { type: String, index: true },           // מיפוי מ-c_folio_number

  arrivalDate: { type: Date, required: true, index: true },
  departureDate: { type: Date, required: true, index: true },
  
  pax: { type: Number, default: 1 },
  babies: { type: Number, default: 0 },
  
  status: { 
    type: String, 
    enum: ['active', 'cancelled', 'manual_fix'], 
    default: 'active' 
  },
  source: { 
    type: String, 
    enum: ['excel', 'manual'], 
    default: 'excel' 
  },
  notes: { type: String, default: '' }
}, { timestamps: true });

bookingSchema.index({ room: 1, arrivalDate: 1, departureDate: 1 });

// מונע שגיאת "OverwriteModelError" בסביבת פיתוח
export default mongoose.models.Booking || mongoose.model('Booking', bookingSchema);