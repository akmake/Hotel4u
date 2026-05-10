import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import Property from './models/Property.js';
import RoomType from './models/RoomType.js';
import Room from './models/Room.js';
import InventoryDate from './models/InventoryDate.js';
import { RatePlan, RateDate } from './models/RatePlan.js';
import GuestProfile from './models/GuestProfile.js';
import Reservation from './models/Reservation.js';
import Folio from './models/Folio.js';
import HousekeepingTask from './models/HousekeepingTask.js';
import MaintenanceTicket from './models/MaintenanceTicket.js';
import User from './models/User.js';
import Company from './models/Company.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u';

const BASE = new Date();
function d(offset = 0) {
  const dt = new Date(BASE);
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().split('T')[0];
}

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    await mongoose.connection.collections[name].deleteMany({});
  }
  console.log('Cleared all collections');

  // ── Property ────────────────────────────────────────────────────────────────
  const property = await Property.create({
    name: 'מלון הגליל', legalName: 'הגליל נכסים בע"מ',
    city: 'טבריה', country: 'IL',
    phone: '04-6720000', email: 'info@galil-hotel.co.il',
    checkInTime: '15:00', checkOutTime: '11:00',
    totalRooms: 32,
  });

  // ── Room Types ──────────────────────────────────────────────────────────────
  const [std, dlx, fam, ste] = await RoomType.insertMany([
    { property: property._id, code:'STD',  name:'חדר סטנדרט', capacityBase:2, capacityMax:3, baseRate:380, sortOrder:1 },
    { property: property._id, code:'DLX',  name:'חדר דלוקס',  capacityBase:2, capacityMax:3, baseRate:520, sortOrder:2 },
    { property: property._id, code:'FAM',  name:'חדר משפחה',  capacityBase:4, capacityMax:5, baseRate:650, sortOrder:3 },
    { property: property._id, code:'STE',  name:'סוויטה',      capacityBase:2, capacityMax:4, baseRate:890, sortOrder:4 },
  ]);

  // ── Rooms ───────────────────────────────────────────────────────────────────
  const roomData = [
    { number:'101', floor:1, roomType:std._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'vacant' },
    { number:'102', floor:1, roomType:std._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'103', floor:1, roomType:std._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'104', floor:1, roomType:std._id, opsStatus:'out_of_order',     cleanStatus:'dirty',     occStatus:'vacant' },
    { number:'105', floor:1, roomType:std._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'106', floor:1, roomType:std._id, opsStatus:'available',        cleanStatus:'inspected', occStatus:'vacant' },
    { number:'107', floor:1, roomType:std._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'due_in' },
    { number:'108', floor:1, roomType:std._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'occupied' },
    { number:'201', floor:2, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'due_in' },
    { number:'202', floor:2, roomType:dlx._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'203', floor:2, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'204', floor:2, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'205', floor:2, roomType:dlx._id, opsStatus:'maintenance_hold', cleanStatus:'clean',     occStatus:'vacant' },
    { number:'206', floor:2, roomType:dlx._id, opsStatus:'available',        cleanStatus:'inspected', occStatus:'vacant' },
    { number:'207', floor:2, roomType:dlx._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'208', floor:2, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'due_in' },
    { number:'301', floor:3, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'302', floor:3, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'303', floor:3, roomType:dlx._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'304', floor:3, roomType:dlx._id, opsStatus:'available',        cleanStatus:'inspected', occStatus:'vacant' },
    { number:'305', floor:3, roomType:dlx._id, opsStatus:'out_of_order',     cleanStatus:'dirty',     occStatus:'vacant' },
    { number:'306', floor:3, roomType:dlx._id, opsStatus:'available',        cleanStatus:'inspected', occStatus:'due_in' },
    { number:'307', floor:3, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'308', floor:3, roomType:dlx._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'401', floor:4, roomType:fam._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'402', floor:4, roomType:fam._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'due_in' },
    { number:'403', floor:4, roomType:fam._id, opsStatus:'available',        cleanStatus:'inspected', occStatus:'vacant' },
    { number:'404', floor:4, roomType:fam._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'501', floor:5, roomType:ste._id, opsStatus:'available',        cleanStatus:'inspected', occStatus:'due_in',  isVip:true },
    { number:'502', floor:5, roomType:ste._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'occupied' },
    { number:'503', floor:5, roomType:ste._id, opsStatus:'available',        cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'504', floor:5, roomType:ste._id, opsStatus:'available',        cleanStatus:'clean',     occStatus:'vacant' },
  ];
  const rooms = await Room.insertMany(roomData.map(r => ({ ...r, property: property._id })));
  const roomByNum = Object.fromEntries(rooms.map(r => [r.number, r]));

  // ── Rate Plans ──────────────────────────────────────────────────────────────
  const [barPlan, vipPlan, otaPlan, corpPlan] = await RatePlan.insertMany([
    { property: property._id, code:'BAR',  name:'Best Available Rate', type:'public',    isRefundable:true,  channels:['direct','booking','expedia','agoda'] },
    { property: property._id, code:'VIP',  name:'VIP Rate',            type:'corporate', isRefundable:true,  channels:['direct'] },
    { property: property._id, code:'OTA',  name:'OTA Non-Refundable',  type:'ota',       isRefundable:false, channels:['booking','expedia'] },
    { property: property._id, code:'CORP', name:'Corporate Rate',      type:'corporate', isRefundable:true,  channels:['direct'] },
  ]);

  const rateDocs = [];
  for (let i = -90; i < 90; i++) {
    const date = d(i);
    const isWeekend = [5, 6].includes(new Date(date).getDay());
    const m = isWeekend ? 1.3 : 1;
    for (const [rt, base] of [[std,380],[dlx,520],[fam,650],[ste,890]]) {
      rateDocs.push({ ratePlan: barPlan._id,  roomType: rt._id, date, price: Math.round(base * m) });
      rateDocs.push({ ratePlan: vipPlan._id,  roomType: rt._id, date, price: Math.round(base * m * 0.85) });
      rateDocs.push({ ratePlan: otaPlan._id,  roomType: rt._id, date, price: Math.round(base * m * 0.95) });
      rateDocs.push({ ratePlan: corpPlan._id, roomType: rt._id, date, price: Math.round(base * m * 0.88) });
    }
  }
  await RateDate.insertMany(rateDocs);

  // ── InventoryDate ───────────────────────────────────────────────────────────
  const invDocs = [];
  const typeRoomCount = { [std._id]: 8, [dlx._id]: 16, [fam._id]: 4, [ste._id]: 4 };
  for (let i = -90; i < 90; i++) {
    const date = d(i);
    for (const [typeId, count] of Object.entries(typeRoomCount)) {
      invDocs.push({
        property: property._id, roomType: typeId, date,
        physicalCount: count,
        oooCount: typeId === String(std._id) ? 1 : typeId === String(dlx._id) ? 1 : 0,
        bookedCount: 0,
      });
    }
  }
  await InventoryDate.insertMany(invDocs);

  // ── Users ────────────────────────────────────────────────────────────────────
  const hash = await bcrypt.hash('hotel4u123', 12);
  const [adminUser, receptionistUser, hkManagerUser, techUser, rinat, miriam, leah] = await User.insertMany([
    { property: property._id, firstName:'יוסף', lastName:'דהן',    email:'admin@galil.co.il',  passwordHash: hash, role:'property_admin' },
    { property: property._id, firstName:'דינה', lastName:'לוי',    email:'dina@galil.co.il',   passwordHash: hash, role:'receptionist' },
    { property: property._id, firstName:'רות',  lastName:'כהן',    email:'ruth@galil.co.il',   passwordHash: hash, role:'housekeeping_manager' },
    { property: property._id, firstName:'אבי',  lastName:'מזרחי', email:'avi@galil.co.il',    passwordHash: hash, role:'technician' },
    { property: property._id, firstName:'רינת', lastName:'אביב',  email:'rinat@galil.co.il',  passwordHash: hash, role:'housekeeper' },
    { property: property._id, firstName:'מרים', lastName:'כץ',    email:'miriam@galil.co.il', passwordHash: hash, role:'housekeeper' },
    { property: property._id, firstName:'לאה',  lastName:'ברק',   email:'leah@galil.co.il',   passwordHash: hash, role:'housekeeper' },
  ]);

  // ── Companies ────────────────────────────────────────────────────────────────
  const [compTech, compGov, compTravel, compLux] = await Company.insertMany([
    { property: property._id, name:'רפאל מערכות מתקדמות בע"מ', type:'corporate',     contactName:'מיכל שרון',  email:'booking@rafael.co.il',  phone:'03-9110000', taxId:'516123456', creditLimit:50000, discountPct:12, active:true },
    { property: property._id, name:'משרד הביטחון',             type:'government',    contactName:'רס"ן אבי גל',email:'travel@mod.gov.il',     phone:'03-6970000', taxId:'500000001', creditLimit:80000, discountPct:8,  active:true },
    { property: property._id, name:'ישראייר תיירות בע"מ',      type:'agency',        contactName:'ורד מוסרי',  email:'hotels@israir.co.il',   phone:'03-7950000', taxId:'512345678', creditLimit:30000, discountPct:10, active:true },
    { property: property._id, name:'Luxury Collection DMC',   type:'tour_operator', contactName:'James Levy', email:'james@luxdmc.com',       phone:'+972-4-9990000', taxId:'514999888', creditLimit:20000, discountPct:15, active:true },
  ]);

  // ── Guests (60 guests) ──────────────────────────────────────────────────────
  const guestData = [
    // Israeli locals
    { firstName:'דוד',     lastName:'לוי',       email:'david.levi@example.com',     phone:'050-1234567', country:'IL', vipLevel:0, totalStays:3 },
    { firstName:'שרה',     lastName:'כהן',       email:'sarah.cohen@example.com',    phone:'052-9876543', country:'IL', vipLevel:3, totalStays:12 },
    { firstName:'אביב',    lastName:'מזרחי',     email:'aviv.mizrahi@example.com',   phone:'054-5551234', country:'IL', vipLevel:1, totalStays:5 },
    { firstName:'נועה',    lastName:'פרידמן',    email:'noa.friedman@example.com',   phone:'058-7778899', country:'IL', vipLevel:0, totalStays:2 },
    { firstName:'יוסי',    lastName:'ברקוביץ',   email:'yossi.b@example.com',        phone:'050-3334455', country:'IL', vipLevel:1, totalStays:7 },
    { firstName:'רחל',     lastName:'גולן',      email:'rachel.golan@example.com',   phone:'052-6667788', country:'IL', vipLevel:4, totalStays:15 },
    { firstName:'גדי',     lastName:'שמש',       email:'gadi.shemesh@example.com',   phone:'054-1112233', country:'IL', vipLevel:0, totalStays:2 },
    { firstName:'מיה',     lastName:'רוז',       email:'mia.roz@example.com',        phone:'052-4445566', country:'IL', vipLevel:1, totalStays:3 },
    { firstName:'אורי',    lastName:'כץ',        email:'uri.katz@example.com',       phone:'054-2223344', country:'IL', vipLevel:0, totalStays:1 },
    { firstName:'ליאת',    lastName:'שפירא',     email:'liat.shapira@example.com',   phone:'050-9990011', country:'IL', vipLevel:2, totalStays:6 },
    { firstName:'עומר',    lastName:'חדד',       email:'omer.hadad@example.com',     phone:'052-1230000', country:'IL', vipLevel:0, totalStays:1 },
    { firstName:'תמר',     lastName:'נחמן',      email:'tamar.nachman@example.com',  phone:'058-5556677', country:'IL', vipLevel:1, totalStays:4 },
    { firstName:'רן',      lastName:'אלון',      email:'ran.alon@example.com',       phone:'054-8889900', country:'IL', vipLevel:0, totalStays:2 },
    { firstName:'הילה',    lastName:'בן-דוד',    email:'hila.bendavid@example.com',  phone:'050-7778888', country:'IL', vipLevel:0, totalStays:3 },
    { firstName:'דנית',    lastName:'פרץ',       email:'danit.peretz@example.com',   phone:'052-3332222', country:'IL', vipLevel:0, totalStays:1 },
    { firstName:'יואב',    lastName:'ביטון',     email:'yoav.biton@example.com',     phone:'054-6667778', country:'IL', vipLevel:1, totalStays:5 },
    { firstName:'שירה',    lastName:'אזוג',      email:'shira.azoulay@example.com',  phone:'050-1112223', country:'IL', vipLevel:0, totalStays:2 },
    { firstName:'נדב',     lastName:'ורד',       email:'nadav.vered@example.com',    phone:'052-8887776', country:'IL', vipLevel:0, totalStays:1 },
    { firstName:'יעל',     lastName:'שלום',      email:'yael.shalom@example.com',    phone:'058-2223334', country:'IL', vipLevel:2, totalStays:8 },
    { firstName:'בן',      lastName:'חיים',      email:'ben.haim@example.com',       phone:'054-4445556', country:'IL', vipLevel:0, totalStays:1 },
    // International
    { firstName:'Michael', lastName:'Brown',    email:'mbrown@example.com',          phone:'+1-555-0100',    country:'US', vipLevel:0, totalStays:1 },
    { firstName:'Sophie',  lastName:'Dupont',   email:'sophie.dupont@example.com',   phone:'+33-612345678',  country:'FR', vipLevel:2, totalStays:8 },
    { firstName:'Ahmad',   lastName:'Hassan',   email:'ahmad.hassan@example.com',    phone:'+971-501234567', country:'AE', vipLevel:0, totalStays:4 },
    { firstName:'Emma',    lastName:'Wilson',   email:'emma.wilson@example.com',     phone:'+44-7700900123', country:'GB', vipLevel:0, totalStays:1 },
    { firstName:'Luca',    lastName:'Rossi',    email:'luca.rossi@example.com',      phone:'+39-335123456',  country:'IT', vipLevel:1, totalStays:3 },
    { firstName:'Anna',    lastName:'Müller',   email:'anna.mueller@example.com',    phone:'+49-17012345',   country:'DE', vipLevel:0, totalStays:2 },
    { firstName:'Carlos',  lastName:'García',   email:'carlos.garcia@example.com',   phone:'+34-612345678',  country:'ES', vipLevel:0, totalStays:1 },
    { firstName:'Yuki',    lastName:'Tanaka',   email:'yuki.tanaka@example.com',     phone:'+81-9012345678', country:'JP', vipLevel:1, totalStays:4 },
    { firstName:'Chen',    lastName:'Wei',      email:'chen.wei@example.com',        phone:'+86-13812345678',country:'CN', vipLevel:0, totalStays:2 },
    { firstName:'Olga',    lastName:'Petrov',   email:'olga.petrov@example.com',     phone:'+7-9161234567',  country:'RU', vipLevel:0, totalStays:1 },
    { firstName:'John',    lastName:'Smith',    email:'john.smith@example.com',      phone:'+1-212-5550123', country:'US', vipLevel:2, totalStays:9 },
    { firstName:'Maria',   lastName:'Santos',   email:'maria.santos@example.com',    phone:'+55-11912345678',country:'BR', vipLevel:0, totalStays:1 },
    { firstName:'Pierre',  lastName:'Martin',   email:'pierre.martin@example.com',   phone:'+33-698765432',  country:'FR', vipLevel:1, totalStays:5 },
    { firstName:'Elena',   lastName:'Kovach',   email:'elena.kovach@example.com',    phone:'+380-671234567', country:'UA', vipLevel:0, totalStays:2 },
    { firstName:'David',   lastName:'Green',    email:'david.green@example.com',     phone:'+1-310-5559876', country:'US', vipLevel:3, totalStays:11 },
    // Corporate / frequent
    { firstName:'ענת',     lastName:'שגיא',     email:'anat.sagi@rafael.co.il',      phone:'054-9990001', country:'IL', vipLevel:1, totalStays:9,  company:'רפאל' },
    { firstName:'איתן',    lastName:'מלול',     email:'eitan.malul@rafael.co.il',    phone:'052-9990002', country:'IL', vipLevel:1, totalStays:7,  company:'רפאל' },
    { firstName:'גיל',     lastName:'גפן',      email:'gil.gefen@mod.gov.il',        phone:'054-9990003', country:'IL', vipLevel:1, totalStays:6,  company:'מו"פ' },
    { firstName:'יניב',    lastName:'אמיר',     email:'yaniv.amir@mod.gov.il',       phone:'050-9990004', country:'IL', vipLevel:0, totalStays:4,  company:'מו"פ' },
    { firstName:'מאיה',    lastName:'הרמן',     email:'maya.herman@israir.co.il',    phone:'052-9990005', country:'IL', vipLevel:0, totalStays:3 },
    // VIP / loyals
    { firstName:'רות',     lastName:'אלמוג',    email:'ruth.almog@example.com',      phone:'054-8880001', country:'IL', vipLevel:5, totalStays:22 },
    { firstName:'James',   lastName:'Goldberg', email:'jgoldberg@example.com',       phone:'+1-646-5550001',country:'US', vipLevel:4, totalStays:18 },
    { firstName:'Fatima',  lastName:'Al-Rashid',email:'fatima.alrashid@example.com', phone:'+971-521234567',country:'AE', vipLevel:3, totalStays:14 },
    // Walk-ins / short stays
    { firstName:'משה',     lastName:'אבוטבול',  email:'moshe.aboutboul@example.com', phone:'050-6660001', country:'IL', vipLevel:0, totalStays:1 },
    { firstName:'ורד',     lastName:'חן',       email:'vered.chen@example.com',      phone:'052-6660002', country:'IL', vipLevel:0, totalStays:1 },
    { firstName:'פיני',    lastName:'דגן',      email:'pini.dagan@example.com',      phone:'054-6660003', country:'IL', vipLevel:0, totalStays:2 },
    { firstName:'Julia',   lastName:'Roberts',  email:'julia.r@example.com',         phone:'+1-323-5550001',country:'US', vipLevel:1, totalStays:3 },
    { firstName:'Hans',    lastName:'Weber',    email:'hans.weber@example.com',      phone:'+49-15112345', country:'DE', vipLevel:0, totalStays:1 },
    { firstName:'Nicolás', lastName:'López',    email:'nicolas.lopez@example.com',   phone:'+54-91123456789',country:'AR', vipLevel:0, totalStays:1 },
    { firstName:'Amira',   lastName:'Benali',   email:'amira.benali@example.com',    phone:'+33-767890123', country:'DZ', vipLevel:0, totalStays:2 },
    { firstName:'Takeshi', lastName:'Yamamoto', email:'takeshi.y@example.com',       phone:'+81-8098765432',country:'JP', vipLevel:2, totalStays:6 },
    { firstName:'אפרת',    lastName:'ציון',     email:'efrat.zion@example.com',      phone:'058-5550001', country:'IL', vipLevel:1, totalStays:4 },
    { firstName:'אלי',     lastName:'דוידי',    email:'eli.davidi@example.com',      phone:'050-5550002', country:'IL', vipLevel:0, totalStays:2 },
    { firstName:'טלי',     lastName:'בר',       email:'tali.bar@example.com',        phone:'052-5550003', country:'IL', vipLevel:0, totalStays:1 },
    { firstName:'מנחם',    lastName:'פנחס',     email:'menachem.pinchas@example.com',phone:'054-5550004', country:'IL', vipLevel:0, totalStays:3 },
    { firstName:'Priya',   lastName:'Sharma',   email:'priya.sharma@example.com',    phone:'+91-9812345678',country:'IN', vipLevel:1, totalStays:4 },
    { firstName:'Viktor',  lastName:'Novak',    email:'viktor.novak@example.com',    phone:'+420-724123456',country:'CZ', vipLevel:0, totalStays:1 },
    { firstName:'Aisha',   lastName:'Mohammed', email:'aisha.m@example.com',         phone:'+971-551234567',country:'AE', vipLevel:2, totalStays:7 },
    { firstName:'Ricardo', lastName:'Ferreira', email:'ricardo.f@example.com',       phone:'+55-21987654321',country:'BR', vipLevel:0, totalStays:1 },
    { firstName:'Ingrid',  lastName:'Larsson',  email:'ingrid.larsson@example.com',  phone:'+46-701234567', country:'SE', vipLevel:1, totalStays:5 },
    { firstName:'Kwame',   lastName:'Asante',   email:'kwame.asante@example.com',    phone:'+233-244123456',country:'GH', vipLevel:0, totalStays:1 },
  ];
  const guests = await GuestProfile.insertMany(
    guestData.map(g => ({ ...g, property: property._id }))
  );

  // helper to pick guest by index
  const G = (i) => guests[i];

  // ── Reservation factory ──────────────────────────────────────────────────────
  let confNum = 1001;
  const makeRes = (o) => ({
    property: property._id,
    confirmationNumber: `RES-${confNum++}`,
    status: 'confirmed',
    adults: 2, children: 0,
    paymentStatus: 'paid',
    currency: 'ILS',
    createdBy: adminUser._id,
    ...o,
  });

  const rtArr = [
    { rt: std, rate: 380, plan: barPlan },   // 0 STD-BAR
    { rt: dlx, rate: 520, plan: barPlan },   // 1 DLX-BAR
    { rt: dlx, rate: 442, plan: vipPlan },   // 2 DLX-VIP
    { rt: fam, rate: 650, plan: barPlan },   // 3 FAM-BAR
    { rt: ste, rate: 756, plan: vipPlan },   // 4 STE-VIP
    { rt: std, rate: 334, plan: corpPlan },  // 5 STD-CORP
    { rt: dlx, rate: 457, plan: corpPlan },  // 6 DLX-CORP
    { rt: ste, rate: 890, plan: barPlan },   // 7 STE-BAR
    { rt: fam, rate: 552, plan: corpPlan },  // 8 FAM-CORP
  ];

  function buildRes(guestIdx, rIdx, startOffset, nights, src, opts = {}) {
    const { rt, rate, plan } = rtArr[rIdx];
    return makeRes({
      primaryGuest: G(guestIdx)._id,
      roomType: rt._id,
      ratePlan: plan._id,
      ratePerNight: rate,
      totalAmount: rate * nights,
      arrivalDate: d(startOffset),
      departureDate: d(startOffset + nights),
      nights,
      source: src,
      ...opts,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TODAY / ARRIVALS TODAY / CURRENTLY IN-HOUSE
  // ═══════════════════════════════════════════════════════════════════════════
  const todayRes = [
    // already in house (checked in days ago, leaving today or tomorrow+)
    buildRes(0,  1, -3, 5, 'direct',   { status:'in_house',  assignedRoom: roomByNum['203']._id }),
    buildRes(1,  2, -2, 4, 'direct',   { status:'in_house',  assignedRoom: roomByNum['307']._id, isVip:true }),
    buildRes(4,  4, -1, 3, 'direct',   { status:'in_house',  assignedRoom: roomByNum['502']._id, isVip:true }),
    buildRes(5,  1, -4, 6, 'booking',  { status:'in_house',  assignedRoom: roomByNum['301']._id }),
    buildRes(9,  3, -2, 4, 'booking',  { status:'in_house',  assignedRoom: roomByNum['404']._id, children:2 }),
    buildRes(10, 1, -1, 2, 'agoda',    { status:'in_house',  assignedRoom: roomByNum['302']._id }),
    buildRes(20, 1, -3, 4, 'booking',  { status:'in_house',  assignedRoom: roomByNum['204']._id }),
    buildRes(24, 2, -2, 3, 'direct',   { status:'in_house',  assignedRoom: roomByNum['308']._id }),
    buildRes(30, 7, -1, 2, 'direct',   { status:'in_house',  assignedRoom: roomByNum['503']._id, isVip:true }),
    buildRes(35, 1, -2, 3, 'expedia',  { status:'in_house',  assignedRoom: roomByNum['303']._id }),
    buildRes(36, 6, -1, 3, 'direct',   { status:'in_house',  assignedRoom: roomByNum['206']._id, company: compTech._id }),
    buildRes(37, 6, -2, 4, 'direct',   { status:'in_house',  assignedRoom: roomByNum['103']._id, company: compGov._id }),
    buildRes(40, 4, -3, 5, 'direct',   { status:'in_house',  assignedRoom: roomByNum['501']._id, isVip:true }),
    buildRes(41, 7, -1, 3, 'direct',   { status:'in_house',  assignedRoom: roomByNum['504']._id, isVip:true }),
    buildRes(42, 2, -2, 4, 'direct',   { status:'in_house',  assignedRoom: roomByNum['201']._id, isVip:true }),
    buildRes(50, 0, -1, 2, 'walk_in',  { status:'in_house',  assignedRoom: roomByNum['101']._id }),
    buildRes(51, 1, -2, 3, 'direct',   { status:'in_house',  assignedRoom: roomByNum['208']._id }),
    buildRes(54, 0, -1, 2, 'direct',   { status:'in_house',  assignedRoom: roomByNum['107']._id }),
    buildRes(55, 1, -3, 5, 'booking',  { status:'in_house',  assignedRoom: roomByNum['306']._id }),
    buildRes(56, 3, -2, 3, 'direct',   { status:'in_house',  assignedRoom: roomByNum['402']._id, children:2 }),
    // arrivals today (due_in)
    buildRes(2,  1,  0, 3, 'expedia',  { status:'confirmed', assignedRoom: roomByNum['108']._id, paymentStatus:'unpaid' }),
    buildRes(3,  3,  0, 4, 'booking',  { status:'confirmed', assignedRoom: roomByNum['403']._id, children:3, paymentStatus:'partial' }),
    buildRes(6,  2,  0, 2, 'direct',   { status:'confirmed', assignedRoom: roomByNum['207']._id, isVip:true, paymentStatus:'unpaid' }),
    buildRes(7,  4,  0, 3, 'direct',   { status:'confirmed', paymentStatus:'unpaid', specialRequests:'Bottle of wine on arrival' }),
    buildRes(11, 1,  0, 2, 'agoda',    { status:'confirmed', paymentStatus:'unpaid' }),
    buildRes(14, 0,  0, 1, 'walk_in',  { status:'confirmed', paymentStatus:'paid' }),
    buildRes(15, 6,  0, 3, 'direct',   { status:'confirmed', company: compTech._id, paymentStatus:'unpaid' }),
    buildRes(18, 2,  0, 5, 'direct',   { status:'confirmed', isVip:true, paymentStatus:'partial', specialRequests:'בקשה: כרית נוספת' }),
    buildRes(22, 1,  0, 2, 'booking',  { status:'confirmed', paymentStatus:'unpaid' }),
    buildRes(23, 0,  0, 3, 'direct',   { status:'confirmed', paymentStatus:'paid' }),
    // due out today (checking out)
    buildRes(8,  1, -2, 2, 'booking',  { status:'in_house',  assignedRoom: roomByNum['202']._id, paymentStatus:'balance_due' }),
    buildRes(12, 0, -3, 3, 'direct',   { status:'in_house',  assignedRoom: roomByNum['105']._id }),
    buildRes(13, 3, -4, 4, 'direct',   { status:'in_house',  assignedRoom: roomByNum['401']._id, children:2 }),
    buildRes(16, 1, -2, 2, 'expedia',  { status:'in_house',  assignedRoom: roomByNum['303']._id }),
    buildRes(19, 1, -1, 1, 'walk_in',  { status:'in_house',  assignedRoom: roomByNum['106']._id }),
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORICAL (past 90 days) — dense, every few days
  // ═══════════════════════════════════════════════════════════════════════════
  const histDefs = [
    // week -1
    [0,  1, -6,  3, 'direct'],   [1,  2, -7,  4, 'direct'],
    [4,  4, -5,  2, 'direct'],   [5,  1, -6,  3, 'booking'],
    [9,  3, -7,  5, 'booking'],  [20, 1, -5,  2, 'agoda'],
    [24, 2, -6,  3, 'direct'],   [30, 7, -5,  2, 'direct'],
    [35, 1, -7,  4, 'expedia'],  [40, 4, -6,  3, 'direct'],
    // week -2
    [0,  0, -12, 2, 'direct'],   [1,  2, -13, 3, 'direct'],
    [2,  1, -11, 2, 'booking'],  [3,  3, -14, 4, 'direct'],
    [6,  2, -12, 3, 'direct'],   [7,  4, -10, 2, 'direct'],
    [10, 1, -11, 3, 'agoda'],    [11, 0, -13, 1, 'walk_in'],
    [14, 1, -12, 2, 'expedia'],  [15, 6, -13, 3, 'direct'],
    [17, 1, -14, 4, 'booking'],  [21, 1, -12, 2, 'booking'],
    [25, 1, -10, 3, 'direct'],   [26, 0, -11, 2, 'direct'],
    [31, 2, -13, 4, 'direct'],   [34, 7, -12, 2, 'direct'],
    // week -3
    [0,  1, -18, 3, 'direct'],   [1,  2, -20, 4, 'direct'],
    [4,  4, -19, 3, 'direct'],   [5,  1, -18, 2, 'booking'],
    [8,  1, -21, 3, 'booking'],  [9,  3, -22, 5, 'booking'],
    [18, 2, -20, 3, 'direct'],   [22, 1, -19, 2, 'booking'],
    [27, 1, -18, 2, 'expedia'],  [29, 0, -17, 1, 'walk_in'],
    [36, 6, -20, 3, 'direct'],   [37, 6, -21, 4, 'direct'],
    [43, 3, -19, 5, 'booking'],  [44, 0, -20, 2, 'walk_in'],
    // week -4
    [0,  0, -26, 2, 'direct'],   [1,  2, -27, 3, 'direct'],
    [2,  1, -25, 3, 'booking'],  [6,  2, -28, 4, 'direct'],
    [10, 1, -26, 2, 'agoda'],    [13, 3, -29, 5, 'direct'],
    [15, 6, -27, 3, 'direct'],   [16, 1, -25, 2, 'expedia'],
    [24, 2, -28, 3, 'direct'],   [28, 1, -26, 2, 'booking'],
    [33, 2, -27, 4, 'direct'],   [38, 6, -28, 3, 'direct'],
    [41, 7, -26, 2, 'direct'],   [46, 0, -25, 1, 'walk_in'],
    [53, 1, -27, 2, 'booking'],  [57, 1, -26, 3, 'direct'],
    // week -5
    [0,  1, -33, 4, 'direct'],   [1,  4, -35, 3, 'direct'],
    [4,  2, -34, 2, 'direct'],   [5,  1, -32, 3, 'booking'],
    [7,  4, -33, 4, 'direct'],   [9,  3, -36, 5, 'booking'],
    [12, 1, -34, 2, 'agoda'],    [20, 1, -33, 3, 'booking'],
    [22, 1, -34, 2, 'booking'],  [25, 1, -32, 3, 'direct'],
    [30, 7, -35, 2, 'direct'],   [35, 1, -33, 3, 'expedia'],
    [40, 4, -34, 4, 'direct'],   [48, 1, -32, 2, 'booking'],
    [55, 1, -35, 3, 'booking'],  [58, 2, -33, 4, 'direct'],
    // week -6 to -8
    [0,  0, -42, 3, 'direct'],   [1,  2, -44, 4, 'direct'],
    [2,  1, -41, 2, 'booking'],  [3,  3, -45, 3, 'direct'],
    [6,  2, -43, 4, 'direct'],   [10, 1, -42, 3, 'agoda'],
    [14, 1, -41, 2, 'expedia'],  [18, 2, -44, 3, 'direct'],
    [21, 1, -43, 2, 'booking'],  [24, 2, -42, 4, 'direct'],
    [31, 2, -44, 3, 'direct'],   [34, 7, -43, 2, 'direct'],
    [36, 6, -45, 3, 'direct'],   [41, 7, -42, 2, 'direct'],
    [42, 2, -44, 3, 'direct'],   [50, 0, -41, 1, 'walk_in'],
    [51, 1, -43, 2, 'direct'],   [56, 3, -42, 3, 'direct'],
    // week -9 to -12
    [0,  1, -58, 4, 'direct'],   [1,  4, -60, 3, 'direct'],
    [4,  2, -55, 2, 'direct'],   [5,  1, -57, 3, 'booking'],
    [7,  4, -59, 4, 'direct'],   [9,  3, -56, 5, 'booking'],
    [11, 0, -54, 2, 'walk_in'],  [13, 3, -61, 5, 'direct'],
    [19, 1, -57, 2, 'direct'],   [22, 1, -56, 2, 'booking'],
    [26, 0, -55, 3, 'direct'],   [29, 0, -58, 1, 'walk_in'],
    [32, 2, -60, 3, 'direct'],   [33, 2, -57, 4, 'direct'],
    [38, 6, -56, 3, 'direct'],   [43, 3, -58, 5, 'booking'],
    [47, 1, -55, 2, 'booking'],  [49, 2, -57, 3, 'direct'],
    [52, 1, -56, 2, 'direct'],   [59, 1, -55, 3, 'direct'],
    // week -13 to -16
    [0,  0, -75, 2, 'direct'],   [1,  2, -78, 3, 'direct'],
    [4,  4, -72, 3, 'direct'],   [5,  1, -76, 2, 'booking'],
    [7,  4, -73, 4, 'direct'],   [10, 1, -74, 3, 'agoda'],
    [12, 1, -77, 2, 'agoda'],    [16, 1, -75, 2, 'expedia'],
    [20, 1, -73, 3, 'booking'],  [24, 2, -78, 4, 'direct'],
    [27, 1, -76, 2, 'expedia'],  [34, 7, -75, 2, 'direct'],
    [40, 4, -72, 3, 'direct'],   [41, 7, -76, 2, 'direct'],
    [42, 2, -78, 3, 'direct'],   [53, 1, -73, 2, 'booking'],
    [54, 0, -75, 1, 'walk_in'],  [57, 1, -74, 3, 'direct'],
    [58, 2, -76, 4, 'direct'],   [59, 1, -72, 3, 'direct'],
  ];

  const histReservations = histDefs.map(([gIdx, rIdx, start, nights, src]) => {
    const { rt, rate, plan } = rtArr[rIdx];
    const vip = guestData[gIdx]?.vipLevel >= 3;
    return makeRes({
      primaryGuest: G(gIdx)._id,
      roomType: rt._id,
      ratePlan: plan._id,
      ratePerNight: rate,
      totalAmount: rate * nights,
      arrivalDate: d(start),
      departureDate: d(start + nights),
      nights,
      status: 'checked_out',
      source: src,
      isVip: vip,
      paymentStatus: 'paid',
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUTURE (next 60 days) — one or more arrivals per day
  // ═══════════════════════════════════════════════════════════════════════════
  const futureDefs = [
    // d+1
    [0, 1, 1, 3, 'direct'],    [5, 0, 1, 2, 'booking'],
    // d+2
    [1, 2, 2, 4, 'direct'],    [9, 3, 2, 5, 'booking'],    [20, 1, 2, 2, 'agoda'],
    // d+3
    [4, 4, 3, 3, 'direct'],    [10, 1, 3, 2, 'booking'],
    // d+4
    [2, 1, 4, 3, 'expedia'],   [6, 2, 4, 2, 'direct'],
    // d+5
    [7, 4, 5, 4, 'direct'],    [22, 1, 5, 2, 'booking'],   [26, 0, 5, 3, 'direct'],
    // d+6
    [11, 1, 6, 3, 'agoda'],    [14, 0, 6, 2, 'direct'],    [15, 6, 6, 3, 'direct'],
    // d+7
    [3, 3, 7, 5, 'booking'],   [17, 1, 7, 4, 'booking'],
    // d+8
    [8, 1, 8, 2, 'booking'],   [18, 2, 8, 3, 'direct'],    [27, 1, 8, 2, 'expedia'],
    // d+9
    [0, 0, 9, 2, 'direct'],    [24, 2, 9, 3, 'direct'],
    // d+10
    [1, 4, 10, 3, 'direct'],   [29, 0, 10, 1, 'walk_in'],  [31, 2, 10, 4, 'direct'],
    // d+11
    [5, 1, 11, 3, 'booking'],  [13, 3, 11, 5, 'direct'],
    // d+12
    [4, 4, 12, 4, 'direct'],   [21, 1, 12, 2, 'booking'],  [33, 2, 12, 3, 'direct'],
    // d+13
    [9, 3, 13, 5, 'booking'],  [34, 7, 13, 2, 'direct'],
    // d+14
    [0, 1, 14, 3, 'direct'],   [2, 1, 14, 2, 'booking'],   [36, 6, 14, 3, 'direct'],
    // d+15
    [40, 4, 15, 3, 'direct'],  [42, 2, 15, 4, 'direct'],
    // d+16
    [6, 2, 16, 2, 'direct'],   [37, 6, 16, 3, 'direct'],   [43, 3, 16, 5, 'booking'],
    // d+17
    [10, 1, 17, 2, 'agoda'],   [25, 1, 17, 3, 'direct'],
    // d+18
    [7, 4, 18, 4, 'direct'],   [16, 1, 18, 2, 'expedia'],  [46, 0, 18, 1, 'walk_in'],
    // d+19
    [1, 2, 19, 3, 'direct'],   [22, 1, 19, 2, 'booking'],
    // d+20
    [4, 4, 20, 2, 'direct'],   [30, 7, 20, 3, 'direct'],   [47, 1, 20, 2, 'booking'],
    // d+21
    [5, 1, 21, 4, 'booking'],  [28, 1, 21, 2, 'expedia'],
    // d+22
    [9, 3, 22, 5, 'booking'],  [32, 2, 22, 3, 'direct'],   [48, 1, 22, 2, 'booking'],
    // d+23
    [11, 1, 23, 3, 'agoda'],   [38, 6, 23, 3, 'direct'],
    // d+24
    [0, 0, 24, 2, 'direct'],   [14, 0, 24, 2, 'direct'],   [41, 7, 24, 2, 'direct'],
    // d+25
    [1, 2, 25, 4, 'direct'],   [35, 1, 25, 3, 'expedia'],
    // d+26
    [6, 2, 26, 3, 'direct'],   [24, 2, 26, 4, 'direct'],   [50, 0, 26, 1, 'walk_in'],
    // d+27
    [7, 4, 27, 3, 'direct'],   [20, 1, 27, 2, 'agoda'],
    // d+28
    [3, 3, 28, 5, 'booking'],  [27, 1, 28, 2, 'expedia'],  [51, 1, 28, 3, 'direct'],
    // d+29
    [4, 4, 29, 2, 'direct'],   [40, 4, 29, 3, 'direct'],
    // d+30
    [1, 2, 30, 3, 'direct'],   [8, 1, 30, 2, 'booking'],   [53, 1, 30, 2, 'booking'],
    // d+31 to +35
    [9, 3, 31, 4, 'booking'],  [22, 1, 31, 2, 'booking'],
    [0, 1, 33, 3, 'direct'],   [5, 0, 33, 2, 'direct'],
    [6, 2, 35, 3, 'direct'],   [17, 1, 35, 4, 'booking'],
    // d+36 to +42
    [4, 4, 36, 3, 'direct'],   [10, 1, 37, 2, 'agoda'],
    [2, 1, 38, 3, 'booking'],  [34, 7, 38, 2, 'direct'],
    [7, 4, 40, 4, 'direct'],   [20, 1, 40, 2, 'booking'],
    [1, 2, 42, 3, 'direct'],   [36, 6, 42, 3, 'direct'],
    // d+43 to +50
    [9, 3, 44, 5, 'booking'],  [14, 0, 45, 2, 'direct'],
    [5, 1, 46, 3, 'booking'],  [24, 2, 46, 4, 'direct'],
    [40, 4, 48, 3, 'direct'],  [11, 1, 49, 2, 'agoda'],
    [0, 0, 50, 2, 'direct'],   [3, 3, 50, 5, 'booking'],
    // d+51 to +60
    [1, 4, 52, 3, 'direct'],   [6, 2, 53, 2, 'direct'],
    [4, 4, 55, 4, 'direct'],   [7, 4, 56, 3, 'direct'],
    [9, 3, 57, 5, 'booking'],  [22, 1, 58, 2, 'booking'],
    [5, 1, 59, 3, 'direct'],   [34, 7, 60, 2, 'direct'],
  ];

  const futureReservations = futureDefs.map(([gIdx, rIdx, start, nights, src]) => {
    const { rt, rate, plan } = rtArr[rIdx];
    const vip = guestData[gIdx]?.vipLevel >= 3;
    return makeRes({
      primaryGuest: G(gIdx)._id,
      roomType: rt._id,
      ratePlan: plan._id,
      ratePerNight: rate,
      totalAmount: rate * nights,
      arrivalDate: d(start),
      departureDate: d(start + nights),
      nights,
      status: 'confirmed',
      source: src,
      isVip: vip,
      paymentStatus: Math.random() > 0.5 ? 'unpaid' : 'paid',
    });
  });

  // no-shows and cancellations (sprinkled in)
  const noShows = [
    buildRes(45, 1, -10, 2, 'booking', { status:'no_show', paymentStatus:'unpaid' }),
    buildRes(46, 0, -5,  1, 'walk_in', { status:'no_show', paymentStatus:'unpaid' }),
    buildRes(16, 1, -30, 2, 'expedia', { status:'no_show', paymentStatus:'unpaid' }),
  ];
  const cancellations = [
    buildRes(14, 1,  3,  3, 'booking',  { status:'cancelled', paymentStatus:'refunded', cancelledAt: new Date() }),
    buildRes(28, 1,  7,  2, 'expedia',  { status:'cancelled', paymentStatus:'unpaid',   cancelledAt: new Date() }),
    buildRes(0,  3, -20, 4, 'direct',   { status:'cancelled', paymentStatus:'refunded', cancelledAt: new Date(Date.now() - 5 * 86400000) }),
    buildRes(5,  4,  15, 3, 'direct',   { status:'cancelled', paymentStatus:'unpaid',   cancelledAt: new Date() }),
  ];

  const allReservations = [...todayRes, ...histReservations, ...futureReservations, ...noShows, ...cancellations];
  const reservations = await Reservation.insertMany(allReservations);
  console.log(`Reservations inserted: ${reservations.length}`);

  // ── Folios ───────────────────────────────────────────────────────────────────
  const futureConfNums = new Set([
    ...futureReservations.map(r => r.confirmationNumber),
    ...cancellations.map(r => r.confirmationNumber),
    ...noShows.map(r => r.confirmationNumber),
  ]);

  const folios = [];
  for (const res of reservations) {
    if (futureConfNums.has(res.confirmationNumber)) continue;

    const lines = [];
    for (let n = 0; n < res.nights; n++) {
      const dt = new Date(res.arrivalDate);
      dt.setDate(dt.getDate() + n);
      const sd = dt.toISOString().split('T')[0];
      lines.push({ type:'charge', description:'לינה', amount: res.ratePerNight, taxAmount: Math.round(res.ratePerNight * 0.17), department:'rooms', serviceDate: sd, status:'posted', source:'pms' });
    }

    if (res.ratePerNight >= 500 && res.nights >= 2) {
      const mid = new Date(res.arrivalDate);
      mid.setDate(mid.getDate() + 1);
      const sd2 = mid.toISOString().split('T')[0];
      lines.push({ type:'charge', description:'מסעדה — ארוחת ערב', amount:220, taxAmount:37, department:'fb', serviceDate: sd2, status:'posted', source:'pos' });
      if (res.ratePerNight >= 650) {
        lines.push({ type:'charge', description:'מינימר — שתייה', amount:85, taxAmount:14, department:'fb', serviceDate: sd2, status:'posted', source:'pos' });
      }
      if (res.isVip) {
        lines.push({ type:'charge', description:'ספא — עיסוי', amount:350, taxAmount:60, department:'spa', serviceDate: sd2, status:'posted', source:'pos' });
      }
    }

    const totalCharged = lines.filter(l => l.type === 'charge').reduce((s, l) => s + l.amount, 0);
    if (res.paymentStatus === 'paid') {
      lines.push({ type:'payment', description:'תשלום כרטיס אשראי', amount: -totalCharged, taxAmount:0, serviceDate: res.arrivalDate, status:'posted', source:'pms' });
    } else if (res.paymentStatus === 'partial') {
      lines.push({ type:'deposit', description:'פיקדון', amount: -Math.round(totalCharged * 0.5), taxAmount:0, serviceDate: res.arrivalDate, status:'posted', source:'pms' });
    }

    const isClosed = ['checked_out', 'cancelled'].includes(res.status);
    folios.push({ property: property._id, reservation: res._id, ownerType:'guest', status: isClosed ? 'closed' : 'open', currency:'ILS', lines });
  }
  await Folio.insertMany(folios);

  // ── Housekeeping Tasks ───────────────────────────────────────────────────────
  const today = d(0);
  const hkTasks = [
    { room: roomByNum['102']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30', assignedTo: rinat._id },
    { room: roomByNum['105']._id, type:'checkout_clean', priority:'high',   status:'in_progress', dueTime:'11:30', assignedTo: miriam._id, startedAt: new Date() },
    { room: roomByNum['202']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30' },
    { room: roomByNum['207']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30', assignedTo: rinat._id },
    { room: roomByNum['303']._id, type:'checkout_clean', priority:'high',   status:'completed',   dueTime:'11:30', assignedTo: miriam._id, startedAt: new Date(Date.now()-3600000), completedAt: new Date() },
    { room: roomByNum['401']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30' },
    { room: roomByNum['503']._id, type:'checkout_clean', priority:'medium', status:'new',         dueTime:'12:00', assignedTo: leah._id },
    { room: roomByNum['108']._id, type:'stayover',       priority:'medium', status:'new',         dueTime:'14:00', assignedTo: leah._id },
    { room: roomByNum['204']._id, type:'stayover',       priority:'low',    status:'new',         dueTime:'14:00', assignedTo: miriam._id },
    { room: roomByNum['306']._id, type:'arrival_prep',   priority:'urgent', status:'new',         dueTime:'10:00', notes:'VIP — Champagne needed!' },
    { room: roomByNum['501']._id, type:'arrival_prep',   priority:'urgent', status:'new',         dueTime:'13:00', assignedTo: rinat._id },
    { room: roomByNum['301']._id, type:'stayover',       priority:'low',    status:'assigned',    dueTime:'14:00', assignedTo: leah._id },
    { room: roomByNum['302']._id, type:'stayover',       priority:'low',    status:'new',         dueTime:'14:00' },
    { room: roomByNum['203']._id, type:'stayover',       priority:'medium', status:'new',         dueTime:'14:00', assignedTo: miriam._id },
    { room: roomByNum['404']._id, type:'stayover',       priority:'low',    status:'new',         dueTime:'14:00', assignedTo: rinat._id },
  ];
  await HousekeepingTask.insertMany(hkTasks.map(t => ({ ...t, property: property._id, date: today, autoCreated: false })));

  // ── Maintenance Tickets ──────────────────────────────────────────────────────
  await MaintenanceTicket.insertMany([
    { property: property._id, room: roomByNum['104']._id, category:'hvac',        description:'מזגן לא מקרר',           priority:'high',   status:'in_progress', assignedTo: techUser._id, blocksRoom:true,  createdAt: new Date(Date.now()-86400000) },
    { property: property._id, room: roomByNum['305']._id, category:'internet',    description:'WiFi לא עובד בחדר',       priority:'high',   status:'new',         blocksRoom:true },
    { property: property._id, room: roomByNum['203']._id, category:'lock',        description:'מנעול קשה לפתיחה',        priority:'medium', status:'resolved',    assignedTo: techUser._id, resolvedAt: new Date() },
    { property: property._id, room: roomByNum['402']._id, category:'electricity', description:'נורת לד פגומה בשירותים', priority:'low',    status:'new' },
    { property: property._id, room: roomByNum['205']._id, category:'water',       description:'דליפת מים תחת הכיור',     priority:'high',   status:'in_progress', assignedTo: techUser._id, blocksRoom:true },
  ]);

  // ── Update InventoryDate bookedCount ──────────────────────────────────────────
  for (const res of reservations) {
    if (['cancelled','no_show'].includes(res.status)) continue;
    const start = new Date(res.arrivalDate);
    const end   = new Date(res.departureDate);
    for (let dt = new Date(start); dt < end; dt.setDate(dt.getDate() + 1)) {
      const dateStr = dt.toISOString().split('T')[0];
      await InventoryDate.updateOne(
        { property: property._id, roomType: res.roomType, date: dateStr },
        { $inc: { bookedCount: 1 } }
      );
    }
  }

  const todayCount    = todayRes.length;
  const histCount     = histReservations.length;
  const futureCount   = futureReservations.length;
  const extraCount    = noShows.length + cancellations.length;

  console.log('');
  console.log('✅  seedBig complete!');
  console.log(`   Property:          ${property.name}`);
  console.log(`   Room Types:        4`);
  console.log(`   Rooms:             ${rooms.length}`);
  console.log(`   Rate Plans:        4  (rates: -90 to +90 days)`);
  console.log(`   Companies:         4`);
  console.log(`   Guests:            ${guests.length}`);
  console.log(`   Today res:         ${todayCount}`);
  console.log(`   Historical res:    ${histCount}`);
  console.log(`   Future res:        ${futureCount}`);
  console.log(`   No-shows/Cancel:   ${extraCount}`);
  console.log(`   Total res:         ${reservations.length}`);
  console.log(`   Folios:            ${folios.length}`);
  console.log(`   HK Tasks:          ${hkTasks.length}`);
  console.log(`   Users:             7`);
  console.log('');
  console.log('   Login: admin@galil.co.il / hotel4u123');
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
