# מעקב התקדמות - מערכת הזמנות PMS

תאריך עדכון: 6 במאי 2026

## סטטוס כללי
- מצב: יציב ומסודר.
- שלב נוכחי: Stage 4.2 הושלם (Integration + RBAC + Status + Split/Group + Routing/Transfers), עם Gate ב-CI.

## מה הושלם
1. מחקר עומק ותיעוד זרימות הזמנות מלא.
2. פירוק עבודה ל-Epics/Stories/Subtasks כולל קבצי import ל-Jira.
3. חוזה API + DB (OpenAPI + Contract Doc) עם התאמת routes.
4. תיקוני קוד קריטיים במודול ההזמנות:
- תיקון `add-service` מול enum פוליו.
- תיקון `totalAmount` להזמנות מרובות חדרים.
- תיקון `requiredRooms` בבדיקת זמינות לעדכון הזמנה.
- תיקון עקביות חיפוש/פג'ינציה ב-`GET /reservations`.
- יישור "today" לפי `property.timezone`.
- חסימת מעבר מצב לא חוקי `cancelled -> no_show`.
5. Smoke automation:
- `server/scripts/stage3ReservationsSmoke.mjs`
- סקריפט מעודכן כך שבדיקת `add-service` רצה לפני `cancel/no-show`.
6. Stage 4 integration suite:
- `server/scripts/stage4ReservationsIntegration.mjs`
- `npm run qa:reservations:integration`
- כולל context אוטומטי, RBAC, property scope ומעברי סטטוס.
7. CI Quality Gate:
- `.github/workflows/pms-reservations-qa.yml`
- מריץ אוטומטית seed + integration suite על Mongo service.
8. Stage 4.2 integration coverage:
- `transfer-charges` (RBAC + success flow + folio validation)
- `folio-routing` (RBAC + create/apply/patch/delete lifecycle)

## אימות אחרון
1. תאריך: 6 במאי 2026
2. מצב הרצה: `write` + `INCLUDE_KNOWN_BUG_CASES=1`
3. תוצאה: `PASS=8 FAIL=0 SKIP=0`
4. נקודת מפתח:
- `WRITE-005-ADD-SERVICE-KNOWN-BUG` עבר עם `201` (כלומר הבאג ההיסטורי נסגר בפועל).
5. Stage 4 integration:
- Summary: `PASS=30 FAIL=0 SKIP=0`.
6. Bug found and fixed during Stage 4.2:
- `folio-routing/apply` returned `500` because `FolioLine.source` enum missed `routing`.
- Fixed in `server/models/Folio.js` by adding `routing` to allowed source values.

## סיכונים פתוחים (נמוכים)
1. קיימת נקודת UTC אחת לא קריטית ליצירת טווח תאריכי לילות מתוך stay (לא מתוך "today").

## הצעד הבא המומלץ
1. Stage 4.3: הוספת בדיקות אינטגרציה למסלולי `duplicate`, `merge`, ו-`partial check-in/check-out` כולל תרחישי כשל.

## Update 2026-05-06 - Stage 4.3 Completed
- Stage 4.3 integration scope is now implemented and validated:
1. `duplicate` endpoint flow covered.
2. `merge` endpoint flow covered with folio transfer verification.
3. `partial-check-in` and `partial-check-out` flows covered end-to-end on multi-room reservation state.
4. RBAC validation added for restricted actor on partial check-in.
- Latest integration summary:
1. `PASS=44 FAIL=0 SKIP=0`.
- Recommended next step:
1. Stage 4.4: extend integration coverage for `check-in`, `check-out`, `extend`, and `change-room`, including negative/error-path scenarios.

## Update 2026-05-06 - Stage 4.4 Completed
- Stage 4.4 integration scope is now implemented and validated:
1. `assign-room` (used as the "change-room" operational flow) covered with RBAC + success path.
2. `extend` covered with both invalid-date rejection and successful extension verification.
3. `check-in` covered with override RBAC gate + successful manager override check-in.
4. `check-out` covered with pre-check-in block + force-checkout RBAC gate + successful manager force-checkout.
- Latest integration summary:
1. `PASS=57 FAIL=0 SKIP=0`.
- Recommended next step:
1. Stage 4.5: add coverage for `early-departure`, `upgrade`, and reservation-room segment lifecycle (`/rooms/:reservationRoomId` + `/segments`).

## Update 2026-05-06 - Stage 4.5 Completed
- Stage 4.5 integration scope is now implemented and validated:
1. `early-departure` endpoint covered (invalid + success + room-date propagation check).
2. `upgrade` endpoint covered (RBAC + success + segment creation check).
3. Reservation-room + segments lifecycle covered:
   - `PATCH /reservations/rooms/:reservationRoomId`
   - `GET /reservations/rooms/:reservationRoomId/segments`
   - `POST /reservations/rooms/:reservationRoomId/segments` (RBAC + validation + success)
- Latest integration summary:
1. `PASS=71 FAIL=0 SKIP=0`.
- Recommended next step:
1. Stage 4.6: harden error-envelope consistency (JSON for service errors), then freeze backend contract and start full UI implementation sprint.

## Update 2026-05-06 - Stage 4.6 Completed
- Stage 4.6 hardening is implemented:
1. Reservation routes now return consistent JSON error envelopes for thrown route/service errors.
2. Reservation service business-rule failures now map to explicit HTTP statuses (`400/404/409`) instead of implicit `500`.
3. Known inconsistency fixed: `check-out` before `check-in` now returns `409` JSON (previously `500` HTML).
- Validation:
1. Full integration suite run on isolated server (`:4020`) passed: `PASS=71 FAIL=0 SKIP=0`.
- Recommended next step:
1. Freeze backend contract and start full UI implementation sprint for reservations end-to-end flows.

## Update 2026-05-06 - Stage 5.1 UI Sprint Started
- Scope implemented in reservations drawer UI:
1. New `advanced` tab connected directly to Stage 4.6-stabilized reservation endpoints.
2. Date operations UI wired to backend:
   - `POST /reservations/:id/extend`
   - `POST /reservations/:id/early-departure`
3. Reservation-room operational UI wired to backend:
   - `POST /reservations/:id/partial-check-in`
   - `POST /reservations/:id/partial-check-out`
   - `POST /reservations/:id/upgrade`
4. Commercial operational UI wired to backend:
   - `POST /reservations/:id/duplicate`
   - `POST /reservations/:id/add-service`
5. API contract alignment fix:
   - `client/src/utils/api.js` reservation `merge(...)` payload updated to `{ targetReservationId, sourceReservationId, transferCharges }` to match backend route contract.
- Validation:
1. `cmd /c npm --prefix client run build` passed successfully.
- Recommended next step:
1. Stage 5.2: add UI flow for reservation merge/split/group linking and bulk actions.

## Update 2026-05-06 - Stage 5.2 UI Scope Expanded
- Implemented inside reservations `advanced` tab:
1. Split flow UI:
   - room-level selection
   - optional `newPrimaryGuestId` and split notes
   - wired to `POST /reservations/:id/split`
2. Merge flow UI:
   - target reservation search
   - manual target ID override
   - transfer-charges toggle
   - wired to `POST /reservations/merge`
3. Group link flow UI:
   - `groupId/groupCode/groupName` fields
   - save/unlink actions
   - wired to `POST /reservations/:id/link-group`
4. API helper upgrades in client:
   - `reservations.split(...)` now supports full payload (while keeping array shortcut compatibility).
   - `reservations.linkGroup(...)` now supports both string `groupId` and full payload object.
- Validation:
1. `cmd /c npm --prefix client run build` passed successfully after integration.
- Recommended next step:
1. Stage 5.3: add true bulk-actions endpoint + UI (multi-select list actions) and complete end-to-end UX for mass operations.

## Update 2026-05-06 - Stage 5.3 Bulk Actions Implemented
- Backend:
1. Added `POST /api/pms/reservations/bulk-actions` in `server/routes/reservations.js`.
2. Supported actions:
   - `send_confirmation`
   - `cancel`
   - `mark_no_show`
   - `check_in`
   - `check_out`
   - `link_group`
   - `unlink_group`
3. Behavior:
   - validates `propertyId`, `reservationIds`, `action`
   - enforces RBAC including override/force privileges
   - processes reservations one-by-one with per-item success/failure result
   - returns batch summary: `total/processed/succeeded/failed/results`
- Frontend:
1. Added `reservations.bulkActions(...)` API helper in `client/src/utils/api.js`.
2. Added multi-select bulk UI in `client/src/pages/ReservationsPage.jsx`:
   - row checkbox + select-all visible
   - bulk action bar with action-specific inputs (cancel reason, group fields, override flags)
   - execution with toast summary and automatic refresh.
- Validation:
1. `node --check server/routes/reservations.js` passed.
2. `cmd /c npm --prefix client run build` passed.
- Recommended next step:
1. Stage 5.4: add automated integration coverage for `/bulk-actions` and then polish UX (confirm dialog + progress indicator per action).

## Update 2026-05-06 - Stage 5.4 Integration Coverage Completed
- Automated integration coverage for bulk actions is now implemented in `server/scripts/stage4ReservationsIntegration.mjs`:
1. RBAC denial path on bulk endpoint (`restricted` actor -> `403`).
2. Validation path for missing `reservationIds` (`400` + failure envelope).
3. Validation path for unsupported `action` (`400` + failure envelope).
4. Success path for single-item bulk confirmation (`200` + `total/processed/succeeded/failed` assertions).
5. Mixed-result path (`200`) with one valid reservation and one non-existent ID, including per-item result assertions.
6. High-privilege gate path for bulk check-in override (`receptionist` + override -> `403`).
- Validation run:
1. Full suite executed against isolated API instance on `http://localhost:4010/api/pms`.
2. Summary: `PASS=78 FAIL=0 SKIP=0`.
- Recommended next step:
1. Stage 5.5: UI polish for bulk-actions UX (confirmation modal, in-flight progress/disabled states, and clearer per-result feedback).

## Update 2026-05-06 - Stage 5.5 Bulk UX Polish Completed
- Bulk actions UX on reservations page polished end-to-end:
1. Confirmation dialog added before executing bulk action (`action + selected count + relevant parameters` preview).
2. In-flight UX hardened:
   - bulk inputs/checkboxes/selection controls disabled while request is running
   - clear loading state shown (`מריץ...`) with action label + selected count
3. Result feedback upgraded:
   - post-action summary card shows `total/processed/succeeded/failed`
   - failure details list shown per reservation (including reservation label + error)
   - on partial failure, failed reservations remain selected for quick retry
4. Implementation file:
   - `client/src/pages/ReservationsPage.jsx`
- Validation:
1. `cmd /c npm --prefix client run build` passed.
- Recommended next step:
1. Stage 5.6: add server-side/background job mode for large bulk batches (progress polling + cancellable execution) to avoid long blocking requests for very large selections.

## Update 2026-05-06 - Stage 5.6 Background Bulk Jobs Implemented
- Backend:
1. `POST /api/pms/reservations/bulk-actions` upgraded with background mode support.
2. Automatic background fallback for large batches (threshold-based) + explicit request flag support (`background: true`).
3. New endpoints:
   - `GET /api/pms/reservations/bulk-actions/jobs/:jobId?propertyId=...&includeResults=1`
   - `POST /api/pms/reservations/bulk-actions/jobs/:jobId/cancel`
4. In-memory bulk job manager added:
   - job lifecycle: `queued -> running -> completed/failed/cancelled`
   - progress counters: `total/processed/succeeded/failed`
   - per-item results + TTL cleanup of completed jobs
- Frontend:
1. `client/src/utils/api.js` added:
   - `reservations.bulkJobStatus(...)`
   - `reservations.cancelBulkJob(...)`
2. `client/src/pages/ReservationsPage.jsx` added:
   - automatic background mode for large selections
   - polling progress loop for background jobs
   - live progress display + cancel button
   - final result summary reuse when background job completes
- Validation:
1. `node --check server/routes/reservations.js` passed.
2. `cmd /c npm --prefix client run build` passed.
- Recommended next step:
1. Stage 5.7: persist bulk jobs in Mongo (instead of in-memory) for crash-safe resume and cross-instance scalability.

## Update 2026-05-06 - Stage 5.7 Bulk Jobs Persisted In Mongo
- Backend persistence migration completed for background bulk jobs:
1. Added Mongo model `server/models/BulkActionJob.js` with:
   - lifecycle status fields (`queued/running/completed/failed/cancelled`)
   - progress counters (`total/processed/succeeded/failed`)
   - per-item result rows
   - cancellation flag + heartbeat + TTL expiry (`expiresAt`) for terminal-job cleanup
2. Replaced in-memory `Map` job store in reservations route with Mongo-backed flow:
   - create job document on enqueue
   - update progress in DB while worker runs
   - status polling endpoint now reads from DB
   - cancel endpoint now updates DB flag/state
3. Crash-safety hardening:
   - stale `running` jobs are auto-marked `failed` on status read if heartbeat exceeded threshold.
- QA coverage expanded:
1. Stage integration suite now includes background bulk flow tests:
   - enqueue (`202`)
   - poll to terminal completion + result assertions
   - terminal cancel rejection (`409`)
2. Latest full-suite result:
   - `PASS=81 FAIL=0 SKIP=0`.
- Recommended next step:
1. Stage 5.8: add operator UI page for background jobs history (filters, retry, and failure drill-down beyond the reservations page context).
