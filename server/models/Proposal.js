// Multi-option quotation (Optima "Quotation multi"): one offer document for one customer with several
// alternatives (room type × rate × board), each priced by the booking engine at the time it was made.
// The customer picks one option and it becomes a reservation; the rest of the proposal closes.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const OptionSchema = new Schema({
  roomTypeId:    { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  roomTypeName:  String,
  ratePlanId:    { type: Schema.Types.ObjectId, ref: 'RatePlan', required: true },
  ratePlanName:  String,
  board:         String,
  rooms:         { type: Number, default: 1 },
  total:         Number,                       // all rooms, all nights, incl. VAT
  averageNight:  Number,
  refundable:    Boolean,
  cancellation:  String,
  priceSignature: String,
  note:          String,
}, { _id: true });

const ProposalSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  number:       { type: String, required: true },          // Q-00017
  guest:        { type: Schema.Types.ObjectId, ref: 'GuestProfile' },
  customer:     { name: String, phone: String, email: String, company: String },
  arrival:      { type: String, required: true },
  departure:    { type: String, required: true },
  nights:       Number,
  adults:       { type: Number, default: 2 },
  children:     { type: Number, default: 0 },
  childAges:    [Number],
  promoCode:    String,
  options:      { type: [OptionSchema], default: [] },
  validUntil:   { type: Date, required: true },
  status:       { type: String, enum: ['open', 'sent', 'won', 'lost'], default: 'open' },
  sentAt:       Date,
  chosenOption: { type: Schema.Types.ObjectId },
  reservation:  { type: Schema.Types.ObjectId, ref: 'Reservation' },
  lostReason:   String,
  note:         String,                                    // shown to the customer
  internalNote: String,
  createdByName: String,
  closedByName: String,
  closedAt:     Date,
}, { timestamps: true });

ProposalSchema.index({ property: 1, createdAt: -1 });
ProposalSchema.index({ property: 1, number: 1 }, { unique: true });

export default model('Proposal', ProposalSchema);
