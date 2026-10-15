// /api/pms/booking — availability & price (INV-03), create booking/quote (RSV-02/RSV-04),
// reservation list (RSV-01) and stay file (RSV-03). Rules live in services/bookingService.js.
import { Router } from 'express';
import { assertPropertyScope, actorOrSystem, requireRoles } from '../middleware/authContext.js';
import GuestProfile from '../models/GuestProfile.js';
import Company from '../models/Company.js';
import Property from '../models/Property.js';
import { cancelWithNotice } from '../services/stayChangeService.js';
import { audit } from '../services/auditService.js';
import {
  BOOKING_ROLES, searchAvailability, createBooking, listReservations, getStayFile,
  markQuoteSent, closeQuote, convertQuote,
} from '../services/bookingService.js';
import { createParty, freeRooms } from '../services/partyBookingService.js';
import { getBoardConfig, updateBoardConfig, BOARD_ADMIN_ROLES } from '../services/boardService.js';

const router = Router();

const READ_ROLES = [...BOOKING_ROLES, 'finance_manager', 'cashier', 'auditor', 'owner_readonly', 'housekeeping_manager'];
const CANCEL_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'receptionist', 'sales_manager'];

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safe = status >= 400 && status < 600 ? status : 500;
    if (safe >= 500) console.error('[booking]', err);
    res.status(safe).json({
      success: false,
      error: safe >= 500 ? 'שגיאת שרת — הפעולה לא הושלמה' : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.details ? { details: err.details } : {}),
      ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}),
    });
  }
};

function scope(req) {
  const propertyId = req.query.propertyId || req.body?.propertyId || req.actor?.propertyId;
  if (!propertyId) {
    const err = new Error('יש לבחור נכס');
    err.status = 400;
    throw err;
  }
  assertPropertyScope(req, propertyId);
  return String(propertyId);
}

function actorOf(req) {
  const a = actorOrSystem(req);
  return { id: a.id, name: a.name, role: a.role };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rx = (q) => new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// ── INV-03 ──────────────────────────────────────────────────────────────────
router.get('/availability', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה לבדוק זמינות ומחיר');
  return searchAvailability({ propertyId: scope(req), query: req.query });
}));

// ── RSV-02 / RSV-04 ─────────────────────────────────────────────────────────
router.post('/reservations', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה ליצור הזמנה');
  return createBooking({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// G2: board (meal plan) pricing — supplements per person and which rate plans include a board.
router.get('/board-config', handle(async (req) => {
  requireRoles(req, READ_ROLES, 'אין הרשאה');
  return getBoardConfig({ propertyId: scope(req) });
}));

router.put('/board-config', handle(async (req) => {
  requireRoles(req, BOARD_ADMIN_ROLES, 'הגדרת סוגי אירוח מותרת להנהלה, הכנסות וכספים');
  return updateBoardConfig({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

// Multi-room booking: several rooms (same or different types) in one action, linked as a party.
router.post('/party', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה ליצור הזמנה');
  return createParty({ propertyId: scope(req), input: req.body || {}, actor: actorOf(req), ip: req.ip });
}));

router.get('/free-rooms', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה');
  const q = req.query;
  return freeRooms({ propertyId: scope(req), roomTypeId: q.roomTypeId, arrival: q.arrival, departure: q.departure });
}));

// Pickers: minimal fields only (who is it, how to reach them).
router.get('/guests', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה');
  const propertyId = scope(req);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return [];
  const r = rx(q);
  const guests = await GuestProfile.find({ property: propertyId, isAnonymized: { $ne: true }, $or: [{ firstName: r }, { lastName: r }, { phone: r }, { email: r }] })
    .select('firstName lastName phone email vipLevel isBlacklisted lastStay totalStays').sort({ lastStay: -1 }).limit(12).lean();
  return guests.map((g) => ({ id: String(g._id), name: `${g.firstName} ${g.lastName}`, phone: g.phone || null, email: g.email || null, vip: (g.vipLevel || 0) > 0, blacklisted: !!g.isBlacklisted, stays: g.totalStays || 0 }));
}));

router.get('/companies', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה');
  const propertyId = scope(req);
  const filter = { property: propertyId, active: { $ne: false } };
  if (req.query.q) filter.name = rx(req.query.q);
  const list = await Company.find(filter).select('name type').sort({ name: 1 }).limit(50).lean();
  return list.map((c) => ({ id: String(c._id), name: c.name, type: c.type }));
}));

// ── RSV-01 / RSV-03 ─────────────────────────────────────────────────────────
router.get('/reservations', handle(async (req) => {
  requireRoles(req, READ_ROLES, 'אין הרשאה לרשימת ההזמנות');
  return listReservations({ propertyId: scope(req), q: req.query });
}));

router.get('/reservations/:id', handle(async (req) => {
  requireRoles(req, READ_ROLES, 'אין הרשאה לתיק ההזמנה');
  return getStayFile({ propertyId: scope(req), id: req.params.id, role: req.actor?.role });
}));

// Kept for API callers: a cancellation is always recorded as a notice (RSV-06) — same gate,
// proposal stored, no fee charged automatically.
router.post('/reservations/:id/cancel', handle(async (req) => {
  requireRoles(req, CANCEL_ROLES, 'אין הרשאה לבטל הזמנה');
  const why = String(req.body?.reason || '').trim().slice(0, 300);
  if (why.length < 3) {
    const err = new Error('ביטול מחייב סיבה');
    err.status = 422; err.fields = { reason: 'נדרש' };
    throw err;
  }
  const a = actorOf(req);
  const out = await cancelWithNotice({ propertyId: scope(req), reservationId: req.params.id, input: { channel: req.body?.channel || 'other', track: 'review', reason: 'other', note: why }, actor: a, ip: req.ip });
  return { id: out.reservationId, status: out.status };
}));

// ── RSV-04 quote lifecycle ──────────────────────────────────────────────────
router.post('/quotes/:id/sent', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה');
  return markQuoteSent({ propertyId: scope(req), id: req.params.id, channel: req.body?.channel, actor: actorOf(req), ip: req.ip });
}));

router.post('/quotes/:id/close', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה');
  return closeQuote({ propertyId: scope(req), id: req.params.id, reason: req.body?.reason, actor: actorOf(req), ip: req.ip });
}));

router.post('/quotes/:id/convert', handle(async (req) => {
  requireRoles(req, BOOKING_ROLES, 'אין הרשאה');
  return convertQuote({ propertyId: scope(req), id: req.params.id, priceSignature: req.body?.priceSignature, actor: actorOf(req), ip: req.ip });
}));

// Printable quote (RSV-04-A02 "not a tax document"). Staff send it themselves; nothing is emailed.
router.get('/quotes/:id/preview', async (req, res) => {
  try {
    requireRoles(req, BOOKING_ROLES, 'אין הרשאה');
    const propertyId = scope(req);
    const file = await getStayFile({ propertyId, id: req.params.id, role: req.actor?.role });
    if (!file.quote) return res.status(422).send('הרשומה אינה הצעת מחיר');
    const prop = await Property.findById(propertyId).select('name phone email address city').lean();
    const nightly = file.price?.snapshot?.nightly || [];
    const fmt = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: file.price?.currency || 'ILS' }).format(n || 0);
    await audit({ property: propertyId, actor: req.actor?.id, actorName: req.actor?.name, action: 'quote.previewed', entityType: 'Reservation', entityId: file.id, ip: req.ip }).catch(() => null);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>הצעת מחיר ${esc(file.confirmationNumber)}</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#111}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border-bottom:1px solid #ddd;padding:6px 4px;text-align:right}.muted{color:#666;font-size:13px}.total{font-weight:700;font-size:16px}.box{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}@media print{button{display:none}}</style></head><body>
<h1>${esc(prop?.name || '')} — הצעת מחיר</h1>
<div class="muted">${esc([prop?.address, prop?.city].filter(Boolean).join(', '))} ${esc(prop?.phone || '')} ${esc(prop?.email || '')}</div>
<div class="box"><div>מספר הצעה: <b>${esc(file.confirmationNumber)}</b> · גרסה ${esc(file.quote.version)}</div>
<div>עבור: <b>${esc(file.guest?.name || '')}</b>${file.company ? ` · ${esc(file.company.name)}` : ''}</div>
<div>תאריכים: ${esc(file.arrivalDate)} – ${esc(file.departureDate)} · ${esc(file.nights)} לילות · ${esc(file.units.length)} יחידות · ${esc(file.adults)} מבוגרים${file.children ? ` · ${esc(file.children)} ילדים` : ''}</div>
<div>סוג חדר: ${esc(file.roomType || '')} · תעריף: ${esc(file.ratePlan?.name || '')}</div></div>
<table><thead><tr><th>לילה</th><th>מחיר ליחידה</th></tr></thead><tbody>${nightly.map((n) => `<tr><td>${esc(n.date)}</td><td>${esc(fmt(n.price))}</td></tr>`).join('')}</tbody></table>
<div class="total">סה״כ: ${esc(fmt(file.price?.total))} (כולל מע״מ)</div>
<div class="box"><div><b>תוקף ההצעה:</b> ${esc(new Date(file.quote.validUntil).toLocaleString('he-IL'))}</div>
<div><b>תנאי ביטול:</b> ${esc(file.terms.cancellation || '')}</div><div><b>מקדמה:</b> ${esc(file.terms.deposit || '')}</div></div>
<p class="muted">זו הצעת מחיר ואינה הזמנה מאושרת או מסמך מס. המחיר והזמינות ייבדקו מחדש באישור ההזמנה.</p>
<button onclick="window.print()">הדפסה</button></body></html>`);
  } catch (err) {
    res.status(Number(err?.status) || 500).send(esc(err?.message || 'שגיאה'));
  }
});

export default router;
