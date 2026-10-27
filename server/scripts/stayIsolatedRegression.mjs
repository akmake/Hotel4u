// Run the existing stay integration suite against a new local replica and the real routers/auth.
// No app.js, schedulers, .env or existing database is used.
import mongoose from 'mongoose';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAccountingTestReplica } from './accountingTestRuntime.mjs';
import { attachActor, requireActor } from '../middleware/authContext.js';
import stayRouter from '../routes/stay.js';
import reservationsRouter from '../routes/reservations.js';
import bookingRouter from '../routes/booking.js';
import frontdeskRouter from '../routes/frontdesk.js';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';

const suite = process.argv[2] || 'stay';
if (!['stay', 'booking', 'frontdesk'].includes(suite)) throw new Error('Unknown isolated suite');

let replica, server;
let output = '', exitCode = 1;
const startedAt = new Date().toISOString();
try {
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  replica = await createAccountingTestReplica();
  const uri = replica.getUri(`stay_regression_${Date.now()}`);
  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  if (suite === 'frontdesk') {
    const property = await Property.create({ name: 'Synthetic frontdesk QA', timezone: 'Asia/Jerusalem', checkInPolicy: { requireGuarantee: true, requireRegistration: true } });
    await RoomType.create({ property: property._id, code: 'STD', name: 'Synthetic standard', baseRate: 400, capacityMax: 6, adultsMax: 6 });
  }
  const app = express(); app.use(express.json()); app.use(attachActor, requireActor);
  app.use('/api/pms/stay', stayRouter); app.use('/api/pms/reservations', reservationsRouter);
  app.use('/api/pms/booking', bookingRouter); app.use('/api/pms/frontdesk', frontdeskRouter);
  server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const child = spawn(process.execPath, [fileURLToPath(new URL(`./${suite}Integration.mjs`, import.meta.url)), `--baseUrl=http://127.0.0.1:${server.address().port}/api/pms`], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PMS_ISOLATED_QA: '1', MONGO_URI: uri, JWT_SECRET: process.env.JWT_SECRET, DISABLE_WHATSAPP: '1' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
  exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code ?? 1)); });
} catch (err) {
  output += `\nBLOCKED ${err.message}\n`; console.error(err.message);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (replica) await replica.stop();
  const folder = fileURLToPath(new URL('../../docs/product-readiness/evidence/', import.meta.url));
  await mkdir(folder, { recursive: true });
  const report = JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), suite, exitCode, passed: (output.match(/^PASS /gm) || []).length, failed: (output.match(/^FAIL /gm) || []).length, mode: 'isolated local replica, real routers and attachActor, no .env or schedulers' }, null, 2) + '\n';
  await writeFile(`${folder}/${suite}-regression-latest.txt`, output, 'utf8');
  await writeFile(`${folder}/${suite}-regression-latest.json`, report);
  const stamp = startedAt.replace(/[:.]/g, '-');
  await writeFile(`${folder}/${suite}-regression-${stamp}.json`, report);
  await writeFile(`${folder}/${suite}-regression-${stamp}.txt`, output, 'utf8');
  process.exitCode = exitCode;
}
