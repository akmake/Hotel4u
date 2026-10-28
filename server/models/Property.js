import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// מדיניות ביטול מובנית — חוק הגנת הצרכן + תקנות שירותי תיירות
// כל מדיניות מכילה: תיאור ברור (בעברית + אנגלית), סוג עמלה, וחלון ביטול חינם
const CancellationPolicySchema = new Schema({
  code:                { type: String, required: true },
  name:                { type: String, required: true },        // למשל: "ביטול חופשי עד 48 שעות"
  nameEn:              { type: String },
  freeUntilHours:      { type: Number, default: 24 },           // שעות לפני הגעה שבהן ביטול חינם
  feeType:             {
    type: String,
    enum: ['none', 'first_night', 'percent', 'fixed'],
    default: 'first_night',
  },
  feePercent:          { type: Number, default: 0, min: 0, max: 100 },
  feeFixedAmount:      { type: Number, default: 0, min: 0 },
  nonRefundable:       { type: Boolean, default: false },        // לא ניתן להחזר כלל
  descriptionHe:       { type: String },                         // טקסט המוצג לאורח — עברית
  descriptionEn:       { type: String },                         // טקסט המוצג לאורח — אנגלית
  active:              { type: Boolean, default: true },
}, { _id: true });

const BuildingSchema = new Schema({
  code: String,
  name: { type: String, required: true },
  active: { type: Boolean, default: true },
  floors: [{
    number: { type: Number, required: true },
    name: String,
    active: { type: Boolean, default: true },
    wings: [{
      code: String,
      name: { type: String, required: true },
      active: { type: Boolean, default: true },
    }],
  }],
}, { _id: true });

const HousekeepingZoneSchema = new Schema({
  code: String,
  name: { type: String, required: true },
  roomNumbers: [String],
  active: { type: Boolean, default: true },
}, { _id: true });

const PublicAreaSchema = new Schema({
  code: String,
  name: { type: String, required: true },
  maintenanceCategory: String,
  active: { type: Boolean, default: true },
}, { _id: true });

const TaxSchema = new Schema({
  code: String,
  name: { type: String, required: true },
  ratePct: { type: Number, required: true, min: 0 },
  inclusive: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { _id: true });

const SurchargeSchema = new Schema({
  code: String,
  name: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  mode: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
  appliesTo: { type: String, enum: ['reservation', 'night', 'guest', 'room'], default: 'reservation' },
  active: { type: Boolean, default: true },
}, { _id: true });

const PaymentMethodSchema = new Schema({
  code: String,
  name: { type: String, required: true },
  type: { type: String, enum: ['cash', 'card', 'bank_transfer', 'voucher', 'other'], default: 'other' },
  requiresReference: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { _id: true });

const MessageTemplateSchema = new Schema({
  channel: { type: String, enum: ['email', 'sms', 'whatsapp'], required: true },
  event: { type: String, required: true },
  subject: String,
  body: { type: String, required: true },
  active: { type: Boolean, default: true },
}, { _id: true });

const DocumentTemplateSchema = new Schema({
  type: { type: String, enum: ['invoice', 'receipt', 'folio', 'registration_card', 'confirmation'], required: true },
  name: { type: String, required: true },
  content: String,
  active: { type: Boolean, default: true },
}, { _id: true });

const CrmSlaSchema = new Schema({
  leadStaleDays: { type: Number, default: 7, min: 1 },
  leadDueGraceHours: { type: Number, default: 0, min: 0 },
  leadHighScoreThreshold: { type: Number, default: 65, min: 0, max: 100 },
  leadHighScoreUnassignedEscalationHours: { type: Number, default: 24, min: 0 },
  leadAttentionScoreThreshold: { type: Number, default: 85, min: 0 },
  oppAtRiskInactiveDays: { type: Number, default: 14, min: 1 },
  oppStalledInactiveDays: { type: Number, default: 30, min: 1 },
  oppOverdueCloseEscalationDays: { type: Number, default: 0, min: 0 },
  oppAttentionScoreThreshold: { type: Number, default: 24, min: 0 },
}, { _id: false });

const PropertySchema = new Schema({
  legalEntity:      { type: Schema.Types.ObjectId, ref: 'LegalEntity' },
  name:             { type: String, required: true },
  propertyCode:     String,
  legalName:        String,
  timezone:         { type: String, default: 'Asia/Jerusalem' },
  defaultCurrency:  { type: String, default: 'ILS' },
  address:          String,
  city:             String,
  state:            String,
  postalCode:       String,
  country:          { type: String, default: 'IL' },
  phone:            String,
  email:            String,
  website:          String,
  logoUrl:          String,
  activeLanguages:  { type: [String], default: ['he', 'en'] },
  checkInTime:      { type: String, default: '15:00' },
  checkOutTime:     { type: String, default: '11:00' },
  totalRooms:       { type: Number, default: 0 },

  // Tax and billing
  taxNumber:        String,
  vatRate:          { type: Number, default: 17 },
  invoicePrefix:    { type: String, default: 'INV' },
  invoiceSequence:  { type: Number, default: 1000 },
  // One running series per document type (FIN-06): the last number issued in each.
  docSequences: {
    tax_invoice:         { type: Number, default: 0 },
    tax_invoice_receipt: { type: Number, default: 0 },
    receipt:             { type: Number, default: 0 },
    proforma:            { type: Number, default: 0 },
    credit_note:         { type: Number, default: 0 },
    debit_note:          { type: Number, default: 0 },
  },
  // FIN-10 / FIN-11: fiscal set-up of the issuing business.
  fiscal: {
    softwareRegNumber: String,                 // Tax Authority software registration certificate (8 digits), once registered
    allocationMode:    { type: String, enum: ['manual', 'api'], default: 'manual' },
    operatorId:        String,                 // ID number of the person the allocation token is registered to (user_id)
    ita: {                                     // OAuth connection to the Tax Authority (tokens sealed with utils/secretBox)
      connected:       { type: Boolean, default: false },
      env:             { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
      accessToken:     String,
      refreshToken:    String,
      expiresAt:       Date,
      connectedAt:     Date,
      connectedBy:     String,
      lastError:       String,
      lastErrorAt:     Date,
    },
    emailFrom:         String,                 // reply-to for documents sent to guests
  },
  reservationPrefix:{ type: String, default: 'RES' },
  reservationSequence: { type: Number, default: 1000 },

  // Policies
  defaultCancellationHours: { type: Number, default: 24 },
  defaultCancellationFee:   { type: String, default: 'first_night' },
  cancellationPolicies:     { type: [CancellationPolicySchema], default: [] }, // מדיניות ביטול מובנית
  defaultDepositPolicy:     String,
  petPolicy:        { type: String, enum: ['not_allowed', 'on_request', 'allowed'], default: 'not_allowed' },
  smokingPolicy:    { type: String, enum: ['non_smoking', 'designated_areas', 'allowed'], default: 'non_smoking' },
  childrenPolicy:   String,

  // מדיניות פרטיות — לפי חוק הגנת הפרטיות תשמ"א-1981
  privacyPolicyVersion:   { type: String },          // גרסה (למשל "2.1")
  privacyPolicyUrl:       { type: String },          // קישור לנוסח המלא
  privacyPolicyUpdatedAt: { type: Date },            // תאריך עדכון אחרון

  // Section 6.2
  buildings:        { type: [BuildingSchema], default: [] },
  housekeepingZones:{ type: [HousekeepingZoneSchema], default: [] },
  publicAreas:      { type: [PublicAreaSchema], default: [] },

  // Section 6.3
  taxes:            { type: [TaxSchema], default: [] },
  surcharges:       { type: [SurchargeSchema], default: [] },
  paymentMethods:   { type: [PaymentMethodSchema], default: [] },
  messageTemplates: { type: [MessageTemplateSchema], default: [] },
  documentTemplates:{ type: [DocumentTemplateSchema], default: [] },
  crmSla:           { type: CrmSlaSchema, default: () => ({}) },

  requiredGuestFields:   { type: [String], default: ['firstName', 'lastName'] },
  requiredCheckInFields: { type: [String], default: ['primaryGuest', 'assignedRoom'] },
  requiredCheckOutFields:{ type: [String], default: ['folioBalanced'] },

  // Housekeeping policy (OPS-02/04): checklists per task type and separation of duties.
  opsPolicy: {
    inspectorMustDiffer: { type: Boolean, default: true },
    checklists: {
      checkout_clean: { type: [String], default: ['מצעים הוחלפו', 'חדר רחצה נוקה וחוטא', 'מגבות ומוצרי אירוח הושלמו', 'רצפה נשאבה ונשטפה', 'מיניבר נבדק', 'פח אשפה רוקן'] },
      stayover:       { type: [String], default: ['מיטה סודרה', 'מגבות הוחלפו לפי בקשה', 'פח אשפה רוקן', 'מוצרי אירוח הושלמו'] },
      inspection:     { type: [String], default: ['ניקיון כללי תקין', 'אין ליקוי גלוי בציוד', 'תאורה ומיזוג פועלים', 'מוצרי אירוח מלאים'] },
    },
  },

  // Day close (FIN-12). Closing atomically advances the managed date; absent businessDate is
  // an unactivated legacy property, which retains the local-calendar fallback.
  dayClose: {
    businessDate: String,
    migrationId: { type: Schema.Types.ObjectId, ref: 'BusinessDayMigration' },
    writeVersion: { type: Number, default: 0 },
    lastClosedDate: String,                                  // YYYY-MM-DD
    lastRunId:      { type: Schema.Types.ObjectId, ref: 'DayCloseRun' },
    // Automatic close (off by default): at `time` (property local) the previous business day is closed.
    // Open arrivals follow `arrivals`; open departures always stop it and open a work item for a manager.
    auto: {
      enabled:  { type: Boolean, default: false },
      time:     { type: String, default: '03:00' },          // HH:MM local
      arrivals: { type: String, enum: ['no_show', 'keep'], default: 'keep' },
      by:       String, at: Date,
      triedOn:  String,                                      // YYYY-MM-DD of the last blocked attempt
    },
  },

  // ADM-05 policy publication: every publish bumps the version; bookings keep their own snapshot.
  policyVersion:     { type: Number, default: 0 },
  policyPublishedAt: Date,
  policyPublishedBy: String,
  // Days of rest/holidays (YYYY-MM-DD) for counting days in cancellation rules — the official
  // calendar must be loaded by the property (gate G06); Saturdays are always counted as rest.
  restDays:          { type: [String], default: [] },
  childMaxAge:       { type: Number, default: null },      // business rule of the property, not law

  // Money policy (FIN-03/04). Legal thresholds are owner decisions (gate G05) — empty = no check.
  // G2 — board (meal plan) pricing "by board": a room-only rate plus a supplement per person per
  // night for the chosen board. Rate plans that include a board are priced "by rate" (calendar).
  // How the property sells: 'rates' (choose a rate plan) or 'board' (choose a board — each board is
  // a rate plan with its own price calendar). The manager decides; the booking form shows one choice.
  pricingMode: { type: String, enum: ['rates', 'board'], default: 'rates' },
  // Public booking site (/book). Off until a manager turns it on; payment is taken at booking time
  // through the payment provider (services/paymentGateway.js) — full amount or a deposit.
  onlineBooking: {
    enabled:      { type: Boolean, default: false },
    payment:      { type: String, enum: ['full', 'deposit'], default: 'full' },
    depositPct:   { type: Number, min: 10, max: 100, default: 30 },
    holdMinutes:  { type: Number, min: 15, max: 60, default: 20 },   // stock held while the guest pays
    ratePlanCodes: { type: [String], default: [] },                  // empty = every public rate plan
    headline:     { type: String, maxlength: 120 },
    intro:        { type: String, maxlength: 600 },
    termsText:    { type: String, maxlength: 4000 },
    updatedByName: String,
    updatedAt:    Date,
  },
  boardPricing: {
    supplements: [{
      _id: false,
      board:  { type: String, enum: ['breakfast', 'half_board', 'full_board'] },
      adult:  { type: Number, min: 0 },                  // gross per adult per night
      child:  { type: Number, min: 0 },                  // gross per child per night (age ≤ childMaxAge)
      active: { type: Boolean, default: true },
    }],
    infantMaxAge: { type: Number, default: 2 },          // children up to this age eat free
    version:      { type: Number, default: 0 },
    updatedByName: String,
  },
  // EXT-04 / ADM-04 (gate G04) — tourist zero-rating rule. Off until the property's accountant
  // approves it; when on, eligible charge codes of a reservation that meets the rule post at 0% VAT.
  taxPolicy: {
    tourist: {
      enabled:       { type: Boolean, default: false },
      visaTypes:     [String],                           // accepted entry visa types (from the accountant)
      chargeCodes:   { type: [String], default: ['rooms'] }, // services zero-rated for an eligible tourist
      // net_of_vat: the tourist pays the shelf price without the VAT part (common practice);
      // same_price: the tourist pays the same amount, only booked without VAT.
      pricing:       { type: String, enum: ['net_of_vat', 'same_price'], default: 'net_of_vat' },
      legalRef:      String,                             // law / regulation the rule is based on
      approvedBy:    String,                             // accountant who approved it
      approvedAt:    Date,
      version:       { type: Number, default: 0 },
      updatedByName: String,
    },
  },
  financePolicy: {
    cashLimitPerStay:   { type: Number, default: null },     // cumulative cash per reservation
    refundApprovalOver: { type: Number, default: 0 },         // refunds above this need a manager/finance role
    postStayDays:       { type: Number, default: 30 },        // G6: days after departure a late charge may still be posted
    // G05 — cash limit rule. 'none' = no legal rule enforced (cashLimitPerStay still applies);
    // 'il_2024' = Israel cash law (directive 1/2024): up to the threshold any cash; above it the lower
    // of 10% of the transaction and the threshold; a verified tourist has the higher threshold.
    cashRule:           { type: String, enum: ['none', 'il_2024'], default: 'none' },
    cashThreshold:      { type: Number, default: 6000 },
    touristCashThreshold: { type: Number, default: 40000 },
  },

  // Front-desk check-in policy (spec FD-03 / ADM-05). Readiness is computed from these on the
  // server; the UI never decides on its own whether a unit may enter.
  checkInPolicy: {
    requireInspection:   { type: Boolean, default: false }, // only 'inspected' counts as ready (else clean|inspected)
    requireGuarantee:    { type: Boolean, default: true },  // a guarantee method must be recorded before entry
    requireRegistration: { type: Boolean, default: true },  // a signed/saved registration card for the primary guest
    requireSignature:    { type: Boolean, default: false },
    termsVersion:        { type: String, default: 'he-1' }, // version of the registration terms shown to the guest
    termsText:           { type: String, default: '' },     // approved terms text; a signature counts as signed only against it
    termsApprovedBy:     String,                             // ADM-05-F09: who approved the published text
    termsApprovedAt:     Date,
  },

  active:           { type: Boolean, default: true },
}, { timestamps: true });

export default model('Property', PropertySchema);
