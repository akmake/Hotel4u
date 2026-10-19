// Public booking site content for the demo property (מלון הגליל): room-type descriptions, sizes,
// views, amenities and guest limits, and the site switched on (payment in full at booking).
// Safe to re-run; touches only the fields below. Usage: node scripts/seedWebsiteContent.mjs [propertyId]
import 'dotenv/config';
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import RoomType from '../models/RoomType.js';

const BASE = ['מיזוג אוויר שקט', 'Wi‑Fi מהיר', 'טלוויזיה חכמה', 'מכונת אספרסו', 'כספת', 'מצעי כותנה מצרית', 'מוצרי טיפוח יוקרתיים', 'חלוקים ונעלי בית'];
const CONTENT = {
  STD: {
    shortDesc: 'חדר שקט ומעוצב בגווני אדמה, למנוחה אמיתית אחרי יום בגליל.',
    fullDesc: 'חדר אינטימי ומוקפד עם מיטה זוגית רחבה, תאורה רכה ופינת ישיבה קטנה. חומרים טבעיים, מצעי כותנה מצרית ומקלחת גשם — כל מה שצריך כדי לנוח באמת.',
    roomSizeSqm: 22, bedType: 'queen', view: 'garden', capacityMax: 3, adultsMax: 2, childrenMax: 1, amenities: [...BASE, 'מקלחת גשם'],
  },
  DLX: {
    shortDesc: 'מרפסת פרטית מול הכנרת, אור בוקר ושקיעות שלא נגמרות.',
    fullDesc: 'חדר מרווח עם מיטת קינג וחלונות גבוהים הפונים לכנרת. מרפסת פרטית עם ריהוט חוץ, פינת עבודה ואמבטיה עם מקלחון נפרד. אפשר להוסיף מיטה לילד.',
    roomSizeSqm: 30, bedType: 'king', view: 'sea', capacityMax: 3, adultsMax: 3, childrenMax: 2, extraBedAllowed: true, amenities: [...BASE, 'מרפסת פרטית', 'נוף לכנרת', 'מיני־בר'],
  },
  FAM: {
    shortDesc: 'שני חללים מחוברים — מקום לכל המשפחה, פרטיות להורים.',
    fullDesc: 'יחידה משפחתית עם חדר שינה להורים ואזור נפרד לילדים, שתי טלוויזיות ושירותים כפולים. קרובה לבריכה ולגן, עם עריסה לפי בקשה.',
    roomSizeSqm: 42, bedType: 'mixed', view: 'garden', capacityMax: 5, adultsMax: 4, childrenMax: 3, cribAllowed: true, amenities: [...BASE, 'שני חללי שינה', 'שתי טלוויזיות', 'עריסה לפי בקשה'],
  },
  STE: {
    shortDesc: 'סוויטה פנורמית עם סלון, ג׳קוזי ומרפסת ענקית מעל המים.',
    fullDesc: 'הסוויטה המרשימה של המלון: חדר שינה עם מיטת קינג, סלון נפרד, ג׳קוזי זוגי ומרפסת פנורמית מעל הכנרת. כוללת קבלת פנים אישית ושדרוג שירות חדרים.',
    roomSizeSqm: 60, bedType: 'king', view: 'sea', capacityMax: 4, adultsMax: 3, childrenMax: 2, extraBedAllowed: true, amenities: [...BASE, 'סלון נפרד', 'ג׳קוזי זוגי', 'מרפסת פנורמית', 'נוף לכנרת', 'קבלת פנים אישית'],
  },
};

await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel4u');
const arg = process.argv[2];
const property = arg ? await Property.findById(arg) : (await Property.findOne({ name: 'מלון הגליל' })) || (await Property.findOne());
if (!property) { console.error('no property'); process.exit(1); }
let n = 0;
for (const [code, c] of Object.entries(CONTENT)) {
  const r = await RoomType.updateOne({ property: property._id, code }, { $set: { ...c, showInEngine: true } });
  n += r.modifiedCount;
}
await Property.updateOne({ _id: property._id }, { $set: { onlineBooking: {
  enabled: true, payment: 'full', depositPct: 30, holdMinutes: 20, ratePlanCodes: [],
  headline: 'שקט מעל הכנרת', intro: 'מלון בוטיק על שפת הכנרת — חדרים מוארים, נוף למים ושירות אישי.',
  updatedByName: 'seed', updatedAt: new Date(),
} } });
console.log(`property ${property.name} (${property._id}): ${n} room types updated, online booking on`);
await mongoose.disconnect();
