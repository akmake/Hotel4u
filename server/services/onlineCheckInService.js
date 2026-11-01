// Pre-arrival online check-in (guest link) and paid extras ("upsells").
//
// Guest side (no login): the link token is the only handle. The guest confirms details, gives the
// ID document, expected arrival time, requests and signature, and may ask for extras. That becomes
// a registration card with idVerified=false — the desk still sees the document at arrival (FD-05),
// but the wizard finds the details ready ("···1234") instead of typing them.
// Desk side: extras are requests until approved; an approved extra is charged to the guest folio
// when the stay is in house (immediately, or automatically at check-in). Nothing is charged online.
import crypto from 'crypto';
import mongoose from 'mongoose';
import OnlineCheckIn from '../models/OnlineCheckIn.js';
import Reservation from '../models/Reservation.js';
import Property from '../models/Property.js';
import GuestProfile from '../models/GuestProfile.js';
import GuestRegistrationCard from '../models/GuestRegistrationCard.js';
import ChargeCode from '../models/ChargeCode.js';
import { audit } from './auditService.js';
import { seal, open as openSealed } from '../utils/secretBox.js';
import { sendEmail, buildOnlineCheckInEmail } from './emailService.js';
import { httpError, policyOf, businessDateOf, loadReservationInScope, IN_HOUSE_STATUSES } from './frontDeskService.js';

const ARRIVING_STATUSES = ['confirmed', 'modified', 'pending_payment', 'partially_checked_in'];
const OPEN_STATUSES = [...ARRIVING_STATUSES, ...IN_HOUSE_STATUSES];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ['early_checkin', 'late_checkout', 'extra'];

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const clientBase = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Starting point shown to the admin before the hotel saved its own list; inactive, so guests see
// no extra until the hotel confirms the prices.
const SUGGESTED = [
  { key: 'early', kind: 'early_checkin', label: 'כניסה מוקדמת', description: 'החדר מוכן לכם כבר בשעות הבוקר', price: 150, chargeCode: 'other', time: '12:00', active: false },
  { key: 'late', kind: 'late_checkout', label: 'יציאה מאוחרת', description: 'נשארים בחדר עד אחר הצהריים', price: 150, chargeCode: 'late_checkout', time: '14:00', active: false },
];

function offersOf(property) {
  const oc = property?.onlineCheckIn || {};
  return oc.configured ? (oc.offers || []) : SUGGESTED;
}

// ── Settings (hotel setup) ──────────────────────────────────────────────────
export async function getCheckInSettings({ propertyId }) {
  const p = await Property.findById(propertyId).select('onlineCheckIn').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  const oc = p.onlineCheckIn || {};
  const codes = await ChargeCode.find({ property: propertyId, kind: 'charge', active: { $ne: false }, postLevel: { $ne: 'system' } }).select('code name').sort({ code: 1 }).lean();
  return {
    enabled: oc.enabled !== false,
    autoSend: oc.autoSend !== false,
    configured: !!oc.configured,
    offers: offersOf(p).map((o) => ({ key: o.key, kind: o.kind, label: o.label, description: o.description || '', price: o.price, chargeCode: o.chargeCode, time: o.time || '', active: o.active !== false })),
    chargeCodes: codes.map((c) => ({ code: c.code, name: c.name })),
    updatedByName: oc.updatedByName || null,
    updatedAt: oc.updatedAt || null,
  };
}

export async function saveCheckInSettings({ propertyId, input, actor, ip }) {
  const codes = new Set((await ChargeCode.find({ property: propertyId, kind: 'charge', active: { $ne: false }, postLevel: { $ne: 'system' } }).select('code').lean()).map((c) => c.code));
  const list = Array.isArray(input.offers) ? input.offers.slice(0, 20) : [];
  const fields = {};
  const seen = new Set();
  const offers = list.map((o, i) => {
    const key = clip(o.key, 30).replace(/[^\w-]/g, '') || `x${i + 1}`;
    if (seen.has(key)) fields[`offers.${i}.key`] = 'מזהה כפול';
    seen.add(key);
    const kind = KINDS.includes(o.kind) ? o.kind : 'extra';
    const label = clip(o.label, 80);
    const price = round2(o.price);
    if (!label) fields[`offers.${i}.label`] = 'שם נדרש';
    if (!(price >= 0) || Number.isNaN(price)) fields[`offers.${i}.price`] = 'מחיר לא תקין';
    if (!codes.has(o.chargeCode)) fields[`offers.${i}.chargeCode`] = 'קוד חיוב לא קיים';
    const time = clip(o.time, 5);
    if (kind !== 'extra' && !HHMM.test(time)) fields[`offers.${i}.time`] = 'שעה בפורמט HH:MM';
    return { key, kind, label, description: clip(o.description, 300), price, chargeCode: o.chargeCode, time: kind === 'extra' ? undefined : time, active: o.active !== false };
  });
  if (Object.keys(fields).length) throw httpError('יש לתקן את ההגדרות', 422, { fields });
  const set = { enabled: input.enabled !== false, autoSend: input.autoSend !== false, offers, configured: true, updatedByName: actor.name, updatedAt: new Date() };
  await Property.updateOne({ _id: propertyId }, { $set: { onlineCheckIn: set } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.online_checkin', entityType: 'Property', entityId: propertyId, after: { enabled: set.enabled, autoSend: set.autoSend, offers: offers.map((o) => `${o.key}:${o.price}:${o.active}`) }, ip });
  return getCheckInSettings({ propertyId });
}

// ── Link ────────────────────────────────────────────────────────────────────
// Returns the reservation's link, creating it on first use; every send repeats the same link so an
// earlier message keeps working. `via` is how it reaches the guest.
export async function issueLink({ propertyId, reservationId, actor, via = 'link', ip }) {
  const property = await Property.findById(propertyId).select('name onlineCheckIn').lean();
  if (property?.onlineCheckIn?.enabled === false) throw httpError('צ\'ק-אין מקוון כבוי בהגדרות המלון', 409);
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!ARRIVING_STATUSES.includes(res.status)) throw httpError('קישור צ\'ק-אין נשלח רק להזמנה שטרם נכנסה', 409);
  const current = await OnlineCheckIn.findOne({ reservation: res._id }).select('tokenSealed tokenHash').lean();
  let token = null;
  try { token = current?.tokenSealed ? openSealed(current.tokenSealed) : null; } catch { token = null; }
  if (!token || hash(token) !== current?.tokenHash) token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(`${res.departureDate}T23:59:59Z`);
  const doc = await OnlineCheckIn.findOneAndUpdate(
    { reservation: res._id },
    {
      $set: { property: res.property, tokenHash: hash(token), tokenSealed: seal(token), expiresAt, sentAt: new Date(), sentByName: actor?.name || 'system' },
      $addToSet: { sentVia: via },
      $setOnInsert: { status: 'sent' },
    },
    { upsert: true, new: true },
  );
  const path = `/checkin/${token}`;
  const url = `${clientBase()}${path}`;
  let email = { sent: false, reason: null };
  if (via === 'email' || via === 'reminder') {
    const g = res.primaryGuest || {};
    const to = g.email || g.emails?.[0]?.address;
    if (!to) email.reason = 'לאורח אין כתובת דוא״ל';
    else {
      const msg = buildOnlineCheckInEmail({ guestName: `${g.firstName || ''} ${g.lastName || ''}`.trim(), confirmationNumber: res.confirmationNumber, arrivalDate: res.arrivalDate, propertyName: property?.name, url });
      const out = await sendEmail({ to, ...msg }).catch(() => null);
      email = out ? { sent: true, reason: null } : { sent: false, reason: 'שרת הדוא״ל לא מוגדר או דחה את ההודעה' };
    }
  }
  await audit({ property: res.property, actor: actor?.id || null, actorName: actor?.name || 'system', action: 'online_checkin.link_issued', entityType: 'Reservation', entityId: res._id, after: { via, emailed: email.sent, onlineCheckIn: String(doc._id) }, ip }).catch(() => null);
  return { path, url, email, status: doc.status };
}

async function loadByToken(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) throw httpError('הקישור אינו תקין', 404, { code: 'bad_link' });
  const doc = await OnlineCheckIn.findOne({ tokenHash: hash(token) });
  if (!doc) throw httpError('הקישור אינו תקף — ייתכן שנשלח קישור חדש יותר', 404, { code: 'bad_link' });
  if (doc.expiresAt < new Date()) throw httpError('תוקף הקישור פג', 410, { code: 'expired' });
  const res = await Reservation.findOne({ _id: doc.reservation, property: doc.property })
    .populate({ path: 'primaryGuest', select: 'firstName lastName email phone citizenship country dateOfBirth marketingConsent' })
    .populate({ path: 'roomType', select: 'name images view' });
  if (!res) throw httpError('ההזמנה לא נמצאה', 404, { code: 'bad_link' });
  const property = await Property.findById(doc.property).select('name phone email address city checkInTime checkOutTime timezone dayClose checkInPolicy onlineCheckIn').lean();
  if (property?.onlineCheckIn?.enabled === false) throw httpError('צ\'ק-אין מקוון אינו זמין כרגע', 409, { code: 'off' });
  return { doc, res, property };
}

function upsellDto(u) {
  return { key: u.key, kind: u.kind, label: u.label, price: u.price, time: u.time || null, status: u.status, declineReason: u.declineReason || null };
}

// Extras that still make sense for this stay (no early check-in once the guest is in).
function availableOffers(property, res) {
  const inHouse = IN_HOUSE_STATUSES.includes(res.status);
  return offersOf(property).filter((o) => o.active !== false && !(o.kind === 'early_checkin' && inHouse));
}

// ── Guest view / submit ─────────────────────────────────────────────────────
export async function guestView({ token }) {
  const { doc, res, property } = await loadByToken(token);
  if (!doc.openedAt) { doc.openedAt = new Date(); if (doc.status === 'sent') doc.status = 'opened'; await doc.save(); }
  const g = res.primaryGuest || {};
  const policy = policyOf(property);
  const card = doc.registrationCard ? await GuestRegistrationCard.findById(doc.registrationCard).select('dateOfBirth nationality idDocType idDocNumber idDocExpiry').lean() : null;
  const nat = /^[A-Za-z]{2}$/.test(g.citizenship || '') ? g.citizenship.toUpperCase() : /^[A-Za-z]{2}$/.test(g.country || '') ? g.country.toUpperCase() : null;
  return {
    hotel: { name: property.name, phone: property.phone || null, email: property.email || null, address: [property.address, property.city].filter(Boolean).join(', ') || null, checkInTime: property.checkInTime || null, checkOutTime: property.checkOutTime || null },
    stay: {
      confirmationNumber: res.confirmationNumber, arrivalDate: res.arrivalDate, departureDate: res.departureDate, nights: res.nights,
      roomType: res.roomType?.name || null, adults: res.adults, children: res.children, open: OPEN_STATUSES.includes(res.status),
      // The room's own photograph (same filter as the booking site), else its view for the drawn room.
      roomImage: (res.roomType?.images || []).find((u) => /^\/(api\/)?uploads\//.test(u) || /^data:image\//.test(u)) || null,
      roomView: res.roomType?.view || null,
      checkedIn: IN_HOUSE_STATUSES.includes(res.status) && res.status !== 'partially_checked_in',
    },
    status: doc.status,
    submittedAt: doc.submittedAt || null,
    guest: {
      firstName: g.firstName || '', lastName: g.lastName || '', email: g.email || '', phone: g.phone || '',
      nationality: card?.nationality || nat || '',
      dateOfBirth: (card?.dateOfBirth || g.dateOfBirth) ? new Date(card?.dateOfBirth || g.dateOfBirth).toISOString().slice(0, 10) : '',
      idDocType: card?.idDocType || 'id_card',
      idDocLast4: card?.idDocNumber ? String(card.idDocNumber).replace(/\s+/g, '').slice(-4) : null,
      idDocExpiry: card?.idDocExpiry ? new Date(card.idDocExpiry).toISOString().slice(0, 10) : '',
      marketingConsent: !!g.marketingConsent,
    },
    eta: doc.eta || res.eta || '',
    requests: doc.requests || '',
    terms: { text: policy.termsText || '', version: policy.termsVersion, requireSignature: policy.requireSignature },
    offers: availableOffers(property, res).map((o) => ({ key: o.key, kind: o.kind, label: o.label, description: o.description || '', price: o.price, time: o.time || null, currency: res.currency || 'ILS' })),
    upsells: doc.upsells.filter((u) => u.status !== 'cancelled').map(upsellDto),
  };
}

export async function guestSubmit({ token, input, ip }) {
  const { doc, res, property } = await loadByToken(token);
  if (!OPEN_STATUSES.includes(res.status)) throw httpError('ההזמנה אינה פתוחה לעדכון', 409);
  const policy = policyOf(property);
  const today = businessDateOf(property);
  const errors = {};
  const firstName = clip(input.firstName, 200);
  const lastName = clip(input.lastName, 200);
  if (!firstName) errors.firstName = 'שם פרטי נדרש';
  if (!lastName) errors.lastName = 'שם משפחה נדרש';
  const email = clip(input.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'כתובת לא תקינה';
  const phone = clip(input.phone, 30);
  if (!input.dateOfBirth || Number.isNaN(Date.parse(input.dateOfBirth))) errors.dateOfBirth = 'תאריך לידה נדרש';
  else if (Date.parse(input.dateOfBirth) > Date.now() || Date.parse(input.dateOfBirth) < Date.parse('1900-01-01')) errors.dateOfBirth = 'תאריך לידה לא סביר';
  if (!/^[A-Za-z]{2}$/.test(String(input.nationality || ''))) errors.nationality = 'יש לבחור אזרחות';
  if (!['passport', 'id_card', 'drivers_license', 'other'].includes(input.idDocType)) errors.idDocType = 'יש לבחור סוג מסמך';
  // A guest who already sent a document may keep it (only the last digits are shown back).
  const previous = doc.registrationCard ? await GuestRegistrationCard.findById(doc.registrationCard).select('idDocNumber idDocType idDocExpiry').lean() : null;
  let idDocNumber = clip(input.idDocNumber, 40).replace(/\s+/g, '');
  if (!idDocNumber && input.keepDoc === true && previous?.idDocNumber) idDocNumber = previous.idDocNumber;
  if (!idDocNumber) errors.idDocNumber = 'מספר מסמך נדרש';
  else if (!/^[A-Za-z0-9-]{4,40}$/.test(idDocNumber)) errors.idDocNumber = 'מספר מסמך לא תקין';
  let idDocExpiry = input.idDocExpiry || (input.keepDoc === true && previous?.idDocExpiry ? new Date(previous.idDocExpiry).toISOString().slice(0, 10) : '');
  if (idDocExpiry) {
    if (Number.isNaN(Date.parse(idDocExpiry))) errors.idDocExpiry = 'תאריך לא תקין';
    else if (Date.parse(idDocExpiry) < Date.parse(today)) errors.idDocExpiry = 'תוקף המסמך פג';
  } else if (input.idDocType === 'passport') errors.idDocExpiry = 'יש להזין תוקף דרכון';
  const eta = clip(input.eta, 5);
  if (eta && !HHMM.test(eta)) errors.eta = 'שעה לא תקינה';
  let signature = null;
  if (input.signature) {
    const m = typeof input.signature === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.signature) : null;
    const bytes = m ? Buffer.from(m[1], 'base64') : null;
    if (!bytes || bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47 || input.signature.length > 400_000) errors.signature = 'החתימה אינה תקינה — נסו לחתום שוב';
    else signature = input.signature;
  }
  if (policy.requireSignature && !signature && !errors.signature) errors.signature = 'נדרשת חתימה';
  if (policy.termsText && input.acceptTerms !== true) errors.acceptTerms = 'יש לאשר את תנאי האירוח';
  const offers = availableOffers(property, res);
  const wanted = Array.isArray(input.upsells) ? [...new Set(input.upsells.map(String))] : [];
  const unknown = wanted.filter((k) => !offers.some((o) => o.key === k));
  if (unknown.length) errors.upsells = 'אחת התוספות כבר אינה זמינה — רעננו את הדף';
  if (Object.keys(errors).length) throw httpError('יש לתקן כמה פרטים', 422, { fields: errors });

  const guestId = res.primaryGuest?._id;
  const priorCards = await GuestRegistrationCard.find({ reservation: res._id, guest: guestId, supersededBy: { $exists: false } }).select('_id idVerified').lean();
  // The desk's verified card is the record of truth; the guest's update only replaces an unverified one.
  const deskVerified = priorCards.some((c) => c.idVerified);
  let cardId = doc.registrationCard || null;
  if (!deskVerified) {
    const card = await GuestRegistrationCard.create({
      property: res.property, reservation: res._id, guest: guestId,
      firstName, lastName, dateOfBirth: new Date(input.dateOfBirth), nationality: String(input.nationality).toUpperCase(),
      idDocType: input.idDocType, idDocNumber, idDocExpiry: idDocExpiry ? new Date(idDocExpiry) : undefined,
      arrivalDate: res.arrivalDate, departureDate: res.departureDate,
      status: signature && policy.termsText ? 'signed' : 'pending',
      signatureUrl: signature || undefined,
      signatureHash: signature ? crypto.createHash('sha256').update(signature).digest('hex') : undefined,
      signedAt: signature ? new Date() : undefined,
      idVerified: false,
      termsVersion: policy.termsVersion,
      digitalDocConsent: input.digitalDocConsent === true,
      ipAddress: ip,
    });
    if (priorCards.length) await GuestRegistrationCard.updateMany({ _id: { $in: priorCards.map((c) => c._id) } }, { $set: { supersededBy: card._id, supersededAt: new Date() } });
    cardId = card._id;
  }

  // Contact details fill gaps only — the desk's data is not overwritten from a link.
  const g = await GuestProfile.findById(guestId);
  if (g) {
    if (email && !g.email) g.email = email;
    if (phone && !g.phone) g.phone = phone;
    if (!g.dateOfBirth) g.dateOfBirth = new Date(input.dateOfBirth);
    if (!g.citizenship) g.citizenship = String(input.nationality).toUpperCase();
    if (input.marketingConsent === true && !g.marketingConsent) {
      g.marketingConsent = true; g.marketingConsentAt = new Date(); g.marketingConsentIp = ip; g.marketingConsentFormVer = 'online_checkin_marketing:v1';
    }
    await g.save().catch(() => null);
  }

  const requests = clip(input.requests, 1000);
  const resSet = {};
  if (eta) resSet.eta = eta;
  if (requests && requests !== doc.requests) {
    resSet.guestNotes = [res.guestNotes, `צ'ק-אין מקוון: ${requests}`].filter(Boolean).join('\n').slice(0, 2000);
  }
  if (Object.keys(resSet).length) await Reservation.updateOne({ _id: res._id }, { $set: resSet });

  // Extras: new picks are requested; an untouched request the guest unticked is withdrawn.
  // Anything the desk already decided stays as decided.
  for (const u of doc.upsells) {
    if (u.status === 'requested' && !wanted.includes(u.key)) u.status = 'cancelled';
  }
  for (const key of wanted) {
    const live = doc.upsells.find((u) => u.key === key && u.status !== 'cancelled' && u.status !== 'declined');
    if (live) continue;
    const o = offers.find((x) => x.key === key);
    doc.upsells.push({ key: o.key, kind: o.kind, label: o.label, price: o.price, chargeCode: o.chargeCode, time: o.time || undefined, status: 'requested' });
  }
  doc.status = 'submitted';
  doc.submittedAt = new Date();
  doc.submitIp = ip;
  doc.eta = eta || doc.eta;
  doc.requests = requests || doc.requests;
  doc.registrationCard = cardId || undefined;
  await doc.save();

  await audit({
    property: res.property, actor: null, actorName: 'אורח (צ\'ק-אין מקוון)', action: 'online_checkin.submitted', entityType: 'Reservation', entityId: res._id,
    after: { idDocType: input.idDocType, signed: !!signature, eta: eta || null, upsells: doc.upsells.filter((u) => u.status === 'requested').map((u) => u.key), keptDeskCard: deskVerified },
    ip,
  }).catch(() => null);
  // New requests may need a prep task for the room.
  import('./prepTaskService.js').then((m) => m.syncPrepTasks({ propertyId: String(res.property), date: res.arrivalDate, reservationId: res._id })).catch(() => null);
  return guestView({ token });
}

// ── Desk ────────────────────────────────────────────────────────────────────
export function deskSummary(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id), status: doc.status, sentAt: doc.sentAt || null, openedAt: doc.openedAt || null, submittedAt: doc.submittedAt || null,
    eta: doc.eta || null, requests: doc.requests || null,
    upsells: (doc.upsells || []).filter((u) => u.status !== 'cancelled').map((u) => ({ ...upsellDto(u), id: String(u._id), decidedByName: u.decidedByName || null, postedAt: u.postedAt || null })),
  };
}

export async function deskView({ propertyId, reservationId }) {
  const res = await loadReservationInScope(reservationId, propertyId);
  const doc = await OnlineCheckIn.findOne({ reservation: res._id }).lean();
  return { reservationId: String(res._id), confirmationNumber: res.confirmationNumber, reservationStatus: res.status, online: deskSummary(doc) };
}

async function postUpsell({ propertyId, res, u, actor, ip }) {
  const { postServiceCharge } = await import('./departureService.js');
  const out = await postServiceCharge({
    propertyId, reservationId: String(res._id), actor, ip,
    input: { department: u.chargeCode, amount: u.price, description: `${u.label} (הוזמן בצ'ק-אין מקוון)`, idempotencyKey: `oci-${u._id}` },
  });
  u.status = 'posted'; u.folioId = out.folioId; u.lineId = out.lineId; u.postedAt = new Date();
}

export async function decideUpsell({ propertyId, reservationId, upsellId, decision, reason, actor, ip }) {
  if (!['approve', 'decline'].includes(decision)) throw httpError('החלטה לא מוכרת', 400);
  if (!mongoose.isValidObjectId(String(upsellId || ''))) throw httpError('מזהה תוספת לא תקין', 400);
  const res = await loadReservationInScope(reservationId, propertyId);
  const doc = await OnlineCheckIn.findOne({ reservation: res._id });
  const u = doc?.upsells.id(upsellId);
  if (!u) throw httpError('הבקשה לא נמצאה', 404);
  if (u.status !== 'requested') throw httpError('הבקשה כבר טופלה', 409);
  u.decidedAt = new Date();
  u.decidedByName = actor.name;
  if (decision === 'decline') {
    u.status = 'declined';
    u.declineReason = clip(reason, 200) || undefined;
  } else {
    u.status = 'approved';
    // Approved times become the stay's expected times, so housekeeping and departures plan by them.
    const set = {};
    if (u.kind === 'early_checkin' && u.time && (!res.eta || res.eta > u.time)) set.eta = u.time;
    if (u.kind === 'late_checkout' && u.time) set.etd = u.time;
    if (IN_HOUSE_STATUSES.includes(res.status)) await postUpsell({ propertyId, res, u, actor, ip });
    if (Object.keys(set).length) await Reservation.updateOne({ _id: res._id }, { $set: set });
  }
  await doc.save();
  await audit({ property: res.property, actor: actor.id, actorName: actor.name, action: `online_checkin.upsell_${decision === 'approve' ? 'approved' : 'declined'}`, entityType: 'Reservation', entityId: res._id, after: { key: u.key, price: u.price, status: u.status }, reason: u.declineReason, ip });
  return deskSummary(doc);
}

// Called after a successful check-in: approved extras land on the guest folio.
export async function postApprovedUpsells({ propertyId, reservationId, actor, ip }) {
  const doc = await OnlineCheckIn.findOne({ reservation: reservationId });
  if (!doc?.upsells.some((u) => u.status === 'approved')) return { posted: 0 };
  const res = await loadReservationInScope(reservationId, propertyId);
  if (!IN_HOUSE_STATUSES.includes(res.status)) return { posted: 0 };
  let posted = 0;
  for (const u of doc.upsells.filter((x) => x.status === 'approved')) {
    try { await postUpsell({ propertyId, res, u, actor, ip }); posted += 1; } catch (err) { console.error('[online-checkin] post upsell failed', err.message); }
  }
  await doc.save();
  return { posted };
}
