import express from 'express';
import multer from 'multer';
import { requireAuth, requireShiftManager } from '../middlewares/authMiddleware.js';
import {
    uploadSchedule,
    getDailyDashboard,
    resolveConflict,
    assignRoomsToHousekeeper,
    createManualBooking,
    updateBooking,
    deleteBooking
} from '../controllers/bookingController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

// העלאת קובץ (אחמ"ש ומעלה)
router.post('/upload', requireShiftManager, upload.single('file'), uploadSchedule);
router.post('/resolve', requireShiftManager, resolveConflict);

// ניהול הזמנות ידני (אחמ"ש ומעלה)
router.post('/manual', requireShiftManager, createManualBooking);
router.put('/:id', requireShiftManager, updateBooking);
router.delete('/:id', requireShiftManager, deleteBooking);

// הקצאה (אחמ"ש ומעלה)
router.post('/assign', requireShiftManager, assignRoomsToHousekeeper);

// דשבורד יומי
router.get('/daily', getDailyDashboard);

export default router;