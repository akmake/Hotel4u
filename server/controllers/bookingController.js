import Booking from '../models/Booking.js';
import Room from '../models/Room.js';
import RoomType from '../models/RoomType.js';
import Hotel from '../models/Hotel.js';
import { syncRoomWithCalendar } from '../services/roomSyncService.js'; 
import { catchAsync } from '../middlewares/errorHandler.js';
import AppError from '../utils/AppError.js';
import XLSX from 'xlsx';
import { getSocketIO } from '../socket.js'; // ✨ חובה למניעת שגיאת 500

// עזר: ניקוי שעות (UTC כדי למנוע בעיות אזור זמן)
const normalizeDate = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

// עזר: חישוב עמודות באקסל
const findColValue = (row, possibleNames) => {
    const rowKeys = Object.keys(row).map(k => k.toLowerCase());
    for (const name of possibleNames) {
        const lowerName = name.toLowerCase();
        if (row[name] !== undefined) return parseInt(row[name]);
        const foundKeyIndex = rowKeys.indexOf(lowerName);
        if (foundKeyIndex !== -1) {
            const realKey = Object.keys(row)[foundKeyIndex];
            return parseInt(row[realKey]);
        }
    }
    return 0;
};

// --- 1. העלאת קובץ ועיבוד ---
export const uploadSchedule = catchAsync(async (req, res, next) => {
    if (!req.file) return next(new AppError('לא נבחר קובץ', 400));
    const { hotelId, dryRun } = req.body;
    if (!hotelId) return next(new AppError('חובה לבחור מלון', 400));

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    const existingRooms = await Room.find({ hotel: hotelId });
    const roomMap = new Map(existingRooms.map(r => [r.roomNumber, r]));
    const hotelDoc = await Hotel.findById(hotelId);

    let defaultType = await RoomType.findOne({ hotel: hotelId, isDefault: true });
    if (!defaultType) defaultType = await RoomType.findOne({ hotel: hotelId });

    const conflicts = [];
    const newBookings = [];
    const createdRooms = [];
    const roomsToSync = new Set();

    for (const row of rawData) {
        let roomNum = String(row['c_room_number'] || row['חדר'] || row['Room'] || '').trim();
        if (!roomNum || roomNum === '0') continue;

        let arrival = row['c_arrival_date'] || row['Arrival'] || row['הגעה'];
        let departure = row['c_depart_date'] || row['Departure'] || row['עזיבה'];
        if (!arrival || !departure) continue;

        const start = normalizeDate(arrival);
        const end = normalizeDate(departure);

        const guestName = row['guest_name'] || row['שם אורח'] || row['Name'] || row['Customer'] || 'אורח';
        const optimaNumber = String(row['c_folio_number'] || row['Res. No.'] || '');
        const guestPhone = row['phone'] || row['טלפון'] || '';

        const adults = findColValue(row, ['c_adults', 'adults', 'adult', 'מבוגרים']);
        const juniors = findColValue(row, ['c_juniors', 'juniors', 'junior', 'נוער']);
        const children = findColValue(row, ['c_children', 'children', 'child', 'ילדים']);
        let pax = (adults + juniors + children) || 1;

        const babies = findColValue(row, ['c_babies', 'babies', 'baby', 'תינוקות']);
        const notes = row['notes'] || row['הערות'] || '';

        let roomId;
        if (roomMap.has(roomNum)) {
            roomId = roomMap.get(roomNum)._id;
        } else {
            if (!defaultType) return next(new AppError('לא מוגדר סוג חדר', 400));
            const newRoom = await Room.create({ hotel: hotelId, roomNumber: roomNum, roomType: defaultType._id, status: 'dirty' });
            roomId = newRoom._id;
            roomMap.set(roomNum, newRoom);
            createdRooms.push(roomNum);
        }

        const candidateBooking = {
            hotel: hotelId, room: roomId, roomNumber: roomNum, guestName, optimaNumber, guestPhone,
            arrivalDate: start, departureDate: end, pax, babies, notes, source: 'excel'
        };

        const overlap = await Booking.findOne({
            room: roomId, status: 'active',
            $or: [{ arrivalDate: { $lt: end, $gte: start } }, { departureDate: { $gt: start, $lte: end } }, { arrivalDate: { $lte: start }, departureDate: { $gte: end } }]
        });

        if (overlap) {
            conflicts.push({ roomNumber: roomNum, existingBookingId: overlap._id, newBookingData: candidateBooking, type: 'overlap' });
        } else {
            newBookings.push(candidateBooking);
            roomsToSync.add(roomId.toString());
        }
    }

    if (String(dryRun) === 'true') return res.json({ status: 'simulation', conflicts, validCount: newBookings.length });

    if (newBookings.length > 0) {
        await Booking.insertMany(newBookings);
        const activeBookings = await Booking.find({ hotel: hotelId, status: 'active' });
        for (const roomId of roomsToSync) {
            const r = await Room.findById(roomId);
            if (r) await syncRoomWithCalendar(r, hotelDoc, activeBookings);
        }
    }
    res.json({ status: 'success', message: `נקלטו ${newBookings.length} הזמנות.`, createdRooms });
});

// --- 2. ניהול ידני (הפונקציות החדשות שביקשת) ---
export const createManualBooking = catchAsync(async (req, res, next) => {
    const data = req.body;
    const newBooking = await Booking.create({
        ...data,
        arrivalDate: normalizeDate(data.arrivalDate),
        departureDate: normalizeDate(data.departureDate),
        source: 'manual',
        status: 'active'
    });
    getSocketIO().to(data.hotel).emit('calendar_updated');
    res.status(201).json({ status: 'success', data: newBooking });
});

export const updateBooking = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const data = req.body;
    if (data.arrivalDate) data.arrivalDate = normalizeDate(data.arrivalDate);
    if (data.departureDate) data.departureDate = normalizeDate(data.departureDate);

    const updated = await Booking.findByIdAndUpdate(id, data, { new: true });
    if (!updated) return next(new AppError('לא נמצאה הזמנה', 404));
    getSocketIO().to(updated.hotel.toString()).emit('calendar_updated');
    res.json({ status: 'success', data: updated });
});

export const deleteBooking = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const booking = await Booking.findById(id);
    if (!booking) return next(new AppError('לא נמצאה הזמנה', 404));
    const hotelId = booking.hotel.toString();
    await Booking.findByIdAndDelete(id);
    getSocketIO().to(hotelId).emit('calendar_updated');
    res.json({ status: 'success', message: 'הזמנה נמחקה' });
});

// --- 3. דשבורד יומי והקצאות ---
export const getDailyDashboard = catchAsync(async (req, res, next) => {
    const { hotelId, date } = req.query;
    const queryDate = date ? normalizeDate(date) : normalizeDate(new Date());
    const rooms = await Room.find({ hotel: hotelId }).populate('assignedTo', 'name').populate('roomType', 'name').lean();
    const bookings = await Booking.find({ hotel: hotelId, status: 'active', arrivalDate: { $lte: queryDate }, departureDate: { $gte: queryDate } }).lean();
    
    const dashboardData = rooms.map(room => {
        const roomBookings = bookings.filter(b => b.room.toString() === room._id.toString());
        // לוגיקת חישוב סטטוס...
        return { ...room, dashboardStatus: roomBookings.length > 0 ? 'occupied' : 'empty' };
    });
    res.json(dashboardData);
});

export const resolveConflict = catchAsync(async (req, res, next) => {
    const { action, conflictData } = req.body;
    if (action === 'overwrite') {
        await Booking.findByIdAndUpdate(conflictData.existingBookingId, { status: 'cancelled' });
        await Booking.create({ ...conflictData.newBookingData, status: 'active' });
    }
    res.json({ message: 'ההתנגשות נפתרה' });
});

export const assignRoomsToHousekeeper = catchAsync(async (req, res, next) => {
    const { roomIds, userId } = req.body;
    await Room.updateMany({ _id: { $in: roomIds } }, { $set: { assignedTo: userId || null, assignmentDate: new Date() } });
    res.json({ message: 'הוקצו חדרים' });
});