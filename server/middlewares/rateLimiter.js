import rateLimit from 'express-rate-limit';

const isDev = process.env.NODE_ENV !== 'production';

/* Limiter כללי — מופסק בפיתוח */
export const publicLimiter = isDev
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: 10 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    });

/* Limiter ל-/api/products — מופסק בפיתוח */
export const productsLimiter = isDev
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: 10 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    });

/* Limiter ל-login/register — תמיד פעיל בכל סביבה */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 דקות
  max: 20,                   // מקסימום 20 ניסיונות לכל IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'יותר מדי ניסיונות. נסה שוב בעוד 15 דקות.' },
  skipSuccessfulRequests: true, // לא סופר בקשות שהצליחו
});

/* ברירת-מחדל */
export default publicLimiter;