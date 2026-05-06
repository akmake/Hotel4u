#!/usr/bin/env node
/* eslint-disable no-console */

import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';

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

function randomObjectIdLike() {
  return new mongoose.Types.ObjectId().toHexString();
}

function signActorToken(actor, secret) {
  const payload = {
    id: String(actor._id),
    firstName: actor.firstName || '',
    lastName: actor.lastName || '',
    email: actor.email || '',
    role: actor.role || 'property_admin',
    propertyId: String(actor.property),
  };
  return jwt.sign(payload, secret, { expiresIn: '8h' });
}

async function requestJson({ method, url, token, body }) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, raw };
}

function assertSuccessEnvelope(result) {
  if (!result.json || typeof result.json !== 'object') return 'response is not JSON object';
  if (result.json.success !== true) return `expected success=true, got ${String(result.json.success)}`;
  return null;
}

function assertFailureEnvelope(result) {
  if (!result.json || typeof result.json !== 'object') return 'response is not JSON object';
  if (result.json.success !== false) return `expected success=false, got ${String(result.json.success)}`;
  return null;
}

async function buildContext(env) {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u';
  const jwtSecret = env.jwtSecret || process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';
  if (!jwtSecret) throw new Error('Missing JWT secret');

  await mongoose.connect(mongoUri);

  const property = env.propertyId
    ? await Property.findById(env.propertyId).select('_id').lean()
    : await Property.findOne({}).select('_id').lean();
  if (!property?._id) throw new Error('No property found for integration context');

  const propertyId = String(property._id);

  const activeUsers = await User.find({ property: property._id, active: true })
    .select('_id firstName lastName email role property')
    .lean();
  if (!activeUsers.length) throw new Error('No active users found in property scope');

  const pickByRoles = (roles) => {
    for (const role of roles) {
      const found = activeUsers.find((u) => u.role === role);
      if (found) return found;
    }
    return null;
  };

  const adminUser = pickByRoles(['property_admin', 'general_manager', 'front_desk_manager', 'super_admin']);
  if (!adminUser) throw new Error('No admin-like user found for integration context');

  const receptionistUser = pickByRoles(['receptionist']);
  const restrictedUser = pickByRoles(['technician', 'housekeeper', 'owner_readonly', 'auditor', 'maintenance_manager']);

  const roomType = env.roomTypeId
    ? await RoomType.findById(env.roomTypeId).select('_id').lean()
    : await RoomType.findOne({ property: property._id, active: { $ne: false } }).select('_id').lean();
  if (!roomType?._id) throw new Error('No room type found for integration context');

  const guest = env.primaryGuestId
    ? await GuestProfile.findById(env.primaryGuestId).select('_id').lean()
    : await GuestProfile.findOne({ property: property._id, isAnonymized: { $ne: true } }).select('_id').lean();
  if (!guest?._id) throw new Error('No guest profile found for integration context');

  const existingReservation = env.existingReservationId
    ? await Reservation.findById(env.existingReservationId).select('_id').lean()
    : await Reservation.findOne({ property: property._id }).select('_id').lean();
  if (!existingReservation?._id) throw new Error('No existing reservation found for integration context');

  const adminToken = signActorToken(adminUser, jwtSecret);
  const receptionistToken = receptionistUser ? signActorToken(receptionistUser, jwtSecret) : null;
  const restrictedToken = restrictedUser ? signActorToken(restrictedUser, jwtSecret) : null;

  await mongoose.disconnect();

  return {
    propertyId,
    roomTypeId: String(roomType._id),
    primaryGuestId: String(guest._id),
    existingReservationId: String(existingReservation._id),
    adminUser,
    receptionistUser,
    restrictedUser,
    adminToken,
    receptionistToken,
    restrictedToken,
    forgedWrongPropertyToken: jwt.sign({
      id: String(adminUser._id),
      firstName: adminUser.firstName || '',
      lastName: adminUser.lastName || '',
      email: adminUser.email || '',
      role: adminUser.role || 'property_admin',
      propertyId: randomObjectIdLike(),
    }, jwtSecret, { expiresIn: '8h' }),
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const env = {
    baseUrl: (args.baseUrl || process.env.PMS_BASE_URL || 'http://localhost:4000/api/pms').replace(/\/+$/, ''),
    propertyId: args.propertyId || process.env.PMS_PROPERTY_ID || '',
    roomTypeId: args.roomTypeId || process.env.PMS_ROOM_TYPE_ID || '',
    primaryGuestId: args.primaryGuestId || process.env.PMS_PRIMARY_GUEST_ID || '',
    existingReservationId: args.existingReservationId || process.env.PMS_EXISTING_RESERVATION_ID || '',
    jwtSecret: process.env.PMS_JWT_SECRET || process.env.JWT_SECRET || '',
    arrivalDate: process.env.PMS_ARRIVAL_DATE || datePlus(7),
    departureDate: process.env.PMS_DEPARTURE_DATE || datePlus(8),
    ratePerNight: Number(process.env.PMS_RATE_PER_NIGHT || 450),
  };

  if (env.departureDate <= env.arrivalDate) {
    console.error('Invalid dates: PMS_DEPARTURE_DATE must be after PMS_ARRIVAL_DATE');
    process.exitCode = 1;
    return;
  }

  let ctx;
  try {
    ctx = await buildContext(env);
  } catch (err) {
    console.error(`Context build failed: ${err?.message || err}`);
    process.exitCode = 1;
    return;
  }

  const state = {
    createdReservationA: null,
    createdReservationB: null,
    createdReservationC: null,
    createdReservationD: null,
    createdReservationCFirstRoomId: null,
    splitChildReservationId: null,
  };

  const baseReservations = `${env.baseUrl}/reservations`;

  const tests = [
    {
      id: 'S4-READ-ADMIN-LIST',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}?propertyId=${encodeURIComponent(ctx.propertyId)}&page=1&limit=5`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!Array.isArray(r.json?.data)) return 'data is not an array';
        return null;
      },
    },
    {
      id: 'S4-SCOPE-WRONG-PROPERTY',
      skip: () => (!ctx.forgedWrongPropertyToken ? 'wrong-property token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}?propertyId=${encodeURIComponent(ctx.propertyId)}&page=1&limit=1`,
        token: ctx.forgedWrongPropertyToken,
      }),
      expect: [403],
    },
    {
      id: 'S4-RBAC-RESTRICTED-CANCEL-FORBIDDEN',
      skip: () => (!ctx.restrictedToken ? 'restricted-role user not found' : null),
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${ctx.existingReservationId}/cancel`,
        token: ctx.restrictedToken,
        body: { reason: 'stage4 rbac probe' },
      }),
      expect: [403],
    },
    {
      id: 'S4-RBAC-RECEPTION-CANCELLATION-FEE-FORBIDDEN',
      skip: () => (!ctx.receptionistToken ? 'receptionist user not found' : null),
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${ctx.existingReservationId}/cancellation-fee`,
        token: ctx.receptionistToken,
        body: { amount: 25, description: 'stage4 unauthorized fee probe' },
      }),
      expect: [403],
    },
    {
      id: 'S4-WRITE-CREATE-A',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: baseReservations,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          arrivalDate: env.arrivalDate,
          departureDate: env.departureDate,
          primaryGuestId: ctx.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 1,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'stage4',
          specialRequests: 'stage4 integration A',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation id';
        return null;
      },
      capture: (r) => { state.createdReservationA = r.json?.data?._id || null; },
    },
    {
      id: 'S4-RBAC-RESTRICTED-CANCEL-CREATED-FORBIDDEN',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted-role user not found';
        if (!ensureObjectIdLike(state.createdReservationA)) return 'created reservation A unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationA}/cancel`,
        token: ctx.restrictedToken,
        body: { reason: 'stage4 unauthorized cancel probe' },
      }),
      expect: [403],
    },
    {
      id: 'S4-WRITE-RECEPTION-CANCEL-CREATED',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationA)) return 'created reservation A unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationA}/cancel`,
        token: ctx.receptionistToken,
        body: { reason: 'stage4 receptionist cancel' },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'cancelled') return `expected cancelled, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4-STATUS-NO_SHOW-AFTER-CANCEL-BLOCKED',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationA)) return 'created reservation A unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationA}/no-show`,
        token: ctx.receptionistToken,
      }),
      expect: [409],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S4-WRITE-CREATE-B',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: baseReservations,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          arrivalDate: env.arrivalDate,
          departureDate: env.departureDate,
          primaryGuestId: ctx.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 1,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'stage4',
          specialRequests: 'stage4 integration B',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation id';
        return null;
      },
      capture: (r) => { state.createdReservationB = r.json?.data?._id || null; },
    },
    {
      id: 'S4-WRITE-ADD-SERVICE-ON-ACTIVE',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/add-service`,
        token: ctx.receptionistToken,
        body: {
          description: 'Stage4 service line',
          amount: 70,
          department: 'service',
          quantity: 2,
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const lines = r.json?.data?.lines || [];
        const lastLine = lines[lines.length - 1];
        if (!lastLine) return 'folio line missing after add-service';
        if (lastLine.type !== 'charge') return `expected folio line type=charge, got ${String(lastLine.type)}`;
        return null;
      },
    },
    {
      id: 'S4-RBAC-RECEPTION-CANCELLATION-FEE-STILL-FORBIDDEN',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/cancellation-fee`,
        token: ctx.receptionistToken,
        body: { amount: 30, description: 'stage4 forbidden fee check' },
      }),
      expect: [403],
    },
    {
      id: 'S4.1-WRITE-CREATE-C-MULTIROOM',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: baseReservations,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          arrivalDate: env.arrivalDate,
          departureDate: env.departureDate,
          primaryGuestId: ctx.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 2,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'stage4_1',
          specialRequests: 'stage4.1 split source',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation C id';
        return null;
      },
      capture: (r) => { state.createdReservationC = r.json?.data?._id || null; },
    },
    {
      id: 'S4.1-WRITE-DETAILS-C-MULTIROOM',
      skip: () => (!ensureObjectIdLike(state.createdReservationC) ? 'created reservation C unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationC}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const rooms = r.json?.data?.reservationRooms;
        if (!Array.isArray(rooms) || rooms.length < 2) return `expected >=2 reservation rooms, got ${Array.isArray(rooms) ? rooms.length : 'N/A'}`;
        return null;
      },
      capture: (r) => {
        const rooms = r.json?.data?.reservationRooms || [];
        state.createdReservationCFirstRoomId = rooms[0]?._id || null;
      },
    },
    {
      id: 'S4.1-WRITE-SPLIT-C',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationC)) return 'created reservation C unavailable';
        if (!ensureObjectIdLike(state.createdReservationCFirstRoomId)) return 'reservation room id for split unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationC}/split`,
        token: ctx.receptionistToken,
        body: {
          reservationRoomIds: [state.createdReservationCFirstRoomId],
          notes: 'stage4.1 split check',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?.newReservationId)) return 'missing split child reservation id';
        return null;
      },
      capture: (r) => { state.splitChildReservationId = r.json?.data?.newReservationId || null; },
    },
    {
      id: 'S4.1-WRITE-DETAILS-SPLIT-CHILD',
      skip: () => (!ensureObjectIdLike(state.splitChildReservationId) ? 'split child reservation id unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.splitChildReservationId}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const rooms = r.json?.data?.reservationRooms;
        if (!Array.isArray(rooms) || rooms.length < 1) return 'split child must have at least one room';
        return null;
      },
    },
    {
      id: 'S4.1-WRITE-CREATE-D',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: baseReservations,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          arrivalDate: env.arrivalDate,
          departureDate: env.departureDate,
          primaryGuestId: ctx.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 1,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'stage4_1',
          specialRequests: 'stage4.1 group-link source',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation D id';
        return null;
      },
      capture: (r) => { state.createdReservationD = r.json?.data?._id || null; },
    },
    {
      id: 'S4.1-WRITE-LINK-GROUP-ACTIVE',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationD)) return 'created reservation D unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationD}/link-group`,
        token: ctx.receptionistToken,
        body: {
          groupCode: 'GRP-STAGE4-01',
          groupName: 'Stage4 Group',
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.groupCode !== 'GRP-STAGE4-01') return `expected groupCode GRP-STAGE4-01, got ${String(r.json?.data?.groupCode)}`;
        return null;
      },
    },
    {
      id: 'S4.1-WRITE-CANCEL-D',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationD)) return 'created reservation D unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationD}/cancel`,
        token: ctx.receptionistToken,
        body: { reason: 'stage4.1 group-link close check' },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'cancelled') return `expected cancelled, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.1-WRITE-LINK-GROUP-CLOSED-BLOCKED',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationD)) return 'created reservation D unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationD}/link-group`,
        token: ctx.receptionistToken,
        body: {
          groupCode: 'GRP-STAGE4-02',
          groupName: 'Stage4 Group Closed',
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
  ];

  const results = [];
  console.log('Running Stage 4 reservations integration suite...');
  console.log(`Target: ${env.baseUrl}`);
  console.log(`Property: ${ctx.propertyId}`);
  console.log(`Role users: admin=${ctx.adminUser.role}, reception=${ctx.receptionistUser?.role || 'N/A'}, restricted=${ctx.restrictedUser?.role || 'N/A'}`);

  for (const tc of tests) {
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
      token: req.token,
      body: req.body,
    });

    const errs = [];
    if (!tc.expect.includes(result.status)) {
      errs.push(`status ${result.status} not in expected [${tc.expect.join(', ')}]`);
    }
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

  // Cleanup best-effort for created reservations.
  const cleanupTargets = [
    state.createdReservationA,
    state.createdReservationB,
    state.createdReservationC,
    state.createdReservationD,
    state.splitChildReservationId,
  ].filter(ensureObjectIdLike);
  for (const reservationId of cleanupTargets) {
    try {
      await requestJson({
        method: 'POST',
        url: `${baseReservations}/${reservationId}/cancel`,
        token: ctx.adminToken,
        body: { reason: 'stage4 cleanup' },
      });
    } catch {
      // ignore cleanup errors
    }
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;

  console.log('\nSummary');
  console.log(`PASS=${pass} FAIL=${fail} SKIP=${skip}`);

  if (fail > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Stage 4 integration runner crashed:', err?.stack || err?.message || err);
  process.exitCode = 1;
});
