import express from 'express';
// משתמש ב-Middlewares הקיימים שלך
import { requireAuth, requireAdmin, requireMaintenance } from '../middlewares/authMiddleware.js';
import {
  getRoomsByHotel,
  getAllRooms,
  createBulkRooms,
  updateRoomStatus,
  addTask,
  toggleTask,
  deleteRoom,
  applyDailyPlan,
  uploadDailySchedule
} from '../controllers/roomController.js';

const router = express.Router();

// כל הנתיבים דורשים התחברות בסיסית
router.use(requireAuth);

// --- ניהול מערכתי (אדמין בלבד) ---
router.get('/all', requireAdmin, getAllRooms);
router.post('/bulk', requireAdmin, createBulkRooms);

// --- העלאת סידור עבודה יומי ---
router.post('/upload-daily', requireAuth, uploadDailySchedule);

// --- נתיב ההפצה הישן ---
router.post('/daily-plan', requireAdmin, applyDailyPlan);

// --- עבודה שוטפת על חדר ---
router.patch('/:id/status', requireAuth, updateRoomStatus);

// הוספת משימות (דורש איש אחזקה/מנהל - חדרנית לא מוסיפה תקלות באופן ישיר אלא דרך הערה)
router.post('/:id/tasks', requireMaintenance, addTask);

// ✨ תיקון: שינוי מ-requireMaintenance ל-requireAuth כדי שחדרניות יוכלו לסמן משימות
router.patch('/:id/tasks/:taskId', requireAuth, toggleTask);

// מחיקת חדר
router.delete('/:id', requireAdmin, deleteRoom);

// --- שליפת חדרים למלון ---
router.get('/:hotelId', getRoomsByHotel);

export default router;