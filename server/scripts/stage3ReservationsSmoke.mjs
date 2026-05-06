#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Stage 3 Reservations Smoke Runner
 *
 * Usage:
 *   node scripts/stage3ReservationsSmoke.mjs
 *   node scripts/stage3ReservationsSmoke.mjs --mode=write
 *
 * Environment:
 *   PMS_BASE_URL=http://localhost:4000/api/pms
 *   PMS_TOKEN=<jwt>
 *   PMS_PROPERTY_ID=<ObjectId>
 *   PMS_ROOM_TYPE_ID=<ObjectId>                (optional for read, required for write)
 *   PMS_PRIMARY_GUEST_ID=<ObjectId>            (required for write)
 *   PMS_RATE_PER_NIGHT=450                     (optional, default 450)
 *   PMS_EXISTING_RESERVATION_ID=<ObjectId>     (optional)
 *   PMS_ARRIVAL_DATE=2026-05-20                (optional)
 *   PMS_DEPARTURE_DATE=2026-05-21              (optional)
 *   INCLUDE_KNOWN_BUG_CASES=1                  (optional; runs add-service known bug probe)
 */

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.slice(2).split('=');
    out[k] = v ?? '1';
  }
  return out;
}

function datePlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function ensureObjectIdLike(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

async function requestJson({ method, url, token, body }) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: res.status, json, raw: text };
}

function assertEnvelope(result) {
  if (!result.json || typeof result.json !== 'object') {
    return 'response is not JSON object';
  }
  if (typeof result.json.success !== 'boolean') {
    return 'missing boolean success field';
  }
  return null;
}

async function run() {
  const args = parseArgs(process.argv);
  const mode = args.mode || process.env.SMOKE_MODE || 'read';
  const writeMode = mode === 'write';

  const env = {
    baseUrl: (process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, ''),
    token: process.env.PMS_TOKEN || '',
    propertyId: process.env.PMS_PROPERTY_ID || '',
    roomTypeId: process.env.PMS_ROOM_TYPE_ID || '',
    primaryGuestId: process.env.PMS_PRIMARY_GUEST_ID || '',
    existingReservationId: process.env.PMS_EXISTING_RESERVATION_ID || '',
    ratePerNight: Number(process.env.PMS_RATE_PER_NIGHT || 450),
    includeKnownBugs: process.env.INCLUDE_KNOWN_BUG_CASES === '1',
    arrivalDate: process.env.PMS_ARRIVAL_DATE || datePlus(7),
    departureDate: process.env.PMS_DEPARTURE_DATE || datePlus(8),
  };

  const missing = [];
  if (!env.token) missing.push('PMS_TOKEN');
  if (!ensureObjectIdLike(env.propertyId)) missing.push('PMS_PROPERTY_ID (24-hex ObjectId)');
  if (writeMode) {
    if (!ensureObjectIdLike(env.roomTypeId)) missing.push('PMS_ROOM_TYPE_ID (24-hex ObjectId)');
    if (!ensureObjectIdLike(env.primaryGuestId)) missing.push('PMS_PRIMARY_GUEST_ID (24-hex ObjectId)');
  }

  if (missing.length) {
    console.error('Missing/invalid required environment variables:');
    for (const m of missing) console.error(`- ${m}`);
    process.exitCode = 1;
    return;
  }

  if (env.departureDate <= env.arrivalDate) {
    console.error('Invalid dates: PMS_DEPARTURE_DATE must be after PMS_ARRIVAL_DATE');
    process.exitCode = 1;
    return;
  }

  const state = {
    createdReservationId: null,
  };

  const baseReservations = `${env.baseUrl}/reservations`;

  /** @type {Array<{
   * id: string,
   * mode: 'read' | 'write',
   * skip?: () => string | null,
   * build: () => { method: string, url: string, body?: any },
   * expect: number[],
   * assert?: (result: {status:number,json:any,raw:string}) => string | null,
   * capture?: (result: {status:number,json:any,raw:string}) => void
   * }>} */
  const cases = [
    {
      id: 'READ-001-LIST',
      mode: 'read',
      build: () => ({
        method: 'GET',
        url: `${baseReservations}?propertyId=${encodeURIComponent(env.propertyId)}&page=1&limit=5`,
      }),
      expect: [200],
      assert: (r) => {
        if (!Array.isArray(r.json?.data)) return 'data is not an array';
        return null;
      },
    },
    {
      id: 'READ-002-AVAILABILITY',
      mode: 'read',
      skip: () => (!ensureObjectIdLike(env.roomTypeId) ? 'PMS_ROOM_TYPE_ID not provided' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/availability/check?propertyId=${encodeURIComponent(env.propertyId)}&roomTypeId=${encodeURIComponent(env.roomTypeId)}&arrivalDate=${env.arrivalDate}&departureDate=${env.departureDate}&requiredRooms=1`,
      }),
      expect: [200],
      assert: (r) => {
        if (typeof r.json?.data?.available !== 'boolean') return 'missing availability boolean';
        return null;
      },
    },
    {
      id: 'READ-003-DETAILS-EXISTING',
      mode: 'read',
      skip: () => (!ensureObjectIdLike(env.existingReservationId) ? 'PMS_EXISTING_RESERVATION_ID not provided' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${env.existingReservationId}`,
      }),
      expect: [200],
      assert: (r) => {
        if (!r.json?.data?._id) return 'reservation details missing _id';
        return null;
      },
    },
    {
      id: 'WRITE-001-CREATE',
      mode: 'write',
      build: () => ({
        method: 'POST',
        url: baseReservations,
        body: {
          propertyId: env.propertyId,
          roomTypeId: env.roomTypeId,
          arrivalDate: env.arrivalDate,
          departureDate: env.departureDate,
          primaryGuestId: env.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 1,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'smoke',
          specialRequests: 'stage3 smoke',
        },
      }),
      expect: [201],
      assert: (r) => {
        if (!r.json?.data?._id) return 'create response missing reservation id';
        return null;
      },
      capture: (r) => {
        state.createdReservationId = r.json?.data?._id || null;
      },
    },
    {
      id: 'WRITE-002-DETAILS-CREATED',
      mode: 'write',
      skip: () => (!ensureObjectIdLike(state.createdReservationId) ? 'no created reservation id in state' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationId}`,
      }),
      expect: [200],
      assert: (r) => {
        if (!Array.isArray(r.json?.data?.reservationRooms)) return 'reservationRooms missing';
        return null;
      },
    },
    {
      id: 'WRITE-005-ADD-SERVICE-KNOWN-BUG',
      mode: 'write',
      skip: () => {
        if (!env.includeKnownBugs) return 'INCLUDE_KNOWN_BUG_CASES!=1';
        if (!ensureObjectIdLike(state.createdReservationId)) return 'no created reservation id in state';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationId}/add-service`,
        body: {
          description: 'Smoke service line',
          amount: 50,
          department: 'service',
          quantity: 1,
        },
      }),
      expect: [201, 500],
      assert: (r) => {
        if (r.status === 500) {
          const err = String(r.json?.error || r.raw || '');
          if (!err.toLowerCase().includes('enum') && !err.toLowerCase().includes('valid')) {
            return 'known bug probe failed with unexpected 500 reason';
          }
        }
        return null;
      },
    },
    {
      id: 'WRITE-003-CANCEL-CREATED',
      mode: 'write',
      skip: () => (!ensureObjectIdLike(state.createdReservationId) ? 'no created reservation id in state' : null),
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationId}/cancel`,
        body: { reason: 'stage3 smoke cleanup' },
      }),
      expect: [200],
      assert: (r) => {
        const status = r.json?.data?.status;
        if (status !== 'cancelled') return `expected status=cancelled, got ${String(status)}`;
        return null;
      },
    },
    {
      id: 'WRITE-004-NO-SHOW-AFTER-CANCEL',
      mode: 'write',
      skip: () => (!ensureObjectIdLike(state.createdReservationId) ? 'no created reservation id in state' : null),
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationId}/no-show`,
      }),
      expect: [400, 409],
      assert: (r) => {
        if (r.json?.success !== false) return 'expected failure envelope after cancel';
        return null;
      },
    },
  ];

  const selected = cases.filter((c) => (writeMode ? true : c.mode === 'read'));
  const results = [];

  console.log(`Running reservations smoke: mode=${mode}, cases=${selected.length}`);

  for (const tc of selected) {
    const skipReason = tc.skip ? tc.skip() : null;
    if (skipReason) {
      results.push({ id: tc.id, status: 'SKIP', detail: skipReason });
      console.log(`- ${tc.id}: SKIP (${skipReason})`);
      continue;
    }

    const req = tc.build();
    const result = await requestJson({
      method: req.method,
      url: req.url,
      token: env.token,
      body: req.body,
    });

    const errs = [];
    if (!tc.expect.includes(result.status)) {
      errs.push(`status ${result.status} not in expected [${tc.expect.join(', ')}]`);
    }

    const envelopeErr = assertEnvelope(result);
    if (envelopeErr) errs.push(envelopeErr);

    if (tc.assert) {
      const customErr = tc.assert(result);
      if (customErr) errs.push(customErr);
    }

    if (!errs.length && tc.capture) tc.capture(result);

    if (errs.length) {
      results.push({ id: tc.id, status: 'FAIL', detail: errs.join(' | ') });
      console.log(`- ${tc.id}: FAIL`);
      console.log(`  -> ${errs.join(' | ')}`);
      if (result.json) {
        console.log(`  -> response: ${JSON.stringify(result.json)}`);
      } else {
        console.log(`  -> raw: ${result.raw.slice(0, 400)}`);
      }
    } else {
      results.push({ id: tc.id, status: 'PASS', detail: `status=${result.status}` });
      console.log(`- ${tc.id}: PASS (status=${result.status})`);
    }
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;

  console.log('\nSummary');
  console.log(`PASS=${pass} FAIL=${fail} SKIP=${skip}`);

  if (fail > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Smoke runner crashed:', err?.stack || err?.message || err);
  process.exitCode = 1;
});
