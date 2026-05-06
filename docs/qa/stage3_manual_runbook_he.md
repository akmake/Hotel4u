# Stage 3 Manual Runbook (Reservations Preflight)

תאריך: 6 במאי 2026  
מטרה: הרצה ידנית מדויקת של בדיקות קריטיות לפני תחילת הטמעה רחבה.

## 1) קבצים רלוונטיים

1. [stage3_reservations_regression_matrix_he.md](C:/Users/yosef dahan/Documents/GitHub/hotel4u/docs/qa/stage3_reservations_regression_matrix_he.md)
2. [stage3_preflight_findings_he.md](C:/Users/yosef dahan/Documents/GitHub/hotel4u/docs/architecture/stage3_preflight_findings_he.md)
3. [stage3_rbac_sideeffects_review_he.md](C:/Users/yosef dahan/Documents/GitHub/hotel4u/docs/architecture/stage3_rbac_sideeffects_review_he.md)
4. [stage3_smoke_env.example](C:/Users/yosef dahan/Documents/GitHub/hotel4u/docs/qa/stage3_smoke_env.example)

## 2) הכנה

1. להרים שרת:
```powershell
cd server
npm run dev:safe
```
אם PowerShell חוסם `npm.ps1`, להריץ עם:
```powershell
cmd /c npm run dev:safe
```
2. להכין token תקין ו-IDs:
1. `PMS_PROPERTY_ID`
2. `PMS_ROOM_TYPE_ID`
3. `PMS_PRIMARY_GUEST_ID`
4. אם יש, גם `PMS_EXISTING_RESERVATION_ID`
3. להכין תפקידים להרצת RBAC (לפחות receptionist + front_desk_manager + finance_manager).

## 3) בדיקות מהירות אוטומטיות (Smoke)

## 3.1 מצב קריאה בלבד

```powershell
cd server
$env:PMS_BASE_URL="http://localhost:4000/api/pms"
$env:PMS_TOKEN="<JWT>"
$env:PMS_PROPERTY_ID="<PROPERTY_OBJECT_ID>"
$env:PMS_ROOM_TYPE_ID="<ROOM_TYPE_OBJECT_ID>"
npm run qa:reservations:smoke
```
אם יש policy חסימה:
```powershell
cmd /c npm run qa:reservations:smoke
```

## 3.2 מצב כתיבה מבוקר

```powershell
cd server
$env:PMS_BASE_URL="http://localhost:4000/api/pms"
$env:PMS_TOKEN="<JWT>"
$env:PMS_PROPERTY_ID="<PROPERTY_OBJECT_ID>"
$env:PMS_ROOM_TYPE_ID="<ROOM_TYPE_OBJECT_ID>"
$env:PMS_PRIMARY_GUEST_ID="<GUEST_OBJECT_ID>"
$env:PMS_RATE_PER_NIGHT="450"
npm run qa:reservations:smoke -- --mode=write
```
אם יש policy חסימה:
```powershell
cmd /c npm run qa:reservations:smoke -- --mode=write
```

## 3.3 בדיקת known bug (אופציונלי)

```powershell
$env:INCLUDE_KNOWN_BUG_CASES="1"
npm run qa:reservations:smoke -- --mode=write
```

## 4) בדיקות ידניות חובה (Top 10)

1. `B-004`: check-in override ע״י receptionist -> `403`.
2. `B-005`: check-in override ע״י front_desk_manager -> `200`.
3. `B-006`: force checkout ע״י receptionist -> `403`.
4. `B-007`: force checkout ע״י finance_manager -> `200`.
5. `C-005`: check-in happy path -> reservation=`in_house`.
6. `C-009`: check-out happy path -> folio=`closed`, room=`checked_out + dirty`.
7. `C-012`: cancel happy path -> reservationRooms=`cancelled`.
8. `D-003`: cancellation fee -> נוצר folio line מסוג `fee`.
9. `E-005`: extend -> inventory updated + totals updated.
10. `F-001`: search/pagination consistency -> לאמת `total` מול `data`.

## 5) DB Assertions (Mongo)

הפקודות להלן דוגמאות. להריץ מול DB של סביבת הבדיקה.

1. אימות reservation status:
```javascript
db.reservations.findOne({_id:ObjectId("<RES_ID>")},{status:1,checkedInAt:1,checkedOutAt:1,roomsCount:1,totalAmount:1})
```
2. אימות reservation rooms:
```javascript
db.reservationrooms.find({reservation:ObjectId("<RES_ID>")},{status:1,assignedRoom:1,arrivalDate:1,departureDate:1})
```
3. אימות folio:
```javascript
db.folios.findOne({reservation:ObjectId("<RES_ID>")},{status:1,lines:{$slice:-10}})
```
4. אימות inventory range:
```javascript
db.inventorydates.find({property:ObjectId("<PROPERTY_ID>"),roomType:ObjectId("<ROOM_TYPE_ID>"),date:{$gte:"2026-05-20",$lte:"2026-05-25"}},{date:1,bookedCount:1,lockedCount:1,stopSell:1})
```
5. אימות audit:
```javascript
db.auditlogs.find({entityId:ObjectId("<RES_ID>")}).sort({createdAt:-1}).limit(20)
```

## 6) קריטריוני מעבר לשלב הטמעה

1. Smoke read ו-smoke write עוברים ללא FAIL.
2. אין `scope` bypass באף תרחיש cross-property.
3. אין פער קונסיסטנטיות בין Reservation / ReservationRoom / Room / Folio.
4. תרחישי High Risk מה-matrix עברו או תועדו עם mitigation מפורש.

## 7) הערות חשובות

1. כרגע יש known issue ב-`add-service` מול enum של `FolioLine.type`; ייתכן 500 עד תיקון.
2. פעולות multi-step רבות עדיין ללא transaction כולל, ולכן תקלת ביניים עלולה להשאיר מצב חלקי.
