// The two statements a hotel publishes to the public:
//  · accessibility — the Equal Rights for Persons with Disabilities (service accessibility) regulations
//    require publishing the hotel's accessibility arrangements, with a contact for accessibility;
//  · privacy notice — the Privacy Protection Law requires telling a person, when asking for their data,
//    whether giving it is a legal duty, what it is for and to whom it is passed.
// Both are edited in hotel setup and shown on the public site (/book/accessibility, /book/privacy) and
// linked from the online check-in. Until the hotel saves its own text, a notice built from the hotel's
// details and from what the system actually collects is shown — flagged as a default to review.
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import Room from '../models/Room.js';
import { audit } from './auditService.js';

export const ACCESS_FEATURES = [
  { code: 'parking', label: 'חניית נכים מסומנת' },
  { code: 'entrance', label: 'כניסה נגישה ללא מדרגות או עם רמפה' },
  { code: 'elevator', label: 'מעלית לכל הקומות הציבוריות' },
  { code: 'reception', label: 'דלפק קבלה מונמך' },
  { code: 'hearing_loop', label: 'עמדת עזר לשמיעה (לולאת השראה) בקבלה' },
  { code: 'rooms', label: 'חדרים נגישים לכיסא גלגלים' },
  { code: 'bathroom', label: 'מקלחת נגישה עם מושב ומאחזי יד' },
  { code: 'public_toilet', label: 'שירותים ציבוריים נגישים' },
  { code: 'dining', label: 'חדר אוכל נגיש' },
  { code: 'pool_lift', label: 'מתקן הורדה לבריכה' },
  { code: 'service_animals', label: 'כלבי שירות מתקבלים בברכה' },
  { code: 'visual_alarm', label: 'התראת חירום חזותית בחדרים הנגישים' },
  { code: 'large_print', label: 'מידע בכתב מוגדל לפי בקשה' },
  { code: 'staff_trained', label: 'צוות שהודרך במתן שירות נגיש' },
];
const FEATURE = new Map(ACCESS_FEATURES.map((f) => [f.code, f.label]));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function httpError(message, status, extra = {}) { return Object.assign(new Error(message), { status }, extra); }

// What the system collects and why — the facts the privacy notice must state.
function defaultPrivacy(p) {
  const holder = p.legalName || p.name;
  return {
    controller: holder,
    contactEmail: p.email || '',
    retention: 'פנקס האורחים ומסמכי הנהלת החשבונות נשמרים לתקופה שהדין מחייב (בדרך כלל 7 שנים). שאר המידע נשמר כל עוד הוא נחוץ למטרות שלמעלה, ונמחק בהתאם.',
    sections: [
      { title: 'מי מחזיק במידע', body: `${[holder, p.address, p.city].filter(Boolean).join(', ')}${p.taxNumber ? ` (ח.פ./ע.מ. ${p.taxNumber})` : ''}.` },
      { title: 'איזה מידע נאסף', body: 'שם, פרטי קשר (טלפון ודוא״ל), מען קבוע, תאריך לידה, אזרחות, סוג ומספר מסמך זיהוי, פרטי השהייה וההזמנה, בקשות מיוחדות, חתימה, ופרטי תשלום כפי שנמסרים לחברת הסליקה (פרטי כרטיס האשראי אינם נשמרים אצלנו).' },
      { title: 'האם חובה למסור', body: 'פרטי הזיהוי והמען נדרשים לפי דין לרישום אורחים ולניהול ספרים, ובלעדיהם לא ניתן לאשר את הכניסה למלון. מסירת דוא״ל וטלפון וההסכמה לדיוור הם לבחירתכם.' },
      { title: 'לאילו מטרות', body: 'ביצוע ההזמנה והאירוח; רישום אורחים ומילוי חובות לפי דין (מס, רשויות); הפקת חשבוניות וקבלות; בטיחות ופינוי בחירום; שירות לקוחות; ומשלוח הצעות שיווקיות — רק למי שהסכים לכך במפורש.' },
      { title: 'למי המידע מועבר', body: 'לספקים שמסייעים לנו לתת את השירות (מערכת ניהול המלון, הפקת חשבוניות, חברת הסליקה), במידה הנדרשת בלבד; ולרשויות כשהדין מחייב (למשל רשות המסים, משטרה בצו או לפי רישיון העסק). המידע אינו נמכר לאיש.' },
      { title: 'הזכויות שלכם', body: 'אפשר לעיין במידע שנשמר עליכם, לבקש לתקן אותו, ולבקש להסיר אתכם מרשימת הדיוור בכל עת — בפנייה לכתובת למטה.' },
    ],
  };
}

async function accessibleRooms(propertyId) {
  return Room.countDocuments({ property: propertyId, active: { $ne: false }, isAccessible: true });
}

export async function getLegalSettings({ propertyId }) {
  const p = await Property.findById(propertyId).select('name legalName address city email phone taxNumber accessibility privacyNotice').lean();
  if (!p) throw httpError('הנכס לא נמצא', 404);
  const a = p.accessibility || {};
  const pn = p.privacyNotice || {};
  const def = defaultPrivacy(p);
  return {
    features: ACCESS_FEATURES,
    accessibility: {
      features: a.features || [], details: a.details || '', coordinatorName: a.coordinatorName || '', coordinatorPhone: a.coordinatorPhone || '', coordinatorEmail: a.coordinatorEmail || '',
      reviewedAt: a.reviewedAt || '', configured: !!a.updatedAt, updatedByName: a.updatedByName || null, updatedAt: a.updatedAt || null,
    },
    accessibleRooms: await accessibleRooms(propertyId),
    privacy: {
      controller: pn.controller || def.controller, contactEmail: pn.contactEmail || def.contactEmail, retention: pn.retention || def.retention, extra: pn.extra || '',
      configured: !!pn.updatedAt, updatedByName: pn.updatedByName || null, updatedAt: pn.updatedAt || null,
    },
    publicPaths: { accessibility: `/book/accessibility?p=${propertyId}`, privacy: `/book/privacy?p=${propertyId}` },
  };
}

export async function saveLegalSettings({ propertyId, input, actor, ip }) {
  const fields = {};
  const a = input.accessibility || {};
  const pn = input.privacy || {};
  const features = Array.isArray(a.features) ? [...new Set(a.features.filter((c) => FEATURE.has(c)))] : [];
  const coordinatorEmail = clip(a.coordinatorEmail, 120);
  if (coordinatorEmail && !EMAIL.test(coordinatorEmail)) fields['accessibility.coordinatorEmail'] = 'כתובת לא תקינה';
  if (!clip(a.coordinatorName, 120)) fields['accessibility.coordinatorName'] = 'יש לציין רכז/ת נגישות או איש קשר';
  if (!clip(a.coordinatorPhone, 40) && !coordinatorEmail) fields['accessibility.coordinatorPhone'] = 'טלפון או דוא״ל לפניות בנושא נגישות';
  const reviewedAt = clip(a.reviewedAt, 10);
  if (reviewedAt && !/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) fields['accessibility.reviewedAt'] = 'תאריך לא תקין';
  const contactEmail = clip(pn.contactEmail, 120);
  if (!clip(pn.controller, 200)) fields['privacy.controller'] = 'שם הגוף המחזיק במידע';
  if (!EMAIL.test(contactEmail)) fields['privacy.contactEmail'] = 'דוא״ל לפניות בנושא פרטיות';
  if (Object.keys(fields).length) throw httpError('יש לתקן את הפרטים', 422, { fields });
  const now = new Date();
  const set = {
    accessibility: { features, details: clip(a.details, 3000), coordinatorName: clip(a.coordinatorName, 120), coordinatorPhone: clip(a.coordinatorPhone, 40), coordinatorEmail, reviewedAt: reviewedAt || undefined, updatedByName: actor.name, updatedAt: now },
    privacyNotice: { controller: clip(pn.controller, 200), contactEmail, retention: clip(pn.retention, 600), extra: clip(pn.extra, 3000), updatedByName: actor.name, updatedAt: now },
  };
  await Property.updateOne({ _id: propertyId }, { $set: set });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.public_statements', entityType: 'Property', entityId: propertyId, after: { features: features.length, coordinator: set.accessibility.coordinatorName, controller: set.privacyNotice.controller }, ip });
  return getLegalSettings({ propertyId });
}

// Public: both statements as the site shows them. Works even when online booking is off — the
// statements describe the hotel, not the booking site.
export async function publicStatements({ p }) {
  if (!mongoose.isValidObjectId(String(p || ''))) throw httpError('המלון לא נמצא', 404);
  const prop = await Property.findById(p).select('name legalName address city email phone taxNumber accessibility privacyNotice active').lean();
  if (!prop || prop.active === false) throw httpError('המלון לא נמצא', 404);
  const a = prop.accessibility || {};
  const pn = prop.privacyNotice || {};
  const def = defaultPrivacy(prop);
  return {
    hotel: { name: prop.name, address: [prop.address, prop.city].filter(Boolean).join(', '), phone: prop.phone || '', email: prop.email || '' },
    accessibility: {
      configured: !!a.updatedAt,
      features: (a.features || []).map((c) => FEATURE.get(c)).filter(Boolean),
      accessibleRooms: await accessibleRooms(prop._id),
      details: a.details || '',
      coordinator: { name: a.coordinatorName || '', phone: a.coordinatorPhone || prop.phone || '', email: a.coordinatorEmail || prop.email || '' },
      reviewedAt: a.reviewedAt || null,
      updatedAt: a.updatedAt || null,
    },
    privacy: {
      configured: !!pn.updatedAt,
      sections: def.sections.map((s) => (s.title === 'מי מחזיק במידע' && pn.controller ? { ...s, body: `${[pn.controller, prop.address, prop.city].filter(Boolean).join(', ')}${prop.taxNumber ? ` (ח.פ./ע.מ. ${prop.taxNumber})` : ''}.` } : s)),
      retention: pn.retention || def.retention,
      extra: pn.extra || '',
      contactEmail: pn.contactEmail || def.contactEmail,
      updatedAt: pn.updatedAt || null,
    },
  };
}
