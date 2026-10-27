import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const RES_STATUS = [
  'draft', 'quote', 'hold', 'pending_payment',
  'confirmed', 'modified', 'cancelled', 'waitlisted',
  'no_show', 'checked_in', 'in_house', 'checked_out',
  'partially_checked_in', 'partially_checked_out',
];

export const PAYMENT_STATUS = ['unpaid', 'partial', 'paid', 'refunded', 'balance_due'];
export const SOURCE = ['direct', 'booking', 'expedia', 'agoda', 'airbnb', 'gds', 'walk_in', 'corporate', 'agent', 'phone'];

const ReservationSchema = new Schema({
  property:          { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  confirmationNumber:{ type: String, required: true, unique: true },
  idempotencyKey:    String,
  bookingRequestHash: String,
  legacyRequestHash: String,
  status:            { type: String, enum: RES_STATUS, default: 'confirmed' },

  // Guests
  primaryGuest:      { type: Schema.Types.ObjectId, ref: 'GuestProfile', required: true },
  additionalGuests:  [{ type: Schema.Types.ObjectId, ref: 'GuestProfile' }],
  adults:            { type: Number, default: 1 },
  children:          { type: Number, default: 0 },

  // Dates
  arrivalDate:       { type: String, required: true },    // 'YYYY-MM-DD'
  departureDate:     { type: String, required: true },
  originalDepartureDate: String,                          // set when the stay ended early (FD-08/FD-11)
  nights:            { type: Number, required: true },
  roomsCount:        { type: Number, default: 1 },
  eta:               { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // expected arrival HH:MM (property local); not actual arrival
  etd:               { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // expected departure HH:MM; not actual departure

  // Booking details
  source:            { type: String, enum: SOURCE, default: 'direct' },
  marketSegment:     String,
  ratePlan:          { type: Schema.Types.ObjectId, ref: 'RatePlan' },
  roomType:          { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  assignedRoom:      { type: Schema.Types.ObjectId, ref: 'Room' },

  // Financials
  ratePerNight:      { type: Number, required: true },
  totalAmount:       { type: Number, required: true },
  taxAmount:         { type: Number, default: 0 },
  discountAmount:    { type: Number, default: 0 },
  surchargeAmount:   { type: Number, default: 0 },
  paymentStatus:     { type: String, enum: PAYMENT_STATUS, default: 'unpaid' },
  depositAmount:     { type: Number, default: 0 },
  depositPaid:       { type: Number, default: 0 },
  currency:          { type: String, default: 'ILS' },
  guaranteeType:     { type: String, enum: ['none', 'credit_card', 'deposit', 'voucher', 'company_guarantee'], default: 'none' },
  confirmationSent:  { type: Boolean, default: false },
  confirmationSentAt: Date,
  confirmationSentTo: String,
  cancellationPolicy:String,
  depositPolicy:     String,
  quoteExpiresAt:    Date,
  holdExpiresAt:     Date,
  holdReleasedAt:    Date,
  // RSV-02/INV-03: the price and terms the guest agreed to, frozen at booking time — later rate or
  // policy changes never rewrite them silently (T24).
  priceSnapshot: {
    ratePlanCode: String,
    ratePlanName: String,
    nightly:      [{ date: String, price: Number }],     // gross per room per night
    total:        Number,                               // gross for all rooms and nights
    vatRate:      Number,
    refundable:   Boolean,
    computedAt:   Date,
    override:     { by: String, reason: String },      // manual price, manager only
    // G2: board on top of the room price. source=plan → included in the rate (nothing extra);
    // source=supplement → per-night meal price for this room, posted as code 'board'.
    board: {
      type:    { type: String, enum: ['room_only', 'breakfast', 'half_board', 'full_board'] },
      source:  { type: String, enum: ['plan', 'supplement', 'none'] },
      nightly: [{ _id: false, date: String, price: Number }],
    },
  },
  // RSV-04: a documented offer that is not a booking until converted.
  quote: {
    version:    Number,
    validUntil: Date,
    language:   String,
    channel:    { type: String, enum: ['email', 'link', 'print'] },
    sentAt:     Date,
    sentBy:     String,
    lostReason: String,
    closedAt:   Date,
    convertedAt:Date,
  },
  // RSV-02-F09/F10: who booked and who pays may differ from the guest.
  booker: { name: String, phone: String, email: String },
  payerType: { type: String, enum: ['guest', 'company', 'booker'], default: 'guest' },
  childAges: [Number],                                  // RSV-02-F05, for child pricing/occupancy
  // RSV-06: the cancellation notice as received and the proposal it produced. Receiving the notice,
  // releasing stock, a credit note and a refund are separate steps; no fee is charged automatically (G06).
  cancellation: {
    receivedAt:    Date,                                  // when the guest's notice arrived (not when handled)
    channel:       { type: String, enum: ['phone', 'web', 'desk', 'ota', 'company', 'email', 'other'] },
    transactionAt: Date,
    disclosureAt:  Date,
    priorCall:     Boolean,
    track:         { type: String, enum: ['regular', 'protected', 'contractual', 'review'] },
    reason:        { type: String, enum: ['regret', 'service_failure', 'other'] },
    note:          String,
    proposal:      Schema.Types.Mixed,                     // what the rules suggested, with sources
    decidedBy:     String,
  },
  // EXT-04 / IL09 — guest who is not an Israeli resident: evidence recorded at the desk. The tax
  // effect (zero-rated lodging) is decided by the property's approved rule (Property.taxPolicy),
  // never by "foreign passport = no VAT" (gate G04).
  board:             { type: String, enum: ['room_only', 'breakfast', 'half_board', 'full_board'] },
  tourist: {
    nonResident:     Boolean,                            // declared: not a resident of Israel
    passportCountry: String,                             // ISO-2 of the passport presented
    visaType:        String,                             // entry visa / permit type as recorded
    entryDate:       String,                             // YYYY-MM-DD last entry to Israel
    docLast4:        String,                             // last 4 of the document — never the full number
    recordedAt:      Date,
    recordedBy:      { type: Schema.Types.ObjectId, ref: 'User' },
    recordedByName:  String,
    note:            String,
  },
  // Multi-room booking: every room is its own reservation (own check-in/out, folio, cancel), linked
  // into one party created in one action. code = confirmation number of the first room.
  party: {
    id:    String,
    code:  String,
    index: Number,
    size:  Number,
  },
  // Gap G6: actions that walk a status back (reinstate a cancellation / no-show, reverse a check-in).
  // Kept as history; the money side (refunds, credit notes) is never touched by these actions.
  reversals: [{
    _id: false,
    kind:   { type: String, enum: ['reinstate_cancelled', 'reinstate_no_show', 'reverse_check_in'] },
    from:   String,
    to:     String,
    at:     Date,
    by:     { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    reason: String,
  }],
  // RSV-05 / FD-10: last change reason and the guest's confirmation reference.
  lastChange: { at: Date, by: String, reason: String, confirmationRef: String, kind: String },

  // Relations
  company:           { type: Schema.Types.ObjectId, ref: 'Company' },
  travelAgent:       { type: Schema.Types.ObjectId, ref: 'Company' },
  group:             String,
  groupCode:         String,
  groupName:         String,

  // Meta
  isVip:             { type: Boolean, default: false },
  isOverbooking:     { type: Boolean, default: false },
  specialRequests:   String,
  guestNotes:        String,
  internalNotes:     String,
  language:          { type: String, default: 'he' },
  externalId:        String,                              // OTA reservation ID
  channelReservationId: String,

  // Timestamps for operations
  checkedInAt:       Date,
  checkedOutAt:      Date,
  cancelledAt:       Date,
  cancellationReason:String,
  noShowAt:          Date,

  createdBy:         { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:         { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ReservationSchema.index({ property: 1, arrivalDate: 1 });
ReservationSchema.index({ property: 1, departureDate: 1 });
ReservationSchema.index({ property: 1, status: 1 });
ReservationSchema.index({ primaryGuest: 1 });
ReservationSchema.index(
  { property: 1, idempotencyKey: 1 },
  // partial (not sparse): a compound sparse index still indexes docs that only have `property`,
  // so every reservation created without a key would collide on null.
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

ReservationSchema.index({ property: 1, 'party.id': 1 }, { sparse: true });

export default model('Reservation', ReservationSchema);
