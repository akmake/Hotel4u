import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Operational status - affects sellability
export const OPS_STATUS = ['available', 'out_of_order', 'out_of_service', 'maintenance_hold', 'owner_hold', 'internal_use'];
// Housekeeping status
export const CLEAN_STATUS = ['clean', 'dirty', 'inspected', 'pickup', 'turndown_required'];
// Occupancy status
export const OCC_STATUS = ['vacant', 'occupied', 'reserved', 'due_in', 'due_out', 'checked_out'];

const RoomSchema = new Schema({
  property:              { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  roomType:              { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  number:                { type: String, required: true },
  floor:                 { type: Number, required: true },
  building:              String,
  wing:                  String,
  housekeepingZone:      String,
  maintenanceArea:       String,
  opsStatus:             { type: String, enum: OPS_STATUS, default: 'available' },
  outOfServiceUntil:     String, // YYYY-MM-DD, allows future-dated sellability
  cleanStatus:           { type: String, enum: CLEAN_STATUS, default: 'clean' },
  occStatus:             { type: String, enum: OCC_STATUS, default: 'vacant' },
  isVip:                 { type: Boolean, default: false },
  isSmoking:             { type: Boolean, default: false },
  isAccessible:          { type: Boolean, default: false },   // סינון מהיר
  // נגישות מפורטת — חוק שוויון זכויות לאנשים עם מוגבלות, תשנ"ח-1998
  accessibilityFeatures: [{
    type: String,
    enum: [
      'wheelchair_accessible',   // נגיש לכיסא גלגלים
      'roll_in_shower',           // מקלחת נגישה ללא מדרגה
      'grab_bars',                // מוטות אחיזה
      'lowered_bed',              // מיטה נמוכה
      'lowered_switches',         // מתגים בגובה נגיש
      'visual_fire_alarm',        // אזעקת אש חזותית (לחירשים)
      'hearing_loop',             // לולאת השראה (מגברי שמע)
      'wide_doorway',             // פתח רחב (לפחות 90 ס"מ)
      'elevator_access',          // גישה במעלית
      'accessible_bathroom',      // שירותים נגישים
      'braille_signage',          // שלטים בברייל
      'pool_lift',                // מעלית לבריכה
    ],
  }],
  connectingRoom:        { type: Schema.Types.ObjectId, ref: 'Room' },
  preferredAlternateRoom:{ type: Schema.Types.ObjectId, ref: 'Room' },
  internalNotes:         String,
  lastRenovatedAt:       Date,
  active:                { type: Boolean, default: true },
}, { timestamps: true });

RoomSchema.index({ property: 1, number: 1 }, { unique: true });

RoomSchema.virtual('isSellable').get(function () {
  if (this.opsStatus === 'out_of_order') return false;
  if (this.opsStatus === 'available') return this.occStatus === 'vacant';
  return false;
});

export default model('Room', RoomSchema);
