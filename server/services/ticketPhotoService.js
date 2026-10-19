// OPS-02-F08 / OPS-06 — photo of a defect on a maintenance ticket. Images only, resized and re-encoded
// (strips EXIF, including location) under an unguessable name; the ticket keeps who added it and when.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import multer from 'multer';
import MaintenanceTicket from '../models/MaintenanceTicket.js';
import { audit } from './auditService.js';
import { httpError } from './frontDeskService.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'tickets');
const MAX_PHOTOS = 10;

export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
}).single('photo');

export async function addTicketPhoto({ propertyId, ticketId, file, caption, actor, ip }) {
  if (!file?.buffer?.length) throw httpError('יש לצרף תמונה (JPG / PNG / WEBP, עד 12MB)', 422, { fields: { photo: 'תמונה' } });
  const t = await MaintenanceTicket.findOne({ _id: ticketId, property: propertyId }).select('photos status').lean();
  if (!t) throw httpError('התקלה לא נמצאה', 404);
  if ((t.photos || []).length >= MAX_PHOTOS) throw httpError(`עד ${MAX_PHOTOS} תמונות לתקלה`, 409);
  let out;
  try {
    out = await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    throw httpError('הקובץ אינו תמונה תקינה', 422, { fields: { photo: 'תמונה' } });
  }
  await fs.mkdir(DIR, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  await fs.writeFile(path.join(DIR, name), out);
  const photo = { url: `/uploads/tickets/${name}`, caption: String(caption || '').trim().slice(0, 200) || undefined, uploadedBy: actor.id || undefined, uploadedAt: new Date() };
  await MaintenanceTicket.updateOne({ _id: ticketId, property: propertyId }, { $push: { photos: photo } });
  await audit({ property: propertyId, actor: actor.id, actorName: actor.name, action: 'ticket.photo_added', entityType: 'MaintenanceTicket', entityId: ticketId, after: { url: photo.url }, ip }).catch(() => null);
  return { url: photo.url, caption: photo.caption || null, at: photo.uploadedAt };
}
