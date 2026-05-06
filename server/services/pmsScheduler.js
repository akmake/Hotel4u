/**
 * pmsScheduler.js
 *
 * PMS-level cron jobs for automation triggers:
 *   - schedule.hourly  — fires every hour for all active properties
 *   - schedule.daily   — fires at 00:05 server time for all active properties
 *   - Check-in reminders — fires at 09:00 daily; sends T-1 arrival reminder emails
 */

import cron         from 'node-cron';
import Property     from '../models/Property.js';
import Reservation  from '../models/Reservation.js';
import GuestProfile from '../models/GuestProfile.js';
import { fireEvent } from './automationEngine.js';
import { sendEmail, buildCheckInReminderEmail } from './emailService.js';

async function getActivePropertyIds() {
  try {
    const props = await Property.find({ active: { $ne: false } }).select('_id timezone').lean();
    return props;
  } catch {
    return [];
  }
}

async function runForAllProperties(trigger, extraCtx = {}) {
  const props = await getActivePropertyIds();
  for (const prop of props) {
    await fireEvent(trigger, {
      property: String(prop._id),
      timezone: prop.timezone || 'Asia/Jerusalem',
      ...extraCtx,
    }).catch(() => null);
  }
}

// ── Check-in reminder batch ───────────────────────────────────────────────────

async function sendCheckInReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowYmd = tomorrow.toISOString().slice(0, 10);

  let reservations;
  try {
    reservations = await Reservation.find({
      arrivalDate: tomorrowYmd,
      status:      { $in: ['confirmed', 'modified', 'pending_payment'] },
    }).select('primaryGuest property confirmationNumber arrivalDate').lean();
  } catch (err) {
    console.error('[pmsScheduler] check-in reminders: query failed:', err.message);
    return;
  }

  if (!reservations.length) return;

  // Load all distinct properties we need
  const propIds = [...new Set(reservations.map(r => String(r.property)))];
  const propertiesMap = {};
  try {
    const props = await Property.find({ _id: { $in: propIds } })
      .select('name address checkInTime')
      .lean();
    for (const p of props) propertiesMap[String(p._id)] = p;
  } catch (err) {
    console.error('[pmsScheduler] check-in reminders: property load failed:', err.message);
    return;
  }

  let sent = 0;
  let skipped = 0;

  for (const reservation of reservations) {
    try {
      const guest = await GuestProfile.findById(reservation.primaryGuest)
        .select('firstName lastName email emails')
        .lean();
      const toEmail = guest?.email || guest?.emails?.[0]?.address;
      if (!toEmail) { skipped++; continue; }

      const property = propertiesMap[String(reservation.property)];
      const { subject, html, text } = buildCheckInReminderEmail({
        guestName:       `${guest.firstName || ''} ${guest.lastName || ''}`.trim(),
        confirmationNumber: reservation.confirmationNumber,
        arrivalDate:     reservation.arrivalDate,
        propertyName:    property?.name,
        propertyAddress: property?.address,
        checkInTime:     property?.checkInTime,
      });

      await sendEmail({ to: toEmail, subject, html, text });
      sent++;
    } catch (err) {
      console.error(`[pmsScheduler] check-in reminder failed for reservation ${reservation._id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[pmsScheduler] check-in reminders: sent=${sent} skipped=${skipped} date=${tomorrowYmd}`);
}

// ── Scheduler init ────────────────────────────────────────────────────────────

export function initPmsScheduler() {
  // Hourly — fires at minute 0 of every hour
  cron.schedule('0 * * * *', async () => {
    const now = new Date();
    await runForAllProperties('schedule.hourly', {
      hour:      now.getHours(),
      timestamp: now.toISOString(),
    });
  });

  // Daily — fires at 00:05 every day (after midnight audit window)
  cron.schedule('5 0 * * *', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await runForAllProperties('schedule.daily', {
      date:      today,
      timestamp: new Date().toISOString(),
    });
  });

  // Check-in reminders — fires at 09:00 every morning
  cron.schedule('0 9 * * *', async () => {
    await sendCheckInReminders().catch(err =>
      console.error('[pmsScheduler] sendCheckInReminders crashed:', err.message)
    );
  });

  console.log('✔ PMS automation scheduler initialized (hourly + daily + check-in reminders)');
}
