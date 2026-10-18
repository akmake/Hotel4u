// Booking confirmation by e-mail (GST-04). Sent for real or not at all: the reservation is marked
// "confirmation sent" only after the mail server accepted the message, with to whom and when.
// A new booking sends it automatically when the guest has an e-mail and the server can send mail;
// the reservation file can send it again (also to another address).
import Reservation from '../models/Reservation.js';
import GuestProfile from '../models/GuestProfile.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import { sendEmail, buildReservationConfirmationEmail } from './emailService.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SENDABLE = ['confirmed', 'modified', 'hold', 'pending_payment', 'checked_in', 'in_house'];

export async function sendConfirmation({ propertyId, reservationId, to, actor, ip, automatic = false }) {
  const r = await Reservation.findOne({ _id: reservationId, property: propertyId }).lean();
  if (!r) throw httpError('ההזמנה לא נמצאה', 404);
  if (!SENDABLE.includes(r.status)) throw httpError('אישור נשלח רק להזמנה פעילה', 409);
  const [guest, property, roomType] = await Promise.all([
    GuestProfile.findById(r.primaryGuest).select('firstName lastName email emails').lean(),
    Property.findById(propertyId).select('name phone email').lean(),
    RoomType.findById(r.roomType).select('name').lean(),
  ]);
  const address = String(to || guest?.email || guest?.emails?.[0]?.address || '').trim().toLowerCase();
  if (!EMAIL_RX.test(address)) throw httpError('אין כתובת דוא״ל תקינה לאורח', 422, { fields: { to: 'דוא״ל' } });
  const mail = buildReservationConfirmationEmail({
    guestName: `${guest?.firstName || ''} ${guest?.lastName || ''}`.trim(),
    confirmationNumber: r.confirmationNumber, arrivalDate: r.arrivalDate, departureDate: r.departureDate,
    roomType: roomType?.name || '', nights: r.nights, totalAmount: r.totalAmount, currency: r.currency || 'ILS',
    propertyName: property?.name, propertyPhone: property?.phone, propertyEmail: property?.email,
  });
  const info = await sendEmail({ to: address, subject: mail.subject, html: mail.html, text: mail.text, replyTo: property?.email || undefined });
  if (!info) throw httpError('שליחת דוא״ל אינה מוגדרת בשרת (EMAIL_USER / EMAIL_PASS)', 409, { code: 'email_not_configured' });
  const at = new Date();
  await Reservation.updateOne({ _id: r._id }, { $set: { confirmationSent: true, confirmationSentAt: at, confirmationSentTo: address } });
  await audit({ property: propertyId, actor: actor?.id || null, actorName: actor?.name || 'system', action: 'reservation.confirmation_sent', entityType: 'Reservation', entityId: r._id,
    after: { to: address.replace(/(^.).*(@.*$)/, '$1***$2'), automatic }, ip }).catch(() => null);
  return { sent: true, to: address, at };
}

// After a booking is created: best effort, never blocks or fails the booking.
export function autoSendConfirmation({ propertyId, reservationId, actor, ip }) {
  sendConfirmation({ propertyId, reservationId, actor, ip, automatic: true }).catch((err) => {
    if (err.code !== 'email_not_configured' && err.status !== 422) console.error('[confirmation]', err.message);
  });
}
