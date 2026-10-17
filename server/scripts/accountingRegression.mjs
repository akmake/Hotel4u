// Runs the existing finance suites against a disposable Replica Set and local ITA mock only.
// Never imports app.js, starts application schedulers or loads the application's .env.
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import express from 'express';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import { attachActor, requireActor } from '../middleware/authContext.js';
import { errorHandler } from '../middleware/errorHandler.js';
import finance from '../routes/finance.js';
import invoices from '../routes/invoice.js';
import frontdesk from '../routes/frontdesk.js';
import reports from '../routes/reports.js';
import stay from '../routes/stay.js';
import folio from '../routes/folio.js';
import reservations from '../routes/reservations.js';
import folioRouting from '../routes/folio-routing.js';
import payments from '../routes/payments.js';

const repl = await createAccountingTestReplica();
let server;
try {
  const uri = repl.getUri('accounting_regression_disposable');
  const qaEnv = {
    MONGO_URI: uri, JWT_SECRET: 'isolated-accounting-regression-secret', EMAIL_USER: '', EMAIL_PASS: '',
    ITA_CLIENT_ID: 'test', ITA_CLIENT_SECRET: 'secret', ITA_AUTH_BASE: 'http://127.0.0.1:4899', ITA_API_BASE: 'http://127.0.0.1:4899',
    TAX_TOKEN_KEY: '0123456789abcdef'.repeat(4), CLIENT_URL: '', NODE_ENV: 'test',
  };
  Object.assign(process.env, qaEnv);
  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const app = express(); app.use(express.json());
  app.get('/api/ita/callback', async (req, res) => {
    try { const { completeConnect } = await import('../services/taxAuthorityService.js'); const result = await completeConnect(req.query); res.redirect(`/pms/admin/fiscal?ita=${result.ok ? 'connected' : 'failed'}`); }
    catch { res.redirect('/pms/admin/fiscal?ita=failed'); }
  });
  app.use('/api/pms', attachActor, requireActor);
  app.use('/api/pms/finance', finance); app.use('/api/pms/invoices', invoices); app.use('/api/pms/frontdesk', frontdesk);
  app.use('/api/pms/reports', reports); app.use('/api/pms/stay', stay);
  app.use('/api/pms/folio', folio); app.use('/api/pms/reservations', reservations);
  app.use('/api/pms/folio-routing', folioRouting);
  app.use('/api/pms/payments', payments);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  qaEnv.ITA_REDIRECT_URI = `${root}/api/ita/callback`; process.env.ITA_REDIRECT_URI = qaEnv.ITA_REDIRECT_URI;
  let failures = 0;
  for (const script of ['financeIntegration.mjs', 'documentsIntegration.mjs', 'booksIntegration.mjs', 'fiscalIntegration.mjs']) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`scripts/${script}`, `--baseUrl=${root}/api/pms`], { env: { ...process.env, ...qaEnv }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', reject); child.on('close', (code) => resolve({ code, output }));
    });
    const lines = result.output.split(/\r?\n/);
    console.log(`${script}: ${lines.find((l) => l.startsWith('Summary:')) || `exit=${result.code}`}`);
    if (result.code !== 0) { failures += 1; console.log(lines.filter((l) => l.startsWith('FAIL') || /Error:|ValidationError/.test(l)).join('\n')); }
  }
  if (failures) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect(); await repl.stop();
}
