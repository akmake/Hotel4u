// Promotion (Optima "Promotion"): a code the desk or the booking site enters at booking time.
// It discounts the lodging price of matching offers — a percent, an amount per night, or "stay N pay M"
// (the cheapest nights in each block of N are free) — inside a booking window and a stay window,
// for chosen room types / rate plans / channels, up to a usage cap.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const PromotionSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:         { type: String, required: true, uppercase: true, trim: true },
  name:         { type: String, required: true },
  description:  String,                                  // shown to the guest on the booking site
  kind:         { type: String, enum: ['percent', 'amount', 'stay_pay'], default: 'percent' },
  value:        { type: Number, default: 0 },            // percent off, or ILS off per night
  stayNights:   Number,                                  // stay_pay: N
  payNights:    Number,                                  // stay_pay: M
  bookFrom:     String,                                  // YYYY-MM-DD — when the booking is made
  bookTo:       String,
  stayFrom:     String,                                  // YYYY-MM-DD — arrival must fall in this window
  stayTo:       String,
  minNights:    Number,
  minLeadDays:  Number,                                  // early booking
  roomTypes:    [{ type: Schema.Types.ObjectId, ref: 'RoomType' }],
  ratePlans:    [{ type: Schema.Types.ObjectId, ref: 'RatePlan' }],
  channels:     { type: [String], default: ['desk', 'web'] },   // desk = staff booking, web = /book
  maxUses:      Number,                                  // bookings, not nights
  active:       { type: Boolean, default: true },
  createdByName: String,
  updatedByName: String,
}, { timestamps: true });

PromotionSchema.index({ property: 1, code: 1 }, { unique: true });

export default model('Promotion', PromotionSchema);
