import cron from 'node-cron';
import Room from '../models/Room.js';
import Booking from '../models/Booking.js';
import Hotel from '../models/Hotel.js';
import { syncRoomWithCalendar } from './roomSyncService.js'; // הייבוא מהקובץ שיצרנו למעלה

export const initScheduler = () => {
    // הרצה כל יום ב-04:00 לפנות בוקר
    cron.schedule('0 4 * * *', async () => {
        console.log('⏰ Starting Daily Room Setup (Cron Job)...');
        
        try {
            // 1. ניקוי שולחן: איפוס כל השיבוצים של אתמול
            await Room.updateMany({}, {
                $set: {
                    activeForShift: false, // כולם נעלמים מהלוח זמנית
                    assignedTo: null,      // ניתוק חדרניות
                    assignmentDate: null,
                    priority: 0,
                    bookingType: 'None'
                }
            });
            console.log('🧹 Cleaned up yesterday\'s assignments.');

            // 2. שליפת כל המלונות והחדרים
            const hotels = await Hotel.find({});
            
            for (const hotel of hotels) {
                // שליפת הזמנות רלוונטיות להיום למלון הזה
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date();
                todayEnd.setHours(23, 59, 59, 999);

                const activeBookings = await Booking.find({
                    hotel: hotel._id,
                    status: 'active',
                    $or: [
                        { arrivalDate: { $lte: todayEnd, $gte: todayStart } },
                        { departureDate: { $lte: todayEnd, $gte: todayStart } },
                        { arrivalDate: { $lt: todayStart }, departureDate: { $gt: todayEnd } }
                    ]
                });

                const rooms = await Room.find({ hotel: hotel._id });

                // 3. הפעלת ה"מוח" על כל חדר
                let updatedCount = 0;
                for (const room of rooms) {
                    const updatedRoom = await syncRoomWithCalendar(room, hotel, activeBookings);
                    if (updatedRoom.activeForShift) updatedCount++;
                }
                
                console.log(`✅ Hotel ${hotel.name}: Prepared ${updatedCount} rooms for today.`);
            }

        } catch (error) {
            console.error('❌ Error in Daily Scheduler:', error);
        }
    });

    console.log('✔ Scheduler initialized (Runs at 04:00 AM daily)');
};