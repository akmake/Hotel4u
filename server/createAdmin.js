// Create or update a PMS administrator (idempotent — safe to re-run, e.g. after `npm run seed:big`).
//
// Usage (from server/):
//   ADMIN_PASSWORD='...' node createAdmin.js --email you@example.com [--first Yosef --last Dahan]
//                                            [--role property_admin] [--property <propertyId>]
//
// The password is read from ADMIN_PASSWORD so it never lives in source control.
// Without --property the user is attached to the first property in the database.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './models/User.js';
import Property from './models/Property.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const email = arg('email')?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const firstName = arg('first', 'Admin');
const lastName = arg('last', '');
const role = arg('role', 'property_admin');

if (!email || !password) {
  console.error('Usage: ADMIN_PASSWORD=... node createAdmin.js --email <email> [--first <name>] [--last <name>] [--role <role>] [--property <id>]');
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');

  const property = arg('property')
    ? await Property.findById(arg('property'))
    : await Property.findOne().sort({ createdAt: 1 });
  if (!property && role !== 'super_admin') throw new Error('No property found — run a seed or pass --property');

  let user = await User.findOne({ email });
  const created = !user;
  if (!user) user = new User({ email });

  Object.assign(user, {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    role,
    property: property?._id,
    active: true,
    passwordHash: password, // hashed by the User pre-save hook
    failedLoginAttempts: 0,
    lockUntil: undefined,
  });
  await user.save();

  console.log(`${created ? 'Created' : 'Updated'} ${role}: ${email}${property ? ` → ${property.name}` : ''}`);
} catch (err) {
  console.error('Failed to create admin:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
