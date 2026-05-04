import mongoose from 'mongoose';

const { Schema } = mongoose;

export const NOTIFICATION_TYPES = [
  // הזמנות
  'reservation.new',
  'reservation.modified',
  'reservation.cancelled',
  'reservation.checkin_due',    // אורח אמור להגיע עוד מעט
  'reservation.checkout_due',   // אורח אמור לצאת עוד מעט
  'reservation.no_show',
  // חדרים ואחזקה
  'housekeeping.room_dirty',
  'housekeeping.room_ready',
  'housekeeping.dnd_exceeded',  // Do-Not-Disturb ארוך מדי
  'maintenance.ticket_opened',
  'maintenance.ticket_urgent',
  'maintenance.ticket_resolved',
  // כספים
  'folio.payment_due',
  'folio.credit_limit',
  // מחסן / מכירות
  'inventory.low',
  'inventory.overbooking',
  // מערכת
  'system.alert',
  'automation.rule_triggered',
  'webhook.failed',
  'group.cutoff_approaching',
];

export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'push'];

const NotificationSchema = new Schema({
  property:    { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },

  // קהל היעד — null = broadcast לכל העובדים, user = אישי, role = לפי תפקיד
  recipientUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  recipientRole: String,   // if set, all users with this role at the property receive it

  type:        { type: String, enum: NOTIFICATION_TYPES, required: true },
  priority:    { type: String, enum: NOTIFICATION_PRIORITIES, default: 'normal' },
  channel:     { type: String, enum: NOTIFICATION_CHANNELS, default: 'in_app' },

  title:       { type: String, required: true },
  body:        { type: String, required: true },

  // קישור לישות הקשורה
  entityType:  String,   // Reservation, Room, MaintenanceTicket, etc.
  entityId:    Schema.Types.ObjectId,
  link:        String,   // optional FE route e.g. /reservations/123

  // מצב
  read:        { type: Boolean, default: false },
  readAt:      Date,
  dismissed:   { type: Boolean, default: false },

  // תפוגה
  expiresAt:   Date,

  // מי יצר (עובד/מערכת)
  createdBy:   { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

NotificationSchema.index({ property: 1, recipientUser: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ property: 1, recipientRole: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL auto-delete

export default mongoose.model('Notification', NotificationSchema);
