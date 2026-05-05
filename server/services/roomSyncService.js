import Room from '../models/Room.js';
import Booking from '../models/Booking.js';
import Hotel from '../models/Hotel.js';

// פונקציה שמקבלת חדר ומחליטה מה הסטטוס שלו להיום ואיזה משימות לתת לו
export const syncRoomWithCalendar = async (room, hotelDoc, activeBookings) => {
    // 1. חדר בתקלה? לא נוגעים בו
    if (room.status === 'maintenance') return room;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // 2. אם החדר כבר סומן כ"נקי" היום (אחרי 00:00) - לא דורסים
    if (room.lastCleanedAt && new Date(room.lastCleanedAt) >= todayStart) {
        if (room.status !== 'clean') {
            room.status = 'clean';
            await room.save();
        }
        return room;
    }

    // 3. מציאת הזמנה רלוונטית להיום
    const booking = activeBookings.find(b => 
        b.room.toString() === room._id.toString() &&
        new Date(b.arrivalDate) <= todayEnd &&
        new Date(b.departureDate) >= todayStart
    );

    // אם אין הזמנה - החדר לא פעיל להיום (מאפסים לו את המצב)
    if (!booking) {
        room.activeForShift = false;
        room.isOccupied = false;
        // מאפסים את הזיכרון כדי לא להציג נתונים ישנים
        room.currentBooking = { guestName: '' };
        room.guestCount = { pax: 0, adults: 0, children: 0, babies: 0 };
        await room.save();
        return room; 
    }

    // 4. חישוב הסטטוס היומי
    const arrivalTime = new Date(booking.arrivalDate).setHours(0,0,0,0);
    const departureTime = new Date(booking.departureDate).setHours(0,0,0,0);
    const todayTime = todayStart.getTime();

    let calculatedStatus = ''; 
    let checklistType = 'stayover'; // ברירת מחדל

    const isArrival = arrivalTime === todayTime;
    const isDeparture = departureTime === todayTime;

    if (isArrival && isDeparture) {
        calculatedStatus = 'back_to_back'; 
        checklistType = 'departure'; // ניקיון יסודי
    } else if (isDeparture) {
        calculatedStatus = 'departure';
        checklistType = 'departure';
    } else if (isArrival) {
        calculatedStatus = 'arrival';
        checklistType = 'arrival';
    } else {
        calculatedStatus = 'stayover';
        checklistType = 'stayover';
    }

    // 5. עדכון החדר
    // אנחנו הופכים אותו ל"מלוכלך" ומפעילים אותו למשמרת
    room.activeForShift = true;
    room.bookingType = isArrival && isDeparture ? 'BackToBack' : 
                       isArrival ? 'Arrival' : 
                       isDeparture ? 'Departure' : 'Stayover';

    // הזרקת משימות (רק אם החדר עוד לא מלוכלך או שאין לו משימות)
    const hasTasks = room.tasks && room.tasks.filter(t => !t.isCompleted).length > 0;
    
    if (room.status !== 'dirty' || !hasTasks) {
        room.status = 'dirty'; 
        
        // שליפת הצ'ק ליסט המתאים מהמלון
        const tasksTemplate = hotelDoc.checklists?.[checklistType] || [];
        
        let newTasks = tasksTemplate.map(item => ({
            description: item.text,
            type: 'standard',
            isSystemTask: true,
            isCompleted: false
        }));

        // משימות מיוחדות (מיטות/לולים)
        if (isArrival || calculatedStatus === 'back_to_back') {
            if (booking.pax > 0) newTasks.unshift({ description: `🛏️ להכין ${booking.pax} מיטות`, type: 'daily', isSystemTask: true, isHighlight: true });
            if (booking.babies > 0) newTasks.unshift({ description: `👶 להכין ${booking.babies} עריסות`, type: 'daily', isSystemTask: true, isHighlight: true });
            if (booking.notes) newTasks.unshift({ description: `📝 הערה: ${booking.notes}`, type: 'daily', isSystemTask: true, isHighlight: true });
        }

        // שימור משימות תחזוקה קיימות
        const existingMaintenance = room.tasks.filter(t => t.type === 'maintenance' && !t.isCompleted);
        room.tasks = [...existingMaintenance, ...newTasks];
    }

    // עדכון פרטי אורח נוכחי (לזיכרון)
    room.currentBooking = {
        bookingId: booking._id,
        guestName: booking.guestName || 'אורח', // ✨ הוספתי
        checkInDate: booking.arrivalDate,
        checkOutDate: booking.departureDate
    };
    
    // ✨ עדכון מוני אורחים בחדר (כדי שיוצג נכון בדשבורד)
    room.guestCount = {
        pax: booking.pax || 1,
        adults: 0, // האקסל לא תמיד מפריד, אז שמים הכל ב-Pax
        children: 0,
        babies: booking.babies || 0
    };

    room.isOccupied = true; // אם יש הזמנה פעילה, החדר תפוס לוגית

    await room.save();
    return room;
};