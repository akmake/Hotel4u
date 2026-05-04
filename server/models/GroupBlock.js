import mongoose from 'mongoose';

const { Schema } = mongoose;

export const GROUP_STATUSES = [
  'tentative',       // ראשוני, לא מאושר
  'confirmed',       // מאושר
  'active',          // בית מלון - קבוצה נמצאת
  'completed',       // סיים שהות
  'cancelled',       // בוטל
];

const AllotmentSchema = new Schema({
  roomTypeId:    { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  roomTypeName:  String,
  blocked:       { type: Number, default: 0, min: 0 },  // חדרים שנחסמו
  picked:        { type: Number, default: 0, min: 0 },  // חדרים שנרשמו
  released:      { type: Number, default: 0, min: 0 },  // חדרים שחזרו למלאי
  negotiatedRate:{ type: Number, min: 0 },              // תעריף מוסכם
}, { _id: false });

const GroupBlockSchema = new Schema({
  property:      { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },

  // פרטי הקבוצה
  name:          { type: String, required: true, trim: true },
  groupCode:     { type: String, required: true, unique: true, uppercase: true, trim: true },
  description:   String,

  // תאריכים
  arrivalDate:   { type: String, required: true },     // YYYY-MM-DD
  departureDate: { type: String, required: true },
  nights:        { type: Number, min: 1 },

  // חסימת חדרים לפי סוג
  allotments:    [AllotmentSchema],

  // קאט-אוף — תאריך אחרון לשמירת חדרים
  cutoffDate:    { type: String },                     // YYYY-MM-DD

  // קשרים
  company:       { type: Schema.Types.ObjectId, ref: 'Company' },    // חברה / סוכנות
  contactName:   String,
  contactEmail:  String,
  contactPhone:  String,

  // תנאים
  status:        { type: String, enum: GROUP_STATUSES, default: 'tentative' },
  cancellationPolicy: String,
  depositPolicy: String,
  depositAmount: { type: Number, min: 0, default: 0 },
  depositDueDate:String,

  // פרטים כספיים
  totalRoomsBlocked: { type: Number, default: 0 },
  totalRoomsPicked:  { type: Number, default: 0 },
  totalRevenue:      { type: Number, default: 0 },

  // תנאי שחרור אוטומטי
  autoReleaseOnCutoff: { type: Boolean, default: true },
  releasedAt:          Date,

  // ביטול
  cancelledAt:    Date,
  cancellationReason: String,

  // הערות
  internalNotes:  String,
  guestNotes:     String,

  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// חישוב אוטומטי של nights ו-totalRoomsBlocked לפני שמירה
GroupBlockSchema.pre('save', function (next) {
  if (this.arrivalDate && this.departureDate) {
    this.nights = Math.round(
      (new Date(this.departureDate) - new Date(this.arrivalDate)) / 86400000
    );
  }
  this.totalRoomsBlocked = (this.allotments || []).reduce((s, a) => s + a.blocked, 0);
  this.totalRoomsPicked  = (this.allotments || []).reduce((s, a) => s + a.picked,  0);
  next();
});

GroupBlockSchema.index({ property: 1, arrivalDate: 1, status: 1 });
GroupBlockSchema.index({ groupCode: 1 }, { unique: true });

export default mongoose.model('GroupBlock', GroupBlockSchema);
