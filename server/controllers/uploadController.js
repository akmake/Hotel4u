import multer from 'multer';
import path from 'path';
import fs from 'fs';

// --- הגדרות נתיבים ---
// נתיב לשרת הלינוקס (תואם לקונפיגורציית Nginx שלך)
const PROD_PATH = '/var/www/zipori_uploads/images';
// נתיב לפיתוח מקומי (ייווצר בתוך תיקיית server/uploads)
const DEV_PATH = path.join(process.cwd(), 'uploads', 'images');

// --- פונקציה חכמה לבחירת מיקום השמירה ---
const getDestination = () => {
    // בדיקה: האם אנחנו רצים על השרת? (בודק אם התיקייה הראשית קיימת)
    if (fs.existsSync('/var/www/zipori_uploads')) {
        if (!fs.existsSync(PROD_PATH)) {
            fs.mkdirSync(PROD_PATH, { recursive: true });
        }
        return PROD_PATH;
    }
    
    // אחרת, אנחנו בווינדוס/פיתוח
    if (!fs.existsSync(DEV_PATH)) {
        fs.mkdirSync(DEV_PATH, { recursive: true });
    }
    return DEV_PATH;
};

// --- הגדרות Multer ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, getDestination());
    },
    filename: (req, file, cb) => {
        // שם קובץ ייחודי למניעת התנגשויות
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const cleanName = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        cb(null, `${uniqueSuffix}-${cleanName}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // מגבלה: 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('רק קבצי תמונה מותרים!'), false);
        }
    }
});

// ייצוא ה-Middleware
export const uploadMiddleware = upload.single('file');

// --- ה-Controller עצמו ---
export const handleUpload = (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'לא נבחר קובץ להעלאה.' });
    }

    // החזרת ה-URL ללקוח
    // Nginx מוגדר לשרת את /uploads/ מהתיקייה החיצונית
    // בפיתוח, נוסיף שורה ב-app.js שתשרת את התיקייה המקומית באותו נתיב
    const fileUrl = `/uploads/images/${req.file.filename}`;

    res.status(200).json({
        message: 'הקובץ הועלה בהצלחה',
        path: fileUrl,
        filename: req.file.filename
    });
};