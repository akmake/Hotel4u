// ─── Hotel Mock Data ─────────────────────────────────────────────────────────
// Simulates a 40-room hotel for May 2026

export const HOTEL = {
  name: 'מלון הגליל',
  totalRooms: 40,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  currency: '₪',
};

// ─── Room Types ───────────────────────────────────────────────────────────────
export const ROOM_TYPES = [
  { id: 'std', name: 'חדר סטנדרט',    capacity: 2, baseRate: 380 },
  { id: 'dlx', name: 'חדר דלוקס',     capacity: 2, baseRate: 520 },
  { id: 'ste', name: 'סוויטה',         capacity: 4, baseRate: 890 },
  { id: 'fam', name: 'חדר משפחה',     capacity: 5, baseRate: 650 },
];

// ─── Room Status Helpers ──────────────────────────────────────────────────────
export const CLEAN_STATUS = { clean: 'נקי', dirty: 'מלוכלך', inspected: 'נבדק', pickup: 'Pickup' };
export const OPS_STATUS   = { available: 'זמין', ooo: 'Out of Order', oos: 'Out of Service', hold: 'Hold' };
export const OCC_STATUS   = { vacant: 'פנוי', occupied: 'תפוס', due_in: 'Due In', due_out: 'Due Out' };

// ─── Rooms ────────────────────────────────────────────────────────────────────
export const ROOMS = [
  // Floor 1 — Standard
  { id: 'r101', num: '101', type: 'std', floor: 1, ops: 'available', clean: 'clean',    occ: 'vacant' },
  { id: 'r102', num: '102', type: 'std', floor: 1, ops: 'available', clean: 'dirty',    occ: 'due_out' },
  { id: 'r103', num: '103', type: 'std', floor: 1, ops: 'available', clean: 'clean',    occ: 'occupied' },
  { id: 'r104', num: '104', type: 'std', floor: 1, ops: 'ooo',       clean: 'dirty',    occ: 'vacant' },
  { id: 'r105', num: '105', type: 'std', floor: 1, ops: 'available', clean: 'dirty',    occ: 'due_out' },
  { id: 'r106', num: '106', type: 'std', floor: 1, ops: 'available', clean: 'clean',    occ: 'due_in' },
  { id: 'r107', num: '107', type: 'std', floor: 1, ops: 'available', clean: 'inspected',occ: 'vacant' },
  { id: 'r108', num: '108', type: 'std', floor: 1, ops: 'available', clean: 'dirty',    occ: 'occupied' },
  // Floor 2 — Deluxe
  { id: 'r201', num: '201', type: 'dlx', floor: 2, ops: 'available', clean: 'clean',    occ: 'due_in' },
  { id: 'r202', num: '202', type: 'dlx', floor: 2, ops: 'available', clean: 'dirty',    occ: 'due_out' },
  { id: 'r203', num: '203', type: 'dlx', floor: 2, ops: 'available', clean: 'clean',    occ: 'occupied' },
  { id: 'r204', num: '204', type: 'dlx', floor: 2, ops: 'available', clean: 'clean',    occ: 'occupied' },
  { id: 'r205', num: '205', type: 'dlx', floor: 2, ops: 'hold',      clean: 'clean',    occ: 'vacant' },
  { id: 'r206', num: '206', type: 'dlx', floor: 2, ops: 'available', clean: 'inspected',occ: 'vacant' },
  { id: 'r207', num: '207', type: 'dlx', floor: 2, ops: 'available', clean: 'dirty',    occ: 'due_out' },
  { id: 'r208', num: '208', type: 'dlx', floor: 2, ops: 'available', clean: 'clean',    occ: 'due_in' },
  // Floor 3 — Deluxe
  { id: 'r301', num: '301', type: 'dlx', floor: 3, ops: 'available', clean: 'clean',    occ: 'occupied' },
  { id: 'r302', num: '302', type: 'dlx', floor: 3, ops: 'available', clean: 'clean',    occ: 'occupied' },
  { id: 'r303', num: '303', type: 'dlx', floor: 3, ops: 'available', clean: 'dirty',    occ: 'due_out' },
  { id: 'r304', num: '304', type: 'dlx', floor: 3, ops: 'available', clean: 'inspected',occ: 'vacant' },
  { id: 'r305', num: '305', type: 'dlx', floor: 3, ops: 'ooo',       clean: 'dirty',    occ: 'vacant' },
  { id: 'r306', num: '306', type: 'dlx', floor: 3, ops: 'available', clean: 'clean',    occ: 'due_in' },
  { id: 'r307', num: '307', type: 'dlx', floor: 3, ops: 'available', clean: 'clean',    occ: 'occupied' },
  { id: 'r308', num: '308', type: 'dlx', floor: 3, ops: 'available', clean: 'clean',    occ: 'occupied' },
  // Floor 4 — Family
  { id: 'r401', num: '401', type: 'fam', floor: 4, ops: 'available', clean: 'dirty',    occ: 'due_out' },
  { id: 'r402', num: '402', type: 'fam', floor: 4, ops: 'available', clean: 'clean',    occ: 'due_in' },
  { id: 'r403', num: '403', type: 'fam', floor: 4, ops: 'available', clean: 'inspected',occ: 'vacant' },
  { id: 'r404', num: '404', type: 'fam', floor: 4, ops: 'available', clean: 'clean',    occ: 'occupied' },
  // Floor 5 — Suites
  { id: 'r501', num: '501', type: 'ste', floor: 5, ops: 'available', clean: 'inspected',occ: 'due_in', vip: true },
  { id: 'r502', num: '502', type: 'ste', floor: 5, ops: 'available', clean: 'clean',    occ: 'occupied' },
  { id: 'r503', num: '503', type: 'ste', floor: 5, ops: 'available', clean: 'dirty',    occ: 'due_out' },
  { id: 'r504', num: '504', type: 'ste', floor: 5, ops: 'available', clean: 'clean',    occ: 'vacant' },
];

// ─── Guests ───────────────────────────────────────────────────────────────────
export const GUESTS = [
  { id: 'g1',  name: 'דוד לוי',       email: 'david@example.com',   phone: '050-1234567', country: 'IL', vip: false, stays: 3 },
  { id: 'g2',  name: 'שרה כהן',       email: 'sarah@example.com',   phone: '052-9876543', country: 'IL', vip: true,  stays: 12 },
  { id: 'g3',  name: 'Michael Brown',  email: 'mbrown@example.com',  phone: '+1-555-0100', country: 'US', vip: false, stays: 1 },
  { id: 'g4',  name: 'אביב מזרחי',    email: 'aviv@example.com',    phone: '054-5551234', country: 'IL', vip: false, stays: 5 },
  { id: 'g5',  name: 'Sophie Dupont',  email: 'sophie@example.com',  phone: '+33-612345678',country:'FR', vip: true,  stays: 8 },
  { id: 'g6',  name: 'נועה פרידמן',   email: 'noa@example.com',     phone: '058-7778899', country: 'IL', vip: false, stays: 2 },
  { id: 'g7',  name: 'יוסי ברקוביץ',  email: 'yossi@example.com',   phone: '050-3334455', country: 'IL', vip: false, stays: 7 },
  { id: 'g8',  name: 'Ahmad Hassan',   email: 'ahmad@example.com',   phone: '+971-501234567',country:'AE',vip: false, stays: 4 },
  { id: 'g9',  name: 'רחל גולן',      email: 'rachel@example.com',  phone: '052-6667788', country: 'IL', vip: true,  stays: 15 },
  { id: 'g10', name: 'Emma Wilson',    email: 'emma@example.com',    phone: '+44-7700900123',country:'GB',vip: false, stays: 1 },
];

// ─── Reservations ─────────────────────────────────────────────────────────────
const d = (offset = 0) => {
  const dt = new Date('2026-05-04');
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().split('T')[0];
};

export const RESERVATIONS = [
  { id: 'RES-1001', guestId:'g1',  roomId:'r102', roomTypeId:'std', arrival:d(-2), departure:d(0), nights:2, rate:380, total:760,  status:'due_out',  payment:'paid',    source:'direct',    ratePlan:'BAR', notes:'' },
  { id: 'RES-1002', guestId:'g2',  roomId:'r203', roomTypeId:'dlx', arrival:d(-3), departure:d(1), nights:4, rate:520, total:2080, status:'inhouse',  payment:'partial', source:'direct',    ratePlan:'VIP', notes:'VIP — פרחים בחדר', vip:true },
  { id: 'RES-1003', guestId:'g3',  roomId:'r301', roomTypeId:'dlx', arrival:d(-1), departure:d(2), nights:3, rate:520, total:1560, status:'inhouse',  payment:'paid',    source:'booking',   ratePlan:'BAR', notes:'' },
  { id: 'RES-1004', guestId:'g5',  roomId:'r501', roomTypeId:'ste', arrival:d(0),  departure:d(3), nights:3, rate:890, total:2670, status:'due_in',   payment:'pending', source:'direct',    ratePlan:'VIP', notes:'VIP Arrival — Champagne', vip:true },
  { id: 'RES-1005', guestId:'g4',  roomId:'r106', roomTypeId:'std', arrival:d(0),  departure:d(2), nights:2, rate:380, total:760,  status:'due_in',   payment:'paid',    source:'expedia',   ratePlan:'BAR', notes:'' },
  { id: 'RES-1006', guestId:'g6',  roomId:'r208', roomTypeId:'dlx', arrival:d(0),  departure:d(4), nights:4, rate:520, total:2080, status:'due_in',   payment:'paid',    source:'direct',    ratePlan:'BAR', notes:'בקשה: קומה גבוהה' },
  { id: 'RES-1007', guestId:'g7',  roomId:'r302', roomTypeId:'dlx', arrival:d(-4), departure:d(0), nights:4, rate:520, total:2080, status:'due_out',  payment:'paid',    source:'agoda',     ratePlan:'BAR', notes:'' },
  { id: 'RES-1008', guestId:'g8',  roomId:'r303', roomTypeId:'dlx', arrival:d(-2), departure:d(0), nights:2, rate:520, total:1040, status:'due_out',  payment:'balance', source:'booking',   ratePlan:'BAR', notes:'יתרה פתוחה: ₪340' },
  { id: 'RES-1009', guestId:'g9',  roomId:'r502', roomTypeId:'ste', arrival:d(-1), departure:d(3), nights:4, rate:890, total:3560, status:'inhouse',  payment:'paid',    source:'direct',    ratePlan:'VIP', notes:'', vip:true },
  { id: 'RES-1010', guestId:'g10', roomId:'r402', roomTypeId:'fam', arrival:d(0),  departure:d(5), nights:5, rate:650, total:3250, status:'due_in',   payment:'paid',    source:'booking',   ratePlan:'BAR', notes:'2 ילדים, מיטה נוספת' },
  { id: 'RES-1011', guestId:'g1',  roomId:'r108', roomTypeId:'std', arrival:d(-3), departure:d(0), nights:3, rate:380, total:1140, status:'inhouse',  payment:'paid',    source:'direct',    ratePlan:'BAR', notes:'' },
  { id: 'RES-1012', guestId:'g2',  roomId:null,   roomTypeId:'std', arrival:d(1),  departure:d(3), nights:2, rate:380, total:760,  status:'confirmed',payment:'paid',    source:'direct',    ratePlan:'BAR', notes:'' },
  { id: 'RES-1013', guestId:'g3',  roomId:null,   roomTypeId:'dlx', arrival:d(2),  departure:d(5), nights:3, rate:520, total:1560, status:'confirmed',payment:'pending', source:'expedia',   ratePlan:'BAR', notes:'' },
  { id: 'RES-1014', guestId:'g4',  roomId:'r307', roomTypeId:'dlx', arrival:d(-1), departure:d(2), nights:3, rate:520, total:1560, status:'inhouse',  payment:'paid',    source:'direct',    ratePlan:'BAR', notes:'' },
  { id: 'RES-1015', guestId:'g5',  roomId:'r308', roomTypeId:'dlx', arrival:d(-2), departure:d(1), nights:3, rate:520, total:1560, status:'inhouse',  payment:'paid',    source:'direct',    ratePlan:'VIP', notes:'' },
  { id: 'RES-1016', guestId:'g6',  roomId:'r404', roomTypeId:'fam', arrival:d(-1), departure:d(3), nights:4, rate:650, total:2600, status:'inhouse',  payment:'paid',    source:'direct',    ratePlan:'BAR', notes:'' },
  { id: 'RES-1017', guestId:'g7',  roomId:null,   roomTypeId:'fam', arrival:d(0),  departure:d(2), nights:2, rate:650, total:1300, status:'due_in',   payment:'paid',    source:'booking',   ratePlan:'BAR', notes:'לא הוקצה חדר!' },
];

// ─── Housekeeping Tasks ───────────────────────────────────────────────────────
export const HK_TASKS = [
  { id:'hk1',  roomId:'r102', type:'checkout',  priority:'high',   status:'new',        assignedTo:'רינת א.', dueTime:'11:30' },
  { id:'hk2',  roomId:'r105', type:'checkout',  priority:'high',   status:'in_progress',assignedTo:'מרים כ.', dueTime:'11:30', startedAt:'10:45' },
  { id:'hk3',  roomId:'r202', type:'checkout',  priority:'high',   status:'new',        assignedTo:null,      dueTime:'11:30' },
  { id:'hk4',  roomId:'r207', type:'checkout',  priority:'high',   status:'new',        assignedTo:'רינת א.', dueTime:'11:30' },
  { id:'hk5',  roomId:'r303', type:'checkout',  priority:'high',   status:'completed',  assignedTo:'מרים כ.', dueTime:'11:30', completedAt:'10:55' },
  { id:'hk6',  roomId:'r401', type:'checkout',  priority:'high',   status:'new',        assignedTo:null,      dueTime:'11:30' },
  { id:'hk7',  roomId:'r503', type:'checkout',  priority:'medium', status:'new',        assignedTo:'לאה ב.',  dueTime:'12:00' },
  { id:'hk8',  roomId:'r108', type:'stayover',  priority:'medium', status:'new',        assignedTo:'לאה ב.',  dueTime:'14:00' },
  { id:'hk9',  roomId:'r204', type:'stayover',  priority:'low',    status:'new',        assignedTo:'מרים כ.', dueTime:'14:00' },
  { id:'hk10', roomId:'r306', type:'arrival',   priority:'urgent', status:'new',        assignedTo:null,      dueTime:'10:00', notes:'VIP — Arrival in 2 hours!' },
];

// ─── Maintenance Tickets ──────────────────────────────────────────────────────
export const MAINTENANCE = [
  { id:'mt1', roomId:'r104', category:'מיזוג',    desc:'מזגן לא מקרר',      priority:'high',   status:'in_progress', assignedTo:'שלמה ת.', created: d(-1) },
  { id:'mt2', roomId:'r305', category:'אינטרנט',  desc:'WiFi לא עובד',      priority:'high',   status:'new',         assignedTo:null,      created: d(0)  },
  { id:'mt3', roomId:'r203', category:'מנעול',    desc:'מנעול קשה לפתיחה', priority:'medium', status:'resolved',    assignedTo:'שלמה ת.', created: d(-2) },
  { id:'mt4', roomId:'r402', category:'חשמל',     desc:'נורה פגומה',        priority:'low',    status:'new',         assignedTo:null,      created: d(0)  },
];

// ─── Alerts (Command Center) ──────────────────────────────────────────────────
export const ALERTS = [
  { id:'a1', type:'warning', icon:'dirty-arrival',  text:'חדר 501 — VIP מגיע ב-14:00 והחדר לא נקי!',        action:'שלח לחדרנות' },
  { id:'a2', type:'danger',  icon:'no-room',         text:'הזמנה RES-1017 — אין חדר מוקצה לאורח שמגיע היום',action:'הקצה חדר' },
  { id:'a3', type:'warning', icon:'balance',         text:'הזמנה RES-1008 — יתרה פתוחה ₪340 לפני צ׳ק-אאוט',action:'פתח Folio' },
  { id:'a4', type:'info',    icon:'pending',         text:'הזמנה RES-1013 — תשלום pending לפני הגעה ב-06/05', action:'שלח לינק תשלום' },
];

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export function getDashboardStats() {
  const today = d(0);
  const arrivals    = RESERVATIONS.filter(r => r.arrival === today);
  const departures  = RESERVATIONS.filter(r => r.departure === today);
  const inhouse     = RESERVATIONS.filter(r => r.status === 'inhouse');
  const cleanRooms  = ROOMS.filter(r => r.clean === 'clean' && r.ops === 'available' && r.occ === 'vacant');
  const dirtyRooms  = ROOMS.filter(r => r.clean === 'dirty');
  const oooRooms    = ROOMS.filter(r => r.ops === 'ooo');
  const unassigned  = RESERVATIONS.filter(r => r.status === 'due_in' && !r.roomId);
  const openBalance = RESERVATIONS.filter(r => r.payment === 'balance');
  const vipArrivals = arrivals.filter(r => r.vip);

  return {
    arrivals:    arrivals.length,
    departures:  departures.length,
    inhouse:     inhouse.length,
    cleanRooms:  cleanRooms.length,
    dirtyRooms:  dirtyRooms.length,
    oooRooms:    oooRooms.length,
    unassigned:  unassigned.length,
    openBalance: openBalance.length,
    vipArrivals: vipArrivals.length,
    occupancy:   Math.round((inhouse.length + arrivals.length) / HOTEL.totalRooms * 100),
  };
}

// ─── Tape Chart Data ──────────────────────────────────────────────────────────
export function getTapeChartDays(startOffset = -2, count = 14) {
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date('2026-05-04');
    dt.setDate(dt.getDate() + startOffset + i);
    return {
      date: dt.toISOString().split('T')[0],
      label: dt.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }),
      isToday: dt.toISOString().split('T')[0] === d(0),
      isWeekend: dt.getDay() === 5 || dt.getDay() === 6,
    };
  });
}

// Helpers
export function getGuest(id)    { return GUESTS.find(g => g.id === id); }
export function getRoom(id)     { return ROOMS.find(r => r.id === id); }
export function getRoomType(id) { return ROOM_TYPES.find(t => t.id === id); }

export function cleanBadge(status) {
  const map = { clean:'clean', dirty:'dirty', inspected:'clean', pickup:'dirty' };
  return map[status] || 'dirty';
}
export function occBadge(status) {
  const map = { vacant:'clean', occupied:'occupied', due_in:'arrival', due_out:'departure' };
  return map[status] || 'pending';
}
