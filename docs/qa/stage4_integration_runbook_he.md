# Stage 4 Integration Runbook (Reservations + RBAC)

תאריך: 6 במאי 2026

## מטרה
- להריץ בדיקת אינטגרציה אוטומטית למודול ההזמנות.
- לכסות:
1. מעברי סטטוס קריטיים.
2. הרשאות לפי תפקידים (RBAC).
3. בדיקת property scope.

## סקריפט
- `server/scripts/stage4ReservationsIntegration.mjs`
- `npm script`: `qa:reservations:integration`

## דרישות מוקדמות
1. MongoDB נגיש עם נתוני Property/Users/Guests/RoomTypes/Reservations.
2. שרת API זמין (מומלץ מופע מבודד על פורט 4010).
3. `JWT_SECRET` של הסקריפט ושל השרת חייב להיות זהה.

## הרצה מומלצת (PowerShell)
```powershell
cd server
$env:JWT_SECRET="<same-secret-used-by-server>"
$env:PMS_BASE_URL="http://localhost:4010/api/pms"
cmd /c npm run qa:reservations:integration
```

## כיסוי בדיקות
1. `S4-READ-ADMIN-LIST` -> `200`
2. `S4-SCOPE-WRONG-PROPERTY` -> `403`
3. `S4-RBAC-RESTRICTED-CANCEL-FORBIDDEN` -> `403`
4. `S4-RBAC-RECEPTION-CANCELLATION-FEE-FORBIDDEN` -> `403`
5. `S4-WRITE-CREATE-A` -> `201`
6. `S4-RBAC-RESTRICTED-CANCEL-CREATED-FORBIDDEN` -> `403`
7. `S4-WRITE-RECEPTION-CANCEL-CREATED` -> `200`
8. `S4-STATUS-NO_SHOW-AFTER-CANCEL-BLOCKED` -> `409`
9. `S4-WRITE-CREATE-B` -> `201`
10. `S4-WRITE-ADD-SERVICE-ON-ACTIVE` -> `201` + line type `charge`
11. `S4-RBAC-RECEPTION-CANCELLATION-FEE-STILL-FORBIDDEN` -> `403`
12. `S4.1-WRITE-CREATE-C-MULTIROOM` -> `201`
13. `S4.1-WRITE-DETAILS-C-MULTIROOM` -> `200` + לפחות 2 חדרים
14. `S4.1-WRITE-SPLIT-C` -> `201`
15. `S4.1-WRITE-DETAILS-SPLIT-CHILD` -> `200`
16. `S4.1-WRITE-CREATE-D` -> `201`
17. `S4.1-WRITE-LINK-GROUP-ACTIVE` -> `200`
18. `S4.1-WRITE-CANCEL-D` -> `200`
19. `S4.1-WRITE-LINK-GROUP-CLOSED-BLOCKED` -> `400`
20. `S4.2-WRITE-CREATE-E` -> `201`
21. `S4.2-WRITE-CREATE-F` -> `201`
22. `S4.2-WRITE-ADD-SERVICE-E` -> `201`
23. `S4.2-RBAC-RECEPTION-TRANSFER-CHARGES-FORBIDDEN` -> `403`
24. `S4.2-WRITE-TRANSFER-CHARGES-ADMIN` -> `200`
25. `S4.2-VERIFY-TRANSFER-FOLIOS` -> `200`
26. `S4.2-RBAC-RECEPTION-ROUTING-CREATE-FORBIDDEN` -> `403`
27. `S4.2-WRITE-ROUTING-CREATE-ADMIN` -> `201`
28. `S4.2-WRITE-ROUTING-APPLY-ADMIN` -> `200`
29. `S4.2-WRITE-ROUTING-PATCH-DEACTIVATE` -> `200`
30. `S4.2-WRITE-ROUTING-DELETE` -> `200`

## תוצאות אחרונות
1. תאריך: 6 במאי 2026
2. Summary: `PASS=30 FAIL=0 SKIP=0`

## CI Gate
1. נוסף workflow:
- `.github/workflows/pms-reservations-qa.yml`
2. ה-workflow מריץ:
- התקנת תלויות
- `seed`
- הרמת API
- `qa:reservations:integration`

## באגים שזוהו ותוקנו תוך כדי Stage 4.2
1. `folio-routing/apply` החזיר `500` בגלל `source: 'routing'` שלא היה מוגדר ב-enum של `FolioLine.source`.
2. התיקון: הוספת `routing` ל-enum במודל `server/models/Folio.js`.

## הערות
1. הסקריפט מייצר context אוטומטי מה-DB (משתמשים/טוקנים/Property/RoomType/Guest).
2. cleanup להזמנות שנוצרו בסקריפט מבוצע best-effort בסיום.

## Update 2026-05-06 - Stage 4.3
1. Added Stage 4.3 integration coverage in `server/scripts/stage4ReservationsIntegration.mjs`:
- `duplicate` flow (create + verify copied fields).
- `merge` flow (source cancelled, rooms moved, target folio merged lines verification).
- `partial-check-in` / `partial-check-out` flow on merged multi-room reservation.
- RBAC guard for restricted role on `partial-check-in`.
2. Latest full-suite result:
- `PASS=44 FAIL=0 SKIP=0`.
3. Implementation note:
- Stage 4.3 tests intentionally reuse reservations created in the suite (`createdReservationB` + its duplicate) to reduce flakiness and avoid dependency on long-range inventory generation.

## Update 2026-05-06 - Stage 4.4
1. Added Stage 4.4 integration coverage in `server/scripts/stage4ReservationsIntegration.mjs`:
- `assign-room` flow as the operational "change-room" API path (RBAC + success).
- `extend` flow (invalid date rejection + successful extension with updated rate/departure).
- `check-in` flow (override permission gate + successful manager override check-in).
- `check-out` flow (blocked pre-check-in, force-checkout RBAC gate, successful manager force-checkout).
2. Latest full-suite result:
- `PASS=57 FAIL=0 SKIP=0`.
3. Stability note:
- Partial check-in tests now run with manager `overrideClean=true` to avoid environment-dependent room-cleanliness flakes.

## Update 2026-05-06 - Stage 4.5
1. Added Stage 4.5 integration coverage in `server/scripts/stage4ReservationsIntegration.mjs`:
- `early-departure` flow (invalid boundary rejection + successful departure-shortening + reservation-room date propagation verification).
- `upgrade` flow (RBAC rejection for receptionist + successful manager upgrade with segment creation verification).
- Reservation-room lifecycle coverage:
  - `PATCH /reservations/rooms/:reservationRoomId`
  - `GET /reservations/rooms/:reservationRoomId/segments`
  - `POST /reservations/rooms/:reservationRoomId/segments` (RBAC/invalid/success paths)
2. Latest full-suite result:
- `PASS=71 FAIL=0 SKIP=0`.

## Update 2026-05-06 - Stage 4.6
1. Error-envelope hardening completed for reservation flows:
- `server/routes/reservations.js` now uses a local async wrapper that guarantees JSON error envelopes for route-level/service-level throws.
- `server/services/reservationService.js` now emits structured HTTP errors (`400/404/409`) for business-rule failures instead of generic `500`.
2. Contract behavior update:
- `check-out` before `check-in` now returns `409` (business conflict) with JSON envelope, replacing previous generic `500` HTML response.
3. Validation run:
- Full suite executed against isolated API instance on `http://localhost:4020/api/pms`.
- Summary: `PASS=71 FAIL=0 SKIP=0`.

## Update 2026-05-06 - Stage 5.4
1. Added bulk-actions integration coverage in `server/scripts/stage4ReservationsIntegration.mjs`:
- RBAC guard (`restricted` role forbidden on bulk endpoint).
- Validation guards (`reservationIds` required + unsupported action).
- Successful single-item bulk execution assertions.
- Mixed-result bulk execution assertions (success + not-found in one request).
- High-privilege override RBAC guard on bulk `check_in`.
2. Latest full-suite result:
- `PASS=78 FAIL=0 SKIP=0`.
3. Isolated run command used:
```powershell
cd server
$env:PMS_BASE_URL="http://localhost:4010/api/pms"
cmd /c npm run qa:reservations:integration
```
