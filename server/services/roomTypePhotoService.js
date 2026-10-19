// Room-type photos for the public booking site: images only, resized to web size and re-encoded
// (strips EXIF / location), stored under an unguessable name. Order = order on the site; first = cover.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import multer from 'multer';
import mongoose from 'mongoose';
import RoomType from '../models/RoomType.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';
import { SETUP_ROLES } from './setupService.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'rooms');
const MAX = 8;

export const roomPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
}).single('photo');

function guard(actor) {
  if (!SETUP_ROLES.includes(actor?.role)) throw httpError('אין הרשאה לשנות את הקמת המלון', 403);
}
async function loadType(propertyId, typeId) {
  if (!mongoose.isValidObjectId(String(typeId || ''))) throw httpError('מזהה סוג חדר לא תקין', 400);
  const t = await RoomType.findOne({ _id: typeId, property: propertyId });
  if (!t) throw httpError('סוג החדר לא נמצא', 404);
  return t;
}

export async function addRoomTypePhoto({ propertyId, typeId, file, actor, ip }) {
  guard(actor);
  if (!file?.buffer?.length) throw httpError('יש לצרף תמונה (JPG / PNG / WEBP, עד 15MB)', 422, { fields: { photo: 'תמונה' } });
  const t = await loadType(propertyId, typeId);
  if ((t.images || []).length >= MAX) throw httpError(`עד ${MAX} תמונות לסוג חדר`, 409);
  let out;
  try {
    out = await sharp(file.buffer).rotate().resize({ width: 2000, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch {
    throw httpError('הקובץ אינו תמונה תקינה', 422, { fields: { photo: 'תמונה' } });
  }
  await fs.mkdir(DIR, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  await fs.writeFile(path.join(DIR, name), out);
  const url = `/uploads/rooms/${name}`;
  await RoomType.updateOne({ _id: t._id }, { $push: { images: url } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.room_type_photo_added', entityType: 'RoomType', entityId: t._id, after: { url }, ip }).catch(() => null);
  return { images: [...(t.images || []), url] };
}

// Reorder / remove: the new list must be a subset of the current one (no foreign URLs).
export async function setRoomTypePhotos({ propertyId, typeId, images, actor, ip }) {
  guard(actor);
  const t = await loadType(propertyId, typeId);
  const current = t.images || [];
  const next = (Array.isArray(images) ? images : []).filter((u, i, a) => current.includes(u) && a.indexOf(u) === i);
  await RoomType.updateOne({ _id: t._id }, { $set: { images: next } });
  const removed = current.filter((u) => !next.includes(u));
  for (const u of removed) if (u.startsWith('/uploads/rooms/')) await fs.unlink(path.join(DIR, path.basename(u))).catch(() => null);
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'setup.room_type_photos', entityType: 'RoomType', entityId: t._id, after: { count: next.length, removed: removed.length }, ip }).catch(() => null);
  return { images: next };
}
