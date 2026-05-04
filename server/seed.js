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

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u';

// ─── Date helpers ─────────────────────────────────────────────────────────────
const BASE = new Date();
function d(offset = 0) {
  const dt = new Date(BASE);
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().split('T')[0];
}

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // Wipe existing data
  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    await mongoose.connection.collections[name].deleteMany({});
  }
  console.log('Cleared all collections');

  // ── Property ──────────────────────────────────────────────────────────────
  const property = await Property.create({
    name: 'מלון הגליל', legalName: 'הגליל נכסים בע"מ',
    city: 'טבריה', country: 'IL',
    phone: '04-6720000', email: 'info@galil-hotel.co.il',
    checkInTime: '15:00', checkOutTime: '11:00',
    totalRooms: 32,
  });

  // ── Room Types ────────────────────────────────────────────────────────────
  const [std, dlx, fam, ste] = await RoomType.insertMany([
    { property: property._id, code:'STD', name:'חדר סטנדרט',  capacityBase:2, capacityMax:3, baseRate:380, sortOrder:1 },
    { property: property._id, code:'DLX', name:'חדר דלוקס',   capacityBase:2, capacityMax:3, baseRate:520, sortOrder:2 },
    { property: property._id, code:'FAM', name:'חדר משפחה',   capacityBase:4, capacityMax:5, baseRate:650, sortOrder:3 },
    { property: property._id, code:'STE', name:'סוויטה',       capacityBase:2, capacityMax:4, baseRate:890, sortOrder:4 },
  ]);

  // ── Rooms ─────────────────────────────────────────────────────────────────
  const roomData = [
    // Floor 1 — Standard (8)
    { number:'101', floor:1, roomType:std._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'vacant' },
    { number:'102', floor:1, roomType:std._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'103', floor:1, roomType:std._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    { number:'104', floor:1, roomType:std._id, opsStatus:'out_of_order',cleanStatus:'dirty',     occStatus:'vacant' },
    { number:'105', floor:1, roomType:std._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'106', floor:1, roomType:std._id, opsStatus:'available',   cleanStatus:'inspected', occStatus:'vacant' },
    { number:'107', floor:1, roomType:std._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'due_in' },
    { number:'108', floor:1, roomType:std._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'occupied' },
    // Floor 2 — Deluxe (8)
    { number:'201', floor:2, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'due_in' },
    { number:'202', floor:2, roomType:dlx._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'203', floor:2, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    { number:'204', floor:2, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    { number:'205', floor:2, roomType:dlx._id, opsStatus:'maintenance_hold', cleanStatus:'clean', occStatus:'vacant' },
    { number:'206', floor:2, roomType:dlx._id, opsStatus:'available',   cleanStatus:'inspected', occStatus:'vacant' },
    { number:'207', floor:2, roomType:dlx._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'208', floor:2, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'due_in' },
    // Floor 3 — Deluxe (8)
    { number:'301', floor:3, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    { number:'302', floor:3, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    { number:'303', floor:3, roomType:dlx._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'304', floor:3, roomType:dlx._id, opsStatus:'available',   cleanStatus:'inspected', occStatus:'vacant' },
    { number:'305', floor:3, roomType:dlx._id, opsStatus:'out_of_order',cleanStatus:'dirty',     occStatus:'vacant' },
    { number:'306', floor:3, roomType:dlx._id, opsStatus:'available',   cleanStatus:'inspected', occStatus:'due_in' },
    { number:'307', floor:3, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    { number:'308', floor:3, roomType:dlx._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    // Floor 4 — Family (4)
    { number:'401', floor:4, roomType:fam._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'402', floor:4, roomType:fam._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'due_in' },
    { number:'403', floor:4, roomType:fam._id, opsStatus:'available',   cleanStatus:'inspected', occStatus:'vacant' },
    { number:'404', floor:4, roomType:fam._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    // Floor 5 — Suites (4)
    { number:'501', floor:5, roomType:ste._id, opsStatus:'available',   cleanStatus:'inspected', occStatus:'due_in',  isVip:true },
    { number:'502', floor:5, roomType:ste._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'occupied' },
    { number:'503', floor:5, roomType:ste._id, opsStatus:'available',   cleanStatus:'dirty',     occStatus:'due_out' },
    { number:'504', floor:5, roomType:ste._id, opsStatus:'available',   cleanStatus:'clean',     occStatus:'vacant' },
  ];

  const rooms = await Room.insertMany(roomData.map(r => ({ ...r, property: property._id })));
  const roomByNum = Object.fromEntries(rooms.map(r => [r.number, r]));

  // ── Rate Plans ────────────────────────────────────────────────────────────
  const [barPlan, vipPlan, otaPlan] = await RatePlan.insertMany([
    { property: property._id, code:'BAR', name:'Best Available Rate', type:'public',    isRefundable:true,  channels:['direct','booking','expedia','agoda'] },
    { property: property._id, code:'VIP', name:'VIP Rate',            type:'corporate', isRefundable:true,  channels:['direct'] },
    { property: property._id, code:'OTA', name:'OTA Non-Refundable',  type:'ota',       isRefundable:false, channels:['booking','expedia'] },
  ]);

  // Rate dates for next 30 days
  const rateDocs = [];
  for (let i = -5; i < 30; i++) {
    const date = d(i);
    const isWeekend = [5, 6].includes(new Date(date).getDay());
    const multiplier = isWeekend ? 1.3 : 1;
    for (const [rt, base] of [[std, 380],[dlx, 520],[fam, 650],[ste, 890]]) {
      rateDocs.push({ ratePlan: barPlan._id, roomType: rt._id, date, price: Math.round(base * multiplier) });
      rateDocs.push({ ratePlan: vipPlan._id, roomType: rt._id, date, price: Math.round(base * multiplier * 0.85) });
      rateDocs.push({ ratePlan: otaPlan._id, roomType: rt._id, date, price: Math.round(base * multiplier * 0.95) });
    }
  }
  await RateDate.insertMany(rateDocs);

  // ── InventoryDate ─────────────────────────────────────────────────────────
  const invDocs = [];
  const typeRoomCount = { [std._id]: 8, [dlx._id]: 16, [fam._id]: 4, [ste._id]: 4 };
  for (let i = -5; i < 60; i++) {
    const date = d(i);
    for (const [typeId, count] of Object.entries(typeRoomCount)) {
      invDocs.push({
        property: property._id,
        roomType: typeId,
        date,
        physicalCount: count,
        oooCount: typeId === String(std._id) ? 1 : typeId === String(dlx._id) ? 1 : 0,
        bookedCount: 0,  // will be updated when reservations are seeded
      });
    }
  }
  await InventoryDate.insertMany(invDocs);

  // ── Users ─────────────────────────────────────────────────────────────────
  const hash = await bcrypt.hash('hotel4u123', 12);
  const [adminUser, receptionistUser, hkManagerUser, techUser, rinat, miriam, leah] = await User.insertMany([
    { property: property._id, firstName:'יוסף',  lastName:'דהן',    email:'admin@galil.co.il',       passwordHash: hash, role:'property_admin' },
    { property: property._id, firstName:'דינה',   lastName:'לוי',    email:'dina@galil.co.il',        passwordHash: hash, role:'receptionist' },
    { property: property._id, firstName:'רות',    lastName:'כהן',    email:'ruth@galil.co.il',        passwordHash: hash, role:'housekeeping_manager' },
    { property: property._id, firstName:'אבי',    lastName:'מזרחי',  email:'avi@galil.co.il',         passwordHash: hash, role:'technician' },
    { property: property._id, firstName:'רינת',   lastName:'אביב',   email:'rinat@galil.co.il',       passwordHash: hash, role:'housekeeper' },
    { property: property._id, firstName:'מרים',   lastName:'כץ',     email:'miriam@galil.co.il',      passwordHash: hash, role:'housekeeper' },
    { property: property._id, firstName:'לאה',    lastName:'ברק',    email:'leah@galil.co.il',        passwordHash: hash, role:'housekeeper' },
  ]);

  // ── Guests ────────────────────────────────────────────────────────────────
  const guests = await GuestProfile.insertMany([
    { property: property._id, firstName:'דוד',   lastName:'לוי',    email:'david@example.com',    phone:'050-1234567', country:'IL', vipLevel:0, totalStays:3 },
    { property: property._id, firstName:'שרה',   lastName:'כהן',    email:'sarah@example.com',    phone:'052-9876543', country:'IL', vipLevel:3, totalStays:12 },
    { property: property._id, firstName:'Michael',lastName:'Brown',  email:'mbrown@example.com',   phone:'+1-555-0100', country:'US', vipLevel:0, totalStays:1 },
    { property: property._id, firstName:'אביב',  lastName:'מזרחי',  email:'aviv@example.com',     phone:'054-5551234', country:'IL', vipLevel:1, totalStays:5 },
    { property: property._id, firstName:'Sophie', lastName:'Dupont', email:'sophie@example.com',   phone:'+33-612345678',country:'FR',vipLevel:2, totalStays:8 },
    { property: property._id, firstName:'נועה',  lastName:'פרידמן', email:'noa@example.com',      phone:'058-7778899', country:'IL', vipLevel:0, totalStays:2 },
    { property: property._id, firstName:'יוסי',  lastName:'ברקוביץ',email:'yossi@example.com',    phone:'050-3334455', country:'IL', vipLevel:1, totalStays:7 },
    { property: property._id, firstName:'Ahmad', lastName:'Hassan',  email:'ahmad@example.com',    phone:'+971-501234567',country:'AE',vipLevel:0,totalStays:4 },
    { property: property._id, firstName:'רחל',   lastName:'גולן',   email:'rachel@example.com',   phone:'052-6667788', country:'IL', vipLevel:4, totalStays:15 },
    { property: property._id, firstName:'Emma',  lastName:'Wilson',  email:'emma@example.com',     phone:'+44-7700900123',country:'GB',vipLevel:0,totalStays:1 },
  ]);
  const [david, sarah, michael, aviv, sophie, noa, yossi, ahmad, rachel, emma] = guests;

  // ── Reservations ──────────────────────────────────────────────────────────
  let confNum = 1001;
  const makeRes = (overrides) => ({
    property: property._id,
    confirmationNumber: `RES-${confNum++}`,
    status: 'confirmed',
    adults: 2, children: 0,
    paymentStatus: 'paid',
    currency: 'ILS',
    createdBy: adminUser._id,
    ...overrides,
  });

  const reservations = await Reservation.insertMany([
    makeRes({ primaryGuest: david._id,   roomType: std._id, assignedRoom: roomByNum['102']._id, ratePlan: barPlan._id, ratePerNight:380, totalAmount:760,  arrivalDate:d(-2), departureDate:d(0),  nights:2, status:'in_house',   source:'direct' }),
    makeRes({ primaryGuest: sarah._id,   roomType: dlx._id, assignedRoom: roomByNum['203']._id, ratePlan: vipPlan._id, ratePerNight:442, totalAmount:1768, arrivalDate:d(-3), departureDate:d(1),  nights:4, status:'in_house',   source:'direct',    isVip:true, internalNotes:'VIP — פרחים בחדר', paymentStatus:'partial' }),
    makeRes({ primaryGuest: michael._id, roomType: dlx._id, assignedRoom: roomByNum['301']._id, ratePlan: barPlan._id, ratePerNight:520, totalAmount:1560, arrivalDate:d(-1), departureDate:d(2),  nights:3, status:'in_house',   source:'booking' }),
    makeRes({ primaryGuest: sophie._id,  roomType: ste._id, assignedRoom: roomByNum['501']._id, ratePlan: vipPlan._id, ratePerNight:756, totalAmount:2268, arrivalDate:d(0),  departureDate:d(3),  nights:3, status:'confirmed',  source:'direct',    isVip:true, specialRequests:'VIP — Champagne on arrival', paymentStatus:'unpaid' }),
    makeRes({ primaryGuest: aviv._id,    roomType: std._id, assignedRoom: roomByNum['107']._id, ratePlan: barPlan._id, ratePerNight:380, totalAmount:760,  arrivalDate:d(0),  departureDate:d(2),  nights:2, status:'confirmed',  source:'expedia' }),
    makeRes({ primaryGuest: noa._id,     roomType: dlx._id, assignedRoom: roomByNum['208']._id, ratePlan: barPlan._id, ratePerNight:520, totalAmount:2080, arrivalDate:d(0),  departureDate:d(4),  nights:4, status:'confirmed',  source:'direct',    specialRequests:'בקשה: קומה גבוהה' }),
    makeRes({ primaryGuest: yossi._id,   roomType: dlx._id, assignedRoom: roomByNum['302']._id, ratePlan: barPlan._id, ratePerNight:520, totalAmount:2080, arrivalDate:d(-4), departureDate:d(0),  nights:4, status:'in_house',   source:'agoda' }),
    makeRes({ primaryGuest: ahmad._id,   roomType: dlx._id, assignedRoom: roomByNum['303']._id, ratePlan: barPlan._id, ratePerNight:520, totalAmount:1040, arrivalDate:d(-2), departureDate:d(0),  nights:2, status:'in_house',   source:'booking',   paymentStatus:'balance_due', internalNotes:'יתרה פתוחה: ₪340' }),
    makeRes({ primaryGuest: rachel._id,  roomType: ste._id, assignedRoom: roomByNum['502']._id, ratePlan: vipPlan._id, ratePerNight:756, totalAmount:3024, arrivalDate:d(-1), departureDate:d(3),  nights:4, status:'in_house',   source:'direct',    isVip:true }),
    makeRes({ primaryGuest: emma._id,    roomType: fam._id, assignedRoom: roomByNum['402']._id, ratePlan: barPlan._id, ratePerNight:650, totalAmount:3250, arrivalDate:d(0),  departureDate:d(5),  nights:5, status:'confirmed',  source:'booking',   specialRequests:'2 ילדים, מיטה נוספת' }),
    makeRes({ primaryGuest: david._id,   roomType: std._id, assignedRoom: roomByNum['108']._id, ratePlan: barPlan._id, ratePerNight:380, totalAmount:1140, arrivalDate:d(-3), departureDate:d(0),  nights:3, status:'in_house',   source:'direct' }),
    makeRes({ primaryGuest: yossi._id,   roomType: fam._id, assignedRoom: null,                 ratePlan: barPlan._id, ratePerNight:650, totalAmount:1300, arrivalDate:d(0),  departureDate:d(2),  nights:2, status:'confirmed',  source:'booking',   internalNotes:'לא הוקצה חדר!' }),
    makeRes({ primaryGuest: sarah._id,   roomType: dlx._id, assignedRoom: roomByNum['307']._id, ratePlan: barPlan._id, ratePerNight:520, totalAmount:1560, arrivalDate:d(-1), departureDate:d(2),  nights:3, status:'in_house',   source:'direct' }),
    makeRes({ primaryGuest: sophie._id,  roomType: dlx._id, assignedRoom: roomByNum['308']._id, ratePlan: vipPlan._id, ratePerNight:442, totalAmount:1326, arrivalDate:d(-2), departureDate:d(1),  nights:3, status:'in_house',   source:'direct',    isVip:true }),
    makeRes({ primaryGuest: noa._id,     roomType: fam._id, assignedRoom: roomByNum['404']._id, ratePlan: barPlan._id, ratePerNight:650, totalAmount:2600, arrivalDate:d(-1), departureDate:d(3),  nights:4, status:'in_house',   source:'direct' }),
  ]);

  // ── Folios ────────────────────────────────────────────────────────────────
  const today = d(0);
  const folios = [];
  for (const res of reservations) {
    const nights = res.nights;
    const lines = [];
    // Room charges per night
    for (let n = 0; n < nights; n++) {
      const dt = new Date(res.arrivalDate);
      dt.setDate(dt.getDate() + n);
      const sd = dt.toISOString().split('T')[0];
      lines.push({ type:'charge', description:'לינה', amount: res.ratePerNight, taxAmount: Math.round(res.ratePerNight * 0.17), department:'rooms', serviceDate: sd, status:'posted', source:'pms' });
    }
    // Payment line
    if (res.paymentStatus === 'paid') {
      lines.push({ type:'payment', description:'תשלום כרטיס אשראי', amount: -res.totalAmount, taxAmount:0, serviceDate: res.arrivalDate, status:'posted', source:'pms' });
    } else if (res.paymentStatus === 'partial') {
      lines.push({ type:'deposit', description:'פיקדון', amount: -Math.round(res.totalAmount * 0.5), taxAmount:0, serviceDate: res.arrivalDate, status:'posted', source:'pms' });
    }
    folios.push({ property: property._id, reservation: res._id, ownerType:'guest', status: ['checked_out','cancelled'].includes(res.status) ? 'closed' : 'open', currency:'ILS', lines });
  }
  await Folio.insertMany(folios);

  // ── Housekeeping Tasks ────────────────────────────────────────────────────
  const hkTasks = [
    { room: roomByNum['102']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30', assignedTo: rinat?._id },
    { room: roomByNum['105']._id, type:'checkout_clean', priority:'high',   status:'in_progress', dueTime:'11:30', assignedTo: miriam?._id, startedAt: new Date() },
    { room: roomByNum['202']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30' },
    { room: roomByNum['207']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30', assignedTo: rinat?._id },
    { room: roomByNum['303']._id, type:'checkout_clean', priority:'high',   status:'completed',   dueTime:'11:30', assignedTo: miriam?._id, startedAt: new Date(Date.now()-3600000), completedAt: new Date() },
    { room: roomByNum['401']._id, type:'checkout_clean', priority:'high',   status:'new',         dueTime:'11:30' },
    { room: roomByNum['503']._id, type:'checkout_clean', priority:'medium', status:'new',         dueTime:'12:00', assignedTo: leah?._id },
    { room: roomByNum['108']._id, type:'stayover',       priority:'medium', status:'new',         dueTime:'14:00', assignedTo: leah?._id },
    { room: roomByNum['204']._id, type:'stayover',       priority:'low',    status:'new',         dueTime:'14:00', assignedTo: miriam?._id },
    { room: roomByNum['306']._id, type:'arrival_prep',   priority:'urgent', status:'new',         dueTime:'10:00', notes:'VIP Sophie Dupont — arrives 14:00, Champagne needed!' },
  ];
  await HousekeepingTask.insertMany(hkTasks.map(t => ({ ...t, property: property._id, date: today, autoCreated: false })));

  // ── Maintenance Tickets ───────────────────────────────────────────────────
  await MaintenanceTicket.insertMany([
    { property: property._id, room: roomByNum['104']._id, category:'hvac',        description:'מזגן לא מקרר — חדר חם',  priority:'high',   status:'in_progress', assignedTo: adminUser._id, blocksRoom:true, createdAt: new Date(Date.now()-86400000) },
    { property: property._id, room: roomByNum['305']._id, category:'internet',    description:'WiFi לא עובד בחדר',       priority:'high',   status:'new',         blocksRoom:true },
    { property: property._id, room: roomByNum['203']._id, category:'lock',        description:'מנעול קשה לפתיחה',        priority:'medium', status:'resolved',    assignedTo: adminUser._id, resolvedAt: new Date() },
    { property: property._id, room: roomByNum['402']._id, category:'electricity', description:'נורת לד פגומה בשירותים', priority:'low',    status:'new' },
  ]);

  // ── Update InventoryDate bookedCount ──────────────────────────────────────
  // For each reservation, increment bookedCount on every date of stay
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

  console.log('✅ Seed complete!');
  console.log(`   Property:     ${property.name}`);
  console.log(`   Room Types:   4`);
  console.log(`   Rooms:        ${rooms.length}`);
  console.log(`   Rate Plans:   3`);
  console.log(`   Guests:       ${guests.length}`);
  console.log(`   Reservations: ${reservations.length}`);
  console.log(`   HK Tasks:     ${hkTasks.length}`);
  console.log(`   Users:        7`);
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
