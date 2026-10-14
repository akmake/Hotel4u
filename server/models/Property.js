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

  // Day close (FIN-12). The business day is the property's local date; closing records the day,
  // posts its nights once and keeps the last closed date so days are closed in order.
  dayClose: {
    lastClosedDate: String,                                  // YYYY-MM-DD
    lastRunId:      { type: Schema.Types.ObjectId, ref: 'DayCloseRun' },
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
  financePolicy: {
    cashLimitPerStay:   { type: Number, default: null },     // cumulative cash per reservation
    refundApprovalOver: { type: Number, default: 0 },         // refunds above this need a manager/finance role
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
