// A guest request the desk could not take (gap-map item 8, weekly view): the hotel was full, the price,
// a restriction… Counted per night so the manager sees lost demand next to availability.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const TURNAWAY_REASONS = { full: 'מלא', room_type: 'אין סוג החדר המבוקש', price: 'מחיר', restriction: 'הגבלה (מינימום לילות / סגור להגעה)', other: 'אחר' };

const TurnAwaySchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  date:     { type: String, required: true },     // requested arrival YYYY-MM-DD
  nights:   { type: Number, default: 1, min: 1, max: 60 },
  rooms:    { type: Number, default: 1, min: 1, max: 100 },
  roomType: { type: Schema.Types.ObjectId, ref: 'RoomType' },
  reason:   { type: String, enum: Object.keys(TURNAWAY_REASONS), required: true },
  note:     { type: String, maxlength: 300 },
  by:       { type: Schema.Types.ObjectId, ref: 'User' },
  byName:   String,
}, { timestamps: true });

TurnAwaySchema.index({ property: 1, date: 1 });

export default model('TurnAway', TurnAwaySchema);
