import mongoose from 'mongoose';

const { Schema } = mongoose;

export const GROUP_STATUSES = [
  'tentative',
  'confirmed',
  'active',
  'completed',
  'cancelled',
];

const AllotmentSchema = new Schema({
  roomTypeId:    { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  roomTypeName:  String,
  blocked:       { type: Number, default: 0, min: 0 },
  picked:        { type: Number, default: 0, min: 0 },
  released:      { type: Number, default: 0, min: 0 },
  negotiatedRate:{ type: Number, min: 0 },
  // Per-night grid (gap-map item 6): the hold need not be the same every night — a night listed here
  // holds its own number; any other night holds `blocked`.
  nightly:       { type: [new Schema({ date: String, blocked: { type: Number, min: 0 } }, { _id: false })], default: undefined },
  releasedAll:   { type: Boolean, default: false },              // the rest of this type went back to sale
}, { _id: false });

// Rooming list entry — one row per guest/room
const RoomingListEntrySchema = new Schema({
  guestName:     String,
  guestEmail:    String,
  guestPhone:    String,
  roomTypeId:    { type: Schema.Types.ObjectId, ref: 'RoomType' },
  roomTypeName:  String,
  arrivalDate:   String,
  departureDate: String,
  specialRequests: String,
  adults:        { type: Number, min: 1, max: 10 },
  children:      { type: Number, min: 0, max: 10 },
  share:         { type: Boolean, default: false },   // shares the room of the row above (one booking, own window)
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation' },  // filled after pickup
  notes:         String,
}, { _id: true });

const GroupBlockSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },

  name:          { type: String, required: true, trim: true },
  groupCode:     { type: String, required: true, uppercase: true, trim: true },
  description:   String,

  arrivalDate:   { type: String, required: true },
  departureDate: { type: String, required: true },
  nights:        { type: Number, min: 1 },

  allotments:    [AllotmentSchema],

  cutoffDate:    { type: String },

  ratePlan:      { type: Schema.Types.ObjectId, ref: 'RatePlan' },   // plan the pickups are booked on
  pickupPending: { type: Map, of: Number, default: {} },             // roomTypeId → pickups in flight (released meanwhile)

  // Master folio — all group charges consolidated here
  masterFolioId: { type: Schema.Types.ObjectId, ref: 'Folio' },

  // Rooming list
  roomingList:   { type: [RoomingListEntrySchema], default: [] },
  // How final the list is: none (with the agent's due date) → preliminary → final. The group is not
  // checked in before the list is final; from then on changes are made in each guest's booking.
  roomingStatus: { type: String, enum: ['none', 'preliminary', 'final'], default: 'none' },
  roomingDueDate: String,
  // Free places for the agent / tour leader: one for every N paying, or a set number.
  freePaxPer:    { type: Number, min: 0, default: 0 },
  freePaxCount:  { type: Number, min: 0 },
  // A series (Tour Series): copies of a master group on other dates.
  seriesOf:      { type: Schema.Types.ObjectId, ref: 'GroupBlock' },
  copiedFrom:    { type: Schema.Types.ObjectId, ref: 'GroupBlock' },

  company:       { type: Schema.Types.ObjectId, ref: 'Company' },
  contactName:   String,
  contactEmail:  String,
  contactPhone:  String,

  status:              { type: String, enum: GROUP_STATUSES, default: 'tentative' },
  cancellationPolicy:  String,
  depositPolicy:       String,
  depositAmount:       { type: Number, min: 0, default: 0 },
  depositDueDate:      String,

  // Programme (gap-map item 6): a day seminar has no rooms; participants and the minimum the client
  // pays for even if fewer come (the basis of the group's billing).
  stayType:            { type: String, enum: ['lodging', 'day'], default: 'lodging' },
  pax:                 { type: Number, default: 0, min: 0 },
  minPax:              { type: Number, default: 0, min: 0 },

  // Billing profile (knowledge 14 §6): what the group is expected to pay, on what terms.
  billing: {
    type: new Schema({
      lines:      { type: [new Schema({ category: { type: String, enum: ['lodging', 'meals', 'activities', 'transport', 'equipment', 'other'] }, description: String, amount: Number }, { _id: true })], default: [] },
      vatRate:    { type: Number, default: 18 },
      vatIncluded:{ type: Boolean, default: true },
      discount:   { type: new Schema({ kind: { type: String, enum: ['percent', 'amount'] }, value: Number, reason: String, note: String, approvedByName: String }, { _id: false }), default: undefined },
      terms:      { type: String, enum: ['immediate', 'net15', 'net30', 'net60', 'custom'], default: 'immediate' },
      termsText:  String,
      dueDate:    String,
      notes:      String,
      updatedByName: String,
      updatedAt:  Date,
    }, { _id: false }),
    default: undefined,
  },

  totalRoomsBlocked:   { type: Number, default: 0 },
  totalRoomsPicked:    { type: Number, default: 0 },
  totalRevenue:        { type: Number, default: 0 },

  autoReleaseOnCutoff: { type: Boolean, default: true },
  releasedAt:          Date,

  cancelledAt:         Date,
  cancellationReason:  String,

  internalNotes:       String,
  guestNotes:          String,

  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

GroupBlockSchema.pre('save', function () {
  if (this.arrivalDate && this.departureDate) {
    this.nights = Math.round(
      (new Date(this.departureDate) - new Date(this.arrivalDate)) / 86400000
    );
  }
  this.totalRoomsBlocked = (this.allotments || []).reduce((s, a) => s + a.blocked, 0);
  this.totalRoomsPicked  = (this.allotments || []).reduce((s, a) => s + a.picked, 0);
});

GroupBlockSchema.index({ property: 1, arrivalDate: 1, status: 1 });
GroupBlockSchema.index({ groupCode: 1 }, { unique: true });

export default mongoose.model('GroupBlock', GroupBlockSchema);
