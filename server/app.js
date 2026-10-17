import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import mongoose from 'mongoose';
import csurf from 'csurf';
import http from 'http';
import { initSocket } from './socket.js';
import { initWhatsAppListener } from './services/whatsappService.js';
import requireAuth from './middlewares/requireAuth.js';
import { errorHandler } from './middleware/errorHandler.js';

// --- ייבוא נתיבים ---
import adminAutoReplyRoutes from './routes/adminAutoReply.js';
import authRoutes from './routes/auth.js';
import priceListRoutes from './routes/priceListRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import adminOrderRoutes from './routes/adminOrders.js';
import adminUserRoutes from './routes/adminUsers.js';
import adminProductRoutes from './routes/adminProducts.js';
import adminHotelRoutes from './routes/adminHotels.js';
import webhookRoutes from './routes/webhookRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import adminDashboardRoutes from './routes/adminDashboard.js';
import adminRoomTypeRoutes from './routes/adminRoomTypes.js';
import announcementRoutes from './routes/announcementRoutes.js';
import adminExtraTypesRoutes from './routes/adminExtraTypes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import referrerRoutes from './routes/referrerRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import pushRoutes from './routes/pushRoutes.js';
import customerCardRoutes from './routes/customerCardRoutes.js';
import adminAuditRoutes from './routes/adminAudit.js';
import adminCommissionRoutes from './routes/adminCommissions.js';
import bookingRoutes from './routes/bookingRoutes.js';
import userRoutes from './routes/userRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import adminTriggerRoutes from './routes/adminTriggers.js';
import whatsappChatRoutes from './routes/whatsappChatRoutes.js';
import { initScheduler }    from './services/scheduler.js';
import { initPmsScheduler } from './services/pmsScheduler.js';
import { getCalendarData } from './controllers/admin/calendarController.js';

// --- ייבוא נתיבי PMS (hotel4u) ---
import { attachActor, requireActor } from './middleware/authContext.js';
import { authLimiter } from './middlewares/rateLimiter.js';
import pmsDashboardRouter    from './routes/dashboard.js';
import pmsPropertiesRouter   from './routes/properties.js';
import pmsRoomsRouter        from './routes/rooms.js';
import pmsReservationsRouter from './routes/reservations.js';
import pmsHousekeepingRouter from './routes/housekeeping.js';
import pmsMaintenanceRouter  from './routes/maintenance.js';
import pmsGuestsRouter       from './routes/guests.js';
import pmsFolioRouter        from './routes/folio.js';
import pmsReportsRouter      from './routes/reports.js';
import pmsRatesRouter        from './routes/rates.js';
import pmsCompaniesRouter    from './routes/companies.js';
import pmsInventoryRouter    from './routes/inventory.js';
import pmsAuditLogRouter     from './routes/audit-log.js';
import pmsCrmRouter          from './routes/crm-core.js';
import pmsNotificationsRouter from './routes/notifications.js';
import pmsUsersRouter        from './routes/users.js';
import pmsAutomationRouter   from './routes/automation.js';
import pmsPaymentsRouter     from './routes/payments.js';
import pmsGroupsRouter          from './routes/groups.js';
import pmsInvoiceRouter          from './routes/invoice.js';
import pmsGuestRequestsRouter    from './routes/guest-requests.js';
import pmsFolioRoutingRouter      from './routes/folio-routing.js';
import pmsFrontDeskRouter         from './routes/frontdesk.js';
import pmsOperationsRouter        from './routes/operations.js';
import pmsFinanceRouter           from './routes/finance.js';
import pmsAccountingRouter        from './routes/accounting.js';
import pmsBookingRouter           from './routes/booking.js';
import pmsStayRouter              from './routes/stay.js';
import pmsIdentityRouter          from './routes/identity.js';
import pmsPlatformRouter          from './routes/platform.js';
// --- חיבור למסד הנתונים ---
try {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✔ Mongo connected');
  initScheduler();
  initPmsScheduler();
} catch (err) {
  console.error('Mongo connection error:', err);
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
initSocket(httpServer);

// --- אבטחה ו-Middlewares בסיסיים ---
app.use(helmet({ crossOriginResourcePolicy: false }));

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'https://localhost:5173',
  'https://www.ziporiteem.com',
  'https://ziporiteem.com'
];

const filteredOrigins = allowedOrigins.filter(Boolean);

app.use(cors({
  origin: filteredOrigins,
  credentials: true
}));
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());

// הגדרת תיקיית העלאות כסטטית
const uploadsPath = path.join(__dirname, 'uploads');
// מגישים את התיקייה גם דרך /uploads (רגיל) וגם דרך /api/uploads (למקרה הצורך)
app.use(['/uploads', '/api/uploads'], express.static(uploadsPath));

// --- הגדרת CSRF ---
const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    // משתמשים ב-ENV כדי לדעת אם אנחנו בפרודקשן (HTTPS) או לוקאלית
    secure: process.env.NODE_ENV === 'production', 
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax'
  },
});

// =========================================================================
// 🚀 ה-Router המרכזי: מכיל את כל הלוגיקה
// =========================================================================
const apiRouter = express.Router();

// 1. נתיבים ציבוריים (ללא CSRF)
apiRouter.use('/auth/login', authLimiter);
apiRouter.use('/auth/password', authLimiter);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/webhooks', webhookRoutes);

// 2. נקודת קצה לקבלת הטוקן (CSRF Token)
apiRouter.get('/csrf-token', csrfProtection, (req, res) => {
  const token = req.csrfToken();
  res.cookie('XSRF-TOKEN', token, {
    httpOnly: false,
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    secure: process.env.NODE_ENV === 'production'
  });
  res.json({ csrfToken: token });
});

// 3. הגנה על שאר הנתיבים (Middleware)
apiRouter.use((req, res, next) => {
  // רשימת החרגות (אם יש נתיבים נוספים שצריכים להיות פתוחים)
  const exceptions = ['/auth', '/webhooks', '/csrf-token'];
  
  // בדיקה פשוטה אם הנתיב מתחיל באחת ההחרגות
  if (exceptions.some(path => req.path.startsWith(path))) {
    return next();
  }
  
  csrfProtection(req, res, next);
});

// 4. כל שאר הנתיבים המוגנים
apiRouter.use('/users', userRoutes);
apiRouter.use('/pricelists', priceListRoutes);
apiRouter.use('/orders', orderRoutes);
apiRouter.use('/admin/orders', adminOrderRoutes);
apiRouter.use('/admin/users', adminUserRoutes);
apiRouter.use('/admin/products', adminProductRoutes);
apiRouter.use('/admin/hotels', adminHotelRoutes);
apiRouter.use('/leads', leadRoutes);
apiRouter.use('/admin/dashboard', adminDashboardRoutes);
apiRouter.use('/admin/room-types', adminRoomTypeRoutes);
apiRouter.use('/admin/triggers', adminTriggerRoutes);
apiRouter.use('/announcements', announcementRoutes);
apiRouter.use('/upload', uploadRoutes);
apiRouter.use('/admin/extras', adminExtraTypesRoutes);
apiRouter.use('/rooms', roomRoutes);
apiRouter.use('/referrers', referrerRoutes);
apiRouter.use('/push', pushRoutes);
apiRouter.use('/admin/audit', adminAuditRoutes);
apiRouter.use('/customer-card', customerCardRoutes);
apiRouter.use('/admin/commissions', adminCommissionRoutes);
apiRouter.use('/admin/calendar', requireAuth, getCalendarData); 
apiRouter.use('/bookings', bookingRoutes);
apiRouter.use('/chat', chatRoutes);
apiRouter.use('/whatsapp', whatsappChatRoutes);
apiRouter.use('/admin/auto-replies', adminAutoReplyRoutes);

// =========================================================================
// 🏨 PMS hotel4u — ראוטר נפרד תחת /pms (עוקף CSRF)
// =========================================================================
// Tax Authority OAuth redirect (FIN-10-A03): public — the one-time state proves who started it.
app.get('/api/ita/callback', async (req, res) => {
  const client = (process.env.CLIENT_URL || '').replace(/\/+$/, '');
  try {
    const { completeConnect } = await import('./services/taxAuthorityService.js');
    const out = await completeConnect({ state: req.query.state, code: req.query.code, error: req.query.error });
    res.redirect(`${client}/pms/admin/fiscal?ita=${out.ok ? 'connected' : 'failed'}`);
  } catch (err) {
    res.redirect(`${client}/pms/admin/fiscal?ita=failed&reason=${encodeURIComponent(err.message || 'error')}`);
  }
});

const pmsRouter = express.Router();
pmsRouter.use(attachActor);
pmsRouter.use(requireActor);
pmsRouter.use('/dashboard',     pmsDashboardRouter);
pmsRouter.use('/properties',    pmsPropertiesRouter);
pmsRouter.use('/rooms',         pmsRoomsRouter);
pmsRouter.use('/reservations',  pmsReservationsRouter);
pmsRouter.use('/housekeeping',  pmsHousekeepingRouter);
pmsRouter.use('/maintenance',   pmsMaintenanceRouter);
pmsRouter.use('/guests',        pmsGuestsRouter);
pmsRouter.use('/folio',         pmsFolioRouter);
pmsRouter.use('/reports',       pmsReportsRouter);
pmsRouter.use('/rates',         pmsRatesRouter);
pmsRouter.use('/companies',     pmsCompaniesRouter);
pmsRouter.use('/inventory',     pmsInventoryRouter);
pmsRouter.use('/audit-log',     pmsAuditLogRouter);
pmsRouter.use('/crm',           pmsCrmRouter);
pmsRouter.use('/notifications', pmsNotificationsRouter);
pmsRouter.use('/users',         pmsUsersRouter);
pmsRouter.use('/automation',    pmsAutomationRouter);
pmsRouter.use('/payments',      pmsPaymentsRouter);
pmsRouter.use('/groups',         pmsGroupsRouter);
pmsRouter.use('/invoices',       pmsInvoiceRouter);
pmsRouter.use('/guest-requests', pmsGuestRequestsRouter);
pmsRouter.use('/folio-routing',  pmsFolioRoutingRouter);
pmsRouter.use('/frontdesk',      pmsFrontDeskRouter);
pmsRouter.use('/ops',            pmsOperationsRouter);
pmsRouter.use('/finance',        pmsFinanceRouter);
pmsRouter.use('/accounting',     pmsAccountingRouter);
pmsRouter.use('/booking',        pmsBookingRouter);
pmsRouter.use('/stay',           pmsStayRouter);
pmsRouter.use('/identity',       pmsIdentityRouter);
pmsRouter.use('/platform',       pmsPlatformRouter);

// =========================================================================
// ✨ הפתרון הכפול: חיבור ה-Router לשני הנתיבים
// =========================================================================

// 1. PMS routes (לפני apiRouter — עוקפים CSRF)
app.use('/api/pms', pmsRouter);

// 2. עבור Localhost (כשהלקוח שולח /api/...)
app.use('/api', apiRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'API route not found.' });
});

// 3. עבור Production/Nginx (כשה-Nginx חותך את ה-/api)
app.use('/', apiRouter);

// =========================================================================

// --- הגשת קבצי הקליינט (React) ---
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));

app.use('*', (req, res) => {
  // אם זו בקשת API שלא נמצאה באף אחד מה-Routers למעלה
  if (req.path.startsWith('/api') || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(404).json({ success: false, error: 'API route not found.' });
  }

  const indexHtmlPath = path.resolve(clientBuildPath, 'index.html');
  res.sendFile(indexHtmlPath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).send(`Error serving index.html: ${err.message}.`);
    }
  });
});

// --- הפעלת שירותים נוספים ---
app.use(errorHandler);
if (process.env.DISABLE_WHATSAPP === '1') {
  console.log('WhatsApp listener disabled (DISABLE_WHATSAPP=1)');
} else {
  initWhatsAppListener();
}

// --- הרמת השרת ---
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`✔ Server & Socket running on port ${PORT}`));

export default app;


