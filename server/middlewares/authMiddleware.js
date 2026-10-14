import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * מוודא שהמשתמש מחובר (יש טוקן תקין).
 * מוסיף את אובייקט המשתמש ל-req.user.
 */
export const requireAuth = async (req, res, next) => {
  const token = req.cookies.jwt;
  if (!token) {
    return res.status(401).json({ message: 'לא מחובר' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const user = await User.findById(decoded.id).select('-passwordHash -totpSecret');
    
    if (!user) {
      return res.status(401).json({ message: 'משתמש לא נמצא' });
    }
    // A deactivated account or an expired access window ends the cookie session too (ADM-06).
    if (user.active === false || (user.accessUntil && user.accessUntil < new Date())) {
      return res.status(401).json({ message: 'המשתמש הושבת או שתוקף הגישה הסתיים' });
    }

    // בדיקת שעת ניתוק כפוי (לא חלה על מנהלים)
    if (user.forcedLogoutTime && user.role !== 'admin') {
        const now = new Date();
        const [logoutHour, logoutMinute] = user.forcedLogoutTime.split(':').map(Number);
        const logoutDate = new Date();
        logoutDate.setHours(logoutHour, logoutMinute, 0, 0);

        if (now > logoutDate) {
            return res.status(401).json({ message: 'שעות הפעילות שלך הסתיימו להיום.' });
        }
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'טוקן לא חוקי / פג תוקף' });
  }
};

// --- בדיקות הרשאה ספציפיות ---

// רק מנהל
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'גישה נדחתה: הרשאת מנהל נדרשת' });
  }
  next();
};

// מנהל + אחראי משמרת (למשל: לשיבוץ חדרים או העלאת קבצים)
export const requireShiftManager = (req, res, next) => {
  const allowed = ['admin', 'shift_manager'];
  if (!allowed.includes(req.user?.role)) {
    return res.status(403).json({ message: 'גישה נדחתה: מורשה לאחראי משמרת ומעלה' });
  }
  next();
};

// מנהל + תחזוקה (למשל: עדכון סטטוס תקלה)
export const requireMaintenance = (req, res, next) => {
  const allowed = ['admin', 'maintenance', 'shift_manager']; // גם אחראי משמרת יכול לדווח/לתקן
  if (!allowed.includes(req.user?.role)) {
    return res.status(403).json({ message: 'גישה נדחתה: מורשה לאנשי תחזוקה' });
  }
  next();
};