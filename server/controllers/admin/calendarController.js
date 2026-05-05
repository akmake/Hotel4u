// server/controllers/admin/calendarController.js
import Booking from '../../models/Booking.js';
import Room from '../../models/Room.js';

export const getCalendarData = async (req, res) => {
  try {
    const { hotelId, startDate, endDate } = req.query;

    if (!hotelId || !startDate || !endDate) {
      return res.status(400).json({ message: 'Missing required parameters' });
    }

    // 1. שליפת כל החדרים במלון (כדי להציג שורות ביומן גם אם אין הזמנה)
    const rooms = await Room.find({ hotel: hotelId })
      .populate('roomType', 'name')
      .sort({ roomNumber: 1 });

    // 2. שליפת השיבוצים - שימוש בשדות הנכונים מהמודל שלך!
    // שים לב: במודל השדות הם arrivalDate/departureDate ולא checkIn/checkOut
    const bookings = await Booking.find({
      hotel: hotelId, // תוקן מ-hotelId ל-hotel
      arrivalDate: { $lte: new Date(endDate) },   // תוקן מ-checkIn
      departureDate: { $gte: new Date(startDate) }, // תוקן מ-checkOut
      status: 'active' // מביאים רק שיבוצים פעילים
    });

    // 3. עיבוד הנתונים לאירועים בלוח השנה
    const events = bookings.map(booking => {
      // מכיוון שאין guestName, נשתמש בהערות או בטקסט קבוע לכותרת
      const title = booking.notes ? booking.notes : 'תפוס'; 

      return {
        id: booking._id,
        // ה-ID של החדר (רוב ספריות ה-Calendar מצפות ל-resourceId או roomId)
        resourceId: booking.room.toString(), 
        roomId: booking.room.toString(), // שומרים גם וגם ליתר ביטחון
        title: title,
        start: booking.arrivalDate, // תוקן מ-checkIn
        end: booking.departureDate, // תוקן מ-checkOut
        status: booking.status,
        pax: booking.pax, // מידע נוסף: כמות אנשים
        babies: booking.babies,
        
        // צבעים או מחלקות CSS לפי הצורך (אופציונלי)
        className: 'bg-blue-500 text-white' 
      };
    });

    res.json({
      // התאמה למבנה שספריות יומן (כמו FullCalendar) אוהבות בדרך כלל
      rooms: rooms.map(r => ({ 
        id: r._id,
        title: r.roomNumber, // השם שמוצג בצד
        name: r.roomNumber,
        type: r.roomType?.name || 'רגיל',
        status: r.status
      })),
      events
    });

  } catch (error) {
    console.error('Calendar Error:', error);
    res.status(500).json({ message: error.message });
  }
};