import express from 'express';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middlewares/authMiddleware.js';
import path from 'path'; // וודא ש-path מיובא
import fs from 'fs';     // וודא ש-fs מיובא

const router = express.Router();

// ✅ תיקון: הגדרה לשמור בתוך תת-תיקיית files
const FINAL_PATH = '/var/www/zipori_uploads/files';

const storage = multer.diskStorage({
  destination(req, file, cb) {
    // בדיקה ויצירת התיקייה אם היא לא קיימת
    if (!fs.existsSync(FINAL_PATH)) {
        fs.mkdirSync(FINAL_PATH, { recursive: true });
    }
    cb(null, FINAL_PATH);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now();
    // החלפת תווים בעייתיים בקו תחתון
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, `file-${uniqueSuffix}-${cleanName}`);
  },
});

const upload = multer({ storage });

router.post('/general', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'לא נבחר קובץ' });

    console.log(`🚀 [Fixed Upload] File saved to: ${req.file.path}`);

    // ✅ תיקון: החזרת הנתיב כולל /files/ כדי שהקליינט והבוט יבינו איפה זה
    res.json({
      message: 'הקובץ עלה בהצלחה',
      path: `/uploads/files/${req.file.filename}`
    });
});

// נתיב לוגו (נשאר ללא שינוי, או שתרצה להעביר גם אותו)
router.post('/logo', requireAuth, requireAdmin, upload.single('logo'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'לא נבחר קובץ' });
    res.json({
        message: 'הלוגו עלה בהצלחה',
        path: `/uploads/files/${req.file.filename}`
    });
});

export default router;