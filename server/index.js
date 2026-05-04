import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { attachActor } from './middleware/authContext.js';

// Routes
import authRouter         from './routes/auth.js';
import dashboardRouter    from './routes/dashboard.js';
import roomsRouter        from './routes/rooms.js';
import reservationsRouter from './routes/reservations.js';
import housekeepingRouter from './routes/housekeeping.js';
import maintenanceRouter  from './routes/maintenance.js';
import guestsRouter       from './routes/guests.js';
import folioRouter        from './routes/folio.js';
import propertiesRouter   from './routes/properties.js';
import reportsRouter      from './routes/reports.js';
import ratesRouter        from './routes/rates.js';
import usersRouter        from './routes/users.js';
import companiesRouter    from './routes/companies.js';
import inventoryRouter    from './routes/inventory.js';
import auditLogRouter     from './routes/audit-log.js';
import integrationsRouter from './routes/integrations.js';
import automationRouter   from './routes/automation.js';
import paymentsRouter      from './routes/payments.js';
import groupsRouter        from './routes/groups.js';
import notificationsRouter from './routes/notifications.js';
import guestRequestsRouter from './routes/guest-requests.js';
import folioRoutingRouter  from './routes/folio-routing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// ── Security & Performance middleware (פרק כג) ───────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // handled by frontend build
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  skip: (req) => req.path === '/api/health',
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: ['http://localhost:5173','http://localhost:5174', process.env.CLIENT_URL].filter(Boolean), credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(attachActor);

// ── Rate limiting (פרק כד) ────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
  skip: (req) => req.path === '/api/health',
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts, please try again later' },
});
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ── Health (enhanced) ─────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const mongoose = (await import('mongoose')).default;
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    db: dbState[mongoose.connection.readyState] || 'unknown',
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage().rss,
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/dashboard',    dashboardRouter);
app.use('/api/rooms',        roomsRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/housekeeping', housekeepingRouter);
app.use('/api/maintenance',  maintenanceRouter);
app.use('/api/guests',       guestsRouter);
app.use('/api/folio',        folioRouter);
app.use('/api/properties',   propertiesRouter);
app.use('/api/reports',      reportsRouter);
app.use('/api/rates',        ratesRouter);
app.use('/api/users',        usersRouter);
app.use('/api/companies',    companiesRouter);
app.use('/api/inventory',    inventoryRouter);
app.use('/api/audit-log',    auditLogRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/automation',   automationRouter);
app.use('/api/payments',     paymentsRouter);
app.use('/api/groups',       groupsRouter);
app.use('/api/notifications',  notificationsRouter);
app.use('/api/guest-requests', guestRequestsRouter);
app.use('/api/folio-routing',  folioRoutingRouter);

// ── Static (production) ───────────────────────────────────────────────────────
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return notFound(req, res);
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🏨 Hotel4U server → http://localhost:${PORT}`));
  })
  .catch(err => { console.error('DB connection failed:', err); process.exit(1); });
