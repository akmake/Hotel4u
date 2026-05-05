import multer from 'multer';
import path from 'path';
import fs from 'fs';

// --- הגדרות נתיבים קשיחות ---
const PROD_PATH = '/var/www/zipori_uploads/files'; // שונה ל-files
const DEV_PATH = path.join(process.cwd(), 'uploads/files');

// פונקציה חכמה לקביעת יעד השמירה
const getDestination = () => {
    if (fs.existsSync('/var/www/zipori_uploads')) {
        if (!fs.existsSync(PROD_PATH)) {
            fs.mkdirSync(PROD_PATH, { recursive: true });
        }
        return PROD_PATH;
    }
    if (!fs.existsSync(DEV_PATH)) {
        fs.mkdirSync(DEV_PATH, { recursive: true });
    }
    return DEV_PATH;
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, getDestination());
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // הסרת רווחים ותווים מיוחדים משם הקובץ
        const ext = path.extname(file.originalname);
        const namePart = path.basename(file.originalname, ext).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        cb(null, `${uniqueSuffix}-${namePart}${ext}`);
    }
});

// ✨ הפילטר המורחב: תמונות, וידאו, מסמכים
const fileFilter = (req, file, cb) => {
    const allowedExtensions = /jpeg|jpg|png|gif|webp|mp4|avi|mov|mkv|pdf|doc|docx|xls|xlsx|txt/;
    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    
    // בדיקה כללית של Mime Type
    const isMedia = file.mimetype.startsWith('image/') || 
                    file.mimetype.startsWith('video/') || 
                    file.mimetype.startsWith('application/') || 
                    file.mimetype.startsWith('text/');

    if (extname && isMedia) {
        return cb(null, true);
    } else {
        cb(new Error('סוג קובץ לא נתמך! מותר: תמונות, וידאו ומסמכים.'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // מגבלה: 50MB
    fileFilter: fileFilter
});

export default upload;