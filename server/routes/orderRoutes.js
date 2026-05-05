import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/authMiddleware.js';
import {
    createOrder,
    getMyOrders,
    getAllOrders, // ✨ הוספתי את הייבוא החסר הזה!
    updateOrder,
    deleteOrder,
    getOrderById,
    getPublicQuoteById,
    sendOrderEmail,
    getMyOrderStats,
    searchAllOrders 
} from '../controllers/orderController.js';

// הגדרת אחסון זמני בזיכרון (עבור העלאת PDF)
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// ⬇️ --- נתיבים ציבוריים (ללא צורך בהתחברות) --- ⬇️
router.get('/public/:id', getPublicQuoteById);

// ⬇️ --- נתיבים מוגנים (דורשים כניסה למערכת) --- ⬇️
router.use(requireAuth);

// נתיב ראשי: יצירת הזמנה (POST) + שליפת כל ההזמנות (GET)
router.route('/')
    .post(createOrder)
    .get(getAllOrders); // ✨ התיקון הקריטי: מאפשר למשוך את כל ההזמנות

// נתיבים אישיים וסטטיסטיקה
router.route('/my-orders')
    .get(getMyOrders);

router.get('/my-stats', getMyOrderStats);

// נתיב חיפוש (גלובלי)
router.get('/search', searchAllOrders);

// נתיבים ספציפיים לפי ID (שליפה, עדכון, מחיקה)
router.route('/:id')
    .get(getOrderById)
    .put(updateOrder)
    .delete(deleteOrder);

// נתיב שליחת מייל עם PDF
router.post('/:id/email', upload.single('pdf'), sendOrderEmail);

export default router;