#!/usr/bin/env node
/* eslint-disable no-console */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';
import GuestProfile from '../models/GuestProfile.js';
import Reservation from '../models/Reservation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Keep integration auth aligned with the PMS server defaults when launched from repo root.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

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

function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function ensureObjectIdLike(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function randomObjectIdLike() {
  return new mongoose.Types.ObjectId().toHexString();
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    createdReservationE: null,
    createdReservationF: null,
    duplicatedReservationFromB: null,
    mergedTargetRoomIds: [],
    mergeSourceConfirmation: null,
    stage43DuplicateArrivalDate: datePlus(40),
    stage43DuplicateDepartureDate: datePlus(42),
    mergeSourceServiceDescription: `Stage4.3 merge source service ${Date.now()}`,
    mergeTargetServiceDescription: `Stage4.3 merge target seed ${Date.now()}`,
    createdReservationK: null,
    createdReservationKFirstRoomId: null,
    createdReservationKAssignedRoomId: null,
    stage44AlternateRoomId: null,
    stage44FallbackRoomId: null,
    stage44ExtendedDepartureDate: addDaysYmd(env.departureDate, 1),
    stage44UpdatedRatePerNight: Number(env.ratePerNight) + 55,
    createdReservationL: null,
    createdReservationLFirstRoomId: null,
    createdReservationLSegmentId: null,
    stage45ArrivalDate: datePlus(25),
    stage45DepartureDate: datePlus(28),
    stage45EarlyDepartureDate: datePlus(27),
    stage45UpgradeNightlyRate: Number(env.ratePerNight) + 77,
    stage45RoomPatchNightlyRate: Number(env.ratePerNight) + 88,
    stage45SegmentFromDate: datePlus(26),
    stage45SegmentToDate: datePlus(27),
    createdReservationM: null,
    stage54ArrivalDate: datePlus(33),
    stage54DepartureDate: datePlus(35),
    stage54MissingReservationId: randomObjectIdLike(),
    stage56JobId: null,
    stage56MissingReservationId: randomObjectIdLike(),
    stage58OriginalDefaultPreset: '',
    stage58OriginalFilterBundles: [],
    stage5227RetryJobId: null,
    stage5227NoFailJobId: null,
    createdReservationN: null,
    createdReservationNFirstRoomId: null,
    createdReservationNAssignedRoomId: null,
    stage520AlternateRoomId: null,
    stage520FallbackRoomId: null,
    stage520ArrivalDate: datePlus(48),
    stage520DepartureDate: datePlus(50),
    stage520ExtendedDepartureDate: datePlus(52),
    stage520EarlyDepartureDate: datePlus(51),
    stage520NightlyRate: Number(env.ratePerNight) + 121,
    transferSourceLineId: null,
    transferSourceDescription: `Stage4.2 transfer source ${Date.now()}`,
    createdRoutingRuleId: null,
    routingApplyDescription: `Stage4.2 routing apply ${Date.now()}`,
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
    {
      id: 'S4.2-WRITE-CREATE-E',
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
          marketSegment: 'stage4_2',
          specialRequests: 'stage4.2 transfer source reservation',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation E id';
        return null;
      },
      capture: (r) => { state.createdReservationE = r.json?.data?._id || null; },
    },
    {
      id: 'S4.2-WRITE-CREATE-F',
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
          marketSegment: 'stage4_2',
          specialRequests: 'stage4.2 transfer target reservation',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation F id';
        return null;
      },
      capture: (r) => { state.createdReservationF = r.json?.data?._id || null; },
    },
    {
      id: 'S4.2-WRITE-ADD-SERVICE-E',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationE)) return 'created reservation E unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationE}/add-service`,
        token: ctx.receptionistToken,
        body: {
          description: state.transferSourceDescription,
          amount: 80,
          department: 'service',
          quantity: 1,
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const lines = r.json?.data?.lines || [];
        const sourceLine = lines.find((line) => line.description === state.transferSourceDescription);
        if (!sourceLine?._id) return 'source transfer line not found in folio';
        return null;
      },
      capture: (r) => {
        const lines = r.json?.data?.lines || [];
        const sourceLine = lines.find((line) => line.description === state.transferSourceDescription);
        state.transferSourceLineId = sourceLine?._id || null;
      },
    },
    {
      id: 'S4.2-RBAC-RECEPTION-TRANSFER-CHARGES-FORBIDDEN',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationE)) return 'created reservation E unavailable';
        if (!ensureObjectIdLike(state.createdReservationF)) return 'created reservation F unavailable';
        if (!ensureObjectIdLike(state.transferSourceLineId)) return 'transfer source line id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/transfer-charges`,
        token: ctx.receptionistToken,
        body: {
          fromReservationId: state.createdReservationE,
          toReservationId: state.createdReservationF,
          lineIds: [state.transferSourceLineId],
        },
      }),
      expect: [403],
    },
    {
      id: 'S4.2-WRITE-TRANSFER-CHARGES-ADMIN',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationE)) return 'created reservation E unavailable';
        if (!ensureObjectIdLike(state.createdReservationF)) return 'created reservation F unavailable';
        if (!ensureObjectIdLike(state.transferSourceLineId)) return 'transfer source line id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/transfer-charges`,
        token: ctx.adminToken,
        body: {
          fromReservationId: state.createdReservationE,
          toReservationId: state.createdReservationF,
          lineIds: [state.transferSourceLineId],
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const moved = r.json?.data?.movedLineIds || [];
        if (!moved.includes(state.transferSourceLineId)) return 'expected moved line id missing';
        return null;
      },
    },
    {
      id: 'S4.2-VERIFY-TRANSFER-FOLIOS',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationE)) return 'created reservation E unavailable';
        if (!ensureObjectIdLike(state.createdReservationF)) return 'created reservation F unavailable';
        if (!ensureObjectIdLike(state.transferSourceLineId)) return 'transfer source line id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${env.baseUrl}/folio/reservation/${state.createdReservationE}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: async (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const sourceLines = r.json?.data?.lines || [];
        const sourceLine = sourceLines.find((line) => String(line._id) === String(state.transferSourceLineId));
        if (!sourceLine) return 'source transfer line missing after transfer';
        if (sourceLine.status !== 'voided') return `expected source line status voided, got ${String(sourceLine.status)}`;

        const targetRes = await requestJson({
          method: 'GET',
          url: `${env.baseUrl}/folio/reservation/${state.createdReservationF}`,
          token: ctx.adminToken,
        });
        if (targetRes.status !== 200) return `target folio fetch failed with status ${targetRes.status}`;
        const targetEnvErr = assertSuccessEnvelope(targetRes);
        if (targetEnvErr) return `target folio envelope invalid: ${targetEnvErr}`;

        const targetLines = targetRes.json?.data?.lines || [];
        const hasTransferredLine = targetLines.some((line) => String(line.description || '').includes('[Transfer from'));
        if (!hasTransferredLine) return 'target folio missing transferred line marker';
        return null;
      },
    },
    {
      id: 'S4.2-RBAC-RECEPTION-ROUTING-CREATE-FORBIDDEN',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationE)) return 'created reservation E unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${env.baseUrl}/folio-routing`,
        token: ctx.receptionistToken,
        body: {
          propertyId: ctx.propertyId,
          reservationId: state.createdReservationE,
          name: 'stage4.2 unauthorized routing create',
          departments: ['service'],
          chargeTypes: ['charge'],
          percentage: 60,
          targetOwnerType: 'company',
        },
      }),
      expect: [403],
    },
    {
      id: 'S4.2-WRITE-ROUTING-CREATE-ADMIN',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationE)) return 'created reservation E unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${env.baseUrl}/folio-routing`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          reservationId: state.createdReservationE,
          name: 'stage4.2 routing split 60/40',
          departments: ['service'],
          chargeTypes: ['charge'],
          percentage: 60,
          targetOwnerType: 'company',
          notes: 'stage4.2 routing rule',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing routing rule id';
        return null;
      },
      capture: (r) => { state.createdRoutingRuleId = r.json?.data?._id || null; },
    },
    {
      id: 'S4.2-WRITE-ROUTING-APPLY-ADMIN',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationE)) return 'created reservation E unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${env.baseUrl}/folio-routing/apply`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          reservationId: state.createdReservationE,
          department: 'service',
          chargeType: 'charge',
          serviceDate: env.arrivalDate,
          amount: 100,
          taxAmount: 17,
          description: state.routingApplyDescription,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const applied = r.json?.data?.applied || [];
        if (!Array.isArray(applied) || applied.length === 0) return 'routing apply returned no postings';
        const hasGuest = applied.some((item) => item.ownerType === 'guest');
        const hasNonGuest = applied.some((item) => item.ownerType && item.ownerType !== 'guest');
        if (!hasGuest || !hasNonGuest) return 'expected split postings for guest and non-guest folios';
        return null;
      },
    },
    {
      id: 'S4.2-WRITE-ROUTING-PATCH-DEACTIVATE',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdRoutingRuleId)) return 'routing rule id unavailable';
        return null;
      },
      build: () => ({
        method: 'PATCH',
        url: `${env.baseUrl}/folio-routing/${state.createdRoutingRuleId}`,
        token: ctx.adminToken,
        body: { active: false },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.active !== false) return `expected active=false, got ${String(r.json?.data?.active)}`;
        return null;
      },
    },
    {
      id: 'S4.2-WRITE-ROUTING-DELETE',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdRoutingRuleId)) return 'routing rule id unavailable';
        return null;
      },
      build: () => ({
        method: 'DELETE',
        url: `${env.baseUrl}/folio-routing/${state.createdRoutingRuleId}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.deleted !== true) return 'expected deleted=true';
        return null;
      },
    },
    {
      id: 'S4.3-WRITE-DUPLICATE-B',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/duplicate`,
        token: ctx.receptionistToken,
        body: {
          arrivalDate: state.stage43DuplicateArrivalDate,
          departureDate: state.stage43DuplicateDepartureDate,
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const newId = r.json?.data?._id;
        if (!ensureObjectIdLike(newId)) return 'missing duplicated reservation id';
        if (String(newId) === String(state.createdReservationB)) return 'duplicate returned same reservation id';
        return null;
      },
      capture: (r) => {
        state.duplicatedReservationFromB = r.json?.data?._id || null;
        state.mergeSourceConfirmation = r.json?.data?.confirmationNumber || null;
      },
    },
    {
      id: 'S4.3-VERIFY-DUPLICATE-B',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.duplicatedReservationFromB)) return 'duplicated reservation id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.duplicatedReservationFromB}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const data = r.json?.data || {};
        if (String(data.marketSegment || '') !== 'stage4') return `expected marketSegment stage4, got ${String(data.marketSegment)}`;
        if (Number(data.roomsCount || 0) < 1) return `expected roomsCount >= 1, got ${String(data.roomsCount)}`;
        if (String(data.arrivalDate || '').slice(0, 10) !== state.stage43DuplicateArrivalDate) return 'duplicate arrivalDate mismatch';
        if (String(data.departureDate || '').slice(0, 10) !== state.stage43DuplicateDepartureDate) return 'duplicate departureDate mismatch';
        return null;
      },
    },
    {
      id: 'S4.3-WRITE-ADD-SERVICE-DUPLICATE-SOURCE',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.duplicatedReservationFromB)) return 'duplicated reservation id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.duplicatedReservationFromB}/add-service`,
        token: ctx.receptionistToken,
        body: {
          description: state.mergeSourceServiceDescription,
          amount: 95,
          department: 'service',
          quantity: 1,
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const lines = r.json?.data?.lines || [];
        const added = lines.find((line) => line.description === state.mergeSourceServiceDescription);
        if (!added?._id) return 'source merge service line missing';
        return null;
      },
    },
    {
      id: 'S4.3-WRITE-ADD-SERVICE-B-TARGET-SEED',
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
          description: state.mergeTargetServiceDescription,
          amount: 35,
          department: 'service',
          quantity: 1,
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const lines = r.json?.data?.lines || [];
        const added = lines.find((line) => line.description === state.mergeTargetServiceDescription);
        if (!added?._id) return 'target merge seed service line missing';
        return null;
      },
    },
    {
      id: 'S4.3-WRITE-MERGE-DUPLICATE-INTO-B',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.duplicatedReservationFromB)) return 'duplicated reservation id unavailable';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/merge`,
        token: ctx.receptionistToken,
        body: {
          sourceReservationId: state.duplicatedReservationFromB,
          targetReservationId: state.createdReservationB,
          transferCharges: true,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (String(r.json?.data?.mergedInto || '') !== String(state.createdReservationB)) return 'merge target id mismatch';
        if (String(r.json?.data?.mergedFrom || '') !== String(state.duplicatedReservationFromB)) return 'merge source id mismatch';
        return null;
      },
    },
    {
      id: 'S4.3-VERIFY-MERGE-SOURCE-CANCELLED',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.duplicatedReservationFromB)) return 'duplicated reservation id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.duplicatedReservationFromB}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'cancelled') return `expected cancelled, got ${String(r.json?.data?.status)}`;
        const rooms = r.json?.data?.reservationRooms || [];
        if (rooms.length !== 0) return `expected 0 rooms on merged source, got ${rooms.length}`;
        return null;
      },
    },
    {
      id: 'S4.3-VERIFY-MERGE-TARGET-ROOMS',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationB}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'modified') return `expected modified, got ${String(r.json?.data?.status)}`;
        const rooms = r.json?.data?.reservationRooms || [];
        if (rooms.length < 2) return `expected target to have >=2 rooms after merge, got ${rooms.length}`;
        return null;
      },
      capture: (r) => {
        const rooms = r.json?.data?.reservationRooms || [];
        state.mergedTargetRoomIds = rooms.map((room) => room?._id).filter(ensureObjectIdLike).slice(0, 2);
      },
    },
    {
      id: 'S4.3-VERIFY-MERGE-TARGET-FOLIO',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${env.baseUrl}/folio/reservation/${state.createdReservationB}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const lines = r.json?.data?.lines || [];
        const mergedServiceLine = lines.find((line) => String(line.description || '').includes(state.mergeSourceServiceDescription));
        if (!mergedServiceLine) return 'merged source service line missing in target folio';
        if (!String(mergedServiceLine.description || '').includes('[Merged ')) return 'merged source service line missing [Merged marker';
        if (state.mergeSourceConfirmation && !String(mergedServiceLine.description || '').includes(state.mergeSourceConfirmation)) {
          return 'merged source service line missing source confirmation number';
        }
        return null;
      },
    },
    {
      id: 'S4.3-RBAC-RESTRICTED-PARTIAL-CHECKIN-FORBIDDEN',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted-role user not found';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        if (state.mergedTargetRoomIds.length < 1) return 'merged target room ids unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/partial-check-in`,
        token: ctx.restrictedToken,
        body: { reservationRoomIds: [state.mergedTargetRoomIds[0]] },
      }),
      expect: [403],
    },
    {
      id: 'S4.3-WRITE-PARTIAL-CHECKIN-FIRST',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        if (state.mergedTargetRoomIds.length < 2) return 'merged target room ids unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/partial-check-in`,
        token: ctx.adminToken,
        body: {
          reservationRoomIds: [state.mergedTargetRoomIds[0]],
          overrideClean: true,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'partially_checked_in') return `expected partially_checked_in, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.3-WRITE-PARTIAL-CHECKIN-SECOND',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        if (state.mergedTargetRoomIds.length < 2) return 'merged target room ids unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/partial-check-in`,
        token: ctx.adminToken,
        body: {
          reservationRoomIds: [state.mergedTargetRoomIds[1]],
          overrideClean: true,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'in_house') return `expected in_house, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.3-WRITE-PARTIAL-CHECKOUT-FIRST',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        if (state.mergedTargetRoomIds.length < 2) return 'merged target room ids unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/partial-check-out`,
        token: ctx.receptionistToken,
        body: { reservationRoomIds: [state.mergedTargetRoomIds[0]] },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'partially_checked_out') return `expected partially_checked_out, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.3-WRITE-PARTIAL-CHECKOUT-SECOND',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        if (state.mergedTargetRoomIds.length < 2) return 'merged target room ids unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationB}/partial-check-out`,
        token: ctx.receptionistToken,
        body: { reservationRoomIds: [state.mergedTargetRoomIds[1]] },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'checked_out') return `expected checked_out, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.3-VERIFY-PARTIAL-FINAL-ROOM-STATUSES',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationB)) return 'created reservation B unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationB}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'checked_out') return `expected checked_out, got ${String(r.json?.data?.status)}`;
        const rooms = r.json?.data?.reservationRooms || [];
        const allCheckedOut = rooms.length >= 2 && rooms.every((room) => room?.status === 'checked_out');
        if (!allCheckedOut) return 'expected all reservation rooms to be checked_out after partial flow';
        return null;
      },
    },
    {
      id: 'S4.4-WRITE-CREATE-K',
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
          marketSegment: 'stage4_4',
          specialRequests: 'stage4.4 checkin-checkout-extend-assign',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation K id';
        return null;
      },
      capture: (r) => { state.createdReservationK = r.json?.data?._id || null; },
    },
    {
      id: 'S4.4-WRITE-DETAILS-K',
      skip: () => (!ensureObjectIdLike(state.createdReservationK) ? 'created reservation K unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationK}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const rooms = r.json?.data?.reservationRooms;
        if (!Array.isArray(rooms) || rooms.length < 1) return 'reservation K must include at least one reservation room';
        if (!ensureObjectIdLike(r.json?.data?.assignedRoom?._id)) return 'reservation K assigned room missing';
        return null;
      },
      capture: (r) => {
        const rooms = r.json?.data?.reservationRooms || [];
        state.createdReservationKFirstRoomId = rooms[0]?._id || null;
        state.createdReservationKAssignedRoomId = r.json?.data?.assignedRoom?._id || null;
      },
    },
    {
      id: 'S4.4-WRITE-LIST-ROOMS-FOR-ASSIGN',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${env.baseUrl}/rooms?propertyId=${encodeURIComponent(ctx.propertyId)}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!Array.isArray(r.json?.data) || r.json.data.length === 0) return 'rooms list is empty';
        return null;
      },
      capture: (r) => {
        const rooms = Array.isArray(r.json?.data) ? r.json.data : [];
        const candidate = rooms.find((room) => (
          ensureObjectIdLike(room?._id)
          && String(room._id) !== String(state.createdReservationKAssignedRoomId)
          && room.opsStatus !== 'out_of_order'
          && ['clean', 'inspected'].includes(String(room.cleanStatus || '').toLowerCase())
          && String(room.occStatus || '').toLowerCase() !== 'occupied'
        ));
        state.stage44AlternateRoomId = candidate?._id || null;
      },
    },
    {
      id: 'S4.4-WRITE-CREATE-FALLBACK-ROOM-FOR-ASSIGN',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (ensureObjectIdLike(state.stage44AlternateRoomId)) return 'alternate room already available';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${env.baseUrl}/rooms`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          number: `S440-${Date.now()}`,
          floor: 98,
          opsStatus: 'available',
          cleanStatus: 'clean',
          occStatus: 'vacant',
        },
      }),
      expect: [201],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'fallback room create did not return room id';
        return null;
      },
      capture: (r) => {
        state.stage44FallbackRoomId = r.json?.data?._id || null;
        if (ensureObjectIdLike(state.stage44FallbackRoomId)) {
          state.stage44AlternateRoomId = state.stage44FallbackRoomId;
        }
      },
    },
    {
      id: 'S4.4-RBAC-RESTRICTED-ASSIGN-ROOM-FORBIDDEN',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted-role user not found';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        if (!ensureObjectIdLike(state.createdReservationKFirstRoomId)) return 'reservation K room id unavailable';
        if (!ensureObjectIdLike(state.stage44AlternateRoomId)) return 'target assign-room id unavailable';
        return null;
      },
      build: () => ({
        method: 'PATCH',
        url: `${baseReservations}/${state.createdReservationK}/assign-room`,
        token: ctx.restrictedToken,
        body: {
          roomId: state.stage44AlternateRoomId,
          reservationRoomId: state.createdReservationKFirstRoomId,
        },
      }),
      expect: [403],
    },
    {
      id: 'S4.4-WRITE-ASSIGN-ROOM-RECEPTION',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        if (!ensureObjectIdLike(state.createdReservationKFirstRoomId)) return 'reservation K room id unavailable';
        if (!ensureObjectIdLike(state.stage44AlternateRoomId)) return 'target assign-room id unavailable';
        return null;
      },
      build: () => ({
        method: 'PATCH',
        url: `${baseReservations}/${state.createdReservationK}/assign-room`,
        token: ctx.receptionistToken,
        body: {
          roomId: state.stage44AlternateRoomId,
          reservationRoomId: state.createdReservationKFirstRoomId,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const assignedId = r.json?.data?.assignedRoom?._id || r.json?.data?.assignedRoom;
        if (String(assignedId || '') !== String(state.stage44AlternateRoomId)) {
          return `expected assignedRoom ${String(state.stage44AlternateRoomId)}, got ${String(assignedId)}`;
        }
        return null;
      },
    },
    {
      id: 'S4.4-WRITE-EXTEND-INVALID-BLOCKED',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationK}/extend`,
        token: ctx.receptionistToken,
        body: {
          newDepartureDate: env.arrivalDate,
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S4.4-WRITE-EXTEND-SUCCESS',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationK}/extend`,
        token: ctx.receptionistToken,
        body: {
          newDepartureDate: state.stage44ExtendedDepartureDate,
          nightlyRate: state.stage44UpdatedRatePerNight,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (String(r.json?.data?.departureDate || '').slice(0, 10) !== state.stage44ExtendedDepartureDate) {
          return 'extend did not update departureDate as expected';
        }
        if (Number(r.json?.data?.ratePerNight) !== Number(state.stage44UpdatedRatePerNight)) {
          return `expected ratePerNight ${state.stage44UpdatedRatePerNight}, got ${String(r.json?.data?.ratePerNight)}`;
        }
        if (r.json?.data?.status !== 'modified') return `expected modified, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.4-WRITE-CHECKOUT-BEFORE-CHECKIN-BLOCKED',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationK}/check-out`,
        token: ctx.receptionistToken,
        body: {},
      }),
      expect: [409],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S4.4-RBAC-RECEPTION-CHECKIN-OVERRIDE-FORBIDDEN',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationK}/check-in`,
        token: ctx.receptionistToken,
        body: {
          overrideEarlyArrival: true,
        },
      }),
      expect: [403],
    },
    {
      id: 'S4.4-WRITE-CHECKIN-ADMIN-OVERRIDE',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationK}/check-in`,
        token: ctx.adminToken,
        body: {
          overrideEarlyArrival: true,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'in_house') return `expected in_house, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.4-RBAC-RECEPTION-FORCE-CHECKOUT-FORBIDDEN',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationK}/check-out`,
        token: ctx.receptionistToken,
        body: {
          forceCheckout: true,
        },
      }),
      expect: [403],
    },
    {
      id: 'S4.4-WRITE-CHECKOUT-ADMIN-FORCE',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationK}/check-out`,
        token: ctx.adminToken,
        body: {
          forceCheckout: true,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'checked_out') return `expected checked_out, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.4-VERIFY-CHECKOUT-FINAL-ROOM-STATUSES',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationK)) return 'created reservation K unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationK}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.status !== 'checked_out') return `expected checked_out, got ${String(r.json?.data?.status)}`;
        const rooms = r.json?.data?.reservationRooms || [];
        const allCheckedOut = rooms.length >= 1 && rooms.every((room) => room?.status === 'checked_out');
        if (!allCheckedOut) return 'expected all reservation K rooms to be checked_out';
        return null;
      },
    },
    {
      id: 'S4.5-WRITE-CREATE-L',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: baseReservations,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          arrivalDate: state.stage45ArrivalDate,
          departureDate: state.stage45DepartureDate,
          primaryGuestId: ctx.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 1,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'stage4_5',
          specialRequests: 'stage4.5 early-departure-upgrade-segments',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation L id';
        return null;
      },
      capture: (r) => { state.createdReservationL = r.json?.data?._id || null; },
    },
    {
      id: 'S4.5-WRITE-DETAILS-L',
      skip: () => (!ensureObjectIdLike(state.createdReservationL) ? 'created reservation L unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationL}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const rooms = r.json?.data?.reservationRooms;
        if (!Array.isArray(rooms) || rooms.length < 1) return 'reservation L must include at least one reservation room';
        return null;
      },
      capture: (r) => {
        const rooms = r.json?.data?.reservationRooms || [];
        state.createdReservationLFirstRoomId = rooms[0]?._id || null;
      },
    },
    {
      id: 'S4.5-RBAC-RECEPTION-UPGRADE-FORBIDDEN',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationL)) return 'created reservation L unavailable';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationL}/upgrade`,
        token: ctx.receptionistToken,
        body: {
          reservationRoomId: state.createdReservationLFirstRoomId,
          nightlyRate: state.stage45UpgradeNightlyRate,
          reason: 'stage4.5 unauthorized upgrade check',
        },
      }),
      expect: [403],
    },
    {
      id: 'S4.5-WRITE-UPGRADE-ADMIN',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationL)) return 'created reservation L unavailable';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationL}/upgrade`,
        token: ctx.adminToken,
        body: {
          reservationRoomId: state.createdReservationLFirstRoomId,
          nightlyRate: state.stage45UpgradeNightlyRate,
          reason: 'stage4.5 upgrade rate adjustment',
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (Number(r.json?.data?.reservationRoom?.nightlyRate) !== Number(state.stage45UpgradeNightlyRate)) {
          return `expected nightlyRate ${state.stage45UpgradeNightlyRate}, got ${String(r.json?.data?.reservationRoom?.nightlyRate)}`;
        }
        if (!ensureObjectIdLike(r.json?.data?.segment?._id)) return 'upgrade segment id missing';
        return null;
      },
    },
    {
      id: 'S4.5-VERIFY-UPGRADE-DETAILS-L',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationL)) return 'created reservation L unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationL}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (Number(r.json?.data?.ratePerNight) !== Number(state.stage45UpgradeNightlyRate)) {
          return `expected reservation ratePerNight ${state.stage45UpgradeNightlyRate}, got ${String(r.json?.data?.ratePerNight)}`;
        }
        if (r.json?.data?.status !== 'modified') return `expected modified, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.5-WRITE-ROOM-PATCH-RECEPTION',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        return null;
      },
      build: () => ({
        method: 'PATCH',
        url: `${baseReservations}/rooms/${state.createdReservationLFirstRoomId}`,
        token: ctx.receptionistToken,
        body: {
          nightlyRate: state.stage45RoomPatchNightlyRate,
          notes: 'stage4.5 room patch notes',
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (Number(r.json?.data?.nightlyRate) !== Number(state.stage45RoomPatchNightlyRate)) {
          return `expected room nightlyRate ${state.stage45RoomPatchNightlyRate}, got ${String(r.json?.data?.nightlyRate)}`;
        }
        return null;
      },
    },
    {
      id: 'S4.5-WRITE-ROOM-SEGMENTS-LIST-BASE',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/rooms/${state.createdReservationLFirstRoomId}/segments`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!Array.isArray(r.json?.data) || r.json.data.length < 1) return 'expected at least one baseline stay segment';
        return null;
      },
    },
    {
      id: 'S4.5-RBAC-RESTRICTED-ADD-SEGMENT-FORBIDDEN',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted-role user not found';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/rooms/${state.createdReservationLFirstRoomId}/segments`,
        token: ctx.restrictedToken,
        body: {
          fromDate: state.stage45SegmentFromDate,
          toDate: state.stage45SegmentToDate,
          ratePerNight: state.stage45RoomPatchNightlyRate,
          changeReason: 'stage4.5 restricted segment add',
        },
      }),
      expect: [403],
    },
    {
      id: 'S4.5-WRITE-ADD-SEGMENT-INVALID-BLOCKED',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/rooms/${state.createdReservationLFirstRoomId}/segments`,
        token: ctx.receptionistToken,
        body: {
          fromDate: state.stage45DepartureDate,
          toDate: addDaysYmd(state.stage45DepartureDate, 1),
          ratePerNight: state.stage45RoomPatchNightlyRate,
          changeReason: 'stage4.5 invalid segment bounds',
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S4.5-WRITE-ADD-SEGMENT-SUCCESS',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/rooms/${state.createdReservationLFirstRoomId}/segments`,
        token: ctx.receptionistToken,
        body: {
          fromDate: state.stage45SegmentFromDate,
          toDate: state.stage45SegmentToDate,
          ratePerNight: state.stage45RoomPatchNightlyRate,
          changeReason: 'stage4.5 valid segment add',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'created segment id missing';
        return null;
      },
      capture: (r) => { state.createdReservationLSegmentId = r.json?.data?._id || null; },
    },
    {
      id: 'S4.5-WRITE-ROOM-SEGMENTS-LIST-AFTER',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationLFirstRoomId)) return 'reservation L room id unavailable';
        if (!ensureObjectIdLike(state.createdReservationLSegmentId)) return 'created segment id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/rooms/${state.createdReservationLFirstRoomId}/segments`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const segments = Array.isArray(r.json?.data) ? r.json.data : [];
        const found = segments.some((segment) => String(segment?._id) === String(state.createdReservationLSegmentId));
        if (!found) return 'newly added segment not found in segments list';
        return null;
      },
    },
    {
      id: 'S4.5-WRITE-EARLY-DEPARTURE-INVALID-BLOCKED',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationL)) return 'created reservation L unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationL}/early-departure`,
        token: ctx.receptionistToken,
        body: {
          newDepartureDate: state.stage45ArrivalDate,
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S4.5-WRITE-EARLY-DEPARTURE-SUCCESS',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationL)) return 'created reservation L unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationL}/early-departure`,
        token: ctx.receptionistToken,
        body: {
          newDepartureDate: state.stage45EarlyDepartureDate,
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (String(r.json?.data?.departureDate || '').slice(0, 10) !== state.stage45EarlyDepartureDate) {
          return 'early-departure did not update departureDate as expected';
        }
        if (r.json?.data?.status !== 'modified') return `expected modified, got ${String(r.json?.data?.status)}`;
        return null;
      },
    },
    {
      id: 'S4.5-VERIFY-EARLY-DEPARTURE-ROOM-DATES',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationL)) return 'created reservation L unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationL}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const rooms = r.json?.data?.reservationRooms || [];
        const allUpdated = rooms.length >= 1 && rooms.every((room) => String(room?.departureDate || '').slice(0, 10) === state.stage45EarlyDepartureDate);
        if (!allUpdated) return 'not all reservation-room departure dates updated after early-departure';
        return null;
      },
    },
    {
      id: 'S5.4-RBAC-RESTRICTED-BULK-FORBIDDEN',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted-role user not found';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.restrictedToken,
        body: {
          propertyId: ctx.propertyId,
          reservationIds: [ctx.existingReservationId],
          action: 'send_confirmation',
        },
      }),
      expect: [403],
    },
    {
      id: 'S5.4-VALIDATION-BULK-MISSING-RESERVATIONIDS',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          action: 'send_confirmation',
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.4-WRITE-CREATE-M',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: baseReservations,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          arrivalDate: state.stage54ArrivalDate,
          departureDate: state.stage54DepartureDate,
          primaryGuestId: ctx.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 1,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'stage5_4',
          specialRequests: 'stage5.4 bulk-actions coverage',
        },
      }),
      expect: [201],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation M id';
        return null;
      },
      capture: (r) => { state.createdReservationM = r.json?.data?._id || null; },
    },
    {
      id: 'S5.4-RBAC-RECEPTION-BULK-CHECKIN-OVERRIDE-FORBIDDEN',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist user not found';
        if (!ensureObjectIdLike(state.createdReservationM)) return 'created reservation M unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.receptionistToken,
        body: {
          propertyId: ctx.propertyId,
          reservationIds: [state.createdReservationM],
          action: 'check_in',
          overrideEarlyArrival: true,
        },
      }),
      expect: [403],
    },
    {
      id: 'S5.4-WRITE-BULK-SEND-CONFIRMATION-SUCCESS',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationM)) return 'created reservation M unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          reservationIds: [state.createdReservationM],
          action: 'send_confirmation',
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const data = r.json?.data || {};
        if (data.action !== 'send_confirmation') return `expected action send_confirmation, got ${String(data.action)}`;
        if (Number(data.total) !== 1) return `expected total=1, got ${String(data.total)}`;
        if (Number(data.processed) !== 1) return `expected processed=1, got ${String(data.processed)}`;
        if (Number(data.succeeded) !== 1) return `expected succeeded=1, got ${String(data.succeeded)}`;
        if (Number(data.failed) !== 0) return `expected failed=0, got ${String(data.failed)}`;
        const rows = Array.isArray(data.results) ? data.results : [];
        if (rows.length !== 1) return `expected one result row, got ${rows.length}`;
        if (String(rows[0]?.reservationId) !== String(state.createdReservationM)) return 'bulk result reservationId mismatch';
        if (rows[0]?.success !== true) return 'bulk success row expected success=true';
        return null;
      },
    },
    {
      id: 'S5.4-WRITE-BULK-SEND-CONFIRMATION-MIXED',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationM)) return 'created reservation M unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          reservationIds: [state.createdReservationM, state.stage54MissingReservationId],
          action: 'send_confirmation',
        },
      }),
      expect: [200],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        const data = r.json?.data || {};
        if (Number(data.total) !== 2) return `expected total=2, got ${String(data.total)}`;
        if (Number(data.processed) !== 2) return `expected processed=2, got ${String(data.processed)}`;
        if (Number(data.succeeded) !== 1) return `expected succeeded=1, got ${String(data.succeeded)}`;
        if (Number(data.failed) !== 1) return `expected failed=1, got ${String(data.failed)}`;
        const rows = Array.isArray(data.results) ? data.results : [];
        const okRow = rows.find((row) => String(row?.reservationId) === String(state.createdReservationM));
        if (!okRow || okRow.success !== true) return 'expected success row for reservation M';
        const failRow = rows.find((row) => String(row?.reservationId) === String(state.stage54MissingReservationId));
        if (!failRow || failRow.success !== false) return 'expected failed row for missing reservation id';
        return null;
      },
    },
    {
      id: 'S5.4-VALIDATION-BULK-UNSUPPORTED-ACTION',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationM)) return 'created reservation M unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          reservationIds: [state.createdReservationM],
          action: 'totally_not_supported',
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.6-WRITE-BULK-BACKGROUND-ENQUEUE',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationM)) return 'created reservation M unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          reservationIds: [state.createdReservationM, state.stage56MissingReservationId],
          action: 'send_confirmation',
          background: true,
        },
      }),
      expect: [202],
      assert: (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;
        if (r.json?.data?.mode !== 'background') return `expected mode background, got ${String(r.json?.data?.mode)}`;
        if (!ensureObjectIdLike(r.json?.data?.job?.jobId)) return 'background job id missing';
        const status = String(r.json?.data?.job?.status || '');
        if (!['queued', 'running'].includes(status)) return `unexpected initial job status ${status}`;
        return null;
      },
      capture: (r) => { state.stage56JobId = r.json?.data?.job?.jobId || null; },
    },
    {
      id: 'S5.6-VERIFY-BULK-BACKGROUND-COMPLETED',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.stage56JobId)) return 'stage5.6 background job id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage56JobId}?propertyId=${encodeURIComponent(ctx.propertyId)}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: async (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;

        const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
        const jobUrl = `${baseReservations}/bulk-actions/jobs/${state.stage56JobId}?propertyId=${encodeURIComponent(ctx.propertyId)}&includeResults=1`;
        let job = r.json?.data?.job || null;

        for (let i = 0; i < 40; i++) {
          if (job && terminalStatuses.has(String(job.status || ''))) break;
          await waitMs(250);
          const poll = await requestJson({
            method: 'GET',
            url: jobUrl,
            token: ctx.adminToken,
          });
          if (poll.status !== 200) return `background job poll returned status ${poll.status}`;
          const pollErr = assertSuccessEnvelope(poll);
          if (pollErr) return `background job poll envelope invalid: ${pollErr}`;
          job = poll.json?.data?.job || null;
        }

        if (!job) return 'background job payload missing';
        if (job.status !== 'completed') return `expected completed status, got ${String(job.status)}`;
        if (Number(job.total) !== 2) return `expected job total=2, got ${String(job.total)}`;
        if (Number(job.processed) !== 2) return `expected job processed=2, got ${String(job.processed)}`;
        if (Number(job.succeeded) !== 1) return `expected job succeeded=1, got ${String(job.succeeded)}`;
        if (Number(job.failed) !== 1) return `expected job failed=1, got ${String(job.failed)}`;
        if (!Array.isArray(job.results) || job.results.length !== 2) return 'expected exactly 2 result rows from background job';
        return null;
      },
    },
    {
      id: 'S5.6-WRITE-BULK-BACKGROUND-CANCEL-TERMINAL-BLOCKED',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.stage56JobId)) return 'stage5.6 background job id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage56JobId}/cancel`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
        },
      }),
      expect: [409],
      assert: (r) => assertFailureEnvelope(r),
    },

    // ── Stage 5.8 — Bulk Jobs List endpoint ──────────────────────────────────
    {
      id: 'S5.8-LIST-NO-PROPERTYID',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs`,
        token: ctx.adminToken,
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.8-LIST-RBAC-RESTRICTED',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted token unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}`,
        token: ctx.restrictedToken,
      }),
      expect: [403],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.8-PREFS-RBAC-RESTRICTED-FORBIDDEN',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted token unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/preferences?propertyId=${ctx.propertyId}`,
        token: ctx.restrictedToken,
      }),
      expect: [403],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.8-PREFS-GET-BASELINE',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/preferences?propertyId=${ctx.propertyId}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const preset = r.json?.data?.defaultPreset;
        if (typeof preset !== 'string') return `expected defaultPreset string, got ${typeof preset}`;
        if (!Array.isArray(r.json?.data?.filterBundles)) return 'expected filterBundles array';
        return null;
      },
      capture: (r) => {
        state.stage58OriginalDefaultPreset = String(r.json?.data?.defaultPreset || '');
        state.stage58OriginalFilterBundles = Array.isArray(r.json?.data?.filterBundles)
          ? r.json.data.filterBundles
          : [];
      },
    },
    {
      id: 'S5.8-PREFS-SET-RETRYABLE-FAILURES',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'PUT',
        url: `${baseReservations}/bulk-actions/preferences`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          defaultPreset: 'retryable_failures',
        },
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const preset = String(r.json?.data?.defaultPreset || '');
        if (preset !== 'retryable_failures') return `expected retryable_failures, got ${preset}`;
        return null;
      },
    },
    {
      id: 'S5.8-PREFS-GET-VERIFY-SET',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/preferences?propertyId=${ctx.propertyId}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const preset = String(r.json?.data?.defaultPreset || '');
        if (preset !== 'retryable_failures') return `expected retryable_failures, got ${preset}`;
        return null;
      },
    },
    {
      id: 'S5.29-PREFS-SET-FILTER-BUNDLES',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'PUT',
        url: `${baseReservations}/bulk-actions/preferences`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          defaultPreset: 'retryable_failures',
          filterBundles: [
            {
              name: 'כשלים פתוחים',
              filters: {
                preset: 'retryable_failures',
                status: 'failed',
                action: 'cancel',
                hasFailures: true,
              },
            },
            {
              name: 'שלי להיום',
              filters: {
                preset: 'mine',
                from: datePlus(0),
                to: datePlus(0),
              },
            },
          ],
        },
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const preset = String(r.json?.data?.defaultPreset || '');
        if (preset !== 'retryable_failures') return `expected retryable_failures, got ${preset}`;
        const bundles = r.json?.data?.filterBundles;
        if (!Array.isArray(bundles) || bundles.length !== 2) {
          return `expected exactly 2 filterBundles, got ${Array.isArray(bundles) ? bundles.length : 'non-array'}`;
        }
        const first = bundles[0] || {};
        if (String(first.name || '') !== 'כשלים פתוחים') return `unexpected first bundle name: ${String(first.name || '')}`;
        if (String(first.filters?.preset || '') !== 'retryable_failures') return 'first bundle preset mismatch';
        if (String(first.filters?.status || '') !== 'failed') return 'first bundle status mismatch';
        if (String(first.filters?.action || '') !== 'cancel') return 'first bundle action mismatch';
        if (!first.filters?.hasFailures) return 'first bundle hasFailures expected true';
        return null;
      },
    },
    {
      id: 'S5.29-PREFS-GET-VERIFY-FILTER-BUNDLES',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/preferences?propertyId=${ctx.propertyId}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const bundles = r.json?.data?.filterBundles;
        if (!Array.isArray(bundles) || bundles.length !== 2) return 'expected 2 bundles after verify fetch';
        if (!bundles.every((bundle) => typeof bundle.id === 'string' && bundle.id.trim())) {
          return 'expected every bundle to include non-empty id';
        }
        const mineBundle = bundles.find((bundle) => String(bundle.name || '') === 'שלי להיום');
        if (!mineBundle) return 'missing "שלי להיום" bundle';
        if (String(mineBundle.filters?.preset || '') !== 'mine') return 'mine bundle preset mismatch';
        if (String(mineBundle.filters?.from || '') !== datePlus(0)) return 'mine bundle from mismatch';
        if (String(mineBundle.filters?.to || '') !== datePlus(0)) return 'mine bundle to mismatch';
        return null;
      },
    },
    {
      id: 'S5.29-PREFS-VALIDATION-BUNDLE-NAME-TOO-LONG',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'PUT',
        url: `${baseReservations}/bulk-actions/preferences`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          filterBundles: [
            {
              name: 'x'.repeat(65),
              filters: { preset: 'active' },
            },
          ],
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.8-PREFS-VALIDATION-INVALID-PRESET',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'PUT',
        url: `${baseReservations}/bulk-actions/preferences`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          defaultPreset: 'totally_not_a_valid_preset',
        },
      }),
      expect: [400],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.8-PREFS-RESTORE-BASELINE',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'PUT',
        url: `${baseReservations}/bulk-actions/preferences`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          defaultPreset: state.stage58OriginalDefaultPreset || '',
          filterBundles: Array.isArray(state.stage58OriginalFilterBundles)
            ? state.stage58OriginalFilterBundles
            : [],
        },
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const expected = String(state.stage58OriginalDefaultPreset || '');
        const actual = String(r.json?.data?.defaultPreset || '');
        if (actual !== expected) return `expected restored preset ${expected || '<empty>'}, got ${actual || '<empty>'}`;
        if (!Array.isArray(r.json?.data?.filterBundles)) return 'expected restored filterBundles array';
        return null;
      },
    },
    {
      id: 'S5.8-LIST-OK-RETURNS-ARRAY',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&limit=10`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs, pagination } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected data.jobs to be an array';
        if (!pagination || typeof pagination.total !== 'number') return 'expected data.pagination with total';
        if (typeof pagination.page !== 'number')  return 'expected pagination.page';
        if (typeof pagination.pages !== 'number') return 'expected pagination.pages';
        if (typeof pagination.limit !== 'number') return 'expected pagination.limit';
        state.stage58TotalJobs = pagination.total;
        return null;
      },
    },
    {
      id: 'S5.8-LIST-STATUS-FILTER-COMPLETED',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&status=completed&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        for (const j of jobs) {
          if (j.status !== 'completed') return `expected all jobs to be completed, got ${j.status}`;
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-ACTION-FILTER',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&action=send_confirmation&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        for (const j of jobs) {
          if (j.action !== 'send_confirmation') return `expected action=send_confirmation, got ${j.action}`;
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-HAS-FAILURES-FILTER',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&hasFailures=1&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        if (!jobs.length) return 'expected at least one job with failures';
        for (const j of jobs) {
          if (Number(j.failed || 0) <= 0) return `expected failed>0 under hasFailures filter, got ${String(j.failed)}`;
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-PRESET-ACTIVE',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&preset=active&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        for (const j of jobs) {
          if (!['queued', 'running'].includes(String(j.status || ''))) {
            return `expected active preset statuses queued/running, got ${String(j.status)}`;
          }
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-PRESET-ACTIVE-CANCELABLE',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&preset=active_cancelable&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        for (const j of jobs) {
          if (!['queued', 'running'].includes(String(j.status || ''))) {
            return `expected active-cancelable statuses queued/running, got ${String(j.status)}`;
          }
          if (j.cancelRequested) return 'expected cancelRequested=false under active_cancelable preset';
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-PRESET-FAILED',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&preset=failed&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        if (!jobs.length) return 'expected at least one failed preset job';
        for (const j of jobs) {
          if (Number(j.failed || 0) <= 0) {
            return `expected failed>0 under failed preset, got ${String(j.failed)}`;
          }
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-PRESET-RETRYABLE-FAILURES',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&preset=retryable_failures&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        if (!jobs.length) return 'expected at least one retryable-failures preset job';
        for (const j of jobs) {
          if (Number(j.failed || 0) <= 0) {
            return `expected failed>0 under retryable_failures preset, got ${String(j.failed)}`;
          }
          if (!['completed', 'failed', 'cancelled'].includes(String(j.status || ''))) {
            return `expected terminal status under retryable_failures preset, got ${String(j.status)}`;
          }
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-PRESET-MINE',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&preset=mine&limit=20`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        if (!jobs.length) return 'expected at least one mine preset job';
        for (const j of jobs) {
          if (String(j.actorId || '') !== String(ctx.adminUser._id || '')) {
            return `mine preset actor mismatch: expected ${String(ctx.adminUser._id)}, got ${String(j.actorId)}`;
          }
        }
        return null;
      },
    },
    {
      id: 'S5.8-LIST-PAGINATION-LIMIT1',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (typeof state.stage58TotalJobs !== 'number' || state.stage58TotalJobs < 2) return 'need ≥2 jobs to test pagination';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&limit=1&page=1`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs, pagination } = r.json?.data || {};
        if (!Array.isArray(jobs) || jobs.length !== 1) return `expected exactly 1 job with limit=1, got ${jobs?.length}`;
        if (pagination.pages < 2) return `expected pages≥2 when total=${state.stage58TotalJobs} with limit=1`;
        return null;
      },
    },
    {
      id: 'S5.8-LIST-DATE-FILTER-FUTURE-EMPTY',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs?propertyId=${ctx.propertyId}&from=${datePlus(1)}&to=${datePlus(2)}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const { jobs } = r.json?.data || {};
        if (!Array.isArray(jobs)) return 'expected jobs array';
        if (jobs.length !== 0) return `expected 0 jobs for a future date range, got ${jobs.length}`;
        return null;
      },
    },
    {
      id: 'S5.22.7-WRITE-RETRY-FAILED-ACCEPTED',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.stage56JobId)) return 'stage5.6 background job id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage56JobId}/retry-failed`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
        },
      }),
      expect: [202],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const data = r.json?.data || {};
        if (data.mode !== 'background') return `expected mode=background, got ${String(data.mode)}`;
        if (String(data.sourceJobId || '') !== String(state.stage56JobId)) {
          return `expected sourceJobId=${state.stage56JobId}, got ${String(data.sourceJobId)}`;
        }
        if (Number(data.failedCount) !== 1) return `expected failedCount=1, got ${String(data.failedCount)}`;
        if (!ensureObjectIdLike(data.job?.jobId)) return 'retry job id missing';
        return null;
      },
      capture: (r) => { state.stage5227RetryJobId = r.json?.data?.job?.jobId || null; },
    },
    {
      id: 'S5.22.7-VERIFY-RETRY-FAILED-COMPLETED',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.stage5227RetryJobId)) return 'stage5.22.7 retry job id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage5227RetryJobId}?propertyId=${encodeURIComponent(ctx.propertyId)}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: async (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;

        const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
        const jobUrl = `${baseReservations}/bulk-actions/jobs/${state.stage5227RetryJobId}?propertyId=${encodeURIComponent(ctx.propertyId)}&includeResults=1`;
        let job = r.json?.data?.job || null;

        for (let i = 0; i < 40; i++) {
          if (job && terminalStatuses.has(String(job.status || ''))) break;
          await waitMs(250);
          const poll = await requestJson({
            method: 'GET',
            url: jobUrl,
            token: ctx.adminToken,
          });
          if (poll.status !== 200) return `retry-failed job poll returned status ${poll.status}`;
          const pollErr = assertSuccessEnvelope(poll);
          if (pollErr) return `retry-failed poll envelope invalid: ${pollErr}`;
          job = poll.json?.data?.job || null;
        }

        if (!job) return 'retry-failed job payload missing';
        if (job.status !== 'completed') return `expected completed status, got ${String(job.status)}`;
        if (Number(job.total) !== 1) return `expected job total=1, got ${String(job.total)}`;
        if (Number(job.processed) !== 1) return `expected job processed=1, got ${String(job.processed)}`;
        if (Number(job.succeeded) !== 0) return `expected job succeeded=0, got ${String(job.succeeded)}`;
        if (Number(job.failed) !== 1) return `expected job failed=1, got ${String(job.failed)}`;
        if (!Array.isArray(job.results) || job.results.length !== 1) return 'expected exactly 1 result row from retry-failed job';
        if (String(job.results[0]?.reservationId || '') !== String(state.stage56MissingReservationId)) {
          return 'retry-failed job reservationId mismatch';
        }
        if (job.results[0]?.success !== false) return 'expected failed retry row success=false';
        return null;
      },
    },
    {
      id: 'S5.22.7-WRITE-BULK-BACKGROUND-ENQUEUE-SUCCESS-ONLY',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationM)) return 'created reservation M unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          reservationIds: [state.createdReservationM],
          action: 'send_confirmation',
          background: true,
        },
      }),
      expect: [202],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        if (!ensureObjectIdLike(r.json?.data?.job?.jobId)) return 'success-only background job id missing';
        return null;
      },
      capture: (r) => { state.stage5227NoFailJobId = r.json?.data?.job?.jobId || null; },
    },
    {
      id: 'S5.22.7-VERIFY-BULK-BACKGROUND-SUCCESS-ONLY-COMPLETED',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.stage5227NoFailJobId)) return 'stage5.22.7 success-only job id unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage5227NoFailJobId}?propertyId=${encodeURIComponent(ctx.propertyId)}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: async (r) => {
        const envErr = assertSuccessEnvelope(r);
        if (envErr) return envErr;

        const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
        const jobUrl = `${baseReservations}/bulk-actions/jobs/${state.stage5227NoFailJobId}?propertyId=${encodeURIComponent(ctx.propertyId)}&includeResults=1`;
        let job = r.json?.data?.job || null;

        for (let i = 0; i < 40; i++) {
          if (job && terminalStatuses.has(String(job.status || ''))) break;
          await waitMs(250);
          const poll = await requestJson({
            method: 'GET',
            url: jobUrl,
            token: ctx.adminToken,
          });
          if (poll.status !== 200) return `success-only job poll returned status ${poll.status}`;
          const pollErr = assertSuccessEnvelope(poll);
          if (pollErr) return `success-only poll envelope invalid: ${pollErr}`;
          job = poll.json?.data?.job || null;
        }

        if (!job) return 'success-only job payload missing';
        if (job.status !== 'completed') return `expected completed status, got ${String(job.status)}`;
        if (Number(job.total) !== 1) return `expected job total=1, got ${String(job.total)}`;
        if (Number(job.processed) !== 1) return `expected job processed=1, got ${String(job.processed)}`;
        if (Number(job.succeeded) !== 1) return `expected job succeeded=1, got ${String(job.succeeded)}`;
        if (Number(job.failed) !== 0) return `expected job failed=0, got ${String(job.failed)}`;
        return null;
      },
    },
    {
      id: 'S5.22.7-VALIDATION-RETRY-FAILED-NO-FAILED-ROWS',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.stage5227NoFailJobId)) return 'stage5.22.7 success-only job id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage5227NoFailJobId}/retry-failed`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
        },
      }),
      expect: [409],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.23-RBAC-RESTRICTED-RETRY-FAILED-FORBIDDEN',
      skip: () => {
        if (!ctx.restrictedToken) return 'restricted token unavailable';
        if (!ensureObjectIdLike(state.stage56JobId)) return 'stage5.6 background job id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage56JobId}/retry-failed`,
        token: ctx.restrictedToken,
        body: {
          propertyId: ctx.propertyId,
        },
      }),
      expect: [403],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.23-SCOPE-WRONG-TOKEN-RETRY-FAILED-FORBIDDEN',
      skip: () => {
        if (!ctx.forgedWrongPropertyToken) return 'wrong-property token unavailable';
        if (!ensureObjectIdLike(state.stage56JobId)) return 'stage5.6 background job id unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions/jobs/${state.stage56JobId}/retry-failed`,
        token: ctx.forgedWrongPropertyToken,
        body: {
          propertyId: ctx.propertyId,
        },
      }),
      expect: [403],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.23-VALIDATION-RETRY-FAILED-JOB-NOT-FOUND',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/bulk-actions/jobs/${randomObjectIdLike()}/retry-failed`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
        },
      }),
      expect: [404],
      assert: (r) => assertFailureEnvelope(r),
    },
    {
      id: 'S5.20-WRITE-CREATE-N',
      skip: () => (!ctx.adminToken ? 'admin token unavailable' : null),
      build: () => ({
        method: 'POST',
        url: baseReservations,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          arrivalDate: state.stage520ArrivalDate,
          departureDate: state.stage520DepartureDate,
          primaryGuestId: ctx.primaryGuestId,
          adults: 2,
          children: 0,
          roomsCount: 1,
          ratePerNight: env.ratePerNight,
          source: 'direct',
          marketSegment: 'stage5_20',
          specialRequests: 'stage5.20 move+resize flow',
        },
      }),
      expect: [201],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'missing created reservation N id';
        return null;
      },
      capture: (r) => { state.createdReservationN = r.json?.data?._id || null; },
    },
    {
      id: 'S5.20-WRITE-DETAILS-N',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationN)) return 'created reservation N unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationN}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const rooms = r.json?.data?.reservationRooms;
        if (!Array.isArray(rooms) || rooms.length < 1) return 'reservation N must include at least one reservation room';
        if (!ensureObjectIdLike(r.json?.data?.assignedRoom?._id)) return 'reservation N assigned room missing';
        return null;
      },
      capture: (r) => {
        const rooms = r.json?.data?.reservationRooms || [];
        state.createdReservationNFirstRoomId = rooms[0]?._id || null;
        state.createdReservationNAssignedRoomId = r.json?.data?.assignedRoom?._id || null;
      },
    },
    {
      id: 'S5.20-WRITE-LIST-ROOMS-FOR-MOVE-N',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationNAssignedRoomId)) return 'reservation N assigned room unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${env.baseUrl}/rooms?propertyId=${encodeURIComponent(ctx.propertyId)}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        if (!Array.isArray(r.json?.data) || r.json.data.length === 0) return 'rooms list is empty';
        return null;
      },
      capture: (r) => {
        const rooms = Array.isArray(r.json?.data) ? r.json.data : [];
        const candidate = rooms.find((room) => (
          ensureObjectIdLike(room?._id)
          && String(room._id) !== String(state.createdReservationNAssignedRoomId)
          && room.opsStatus !== 'out_of_order'
          && ['clean', 'inspected'].includes(String(room.cleanStatus || '').toLowerCase())
          && String(room.occStatus || '').toLowerCase() !== 'occupied'
        ));
        state.stage520AlternateRoomId = candidate?._id || null;
      },
    },
    {
      id: 'S5.20-WRITE-CREATE-FALLBACK-ROOM-FOR-MOVE',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (ensureObjectIdLike(state.stage520AlternateRoomId)) return 'alternate room already available';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${env.baseUrl}/rooms`,
        token: ctx.adminToken,
        body: {
          propertyId: ctx.propertyId,
          roomTypeId: ctx.roomTypeId,
          number: `S520-${Date.now()}`,
          floor: 99,
          opsStatus: 'available',
          cleanStatus: 'clean',
          occStatus: 'vacant',
        },
      }),
      expect: [201],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        if (!ensureObjectIdLike(r.json?.data?._id)) return 'fallback room create did not return room id';
        return null;
      },
      capture: (r) => {
        state.stage520FallbackRoomId = r.json?.data?._id || null;
        if (ensureObjectIdLike(state.stage520FallbackRoomId)) {
          state.stage520AlternateRoomId = state.stage520FallbackRoomId;
        }
      },
    },
    {
      id: 'S5.20-WRITE-MOVE-ROOM-N',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist token unavailable';
        if (!ensureObjectIdLike(state.createdReservationN)) return 'created reservation N unavailable';
        if (!ensureObjectIdLike(state.createdReservationNFirstRoomId)) return 'reservation N room id unavailable';
        if (!ensureObjectIdLike(state.stage520AlternateRoomId)) return 'no alternate room found for move';
        return null;
      },
      build: () => ({
        method: 'PATCH',
        url: `${baseReservations}/${state.createdReservationN}/assign-room`,
        token: ctx.receptionistToken,
        body: {
          roomId: state.stage520AlternateRoomId,
          reservationRoomId: state.createdReservationNFirstRoomId,
        },
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const assignedId = r.json?.data?.assignedRoom?._id || r.json?.data?.assignedRoom;
        if (String(assignedId || '') !== String(state.stage520AlternateRoomId)) {
          return `expected assignedRoom ${String(state.stage520AlternateRoomId)}, got ${String(assignedId)}`;
        }
        return null;
      },
    },
    {
      id: 'S5.20-WRITE-RESIZE-EXTEND-N',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist token unavailable';
        if (!ensureObjectIdLike(state.createdReservationN)) return 'created reservation N unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationN}/extend`,
        token: ctx.receptionistToken,
        body: {
          newDepartureDate: state.stage520ExtendedDepartureDate,
          nightlyRate: state.stage520NightlyRate,
        },
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        if (String(r.json?.data?.departureDate || '').slice(0, 10) !== state.stage520ExtendedDepartureDate) {
          return 'extend step did not update departureDate as expected';
        }
        if (Number(r.json?.data?.ratePerNight) !== Number(state.stage520NightlyRate)) {
          return `expected ratePerNight ${state.stage520NightlyRate}, got ${String(r.json?.data?.ratePerNight)}`;
        }
        return null;
      },
    },
    {
      id: 'S5.20-WRITE-RESIZE-EARLY-DEPARTURE-N',
      skip: () => {
        if (!ctx.receptionistToken) return 'receptionist token unavailable';
        if (!ensureObjectIdLike(state.createdReservationN)) return 'created reservation N unavailable';
        return null;
      },
      build: () => ({
        method: 'POST',
        url: `${baseReservations}/${state.createdReservationN}/early-departure`,
        token: ctx.receptionistToken,
        body: {
          newDepartureDate: state.stage520EarlyDepartureDate,
        },
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        if (String(r.json?.data?.departureDate || '').slice(0, 10) !== state.stage520EarlyDepartureDate) {
          return 'early-departure step did not update departureDate as expected';
        }
        return null;
      },
    },
    {
      id: 'S5.20-VERIFY-FINAL-N',
      skip: () => {
        if (!ctx.adminToken) return 'admin token unavailable';
        if (!ensureObjectIdLike(state.createdReservationN)) return 'created reservation N unavailable';
        if (!ensureObjectIdLike(state.stage520AlternateRoomId)) return 'stage5.20 target room unavailable';
        return null;
      },
      build: () => ({
        method: 'GET',
        url: `${baseReservations}/${state.createdReservationN}`,
        token: ctx.adminToken,
      }),
      expect: [200],
      assert: (r) => {
        const err = assertSuccessEnvelope(r);
        if (err) return err;
        const data = r.json?.data || {};
        if (String(data.departureDate || '').slice(0, 10) !== state.stage520EarlyDepartureDate) {
          return `expected departureDate=${state.stage520EarlyDepartureDate}, got ${String(data.departureDate)}`;
        }
        if (Number(data.ratePerNight) !== Number(state.stage520NightlyRate)) {
          return `expected final ratePerNight=${state.stage520NightlyRate}, got ${String(data.ratePerNight)}`;
        }
        const assignedId = data.assignedRoom?._id || data.assignedRoom;
        if (String(assignedId || '') !== String(state.stage520AlternateRoomId)) {
          return `expected final assignedRoom=${state.stage520AlternateRoomId}, got ${String(assignedId)}`;
        }
        const rooms = Array.isArray(data.reservationRooms) ? data.reservationRooms : [];
        if (!rooms.length) return 'expected reservationRooms in final verification';
        const allUpdated = rooms.every((rr) => String(rr?.departureDate || '').slice(0, 10) === state.stage520EarlyDepartureDate);
        if (!allUpdated) return 'not all reservation-room departure dates were updated after resize sequence';
        return null;
      },
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
      const customErr = await tc.assert(result);
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
    state.createdReservationE,
    state.createdReservationF,
    state.duplicatedReservationFromB,
    state.createdReservationK,
    state.createdReservationL,
    state.createdReservationM,
    state.createdReservationN,
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

  if (ensureObjectIdLike(state.stage520FallbackRoomId)) {
    try {
      await requestJson({
        method: 'DELETE',
        url: `${env.baseUrl}/rooms/${state.stage520FallbackRoomId}`,
        token: ctx.adminToken,
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
