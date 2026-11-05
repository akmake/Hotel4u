// Items the hotel lends to a stay (gap-map item 15): rollaway beds, extra cots, high chairs, heaters …
// A stock per item type, booked per night; availability = stock − what other stays hold that night.
// (Baby cribs keep their own flow in cribService.)
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const ItemTypeSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  code:     { type: String, required: true, maxlength: 30 },
  name:     { type: String, required: true, maxlength: 80 },
  total:    { type: Number, required: true, min: 0, max: 500 },
  price:    { type: Number, min: 0 },                 // per night, informational (charged by the desk with its charge code)
  active:   { type: Boolean, default: true },
}, { timestamps: true });
ItemTypeSchema.index({ property: 1, code: 1 }, { unique: true });

const ItemBookingSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  item:        { type: Schema.Types.ObjectId, ref: 'ItemType', required: true },
  qty:         { type: Number, default: 1, min: 1, max: 20 },
  from:        { type: String, required: true },     // first night
  to:          { type: String, required: true },     // morning after the last night (exclusive)
  status:      { type: String, enum: ['booked', 'released'], default: 'booked' },
  byName:      String,
}, { timestamps: true });
ItemBookingSchema.index({ property: 1, item: 1, status: 1, from: 1, to: 1 });

export const ItemType = mongoose.models.ItemType || model('ItemType', ItemTypeSchema);
export const ItemBooking = mongoose.models.ItemBooking || model('ItemBooking', ItemBookingSchema);
