import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const RES_STATUS = [
  'draft', 'quote', 'hold', 'pending_payment',
  'confirmed', 'modified', 'cancelled', 'waitlisted',
  'no_show', 'checked_in', 'in_house', 'checked_out',
  'partially_checked_in', 'partially_checked_out',
  'deleted', // entered by mistake — not a cancellation; never counted in cancellation / no-show / revenue stats
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
  // Where the stay was sold (gap-map item 9): channel rules (web discount) keep applying when it is repriced.
  salesChannel:      { type: String, enum: ['desk', 'web', 'ota'] },
  ratePlan:         { type: Schema.Types.ObjectId, ref: 'RatePlan' },
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
  guaranteeType:     { type: String, enum: ['none', 'credit_card', 'deposit', 'voucher', 'company_guarantee', 'non_guaranteed'], default: 'none' },
  // Cash Basis / No Post: services other than lodging/board may not be charged to the room without a manager.
  noPost: { on: Boolean, source: { type: String, enum: ['manual', 'check_in'] }, by: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, at: Date, reason: String },
  // Voucher — who pays for what (services/voucherService.js); drives routing to the payer's window.
  voucher: { type: { type: String, enum: ['agent_all', 'agent_room', 'deposit', 'guest_all'] }, number: String, amount: Number, payerRef: String, payerRole: { type: String, enum: ['agent', 'company'] }, payerName: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, at: Date },
  holdUntilTime:     { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // GTD: non-guaranteed booking held until HH:MM on arrival day
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
    nightly:      [{ date: String, price: Number, planCode: String }],     // gross per room per night; planCode when part of the stay is on another rate (gap-map item 14)
    total:        Number,                               // gross for all rooms and nights
    vatRate:      Number,
    refundable:   Boolean,
    computedAt:   Date,
    override:     { by: String, reason: String },      // manual price, manager only
    promotion:    { code: String, name: String, saving: Number }, // promo code applied at booking
    // Discount on top of the rate (not a manual price): percent or amount off lodging, with a reason
    // from the list; above Property.discountApprovalPercent a manager approves. Saving is per room.
    discount: { kind: { type: String, enum: ['percent', 'amount'] }, value: Number, reason: String, note: String, saving: Number, baseTotal: Number, by: String, approvedBy: String, threshold: Number },
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
    reason:        { type: String },   // code from the hotel's cancellation reasons; 'regret' / 'service_failure' carry the legal meaning
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
    permanentAddress: String,                            // permanent address abroad — required for the 0% VAT evidence
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
  // Shares (gap-map item 5): another guest in the same room with their own billing window. The
  // lodging is split per night by `split`: none = all on the main guest, half = equal parts,
  // full = the sharer pays a full night as well. Removed / separated shares stay as history.
  shares: [{
    guest:   { type: Schema.Types.ObjectId, ref: 'GuestProfile', required: true },
    name:    String,
    split:   { type: String, enum: ['none', 'half', 'full'], default: 'half' },
    folio:   { type: Schema.Types.ObjectId, ref: 'Folio' },
    status:  { type: String, enum: ['active', 'removed', 'separated'], default: 'active' },
    mergedFrom: String,                                   // confirmation number of a booking joined into this room
    newReservation: { type: Schema.Types.ObjectId, ref: 'Reservation' },
    at: Date, byName: String, endedAt: Date, endedByName: String, reason: String,
  }],
  // Split Master (gap-map item 5): this booking was split out of a multi-room booking.
  splitFrom: { reservation: { type: Schema.Types.ObjectId, ref: 'Reservation' }, confirmationNumber: String, at: Date, byName: String },
  // Gap G6: actions that walk a status back (reinstate a cancellation / no-show, reverse a check-in).
  // Kept as history; the money side (refunds, credit notes) is never touched by these actions.
  reversals: [{
    _id: false,
    kind:   { type: String, enum: ['reinstate_cancelled', 'reinstate_no_show', 'reverse_check_in', 'reinstate_check_out'] },
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
  // The card on file for this stay (gap-map item 12) — a reference to the tokenized card, last 4 for display.
  card:              { type: new Schema({ ref: { type: Schema.Types.ObjectId, ref: 'PaymentCard' }, last4: String, brand: String }, { _id: false }), default: undefined },
  // Profiles on the booking (gap-map item 16): a source profile (company of type 'source') and a contact who does not stay.
  sourceProfile:     { type: Schema.Types.ObjectId, ref: 'Company' },
  contactProfile:    { type: Schema.Types.ObjectId, ref: 'GuestProfile' },
  // Reservation details (gap-map item 14).
  teens:             { type: Number, min: 0, max: 20, default: 0 },
  infants:           { type: Number, min: 0, max: 10, default: 0 },
  coordinator:       { type: Schema.Types.ObjectId, ref: 'User' },       // reservation coordinator
  salesperson:       { type: Schema.Types.ObjectId, ref: 'User' },       // account / sales owner
  flight:            { type: new Schema({ arrivalNo: String, arrivalTime: String, departureNo: String, departureTime: String }, { _id: false }), default: undefined },
  lateCheckout:      { type: new Schema({ time: String, byName: String, at: Date }, { _id: false }), default: undefined },
  cashierNote:       { type: String, maxlength: 300 },                  // shown on the folio screen
  hidePrice:         { type: Boolean, default: false },                 // price left out of confirmation, summary and registration card
  fixedRate:         { type: Boolean, default: false },                 // added nights keep the first night's price
  billedRoomType:    { type: Schema.Types.ObjectId, ref: 'RoomType' }, // a free upgrade: billed as this type, staying in another
  vipReason:         { type: String, maxlength: 200 },
  // Waitlist, deposit due date, payment methods, privileges, housekeeping (gap-map item 15).
  waitlist:          { type: new Schema({ priority: { type: Number, default: 3 }, note: String, promotedTo: { type: Schema.Types.ObjectId, ref: 'Reservation' }, byName: String, at: Date }, { _id: false }), default: undefined },
  depositDue:        { type: new Schema({ amount: Number, dueDate: String, remindedAt: Date, note: String, byName: String }, { _id: false }), default: undefined },
  paymentMethods:    { type: [new Schema({ method: { type: String, enum: ['credit_card', 'cash', 'company', 'voucher', 'bank_transfer'] }, covers: { type: String, enum: ['all', 'room', 'extras'], default: 'all' }, limit: Number, rule: { type: String, enum: ['none', 'authorization', 'manager', 'voucher_number'], default: 'none' }, ref: String, company: { type: Schema.Types.ObjectId, ref: 'Company' } }, { _id: false })], default: [] },
  privileges:        { type: new Schema({ preArrivalCharges: Boolean, postStayCharges: Boolean, selfCheckout: Boolean }, { _id: false }), default: undefined },
  housekeeping:      { type: new Schema({ turndown: Boolean, turndownTime: String, cleaningEvery: Number, linenEvery: Number, note: String }, { _id: false }), default: undefined },
  // Special services (gap-map item 13/14): from the hotel's list, added by hand or automatically for a VIP level.
  specialServices:   { type: [new Schema({ code: String, label: String, source: { type: String, enum: ['vip', 'manual'], default: 'manual' }, byName: String, at: Date }, { _id: false })], default: [] },
  // Commission % for this reservation only (a group agreed a different rate) — beats plan and agent.
  commissionPct:     { type: Number, min: 0, max: 100 },
  // Package components added to this reservation by hand (gap-map item 10) — on top of the plan's.
  packageItems:      { type: [new Schema({ component: { type: Schema.Types.ObjectId, ref: 'PackageComponent', required: true }, qty: { type: Number, default: 1, min: 1, max: 50 }, from: String, to: String, byName: String, at: Date }, { _id: true })], default: [] },
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
  // Deleted (entered by mistake): kept for the audit trail, out of every list and statistic.
  deletion: { at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, reason: String, note: String },
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
