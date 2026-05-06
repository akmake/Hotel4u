# Stage 3 RBAC + Side Effects Review (Reservations)

תאריך: 6 במאי 2026  
מקור נתונים: ניתוח סטטי של `server/routes/reservations.js` + `server/services/reservationService.js`  
קבצי עזר:
1. `docs/architecture/stage3_rbac_sideeffects_inventory.csv`
2. `docs/architecture/stage3_service_sideeffects_inventory.csv`

## 1) תקציר מנהלים

1. כיסוי endpoints: `35/35` מופו.
2. אכיפת tenant scope: בכל הנתיבים נמצא `assertPropertyScope` (`35/35`).
3. נתיבי כתיבה: `31/35` מבצעים side effects ברמת DB/Inventory/Folio/Audit.
4. נקודת סיכון מרכזית: רוב הכתיבות הרב-שלביות אינן עטופות transaction, ולכן יש סיכון לקונסיסטנטיות חלקית בכשל ביניים.

## 2) סטטיסטיקת הרשאות

1. `auth_only`: `5` נתיבים.
2. `COMMERCIAL_ROLES`: `22` נתיבים.
3. `COMMERCIAL_ROLES + OVERRIDE_ROLES`: `1` נתיב.
4. `COMMERCIAL_ROLES + HIGH_PRIV_CHECKIN_ROLES`: `2` נתיבים.
5. `COMMERCIAL_ROLES + HIGH_PRIV_CHECKOUT_ROLES`: `1` נתיב.
6. `HIGH_PRIV_CHECKOUT_ROLES`: `3` נתיבים.
7. `OVERRIDE_ROLES`: `1` נתיב.

## 3) ממצאים

## 3.1 ממצאים חיוביים

1. אין חור scope גלוי: כל endpoint מבצע בדיקת property context.
2. פעולות override רגישות קיימות:
1. `check-in` עם `overrideClean/overrideEarlyArrival` דורש High Priv.
2. `check-out` עם `forceCheckout` דורש High Priv.
3. `cancellation-fee`/`no-show-fee` מוגבלות ל-High Priv checkout roles.
3. יש audit נרחב על רוב הנתיבים העסקיים הכבדים.

## 3.2 ממצאי סיכון (High)

### A) חוסר Transaction בזרימות מרובות אוספים

1. פעולות כמו `merge`, `split`, `check-in`, `check-out`, `extend`, `early-departure`, `transfer-charges` מבצעות כמה writes עוקבים.
2. אם שלב מאוחר נכשל, ייתכן מצב ביניים עם נתונים חלקיים.

דוגמאות:
1. `check-in`: service מעדכן Reservation/Folio/Room ואז route מעדכן ReservationRoom statuses.
2. `check-out`: service סוגר Folio/Reservation/Room ואז route מעדכן ReservationRoom statuses.
3. `merge`: העברת room lines/segments/folio lines + עדכון שתי הזמנות.

השפעה:
1. סטטוסים לא עקביים בין Reservation ל-ReservationRoom.
2. פערים בין inventory למצב הזמנה בפועל.
3. פוליו/חיובים במצב חצי-מוזז.

### B) הרשאות תפעול רחבות מדי תחת `COMMERCIAL_ROLES`

1. `COMMERCIAL_ROLES` כולל גם `sales_manager` ו-`revenue_manager`.
2. בפועל roles אלה יכולים לגשת לפעולות תפעוליות כגון check-in/check-out/cancel/room operations כי הנתיב דורש COMMERCIAL בלבד.

השפעה:
1. הרחבת attack surface של פעולות Front Desk.
2. סיכון שגיאות תפעוליות/זדוניות אם role אינו תפעולי ביום-יום.

הערה:
1. זה יכול להיות מכוון עסקית, אך דורש החלטת מוצר-אבטחה מפורשת.

## 3.3 ממצאי סיכון (Medium)

### C) נתיבי `auth_only` מחזירים מידע הזמנה עשיר

1. `GET /reservations`, `GET /reservations/:id`, `GET /reservations/:id/rooms`, `GET /reservations/rooms/:reservationRoomId/segments`, `GET /availability/check` הם ללא role gate נוסף מעבר לאימות משתמש וסcope.
2. אם יש משתמשים authenticated ברמת property שאינם אמורים לראות PII/finance, נדרש role read-policy מדויק יותר.

### D) היעדר idempotency ברוב הכתיבות

1. idempotency קיים בעיקר ב-`createReservation` ובזרימות lock מסוימות.
2. פעולות רבות חשופות ל-double-submit (למשל click כפול/timeout retry).

## 4) מטריצת סיכון לפי קבוצת endpoint

| קבוצה | דוגמאות | סיכון עיקרי | דרגת סיכון |
|---|---|---|---|
| Lifecycle | check-in/out/cancel/no-show | קונסיסטנטיות בין Reservation/Folio/Room/ReservationRoom | High |
| Complex Ops | merge/split/transfer-charges | partial updates במספר אוספים | High |
| Financial Lines | cancellation-fee/no-show-fee/add-service | כפילויות ו-idempotency חסר | Medium |
| Read APIs | list/details/rooms/segments | חשיפת מידע פנימית ל-role רחב מדי | Medium |
| Availability Ops | extend/early-departure/add room | drift בין inventory ל-reservation במקרי כשל | High |

## 5) המלצות Pre-Implementation (לפני rollout רחב)

1. להוסיף transactions (Mongo session) לפחות לנתיבים:
1. `merge`
2. `split`
3. `check-in`
4. `check-out`
5. `extend`
6. `early-departure`
7. `transfer-charges`

2. לבצע hardening ל-RBAC:
1. לפצל `COMMERCIAL_ROLES` ל-`frontdesk_ops_roles` מול `commercial_read_roles`.
2. להגביל check-in/out/room writes ל-ops roles בלבד.

3. להוסיף idempotency key גם לפעולות פיננסיות ו-lifecycle קריטיות.
4. להוסיף optimistic concurrency לנתיבי update רגישים (`updatedAt` guard או versioning).
5. להרחיב audit schema כך שיכלול גם `request_id` ו-`idempotency_key` ל-traceability.

## 6) תוצרי בדיקות שהופקו

1. Inventory route-level side effects:
`docs/architecture/stage3_rbac_sideeffects_inventory.csv`
2. Service-level side effects:
`docs/architecture/stage3_service_sideeffects_inventory.csv`

