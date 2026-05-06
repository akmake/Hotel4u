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

## תוצאות אחרונות
1. תאריך: 6 במאי 2026
2. Summary: `PASS=11 FAIL=0 SKIP=0`

## הערות
1. הסקריפט מייצר context אוטומטי מה-DB (משתמשים/טוקנים/Property/RoomType/Guest).
2. cleanup להזמנות שנוצרו בסקריפט מבוצע best-effort בסיום.
