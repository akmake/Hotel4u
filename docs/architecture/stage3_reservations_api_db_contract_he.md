# Stage 3: API Contract + DB Schema (Reservations)

תאריך: 6 במאי 2026  
סביבה: `server/routes/reservations.js` תחת בסיס נתיב ` /api/pms/reservations `  
מטרה: לייצר חוזה טכני מדויק לביצוע שלב הפיתוח הבא, כולל API, כללי הרשאות, ולידציות, side-effects, ומודל נתונים.

## 1) Scope וגבולות

1. החוזה מתייחס למודול `Reservations` בלבד.
2. נכללו גם ישויות תלויות קריטיות: `ReservationRoom`, `StaySegment`, `Folio`, `Payment`, `InventoryDate`, `InventoryLock`, `Room`, `GuestProfile`.
3. החוזה משקף את המימוש הנוכחי בקוד, ומסמן פערים מול יעד parity שנבנה במחקר.

## 2) אבטחה והרשאות

## 2.1 אימות

1. כל הנתיבים תחת `/api/pms/*` דורשים `Bearer JWT`.
2. actor נטען מתוך `Authorization: Bearer <token>` על ידי `attachActor`.
3. אם אין actor תקף: `401` עם `{ success: false, error: 'Authentication required' }`.

## 2.2 הרשאות תפקידים

1. `COMMERCIAL_ROLES`: `super_admin`, `property_admin`, `general_manager`, `front_desk_manager`, `receptionist`, `revenue_manager`, `sales_manager`.
2. `HIGH_PRIV_CHECKIN_ROLES`: `super_admin`, `property_admin`, `general_manager`, `front_desk_manager`.
3. `HIGH_PRIV_CHECKOUT_ROLES`: `super_admin`, `property_admin`, `general_manager`, `front_desk_manager`, `finance_manager`, `cashier`.
4. `OVERRIDE_ROLES`: `super_admin`, `property_admin`, `general_manager`, `front_desk_manager`.

## 2.3 Property Scope

1. `assertPropertyScope` נאכף ברוב ה-endpoints.
2. אם `propertyId` לא תואם ל-actor: `403 Property scope violation`.
3. `super_admin`/`chain_admin` יכולים חריגות scope בהתאם לכללי middleware.

## 3) פורמט תגובות

## 3.1 הצלחה

1. Envelope סטנדרטי:
`{ success: true, data: ... }`
2. בחלק מהמסכים קיימים גם:
`{ success: true, data, total, page, limit }`

## 3.2 שגיאה

1. Envelope נוכחי:
`{ success: false, error: '<message>' }`
2. קודי HTTP בשימוש עיקרי:
`400`, `401`, `403`, `404`, `409`, `500`.

## 3.3 המלצה לשלב הבא

1. לאחד לשגיאות `application/problem+json` לפי RFC 9457.
2. לשמר תאימות לאחור ע"י `success/error` בטווח מעבר.

## 4) קטלוג Endpoint מלא

| Method | Path | Role Gate | שימוש |
|---|---|---|---|
| GET | `/availability/check` | auth + scope | בדיקת זמינות לפי תאריכים/roomType |
| GET | `/` | auth + scope | רשימת הזמנות עם פילטרים |
| POST | `/` | COMMERCIAL | יצירת הזמנה |
| POST | `/quote` | COMMERCIAL | הצעת מחיר |
| POST | `/quote/save` | COMMERCIAL | שמירת Quote/Hold |
| POST | `/merge` | COMMERCIAL | מיזוג הזמנות |
| POST | `/:id/split` | COMMERCIAL | פיצול הזמנה |
| GET | `/:id` | auth + scope | שליפת הזמנה ו-reservation rooms |
| POST | `/:id/confirm` | COMMERCIAL | אישור הזמנה מ-draft/quote/hold |
| POST | `/:id/send-confirmation` | COMMERCIAL | סימון/שליחת אישור |
| PATCH | `/:id` | COMMERCIAL | עדכון הזמנה |
| POST | `/:id/check-in` | COMMERCIAL | צ'ק-אין |
| POST | `/:id/check-out` | COMMERCIAL | צ'ק-אאוט |
| POST | `/:id/cancel` | COMMERCIAL | ביטול הזמנה |
| POST | `/:id/no-show` | COMMERCIAL | סימון No-show |
| POST | `/:id/cancellation-fee` | HIGH_PRIV_CHECKOUT | הוספת עמלת ביטול לפוליו |
| POST | `/:id/no-show-fee` | HIGH_PRIV_CHECKOUT | הוספת עמלת No-show |
| PATCH | `/:id/assign-room` | COMMERCIAL | שיוך חדר להזמנה/room line |
| POST | `/:id/partial-check-in` | COMMERCIAL | צ'ק-אין חלקי לחדרים מסוימים |
| POST | `/:id/partial-check-out` | COMMERCIAL | צ'ק-אאוט חלקי |
| POST | `/:id/extend` | COMMERCIAL | הארכת שהייה |
| POST | `/:id/early-departure` | COMMERCIAL | קיצור שהייה |
| POST | `/:id/upgrade` | OVERRIDE | upgrade חדר/סוג/תעריף |
| POST | `/transfer-charges` | HIGH_PRIV_CHECKOUT | העברת חיובים בין פוליוים |
| GET | `/:id/rooms` | auth + scope | רשימת חדרים תחת הזמנה |
| POST | `/:id/rooms` | COMMERCIAL | הוספת חדר להזמנה |
| PATCH | `/rooms/:reservationRoomId` | COMMERCIAL | עדכון ReservationRoom |
| DELETE | `/rooms/:reservationRoomId` | COMMERCIAL | מחיקת ReservationRoom |
| GET | `/rooms/:reservationRoomId/segments` | auth + scope | שליפת מקטעי StaySegment |
| POST | `/rooms/:reservationRoomId/segments` | COMMERCIAL | הוספת מקטע שהייה |
| POST | `/:id/duplicate` | COMMERCIAL | שכפול הזמנה |
| POST | `/:id/send-welcome` | COMMERCIAL | שליחת welcome |
| POST | `/:id/add-service` | COMMERCIAL | הוספת חיוב שירות לפוליו |
| POST | `/:id/link-group` | COMMERCIAL | קישור הזמנה לקבוצה |
| POST | `/:id/express-checkout-link` | COMMERCIAL | יצירת לינק Express Checkout |

## 5) חוזים מפורטים לפי אזור פונקציונלי

## 5.1 Availability & Search

### GET `/availability/check`

1. Query חובה: `propertyId`, `roomTypeId`, `arrivalDate`, `departureDate`.
2. Query אופציונלי: `requiredRooms` (ברירת מחדל `1`).
3. Response data צפוי:
1. `available: boolean`
2. `availableRooms: Room[]`
3. `reason: string | null`

### GET `/`

1. Query נתמך:
`propertyId`, `status`, `arrivalDate`, `departureDate`, `q`, `search`, `source`, `paymentStatus`, `company`, `groupCode`, `dateFrom`, `dateTo`, `page`, `limit`.
2. פילטרים:
1. `status` תומך CSV values.
2. חיפוש טקסט על `confirmationNumber` (DB) + פילטר בזיכרון על שם אורח/IDs חיצוניים כאשר `q` קיים.
3. Response:
`{ success, data: ReservationListItem[], total, page, limit }`.

## 5.2 Create / Quote / Confirm

### POST `/`

1. body חובה:
`propertyId`, `roomTypeId`, `arrivalDate`, `departureDate`, `primaryGuestId`, `ratePerNight`.
2. body אופציונלי:
`adults`, `children`, `roomsCount`, `ratePlanId`, `source`, `marketSegment`, `companyId`, `travelAgentId`, `specialRequests`, `guestNotes`, `internalNotes`, `guaranteeType`, `language`, `currency`, `isVip`, `externalId`, `channelReservationId`, `idempotencyKey`, `bookingStatus`, `cancellationPolicy`, `depositPolicy`, `quoteExpiresAt`, `holdExpiresAt`, `allowOverbooking`.
3. guard:
1. `allowOverbooking=true` דורש `OVERRIDE_ROLES`.
4. side effects:
1. יצירת `Reservation`.
2. יצירת `Folio` (לסטטוסים מסוימים).
3. עדכון Inventory (`incrementInventory`) לפי סטטוס.
4. יצירת `ReservationRoom[]`.
5. יצירת `StaySegment[]`.
6. audit event + channel queue event.

### POST `/quote`

1. body מינימלי:
`propertyId`, `roomTypeId`, `arrivalDate`, `departureDate`.
2. מחשב:
`nights`, `subtotal`, `taxAmount`, `total`, `expiresAt`.
3. לא יוצר Reservation.

### POST `/quote/save`

1. שומר הזמנה בסטטוס `quote` או `hold`.
2. אם `quoteExpiresAt` חסר: ברירת מחדל +30 דקות.
3. מחזיר `201` עם reservation שנשמר.

### POST `/:id/confirm`

1. סטטוסים מותרים למעבר:
`draft`, `quote`, `hold`, `pending_payment`, `confirmed`.
2. אם אין assignedRoom: מבצע ניסיון auto-assignment לפי availability.
3. side effects:
1. commit inventory כאשר המקור `draft/quote`.
2. ensure folio קיים.
3. ניקוי `quoteExpiresAt`, `holdExpiresAt`, `holdReleasedAt`.
4. audit.

## 5.3 Update & Lifecycle

### PATCH `/:id`

1. שדות עדכון מורשים:
`arrivalDate`, `departureDate`, `roomTypeId`, `ratePerNight`, `ratePlanId`, `adults`, `children`, `specialRequests`, `guestNotes`, `internalNotes`, `marketSegment`, `companyId`, `travelAgentId`, `guaranteeType`, `channelReservationId`, `externalId`, `priceOverrideReason`, `group`, `cancellationPolicy`, `depositPolicy`.
2. ב-`modifyReservation`:
1. שינוי תאריכים/roomType גורר release old inventory + check availability + commit new inventory.
2. rollback inventory אם אין זמינות.
3. סטטוס יעד תמיד `modified`.
4. audit + channel queue.

### POST `/:id/check-in`

1. body:
`overrideClean?: boolean`, `overrideEarlyArrival?: boolean`.
2. override דורש `HIGH_PRIV_CHECKIN_ROLES`.
3. כללי שירות:
1. guest blacklist חוסם check-in.
2. early arrival בלי override נחסם.
3. חדר לא נקי/OOO נחסם בלי override מתאים.
4. side effects:
1. Reservation -> `in_house`, `checkedInAt`.
2. Room -> `occStatus=occupied`.
3. Folio: יצירת nightly room charges לכל לילה.
4. GuestProfile counters: `totalStays`, `totalRevenue`.
5. ReservationRoom statuses -> `in_house`.

### POST `/:id/check-out`

1. body:
`forceCheckout?: boolean`.
2. `forceCheckout=true` דורש `HIGH_PRIV_CHECKOUT_ROLES`.
3. guard:
1. folio open balance חוסם checkout אם force לא דלוק.
4. side effects:
1. Reservation -> `checked_out`, `checkedOutAt`.
2. Folio -> `closed`.
3. Room -> `checked_out + dirty`.
4. יצירת Housekeeping task מסוג `checkout_clean`.
5. ReservationRoom statuses -> `checked_out`.

### POST `/:id/cancel`

1. body:
`reason?: string`.
2. אסור לבטל אם כבר `cancelled` או `checked_out`.
3. side effects:
1. release inventory.
2. Room occupancy ל-`vacant` אם היה assigned.
3. ReservationRoom -> `cancelled`.
4. channel update + audit.

### POST `/:id/no-show`

1. side effects:
1. Reservation -> `no_show`, `noShowAt`.
2. release inventory.
3. assigned room -> `vacant`.
4. ReservationRoom -> `no_show`.

## 5.4 Charges & Fees

### POST `/:id/cancellation-fee`

1. role: `HIGH_PRIV_CHECKOUT_ROLES`.
2. body חובה: `amount > 0`.
3. body אופציונלי: `description` (default `Cancellation Fee`).
4. side effects:
1. ensure open folio.
2. append folio line (`type=fee`, `source=manual`).
3. audit.

### POST `/:id/no-show-fee`

1. זהה ל-cancellation-fee עם default description `No-show Fee`.

### POST `/:id/add-service`

1. body חובה: `description`, `amount > 0`.
2. body אופציונלי: `department`, `quantity`, `serviceDate`, `taxRate`.
3. אסור לסטטוסים `cancelled`/`no_show`.
4. side effects:
1. ensure open folio.
2. append line (`type=service`, `source=manual`).
3. audit.

### POST `/transfer-charges`

1. role: `HIGH_PRIV_CHECKOUT_ROLES`.
2. body חובה: `fromReservationId`, `toReservationId`, `lineIds[]`.
3. שני הצדדים חייבים להיות באותו property.
4. side effects:
1. lineIds במקור מסומנים `voided`.
2. נוצרת העתקה `posted` בפוליו יעד.
3. audit.

## 5.5 Room Assignment / Partial Ops / Stay Changes

### PATCH `/:id/assign-room`

1. body: `roomId`, `reservationRoomId?`.
2. מעדכן `Reservation.assignedRoom` וגם אופציונלית room line ספציפית.

### POST `/:id/partial-check-in`

1. body חובה: `reservationRoomIds[]`.
2. body אופציונלי: `overrideClean`.
3. side effects:
1. room lines selected -> `in_house`.
2. rooms occupancy -> `occupied`.
3. reservation status -> `in_house` או `partially_checked_in`.

### POST `/:id/partial-check-out`

1. body חובה: `reservationRoomIds[]`.
2. side effects:
1. room lines selected -> `checked_out`.
2. rooms -> `checked_out + dirty`.
3. reservation status -> `checked_out` או `partially_checked_out`.

### POST `/:id/extend`

1. body חובה: `newDepartureDate`.
2. body אופציונלי: `nightlyRate`.
3. דרישת זמינות לטווח ההארכה.
4. side effects:
1. increment inventory לטווח המוארך.
2. update reservation: `departureDate`, `nights`, `ratePerNight?`, `totalAmount`, `taxAmount`, `status=modified`.
3. update כל ReservationRoom departure/rate.

### POST `/:id/early-departure`

1. body חובה: `newDepartureDate` (בין arrival ל-departure).
2. side effects:
1. release inventory לטווח שקוצר.
2. update reservation totals/nights/status.
3. update ReservationRoom departure.

### POST `/:id/upgrade`

1. role: `OVERRIDE_ROLES`.
2. body: לפחות אחד מ-`newRoomTypeId`, `newRoomId`, `nightlyRate`.
3. body אופציונלי: `reservationRoomId`, `reason`.
4. side effects:
1. patch ל-ReservationRoom.
2. יצירת StaySegment חדש מ"היום" ועד checkout.
3. update Reservation top-level (`roomType`, `assignedRoom`, `ratePerNight`, `status=modified`).

## 5.6 Reservation Rooms & Segments

### GET `/:id/rooms`

1. מחזיר room lines של ההזמנה עם populate מתאים.

### POST `/:id/rooms`

1. body חובה:
`roomTypeId`, `arrivalDate`, `departureDate`.
2. body אופציונלי:
`assignedRoom`, `ratePlanId`, `nightlyRate`, `guests[]`, `notes`.
3. side effects:
1. availability check.
2. create ReservationRoom + StaySegment.
3. increment inventory + adjust reservation totals.
4. audit.

### PATCH `/rooms/:reservationRoomId`

1. fields מותרים:
`assignedRoom`, `roomTypeBooked`, `arrivalDate`, `departureDate`, `ratePlan`, `nightlyRate`, `status`, `notes`, `guests`.

### DELETE `/rooms/:reservationRoomId`

1. side effects:
1. release inventory.
2. delete segments.
3. delete room line.
4. decrement reservation totals.

### GET `/rooms/:reservationRoomId/segments`

1. שליפת stay segments לפי room line.

### POST `/rooms/:reservationRoomId/segments`

1. body חובה:
`fromDate`, `toDate` בטווח ה-room stay.
2. body אופציונלי:
`roomTypeId`, `roomId`, `ratePerNight`, `ratePlanId`, `changeReason`.
3. side effects:
1. create StaySegment.
2. set reservation status `modified`.
3. audit.

## 5.7 Utilities

### POST `/:id/split`

1. body חובה: `reservationRoomIds[]`.
2. body אופציונלי: `newPrimaryGuestId`, `notes`.
3. side effects:
1. יצירת reservation חדש + folio.
2. העברת room lines + segments.
3. חישוב מחדש source reservation totals.

### POST `/merge`

1. body חובה: `sourceReservationId`, `targetReservationId`.
2. body אופציונלי: `transferCharges` (default true).
3. side effects:
1. העברת room lines + segments ליעד.
2. העברת שורות פוליו (אם enabled).
3. source -> `cancelled`, יעד -> `modified`.

### POST `/:id/duplicate`

1. body אופציונלי: `arrivalDate`, `departureDate`.
2. יוצר Reservation חדש על בסיס הקיים דרך `createReservation`.

### POST `/:id/send-confirmation`

1. מסמן `confirmationSent=true` + audit.

### POST `/:id/send-welcome`

1. כרגע מדמה שליחה (audit בלבד).

### POST `/:id/link-group`

1. body: `groupId?`, `groupCode?`, `groupName?`.
2. אסור לסטטוסים סגורים (`cancelled`, `no_show`, `checked_out`).
3. מעדכן group fields + `status=modified`.

### POST `/:id/express-checkout-link`

1. סטטוסים מותרים: `in_house`, `checked_in`, `confirmed`, `partially_checked_in`.
2. מחזיר קישור tokenized ל-24 שעות.
3. הערה: זה token בסיסי (base64url), לא חתימה קריפטוגרפית persisted.

## 6) State Machine (Current)

### Reservation Status enum

`draft`, `quote`, `hold`, `pending_payment`, `confirmed`, `modified`, `cancelled`, `waitlisted`, `no_show`, `checked_in`, `in_house`, `checked_out`, `partially_checked_in`, `partially_checked_out`

### מעברים עיקריים מיושמים

1. `draft/quote/hold/pending_payment/confirmed -> confirmed` (`/:id/confirm`).
2. `confirmed/modified/pending_payment -> in_house` (`/:id/check-in`).
3. `in_house/checked_in -> checked_out` (`/:id/check-out`).
4. `* -> cancelled` (בהגבלות business).
5. `* -> no_show`.
6. `in_house partial ops -> partially_checked_in / partially_checked_out`.
7. שינויים מסחריים -> `modified`.

## 7) Data Contract: DB Collections

## 7.1 Reservation

1. אוסף: `reservations`.
2. שדות מפתח:
`property`, `confirmationNumber`, `idempotencyKey`, `status`, `primaryGuest`, `arrivalDate`, `departureDate`, `nights`, `roomsCount`, `source`, `roomType`, `assignedRoom`, `ratePerNight`, `totalAmount`, `taxAmount`, `paymentStatus`, `currency`, `guaranteeType`, `company`, `travelAgent`, `group/groupCode/groupName`, `externalId`, `channelReservationId`, operational timestamps.
3. אינדקסים:
1. `{ property, arrivalDate }`
2. `{ property, departureDate }`
3. `{ property, status }`
4. `{ primaryGuest }`
5. `{ property, idempotencyKey } unique sparse`
4. invariant:
1. `nights = departureDate - arrivalDate`.
2. `totalAmount = ratePerNight * nights * roomsCount` (לרוב, עשוי לחרוג לאחר התאמות ידניות).

## 7.2 ReservationRoom

1. אוסף: `reservationrooms`.
2. מייצג line-level חדר בתוך הזמנה.
3. אינדקסים:
1. `{ reservation, createdAt }`
2. `{ property, arrivalDate, departureDate }`

## 7.3 StaySegment

1. אוסף: `staysegments`.
2. מייצג פיצולי stay/room-move לאורך הטווח.
3. אינדקסים:
1. `{ reservationRoom, fromDate }`
2. `{ reservation, fromDate }`

## 7.4 Folio

1. אוסף: `folios`.
2. schema מוטמע `lines[]` עם `type/status/amount/taxAmount/source/serviceDate`.
3. virtuals:
1. `balance`
2. `totalCharges`
3. `totalPayments`

## 7.5 Payment

1. אוסף: `payments`.
2. תשלום כספי ברמת provider operation נפרדת מה-folio line.
3. אינדקסים:
1. `{ correlationId } unique sparse` (idempotency)
2. `{ property, createdAt }`
3. `{ folio }`, `{ reservation }`, `{ providerReference }`

## 7.6 InventoryDate

1. אוסף: `inventorydates`.
2. document אחד לכל `property + roomType + date`.
3. אינדקס unique: `{ property, roomType, date }`.
4. נוסחת זמינות:
`available = physical - blocked - ooo - booked - tentative - locked - effectiveAllotment + overbookingLimit`.

## 7.7 InventoryLock

1. אוסף: `inventorylocks`.
2. lock זמינות זמני לפי `idempotencyKey`.
3. אינדקסים:
1. TTL על `expiresAt`.
2. unique `{ property, idempotencyKey }`.

## 8) Consistency Rules (Must)

1. כל שינוי סטטוס Reservation צריך להתגלגל ל-ReservationRoom statuses בהתאם.
2. כל שינוי שמאריך/מקצר stay חייב ליישב InventoryDate.
3. folio close ב-checkout חייב להישמר לפני החלפת status ל-`checked_out`.
4. group/merge/split חייבים audit עקבי.
5. operations שמשנות חיובים חייבות להישען על open folio בלבד.

## 9) Gaps מול יעד Parity

1. חסר endpoint ייעודי ל-Bulk actions ברזולוציה מלאה (קיים חלקית בתהליכים אחרים).
2. אין חוזה רשמי מאוחד ל-error codes (כרגע free-text).
3. אין token signing persisted ל-express-checkout links.
4. חסר reconciliation UI/API מלא ל-OTA failure queue במסגרת נתיב reservations עצמו.
5. חסר סט standardized ל-email templates/send outcomes ישירות במודול reservations (קיים חלקית במודולים אחרים).

## 10) Deliverables לשלב 4 (יישום)

1. ליישר כל responses ל-schema אחד (`success/data/meta` + `problem details`).
2. להוסיף `bulk` endpoints ו-partial success contract.
3. להוסיף optimistic concurrency (`version`/`updatedAt` guards) ל-merge/split/upgrade.
4. להוסיף signing/verification storage ל-express checkout token.
5. להוסיף test matrix ל-50+ תרחישי lifecycle קריטיים.

## 11) קבצים קשורים

1. `server/routes/reservations.js`
2. `server/services/reservationService.js`
3. `server/services/availabilityService.js`
4. `server/models/Reservation.js`
5. `server/models/ReservationRoom.js`
6. `server/models/StaySegment.js`
7. `server/models/Folio.js`
8. `server/models/Payment.js`
9. `server/models/InventoryDate.js`
10. `server/models/InventoryLock.js`
