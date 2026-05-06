/**
 * retentionService.js
 * שירות שמירת נתונים ומחיקה אוטומטית — 7 שנים מהשהות האחרונה
 *
 * בסיס חוקי:
 *  • פקודת מס הכנסה [נוסח חדש] — סעיף 25ג: חובת שמירת תיעוד 7 שנים
 *  • חוק מע"מ, תשל"ו-1975 — תקנה 53: שמירת חשבוניות 7 שנים
 *  • חוק הגנת הפרטיות, תשמ"א-1981 — עיקרון המידתיות
 *
 * הפונקציה runAnonymizationPass() מופעלת:
 *  1. מ-scheduler.js — אוטומטית ב-03:00 בראשון לכל חודש
 *  2. ידנית מ-route (admin only) — לצרכי בדיקה
 *
 * חשוב: הפונקציה לא מוחקת רשומות — היא מאנונימית אותן.
 *       פרטים פיננסיים (חשבוניות, פוליות) נשמרים ללא שינוי.
 */

import GuestProfile  from '../models/GuestProfile.js';
import Reservation   from '../models/Reservation.js';
import AuditLog      from '../models/AuditLog.js';

/**
 * אנונימיזציה של פרופיל אורח בודד.
 * מחזיר true אם בוצעה אנונימיזציה, false אם דולגה.
 */
async function anonymizeGuest(guest) {
  // בדיקת הזמנות פעילות — לא מאנונימים אורח שהות פעיל
  const activeReservations = await Reservation.countDocuments({
    property: guest.property,
    primaryGuest: guest._id,
    status: { $in: ['confirmed', 'in_house', 'checked_in'] },
  });

  if (activeReservations > 0) return false;

  guest.firstName          = '***';
  guest.lastName           = '***';
  guest.email              = `anon_${guest._id}@deleted.local`;
  guest.phone              = null;
  guest.passportNumber     = null;
  guest.passportExpiry     = null;
  guest.dateOfBirth        = null;
  guest.loyaltyId          = null;
  guest.address            = {};
  guest.internalNotes      = null;
  guest.preferences        = null;
  guest.allergies          = null;
  guest.notes              = [];
  // ניקוי שדות הסכמה אישיים (ה-IP כבר לא רלוונטי)
  guest.marketingConsentIp = null;
  guest.privacyConsentIp   = null;
  guest.isAnonymized       = true;

  await guest.save();
  return true;
}

/**
 * runAnonymizationPass — עובר על כל האורחים שעברה תקופת השמירה שלהם.
 *
 * @returns {{ processed: number, anonymized: number, skipped: number, errors: number }}
 */
export async function runAnonymizationPass() {
  const now    = new Date();
  const result = { processed: 0, anonymized: 0, skipped: 0, errors: 0 };

  // מוצאים את כל הפרופילים שתאריך השמירה עבר ולא אנונימיים עדיין
  const candidates = await GuestProfile.find({
    retentionDeleteAfter: { $lte: now },
    isAnonymized:         { $ne: true },
  }).select('_id firstName lastName property retentionDeleteAfter').lean();

  if (candidates.length === 0) return result;

  console.log(`[retentionService] ${candidates.length} candidates for anonymization`);

  for (const candidate of candidates) {
    result.processed++;
    try {
      // re-fetch ל-save() מלא (lean לא מתאים לשמירה)
      const guest = await GuestProfile.findById(candidate._id);
      if (!guest) { result.skipped++; continue; }

      const wasAnonymized = await anonymizeGuest(guest);

      if (wasAnonymized) {
        result.anonymized++;
        // רישום ביומן ביקורת
        await AuditLog.create({
          property:   guest.property,
          action:     'guest.auto_anonymized',
          entityType: 'GuestProfile',
          entityId:   guest._id,
          after: {
            reason:               'retention_period_expired',
            retentionDeleteAfter: candidate.retentionDeleteAfter,
          },
          performedBy: null,  // מערכת אוטומטית
          ip:          '0.0.0.0',
        });
      } else {
        result.skipped++;
        console.log(`[retentionService] Skipped guest ${candidate._id} — has active reservations`);
      }
    } catch (err) {
      result.errors++;
      console.error(`[retentionService] Error anonymizing guest ${candidate._id}:`, err.message);
    }
  }

  console.log(`[retentionService] Pass complete:`, result);
  return result;
}
