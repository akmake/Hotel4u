/**
 * pmsScheduler.js
 *
 * PMS-level cron jobs for automation triggers:
 *   - schedule.hourly  — fires every hour for all active properties
 *   - schedule.daily   — fires at 00:05 server time for all active properties
 */

import cron      from 'node-cron';
import Property  from '../models/Property.js';
import { fireEvent } from './automationEngine.js';

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

  console.log('✔ PMS automation scheduler initialized (hourly + daily)');
}
