import Room from '../models/Room.js';
import Hotel from '../models/Hotel.js';
import Booking from '../models/Booking.js';
import { catchAsync } from '../middlewares/errorHandler.js';
import AppError from '../utils/AppError.js';
import moment from 'moment';
import { syncRoomWithCalendar } from '../services/roomSyncService.js';

/**
 * @desc    קליטת סידור עבודה יומי (אקסל) - פונקציה חדשה!
 * @desc    מאפסת משמרת, שומרת זיכרון Stayovers, ומעדכנת לפי האקסל
 * @route   POST /api/rooms/upload-daily
 */
export const uploadDailySchedule = catchAsync(async (req, res, next) => {
    const { roomsData, hotelId } = req.body; 
    const today = moment().startOf('day');

    // 1. איפוס יומי + שימור זיכרון (Rollover)
    // מכבים את ActiveForShift לכולם כדי להתחיל "דף נקי"
    await Room.updateMany({ hotel: hotelId }, {
      $set: {
        activeForShift: false, 
        priority: 0,
        bookingType: 'None',
        // לא מוחקים tasks כי הלוגיקה המקורית שלך מטפלת בהם בנפרד
      }
    });

    // 2. חישוב Stayovers אוטומטי (לחדרים שלא באקסל אבל תפוסים)
    // משתמשים בשדה הזיכרון החדש: checkOutDate
    const occupiedRooms = await Room.find({ hotel: hotelId, isOccupied: true });
    const stayoverUpdates = [];

    for (const room of occupiedRooms) {
      if (room.currentBooking && room.currentBooking.checkOutDate) {
          const checkOut = moment(room.currentBooking.checkOutDate);
          
          // אם תאריך העזיבה הוא בעתיד -> זה Stayover
          if (checkOut.isAfter(today)) {
            stayoverUpdates.push({
              updateOne: {
                filter: { _id: room._id },
                update: {
                  $set: {
                    bookingType: 'Stayover',
                    activeForShift: true, // מציגים לחדרנית
                    status: 'dirty',
                    priority: 1
                  }
                }
              }
            });
          }
      }
    }
    if (stayoverUpdates.length > 0) await Room.bulkWrite(stayoverUpdates);

    // 3. עיבוד האקסל (האמת האבסולוטית להיום)
    if (roomsData && roomsData.length > 0) {
      const excelOps = roomsData.map((row) => {
        const type = row.type; // Arrival, Departure...
        
        let priority = 1;
        if (type === 'BackToBack' || type === 'Arrival') priority = 3;
        else if (type === 'Departure') priority = 2;

        const updateFields = {
          activeForShift: true,
          bookingType: type,
          priority: priority,
          status: 'dirty',
          guestCount: {
            adults: row.adults || 0,
            children: row.children || 0,
            babies: row.babies || 0
          }
        };

        // עדכון זיכרון אם זו כניסה חדשה (כדי שנדע מחר שהם נשארים)
        if (type === 'Arrival' || type === 'BackToBack') {
            updateFields.isOccupied = true;
            updateFields['currentBooking.checkInDate'] = new Date();
            if (row.checkOutDate) {
                updateFields['currentBooking.checkOutDate'] = moment(row.checkOutDate).toDate();
            }
        }
        
        // אופציונלי: הזרקת הערה כמשימה יומית
        if (row.notes) {
             // כרגע נשאיר ללא שינוי tasks כדי לא להתנגש עם syncRoomWithCalendar
             // אבל המידע נשמר בחדר ויוצג
        }

        return {
          updateOne: {
            filter: { roomNumber: row.roomNumber, hotel: hotelId },
            update: { $set: updateFields }
          }
        };
      });

      await Room.bulkWrite(excelOps);
    }

    // החזרת החדרים הפעילים למסך
    const activeRooms = await Room.find({ hotel: hotelId, activeForShift: true })
        .sort({ priority: -1, roomNumber: 1 });

    res.status(200).json({ status: 'success', data: activeRooms });
});


/**
 * @desc    שליפת חדרים למלון (כולל סנכרון אוטומטי מול יומן)
 * @route   GET /api/rooms/:hotelId
 */
export const getRoomsByHotel = catchAsync(async (req, res) => {
    const { hotelId } = req.params;
    const user = req.user;
    const { activeOnly } = req.query; // פרמטר חדש לסינון הדשבורד!

    // 1. שליפת הגדרות המלון (בשביל הצ'ק ליסטים)
    const hotelDoc = await Hotel.findById(hotelId);
    if (!hotelDoc) return res.status(404).json({ message: 'מלון לא נמצא' });

    // 2. בניית שאילתה בסיסית לחדרים
    let query = { hotel: hotelId };

    // --- לוגיקה חדשה: סינון לפי משמרת יומית (לדשבורד מנהל) ---
    if (activeOnly === 'true') {
        query.activeForShift = true;
    }

    // סינון לפי תפקיד (חדרנית רואה רק את שלה, מנהל רואה הכל)
    if (user.role === 'housekeeper') {
        query.assignedTo = user._id;
        query.activeForShift = true; // חדרנית רואה רק מה שבסידור היום
    } 
    else if (user.role === 'maintenance') {
        // איש תחזוקה רואה חדרים בסטטוס תקלה או שיש בהם משימות תחזוקה
        query.$or = [
            { status: 'maintenance' },
            { tasks: { $elemMatch: { type: 'maintenance', isCompleted: false } } }
        ];
    }

    // שליפת החדרים מה-DB
    const rooms = await Room.find(query)
        .populate('roomType', 'name')
        .populate('assignedTo', 'name')
        .collation({ locale: "en_US", numericOrdering: true }) // מיון מספרי נכון (1, 2, 10 ולא 1, 10, 2)
        .sort({ priority: -1, roomNumber: 1 }); // מיון משולב: קודם דחיפות, אח"כ מספר

    // 3. ייעול: שליפת כל ההזמנות הרלוונטיות להיום במכה אחת
    // (מונע ביצוע שאילתה נפרדת לכל חדר בתוך הלולאה)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const activeBookings = await Booking.find({
        hotel: hotelId,
        status: 'active',
        $or: [
            { arrivalDate: { $lte: todayEnd, $gte: todayStart } }, // נכנסים היום
            { departureDate: { $lte: todayEnd, $gte: todayStart } }, // יוצאים היום
            { arrivalDate: { $lt: todayStart }, departureDate: { $gt: todayEnd } } // שוהים (התחילו לפני ונגמרים אחרי)
        ]
    });

    // 4. הרצת הסנכרון על כל חדר
    const processedRooms = await Promise.all(rooms.map(async (room) => {
        // אנשי תחזוקה לא צריכים לראות צ'ק ליסט ניקיון שנוצר אוטומטית
        if (user.role === 'maintenance') return room;
        
        // הפונקציה החכמה שבודקת את היומן ומעדכנת את החדר
        return await syncRoomWithCalendar(room, hotelDoc, activeBookings);
    }));

    res.json(processedRooms);
});


/**
 * @desc    עדכון סטטוס חדר (נקי/מלוכלך/תקלה) + עדכון תפוסה (Front Desk)
 * @route   PATCH /api/rooms/:id/status
 */
export const updateRoomStatus = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { status, isOccupied } = req.body; // הוספתי תמיכה ב-isOccupied

    const room = await Room.findById(id);
    if (!room) return next(new AppError('חדר לא נמצא', 404));

    // --- תוספת: עדכון תפוסה מהקבלה (בזמן אמת) ---
    if (typeof isOccupied === 'boolean') {
        room.isOccupied = isOccupied;
        
        // לוגיקה: אם עשו Check-Out (החדר התפנה פיזית) -> הוא הופך למלוכלך לניקיון יסודי
        if (isOccupied === false && room.bookingType === 'Departure') {
             room.status = 'dirty'; 
        }
    }

    // מצב 1: הופכים ל"נקי" (סוגרים הכל)
    if (status === 'clean') {
        room.status = 'clean';
        room.lastCleanedAt = new Date();
        room.lastCleanedBy = req.user._id;

        // שומרים היסטוריה
        room.history.push({
            cycleDate: new Date(),
            cleanedBy: req.user.name,
            tasksSnapshot: room.tasks // שומרים מה בוצע
        });

        room.tasks = room.tasks.filter(t => t.type === 'maintenance' && !t.isCompleted);
    }

    else if (status === 'dirty') {
        room.status = 'dirty';
    }

    else if (status) {
        room.status = status;
    }

    await room.save();
    res.json(room);
});


/**
 * @desc    הוספת משימה ידנית (ע"י מנהל או חדרנית)
 * @route   POST /api/rooms/:id/tasks
 */
export const addTask = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { description, isTemporary } = req.body;
    const room = await Room.findById(id);
    if (!room) return next(new AppError('לא נמצא', 404));

    room.tasks.push({
        description,
        type: isTemporary ? 'daily' : 'maintenance', // daily = בקשה, maintenance = תקלה
        addedBy: req.user._id,
        isSystemTask: false
    });

    // אם הוסיפו משימה לחדר נקי -> הוא הופך למלוכלך/בטיפול
    if (room.status === 'clean') {
        room.status = isTemporary ? 'dirty' : 'maintenance';
    }
    
    await room.save();
    res.json(room);
});


/**
 * @desc    סימון משימה כבוצעה/לא בוצעה
 * @route   PATCH /api/rooms/:id/tasks/:taskId
 */
export const toggleTask = catchAsync(async (req, res, next) => {
    const { id, taskId } = req.params;
    const { isCompleted } = req.body;

    const room = await Room.findById(id);
    if (!room) return next(new AppError('לא נמצא', 404));

    const task = room.tasks.id(taskId);
    if (task) {
        task.isCompleted = isCompleted;
        task.completedBy = isCompleted ? req.user._id : null;
        task.completedAt = isCompleted ? new Date() : null;
        await room.save();
    }
    res.json(room);
});


/**
 * @desc    יצירת חדרים (Bulk)
 * @route   POST /api/rooms/bulk
 */
export const createBulkRooms = catchAsync(async (req, res) => {
    const { hotel, roomType, startNumber, endNumber } = req.body;
    const start = Number(startNumber);
    const end = Number(endNumber);
    const created = [];

    for(let i=start; i<=end; i++) {
        const num = i.toString();
        const exists = await Room.exists({ hotel, roomNumber: num });
        if(!exists) {
            created.push({ 
                hotel, 
                roomNumber: num, 
                roomType, 
                status: 'dirty', 
                tasks: [] // יתמלא אוטומטית בכניסה הראשונה
            });
        }
    }
    if(created.length) await Room.insertMany(created);
    res.status(201).json({ message: 'חדרים נוצרו בהצלחה' });
});


/**
 * @desc    שליפת כל החדרים (מנהל)
 * @route   GET /api/rooms/all
 */
export const getAllRooms = catchAsync(async (req, res) => {
    const rooms = await Room.find({})
        .populate('hotel', 'name')
        .sort({roomNumber: 1});
    res.json(rooms);
});


/**
 * @desc    מחיקת חדר
 * @route   DELETE /api/rooms/:id
 */
export const deleteRoom = catchAsync(async (req, res) => {
    await Room.findByIdAndDelete(req.params.id);
    res.status(204).send();
});


/**
 * @desc    הפצת תוכנית יומית (אופציונלי - נשאר לתמיכה ידנית)
 * @route   POST /api/rooms/daily-plan
 */
export const applyDailyPlan = catchAsync(async (req, res) => {
    const { plan } = req.body; // [{ roomId, note }]
    let count = 0;
    
    for (const item of plan) {
        const room = await Room.findById(item.roomId);
        if (room) {
            if (item.note) {
                room.tasks.unshift({
                    description: `👑 ${item.note}`,
                    type: 'daily',
                    isSystemTask: false,
                    addedBy: req.user._id
                });
                
                if (room.status === 'clean') room.status = 'dirty';
                await room.save();
                count++;
            }
        }
    }
    res.json({ message: `הערות הופצו ל-${count} חדרים.` });
});