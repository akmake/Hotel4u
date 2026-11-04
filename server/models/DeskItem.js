// Front-desk communication (gap-map item 4). One collection for the desk's small records, by kind:
//  message  — a message left FOR a guest (who left it, phone, text) until delivered;
//  alert    — a pop-up on the reservation at check-in / check-out / every opening;
//  trace    — an internal task for a department over a date range, marked resolved;
//  wakeup   — a wake-up call for one date + time (a range = one record per day), done / no answer;
//  locator  — where the guest is and until when (for the operator);
//  logbook  — a shift-handover note between desk clerks (not about one guest).
// PhoneBookEntry — the desk's phone book (car hire, restaurants, transport, emergency).
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const DESK_KINDS = ['message', 'alert', 'trace', 'wakeup', 'locator', 'logbook'];

const DeskItemSchema = new Schema({
  property:     { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  kind:         { type: String, enum: DESK_KINDS, required: true },
  reservation:  { type: Schema.Types.ObjectId, ref: 'Reservation' },
  roomNumber:   String,                                   // snapshot at creation
  guestName:    String,
  text:         { type: String, required: true },
  status:       { type: String, enum: ['open', 'done', 'no_answer', 'cancelled'], default: 'open' },
  // message
  from:         String,
  fromPhone:    String,
  deliveredHow: { type: String, enum: ['verbal', 'printed', 'phone'] },
  // alert
  on:           [{ type: String, enum: ['check_in', 'check_out', 'open'] }],
  // trace
  department:   String,
  fromDate:     String,                                   // YYYY-MM-DD
  toDate:       String,
  // wakeup
  date:         String,                                   // YYYY-MM-DD
  time:         String,                                   // HH:MM
  series:       String,                                   // shared by the days of one request
  // locator
  until:        Date,
  // logbook
  important:    Boolean,
  readBy:       [{ _id: false, user: Schema.Types.ObjectId, name: String, at: Date }],
  // who / when
  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: String,
  closedAt:      Date,
  closedByName:  String,
  closeNote:     String,
}, { timestamps: true });
DeskItemSchema.index({ property: 1, kind: 1, status: 1 });
DeskItemSchema.index({ property: 1, reservation: 1 });
DeskItemSchema.index({ property: 1, kind: 1, date: 1 });

export const DeskItem = model('DeskItem', DeskItemSchema);

const PhoneBookSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  category: { type: String, required: true },
  name:     { type: String, required: true },
  phone:    String,
  website:  String,
  note:     String,
  updatedByName: String,
}, { timestamps: true });
PhoneBookSchema.index({ property: 1, category: 1, name: 1 });
export const PhoneBookEntry = model('PhoneBookEntry', PhoneBookSchema);

export default DeskItem;
