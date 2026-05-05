import express from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { getMyContacts, getMessages, sendMessage, markAsRead, deleteMessage } from '../controllers/chatController.js';
import upload from '../middlewares/uploadMiddleware.js'; // ✨ שימוש במידלוור המעודכן

const router = express.Router();
router.use(requireAuth);

router.get('/contacts', getMyContacts);
router.get('/messages/:otherUserId', getMessages);

// ✨ הוספת upload.single('file') כדי לתמוך בהעלאה
router.post('/send', upload.single('file'), sendMessage);

router.put('/read', markAsRead);
router.delete('/:messageId', deleteMessage);

export default router;