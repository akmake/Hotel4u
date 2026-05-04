import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: ['http://localhost:5173','http://localhost:5174', process.env.CLIENT_URL].filter(Boolean), credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status:'ok', ts: new Date().toISOString() }));

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
