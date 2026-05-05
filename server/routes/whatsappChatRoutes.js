import express from 'express';
import { getChatList, getMessagesByNumber, sendMessage } from '../controllers/whatsappChatController.js';
import requireAuth from '../middlewares/requireAuth.js';

const router = express.Router();

router.get('/chats', requireAuth, getChatList); // רשימת שיחות
router.get('/messages/:number', requireAuth, getMessagesByNumber); // הודעות ספציפיות
router.post('/send', requireAuth, sendMessage); // שליחת הודעה

export default router;