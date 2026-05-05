import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { createAndSendTokens } from '../utils/tokenHandler.js';
import { logAction } from '../utils/auditLogger.js';

const PMS_JWT_SECRET = process.env.JWT_SECRET || 'hotel4u_dev_secret_change_in_prod';

export const registerUser = async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ message: 'שם, אימייל וסיסמה הם שדות חובה' });

  const exists = await User.findOne({ email });
  if (exists)
    return res.status(400).json({ message: 'משתמש עם אימייל זה כבר קיים' });

  const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\da-zA-Z]).{8,}$/;
  if (!strong.test(password))
    return res.status(400).json({ message: 'הסיסמה חלשה מדי. נדרשים 8 תווים, אות גדולה, קטנה, מספר ותו מיוחד.' });

  const hash = await bcrypt.hash(password, 12);

  const user = await User.create({
    name,
    email,
    passwordHash: hash,
    role: 'sales',
  });

  // ✨ שליחת ההרשאות החדשות לקליינט
  const userPayload = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      canManagePriceLists: user.canManagePriceLists,
      canViewCommissions: user.canViewCommissions
  };

  createAndSendTokens(user, res);
  
  // ✨ תיעוד הרשמה (אופציונלי - נרשם כמשתמש המחובר, שזה המשתמש החדש עצמו כרגע)
  req.user = user;
  await logAction(req, 'CREATE', 'User', user._id, `משתמש חדש נרשם: ${user.name}`);

  return res.status(201).json({ message: "ההרשמה הושלמה בהצלחה", user: userPayload });
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: 'חסר אימייל או סיסמה' });

  const user = await User.findOne({ email });
  if (!user) {
    // עיכוב מלאכותי למניעת timing attack
    await bcrypt.hash(password, 12);
    return res.status(401).json({ message: 'אימייל או סיסמה שגויים' });
  }

  if (user.isLocked)
    return res.status(423).json({ message: 'החשבון נעול זמנית' });

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await user.incrementLoginAttempts();
    return res.status(401).json({ message: 'אימייל או סיסמה שגויים' });
  }

  await user.resetLoginAttempts();

  const propertyId = user.property ? String(user.property) : null;
  const userPayload = {
    _id: user._id,
    name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    propertyId,
    canManagePriceLists: user.canManagePriceLists,
    canViewCommissions: user.canViewCommissions,
  };

  // Bearer token for PMS pages (stored in localStorage by client)
  const bearerToken = jwt.sign(
    { id: String(user._id), firstName: user.firstName, lastName: user.lastName,
      email: user.email, role: user.role, propertyId },
    PMS_JWT_SECRET,
    { expiresIn: '8h' }
  );

  createAndSendTokens(user, res); // sets HttpOnly cookies for Ziporiclass routes

  req.user = user;
  await logAction(req, 'LOGIN', 'System', null, 'התחברות למערכת');

  return res.status(200).json({
    success: true,
    message: 'התחברת בהצלחה',
    data: { token: bearerToken, user: userPayload },
  });
};

export const logout = async (req, res) => {
    // ✨ תיעוד יציאה (אם המשתמש היה מחובר)
    // ה-middleware של requireAuth אמור לרוץ לפני ה-logout ב-routes בדרך כלל, 
    // אבל גם אם לא, ננסה לתעד אם יש קוקי. כאן נניח שיש.
    if (req.user) {
        await logAction(req, 'LOGOUT', 'System', null, 'יציאה מהמערכת');
    }

    res.clearCookie('jwt');
    res.clearCookie('refreshToken');
    return res.sendStatus(204);
};

export const refresh = async (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) {
    return res.status(401).json({ message: 'No refresh token provided.' });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.tokenVersion !== decoded.v) {
      return res.status(403).json({ message: 'Forbidden. Please log in again.' });
    }
    createAndSendTokens(user, res);

    const userPayload = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        canManagePriceLists: user.canManagePriceLists,
        canViewCommissions: user.canViewCommissions
    };
    return res.status(200).json({ message: "Tokens refreshed successfully", user: userPayload });
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired refresh token.' });
  }
};