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

  // Master folio — all group charges consolidated here
  masterFolioId: { type: Schema.Types.ObjectId, ref: 'Folio' },

  // Rooming list
  roomingList:   { type: [RoomingListEntrySchema], default: [] },

  company:       { type: Schema.Types.ObjectId, ref: 'Company' },
  contactName:   String,
  contactEmail:  String,
  contactPhone:  String,

  status:              { type: String, enum: GROUP_STATUSES, default: 'tentative' },
  cancellationPolicy:  String,
  depositPolicy:       String,
  depositAmount:       { type: Number, min: 0, default: 0 },
  depositDueDate:      String,

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

GroupBlockSchema.pre('save', function (next) {
  if (this.arrivalDate && this.departureDate) {
    this.nights = Math.round(
      (new Date(this.departureDate) - new Date(this.arrivalDate)) / 86400000
    );
  }
  this.totalRoomsBlocked = (this.allotments || []).reduce((s, a) => s + a.blocked, 0);
  this.totalRoomsPicked  = (this.allotments || []).reduce((s, a) => s + a.picked, 0);
  next();
});

GroupBlockSchema.index({ property: 1, arrivalDate: 1, status: 1 });
GroupBlockSchema.index({ groupCode: 1 }, { unique: true });

export default mongoose.model('GroupBlock', GroupBlockSchema);
