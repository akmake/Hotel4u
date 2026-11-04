// Events & function spaces (Optima "Event search" / "Events chart").
// EventSpace: a hall / meeting room. EventBooking: one function in one space on one date and time
// range (a conference day, a wedding, a meeting), its client, attendance, setup, catering lines and
// status. Billing goes through a house folio (NR folio, outlet "events") linked to the event.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const EventSpaceSchema = new Schema({
  property:   { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  name:       { type: String, required: true },
  capacity:   { type: Number, default: 0 },                 // max people
  setups:     { type: [String], default: [] },              // theatre, classroom, banquet, cocktail, u_shape, boardroom
  pricePerDay: Number,
  note:       String,
  sortOrder:  { type: Number, default: 0 },
  active:     { type: Boolean, default: true },
}, { timestamps: true });
EventSpaceSchema.index({ property: 1, name: 1 }, { unique: true });
export const EventSpace = model('EventSpace', EventSpaceSchema);

const ItemSchema = new Schema({
  description: { type: String, required: true },
  quantity:    { type: Number, default: 1 },
  unitPrice:   { type: Number, default: 0 },              // incl. VAT
}, { _id: true });

const EventBookingSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  number:      { type: String, required: true },            // EV-00012
  name:        { type: String, required: true },
  kind:        { type: String, enum: ['conference', 'meeting', 'wedding', 'party', 'seminar', 'other'], default: 'meeting' },
  space:       { type: Schema.Types.ObjectId, ref: 'EventSpace', required: true },
  date:        { type: String, required: true },            // YYYY-MM-DD
  start:       { type: String, required: true },            // HH:MM
  end:         { type: String, required: true },            // HH:MM
  attendees:   { type: Number, default: 0 },
  setup:       String,
  status:      { type: String, enum: ['tentative', 'confirmed', 'cancelled', 'done'], default: 'tentative' },
  client:      { name: String, phone: String, email: String },
  company:     { type: Schema.Types.ObjectId, ref: 'Company' },
  groupBlock:  { type: Schema.Types.ObjectId, ref: 'GroupBlock' },
  items:       { type: [ItemSchema], default: [] },
  notes:       String,                                       // operations: AV, menu, signage…
  folio:       { type: Schema.Types.ObjectId, ref: 'Folio' },
  cancelReason: String,
  createdByName: String,
  updatedByName: String,
}, { timestamps: true });
EventBookingSchema.index({ property: 1, date: 1, space: 1 });
EventBookingSchema.index({ property: 1, number: 1 }, { unique: true });
export default model('EventBooking', EventBookingSchema);
