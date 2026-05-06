# Stage 3 Preflight Findings (Reservations)

תאריך: 6 במאי 2026  
היקף: בדיקות מקדימות טכניות לפני הטמעה רחבה במודול הזמנות.  
סטטוס: ממצאים פתוחים, טרם תיקון בקוד.

## ממצאים קריטיים

### 1) שגיאת Enum בפוליו בעת הוספת שירות

1. `FolioLine.type` מוגדר enum ללא הערך `service`.
2. endpoint `POST /reservations/:id/add-service` דוחף `type: 'service'`.
3. תוצאה: ולידציה של Mongoose נכשלת בעת `folio.save()`.

ראיות:
1. `server/models/Folio.js:4` — `LINE_TYPE` ללא `service`.
2. `server/routes/reservations.js:1538` — שימוש ב-`type: 'service'`.
3. אימות ריצה: `Folio validation failed: lines.0.type: 'service' is not a valid enum value for path 'type'`.

השפעה:
1. כפתור/פעולת הוספת שירות עלולה להיכשל בפרודקשן.
2. תיעוד billing יוצא לא עקבי מול תכנון.

תיקון מוצע:
1. להוסיף `service` ל-`LINE_TYPE` או למפות שירות ל-`charge` עם `department='service'`.
2. ליישר OpenAPI + בדיקות אוטומטיות לערך הסופי.

---

### 2) חישוב `totalAmount` שגוי בעדכון הזמנה מרובת חדרים

1. ב-`modifyReservation()` החישוב לאחר שינוי תאריכים/סוג חדר הוא `rate * nights` בלבד.
2. גם בעדכון מחיר בלבד החישוב הוא `rate * nights` בלבד.
3. במודל ההזמנה הכללי החישוב המקורי כולל `roomsCount`.

ראיות:
1. `server/services/reservationService.js:518` — `res.totalAmount = rate * nights;`
2. `server/services/reservationService.js:529` — `res.totalAmount = Number(ratePerNight) * res.nights;`
3. `server/services/reservationService.js:100` — ביצירה: `ratePerNight * nights * normalizedRoomsCount`.

השפעה:
1. undercharge/overcharge להזמנות multi-room.
2. טעות בדוחות פיננסיים ובאיזון פוליו.

תיקון מוצע:
1. להחליף ל-`rate * nights * roomsCount` בכל המסלולים הרלוונטיים.
2. להוסיף בדיקות יחידה להזמנה עם `roomsCount > 1`.

---

### 3) בדיקת זמינות לא מלאה בעדכון הזמנה (roomsCount לא נבדק)

1. ב-`modifyReservation()` קריאת `checkAvailability()` לא מעבירה `requiredRooms`.
2. ברירת המחדל בשירות זמינות היא `1`.

ראיות:
1. `server/services/reservationService.js:482-488` — קריאה ללא `requiredRooms`.
2. `server/services/availabilityService.js` — default `requiredRooms = 1`.

השפעה:
1. עדכון הזמנה מרובת חדרים יכול לעבור כאשר בפועל אין מספיק מלאי לכל החדרים.
2. סיכון ל-overbooking בפועל.

תיקון מוצע:
1. להעביר `requiredRooms: res.roomsCount || 1` בקריאה זו.
2. להוסיף בדיקת אינטגרציה: modify multi-room עם מלאי חלקי.

## ממצאים גבוהים

### 4) חיפוש הזמנות לא עקבי עם Pagination/Total

1. `GET /reservations` מחשב `total` לפני סינון צד-שרת מלא לפי שם אורח.
2. סינון נוסף לפי `q` נעשה אחרי `limit` בצד אפליקציה.

ראיות:
1. `server/routes/reservations.js:97` — `countDocuments(filter)` לפני סינון בזיכרון.
2. `server/routes/reservations.js:106-107` — `skip/limit` לפני סינון נוסף.
3. `server/routes/reservations.js:110-119` — סינון בזיכרון אחרי שליפה.

השפעה:
1. `total` לא משקף את התוצאות בפועל.
2. תוצאות חיפוש יכולות להיעלם בעמודים אחרים (false negatives).

תיקון מוצע:
1. להעביר את כל תנאי החיפוש ל-query DB (כולל guest name דרך denormalization או aggregation).
2. לשמור consistency: filter -> count -> paginate.

---

### 5) לוגיקת תאריכים מבוססת UTC ולא timezone של נכס

1. יש שימוש חוזר ב-`new Date().toISOString().split('T')[0]`.
2. חישובי "היום" אמורים להיות לפי property timezone.

ראיות:
1. `server/services/reservationService.js:255`
2. `server/services/reservationService.js:351`
3. `server/routes/reservations.js:756`
4. `server/routes/reservations.js:800`
5. `server/routes/reservations.js:1117`
6. `server/routes/reservations.js:1545`

השפעה:
1. חריגות סביב חצות/מעברי יום בין UTC לזמן מקומי.
2. שגיאות בתהליכי check-in/out ותאריכי חיוב.

תיקון מוצע:
1. להכניס utility אחיד של `todayByPropertyTimezone(propertyId)`.
2. להחיל על כל guards ויצירת serviceDate/segment fromDate.

## בדיקות תקינות שעברו

1. התאמת OpenAPI מול routes:
1. `ROUTES_CODE = 35`
2. `ROUTES_SPEC = 35`
3. `MISSING_IN_SPEC = 0`
4. `EXTRA_IN_SPEC = 0`

2. תקינות YAML:
1. הקובץ נטען בהצלחה עם `python yaml.safe_load`.
2. נמצאו `195` `$ref`, מתוכן `0` חסרות.

## סדר תיקון מומלץ לפני הטמעה רחבה

1. Enum `service` בפוליו.
2. נוסחאות `totalAmount` + `requiredRooms` ב-modify.
3. חיפוש/pagination עקבי ב-`GET /reservations`.
4. timezone utility אחיד לכל מודול הזמנות.

