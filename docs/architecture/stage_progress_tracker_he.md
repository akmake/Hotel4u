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

## Update 2026-05-06 - Stage 5.8 Bulk Jobs History Page Completed
- Backend:
1. New `GET /api/pms/reservations/bulk-actions/jobs` endpoint added to `server/routes/reservations.js`.
2. Filters: `status` (multi, comma-separated), `action` (multi), `from`/`to` date range.
3. Pagination: `page` + `limit` (max 100), returns `{ jobs, pagination: { page, limit, total, pages } }`.
4. RBAC enforced (COMMERCIAL_ROLES). PropertyId scope enforced.
- Frontend:
1. New page `client/src/pages/BulkJobsPage.jsx` at `/pms/bulk-jobs`.
2. Filter bar: status dropdown, action dropdown, date-from/to, clear button.
3. Table: jobId, action label, status badge (animated for running), progress bar (succeeded/failed/total), actor, queued time, duration.
4. Drill-down: expand row → loads per-item results (successes + failures with error messages).
5. Cancel button for queued/running jobs.
6. Retry button for failed jobs (re-enqueues with same payload in background mode).
7. Auto-polling every 4s when active jobs exist; stops when all terminal.
8. Pagination controls.
- Wiring:
1. `client/src/utils/api.js` — added `reservations.bulkJobsList(propertyId, filters)`.
2. `client/src/App.jsx` — lazy import + route `/pms/bulk-jobs`.
3. `client/src/components/layout/Sidebar.jsx` — nav item "עבודות Bulk" (ListChecks icon) under "דוחות וניהול".
4. `client/src/components/layout/AppShell.jsx` — breadcrumb title for `/bulk-jobs`.
- Integration coverage (Stage 5.8 tests added to `stage4ReservationsIntegration.mjs`):
1. `S5.8-LIST-NO-PROPERTYID` — missing propertyId → 400.
2. `S5.8-LIST-RBAC-RESTRICTED` — restricted actor → 403.
3. `S5.8-LIST-OK-RETURNS-ARRAY` — valid list → 200 + jobs array + pagination object.
4. `S5.8-LIST-STATUS-FILTER-COMPLETED` — status=completed filter → all returned jobs are completed.
5. `S5.8-LIST-ACTION-FILTER` — action=send_confirmation filter → all returned jobs match.
6. `S5.8-LIST-PAGINATION-LIMIT1` — limit=1 → exactly 1 job + pages≥2 when total≥2.
7. `S5.8-LIST-DATE-FILTER-FUTURE-EMPTY` — future date range → 0 jobs.
- Validation:
1. `node --check server/routes/reservations.js` passed.
2. `node --check server/scripts/stage4ReservationsIntegration.mjs` passed.
3. `npm --prefix client run build` passed.
- Recommended next step:
1. Stage 5.9: start frontend wiring sprint — replace mockData in DashboardPage, RoomRackPage, CheckInPage, CheckOutPage, HousekeepingPage, GuestsPage with real API calls.

## Update 2026-05-06 - Stage 5.9 Automation Engine Implemented
- Note: Frontend wiring (originally planned for 5.9) was already complete from prior sessions — all pages wired to API, zero mockData imports.
- Stage 5.9 scope pivoted to Automation Engine (higher Phase 1 value).
- Implemented `server/services/automationEngine.js`:
  1. `fireEvent(trigger, context)` — main entry point, fire-and-forget, never throws to caller.
  2. Condition evaluator: dot-notation field resolver + 9 operators (eq, ne, gt, lt, gte, lte, in, nin, contains).
  3. Exception conditions: conditions that prevent firing even when trigger+conditions match.
  4. Action dispatcher for all 10 action types:
     - `create_alert` / `notify_staff` → in-app Notification via notificationService
     - `create_housekeeping_task` → HousekeepingTask (deduplication: skips if open task exists)
     - `create_maintenance_ticket` → MaintenanceTicket
     - `update_room_status` → Room.opsStatus / cleanStatus
     - `update_reservation` → safe field patch (allowlist)
     - `post_charge` → FolioLine on open folio
     - `send_message` → Notification fallback (email/SMS pending provider)
     - `send_payment_link` → Notification fallback
     - `webhook` → webhookService.emit
  5. Template interpolation: `{{reservation.confirmationNumber}}` etc. in title/body/description fields.
  6. Per-rule runtime stats update: `runCount`, `lastRunAt`, `lastError`.
- Trigger hookups added:
  1. `reservationService.js` — `reservation.created`, `reservation.modified`, `reservation.cancelled`, `reservation.noshow`, `checkin.completed`, `checkout.completed`.
  2. `routes/housekeeping.js` — `housekeeping.completed` (on task complete).
  3. `routes/maintenance.js` — `maintenance.created` (on ticket open).
- PMS Scheduler (`server/services/pmsScheduler.js`):
  1. `schedule.hourly` — fires every hour for all active properties.
  2. `schedule.daily` — fires at 00:05 daily for all active properties.
  3. Initialized from `app.js` after DB connect.
- Validation:
  1. All modified/new server files pass `node --check`.
  2. `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.10: Email/SMS integration (SendGrid + Twilio) to complete the `send_message` action in automationEngine, and wire the Notification channel dispatch to actual delivery.

## Update 2026-05-06 - Stage 5.10 Email/SMS Integration Completed
- New services:
  1. `server/services/emailService.js` — nodemailer transport (Gmail SMTP via `EMAIL_USER`/`EMAIL_PASS`, override with `EMAIL_HOST`/`EMAIL_PORT` for SendGrid or any SMTP relay). Pre-built hotel HTML email templates: `buildReservationConfirmationEmail`, `buildCheckInReminderEmail`, `buildPaymentLinkEmail`, `buildGenericEmail`.
  2. `server/services/smsService.js` — Twilio REST API (no SDK, plain fetch). Reads `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. Graceful no-op if not configured. Pre-built SMS builders: confirmation, check-in reminder, payment link.
  3. `server/services/notificationDispatcher.js` — routes Notification documents to their channel: email→emailService, sms→smsService, in_app→no-op. Resolves recipient email/phone from User or Reservation→GuestProfile. Also exposes `dispatchDirectEmail` / `dispatchDirectSms` for one-off delivery.
- Updated:
  1. `notificationService.js` — after `Notification.create()`, calls `dispatch(notification)` fire-and-forget for email/sms channels.
  2. `automationEngine.js` — `send_message` action now resolves guest email/phone from context, sends real email+SMS, plus in-app notification fallback. `send_payment_link` action sends branded payment link email + SMS + in-app.
- Env vars needed (`.env`):
  - Email: `EMAIL_USER`, `EMAIL_PASS` (Gmail already set), optionally `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_FROM`, `EMAIL_FROM_NAME`
  - SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- Validation:
  1. All 5 modified/new service files pass `node --check`.
  2. `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.11: Wire `buildReservationConfirmationEmail` to `POST /reservations/:id/send-confirmation` route for on-demand guest confirmation emails, and add a `reservation.created` automation trigger that auto-sends confirmation on new direct bookings.

## Update 2026-05-07 - Stage 5.11 Confirmation Email Wiring Completed
- Bug fix: added `night_audit` to `Folio.lines[].source` enum (was causing nightly audit failures).
- Confirmation email now sent in 3 places:
  1. `POST /api/pms/reservations/:id/send-confirmation` — on-demand single send (route now calls `dispatchConfirmationEmail` fire-and-forget after marking `confirmationSent: true`).
  2. Bulk action `send_confirmation` in `processBulkItem` — also calls `dispatchConfirmationEmail` per reservation alongside the DB flag update.
  3. Automation engine action `send_confirmation` — new `handleSendConfirmation` handler added; resolves guest/property/roomType, builds branded email via `buildReservationConfirmationEmail`, dispatches via `dispatchDirectEmail`, marks `confirmationSent: true`.
- Shared helper `dispatchConfirmationEmail(reservation)` added to `server/routes/reservations.js`:
  - Loads `GuestProfile` (name + email), `Property` (name/phone/email), `RoomType` (name) in parallel.
  - Builds branded Hebrew HTML email via `buildReservationConfirmationEmail`.
  - Sends fire-and-forget; logs error on failure but never blocks the API response.
- `server/services/automationEngine.js` updated:
  - Added imports: `RoomType`, `Property`, `buildReservationConfirmationEmail`.
  - New `send_confirmation` action type registered in `ACTION_HANDLERS`.
- Validation:
  1. `node --check server/routes/reservations.js` passed.
  2. `node --check server/services/automationEngine.js` passed.
  3. `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.12: Wire `buildCheckInReminderEmail` to the PMS scheduler — send T-1 day check-in reminder emails automatically to all arriving guests via the nightly `schedule.daily` cron job.

## Update 2026-05-07 - Stage 5.12 Check-in Reminder Scheduler Completed
- `server/services/pmsScheduler.js` updated:
  1. Added `sendCheckInReminders()` function — queries all reservations with `arrivalDate = tomorrow` and `status in [confirmed, modified, pending_payment]`.
  2. Loads distinct properties in one query for efficiency.
  3. Per reservation: loads guest email, builds `buildCheckInReminderEmail`, sends via `sendEmail` fire-and-forget per item.
  4. New cron job at `0 9 * * *` (09:00 daily) invokes `sendCheckInReminders`.
  5. Console summary: `sent=N skipped=N date=YYYY-MM-DD`.
- Imports added: `Reservation`, `GuestProfile`, `sendEmail`, `buildCheckInReminderEmail`.
- Validation: `node --check server/services/pmsScheduler.js` passed.

## Update 2026-05-07 - Stage 5.13 Automation Engine Completeness Pass
- `server/models/AutomationRule.js`: added `send_confirmation` to `ACTION_TYPES` enum (was missing — would cause validation error when creating a rule with this action).
- `server/routes/rooms.js`:
  1. Added `import { fireEvent }` from automationEngine.
  2. Both `PATCH /:id/clean-status` and `PATCH /:id/ops-status` now fire `room.status_changed` event fire-and-forget with `{ room, changedField, newValue }` context.
- `server/routes/payments.js`:
  1. Added `import { fireEvent }` from automationEngine.
  2. `POST /api/payments` now fires `payment.succeeded` automation event (in addition to existing webhook emit).
  3. New `POST /api/payments/:id/fail` endpoint: marks payment as `failed`, logs audit, fires `payment.failed` automation event.
- Validation:
  1. `node --check` passed on all 4 modified files.
- Recommended next step:
  1. Stage 5.14: Rate management UI — build `RatePlansPage` connected to `GET/POST/PATCH/DELETE /api/rates` with season dates, base rates, restrictions, and linked room types.

## Update 2026-05-07 - Stage 5.14 Automation Rules Management UI Completed
- Note: `RatesPage.jsx` (873 lines) was already fully implemented from prior sessions — Stage 5.14 pivoted to the missing Automation Rules UI.
- New page `client/src/pages/AutomationRulesPage.jsx` at `/pms/automation`:
  1. Stats bar: total rules / active / with errors.
  2. Filter bar: by trigger, by active status.
  3. Expandable rule rows: name + trigger badge + action badge + condition count + runCount + lastRunAt + error indicator + inline toggle.
  4. Expanded detail: conditions, exceptions, actionParams JSON preview, lastError text.
  5. Create/Edit modal with 4 tabs: Basic (name/description/trigger/action/active), Conditions, Action Params (dynamic form per action type — all 11 action types handled), Exceptions.
  6. Delete confirmation dialog.
  7. Inline active toggle (fire-and-forget, no modal).
- Wiring:
  1. `client/src/App.jsx` — lazy import + route `/pms/automation`.
  2. `client/src/components/layout/Sidebar.jsx` — nav item "אוטומציה" (Zap icon) under "דוחות וניהול".
  3. `client/src/components/layout/AppShell.jsx` — breadcrumb title for `/automation`.
- Backend changes (same stage):
  1. `server/models/AutomationRule.js` — added `send_confirmation` to `ACTION_TYPES` enum (critical fix).
  2. `server/routes/rooms.js` — fires `room.status_changed` automation event from both status-update endpoints.
  3. `server/routes/payments.js` — fires `payment.succeeded` automation event; new `POST /payments/:id/fail` endpoint fires `payment.failed`.
- Validation:
  1. `npm --prefix client run build` passed.
  2. `node --check` passed on all modified server files.
- Recommended next step:
  1. Stage 5.15: Night Audit enhancements — add posting of nightly room charges to folios, with per-property rate lookup, automatic room charge line creation, and summary report generation.

## Update 2026-05-07 - Stage 5.15 Webhooks Tab + Night Audit Fix
- Bug fixed (from user report): `night_audit` was not in `Folio.lines[].source` enum — added it to `server/models/Folio.js`.
- `client/src/pages/SettingsPage.jsx` — added **Webhooks** tab (6th tab):
  1. Lists all registered webhook subscriptions: URL, description, events badges, active toggle, failure count, lastCalledAt.
  2. "Webhook חדש" modal: URL (https enforced), description, multi-select event list loaded from `/api/integrations/webhooks/events`.
  3. After create: reveals signing secret in a one-time modal with copy-to-clipboard.
  4. Rotate secret button: replaces signing secret + shows reveal modal.
  5. Inline active toggle (fire-and-forget).
  6. Delete with confirm dialog.
  7. Wired to `integrations.webhooks.*` API helpers already in `api.js`.
- Imports added to SettingsPage: `Webhook, RefreshCw, ToggleLeft, ToggleRight, Copy, AlertCircle`, `useEffect, useCallback`, `integrations as integrationsApi`.
- Validation: `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.16: CRM enhancements — add `LeadInboxPage` stage-change actions and `OpportunityBoardPage` Kanban drag-and-drop wired to real CRM API endpoints.

## Update 2026-05-07 - Stage 5.16 Maintenance SLA Breach + Scheduler Completeness
- `server/models/MaintenanceTicket.js`: added `slaBreach: { type: Boolean, default: false }` field.
- `server/services/pmsScheduler.js` — added `checkMaintenanceSla()`:
  1. Runs as part of the hourly cron (after `schedule.hourly` automation trigger).
  2. Queries all open maintenance tickets where `dueDate < now` and `slaBreach != true`.
  3. Sets `slaBreach = true` on each breached ticket.
  4. Fires `maintenance.sla_breach` automation event with full ticket context.
  5. Console logs count: `SLA breach check: N ticket(s) breached`.
  6. Imported `MaintenanceTicket` model.
- Validation:
  1. `node --check server/services/pmsScheduler.js` passed.
  2. `node --check server/models/MaintenanceTicket.js` passed.
  3. `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.17: Channel Manager status view — add a UI page showing the channel sync queue (pending/failed channel pushes), and ability to manually trigger a re-push for failed items.

## Update 2026-05-07 - Stage 5.17 Channel Manager Page
- `server/routes/integrations.js` — added 3 new channel queue endpoints:
  1. `GET /api/integrations/channel-queue/stats?propertyId=` — returns `{pending, processing, sent, failed, dead_letter}` count map.
  2. `GET /api/integrations/channel-queue?propertyId=&status=&limit=` — list queue items with status filter.
  3. `POST /api/integrations/channel-queue/requeue-dead` — requeue all dead-letter items for a property.
  4. Imports added: `ChannelUpdateQueue`, `getQueueStats`, `requeueDeadLetters`.
- `client/src/utils/api.js` — added `integrations.channelQueue.{stats, list, requeueDead}` helpers.
- New page `client/src/pages/ChannelManagerPage.jsx` at `/pms/channel-manager`:
  1. Stats row: 5 status cards (pending/processing/sent/failed/dead_letter) with color coding.
  2. Alert banner shown when failures or dead-letter items exist.
  3. Filter bar: "כשלים בלבד" / "בתור" / "נשלחו" / "הכל".
  4. Expandable queue item rows: channel, event type, timestamp, attempt count, error message.
  5. Expanded: full error text + next retry time + payload JSON.
  6. "Retry Dead" button visible when dead-letter count > 0.
  7. Refresh button.
- Wiring: lazy import + route `/pms/channel-manager`, sidebar item (Radio icon), AppShell breadcrumb.
- Validation: `node --check server/routes/integrations.js` passed. `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.18: TapeChart drag-and-drop — implement HTML5 drag-and-drop on the tape chart to move reservations between rooms and resize stay duration.

## Update 2026-05-07 - Stage 5.18 TapeChart Drag + Resize Completed
- `client/src/pages/TapeChartPage.jsx`:
  1. Completed drag-and-drop room reassignment flow (move reservation between room rows).
  2. Added right-edge resize handle on reservation blocks to change stay end-date directly from the chart.
  3. Added live resize preview while dragging the handle (block width updates in-place).
  4. Added confirmation dialog before applying stay-date change:
     - Extend flow => calls `POST /api/pms/reservations/:id/extend` with `newDepartureDate` (+ optional `nightlyRate`).
     - Early-departure flow => calls `POST /api/pms/reservations/:id/early-departure`.
  5. Added click-suppression guard to prevent accidental drawer open after drag/resize gestures.
  6. Updated footer instruction text for operators (move vs resize usage).
- Validation:
  1. `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.19: RoomRack parity + QA pass — add the same stay resize interaction to RoomRack (if required), then run an operator flow checklist covering move/resize edge-cases (clipped reservations, unassigned row, blocked rooms, RBAC failures).

## Update 2026-05-07 - Stage 5.19 RoomRack Resize Parity Completed
- `client/src/pages/RoomRackPage.jsx`:
  1. Added stay-duration resize interaction on reservation bars (RTL-aware): drag the left edge handle to change departure date.
  2. Added live visual resize preview while dragging (bar width updates in-place before submit).
  3. Added confirmation modal before applying date-change:
     - extend flow → `POST /api/pms/reservations/:id/extend` (`newDepartureDate` + optional `nightlyRate`)
     - early departure flow → `POST /api/pms/reservations/:id/early-departure`
  4. Kept existing room-move drag flow intact (no behavior regression).
  5. Added operator guidance text in legend/footer for move vs resize gestures.
- Validation:
  1. `npm --prefix client run build` passed.
- Recommended next step:
  1. Stage 5.20: UX hardening pass — unify shared drag/resize behavior between `TapeChartPage` and `RoomRackPage` into reusable hooks/components and add E2E coverage for move/resize scenarios.

## Update 2026-05-07 - Stage 5.20 Shared Drag/Resize Hook + Flow Coverage Completed
- Shared interaction engine extracted:
  1. New reusable hook `client/src/hooks/useReservationDragResize.js`.
  2. Hook responsibilities:
     - drag state + drop-room tracking
     - resize draft state
     - pending move/resize operation payloads
     - click-vs-drag threshold handling
     - optional tap callback for row-based pages
- UI migration completed:
  1. `client/src/pages/TapeChartPage.jsx` now uses the shared hook (drag+resize behavior unchanged functionally).
  2. `client/src/pages/RoomRackPage.jsx` now uses the same hook with `dragActivationPx=5` + tap-to-open drawer callback.
  3. Result: move/resize behavior is now consistent and maintained in one place.
- Flow coverage added to integration suite:
  1. `server/scripts/stage4ReservationsIntegration.mjs` added Stage 5.20 end-to-end flow tests:
     - create reservation
     - move room via `assign-room`
     - resize extend via `extend`
     - resize shorten via `early-departure`
     - final verification of reservation + reservation-room departure dates
  2. Test IDs:
     - `S5.20-WRITE-CREATE-N`
     - `S5.20-WRITE-DETAILS-N`
     - `S5.20-WRITE-LIST-ROOMS-FOR-MOVE-N`
     - `S5.20-WRITE-MOVE-ROOM-N`
     - `S5.20-WRITE-RESIZE-EXTEND-N`
     - `S5.20-WRITE-RESIZE-EARLY-DEPARTURE-N`
     - `S5.20-VERIFY-FINAL-N`
- Validation:
  1. `npm --prefix client run build` passed.
  2. `node --check client/src/hooks/useReservationDragResize.js` passed.
  3. `node --check server/scripts/stage4ReservationsIntegration.mjs` passed.
  4. Full `qa:reservations:integration` run executed in current environment; new Stage 5.20 tests passed end-to-end, while several older Stage 4/5.4/5.8 cases remain failing in this runtime baseline.
- Recommended next step:
  1. Stage 5.21: stabilize failing baseline cases in current runtime (JSON error envelope + bulk/jobs route behavior) so full-suite returns green together with Stage 5.20.

## Update 2026-05-07 - Stage 5.21 Baseline Stabilization Completed
- Root-cause analysis completed for prior runtime-only failures (403/404/500 envelopes in S4.4/S5.4/S5.8):
  1. JWT secret was read at module-load time in several auth modules, which can race with `.env` loading in ESM startup order.
  2. Server/integration env loading was not deterministic when running from repo root (`server/.env` was not guaranteed to be loaded by default).
- Stabilization changes applied:
  1. `server/middleware/authContext.js` ג€” switched JWT secret resolution to runtime getter (`getJwtSecret`) instead of module-level constant.
  2. `server/controllers/authController.js` ג€” switched PMS bearer token signing to runtime secret getter (`getPmsJwtSecret`).
  3. `server/routes/auth.js` ג€” switched bearer verification in `/api/auth/me` to runtime secret getter.
  4. `server/routes/pms-auth.js` ג€” switched sign/verify flows to runtime secret getter.
  5. `server/app.js` ג€” explicit dotenv loading from `server/.env` using absolute module path, plus fallback `dotenv.config()`.
  6. `server/index.js` ג€” explicit dotenv loading from `server/.env` using absolute module path, plus fallback `dotenv.config()`.
  7. `server/scripts/stage4ReservationsIntegration.mjs` ג€” explicit dotenv loading from `server/.env` for deterministic token signing in QA runs.
- Validation:
  1. `node --check` passed for all modified auth/bootstrap/integration files.
  2. Full integration suite on isolated local server instance (`PORT=4100`, `PMS_BASE_URL=http://localhost:4100/api/pms`) now passes fully:
     - `PASS=95 FAIL=0 SKIP=0`
  3. This confirms earlier S4.4/S5.4/S5.8 failures were runtime bootstrap/env drift, not API logic regressions.
- Recommended next step:
  1. Stage 5.22: move from baseline stabilization back to UI implementation acceleration (operator-facing PMS flows), with regression smoke run after each milestone.

## Update 2026-05-07 - Stage 5.21.1 Runtime Warnings Cleanup
- `server/models/BulkActionJob.js`:
  1. Removed duplicate `expiresAt` index declaration at field level (kept dedicated TTL index via `schema.index(...)`) to prevent Mongoose duplicate-index warning.
- `server/routes/reservations.js`:
  1. Replaced legacy `{ new: true }` in `findByIdAndUpdate` calls with `{ returnDocument: 'after' }` to align with Mongoose 9 deprecation guidance.
- Validation:
  1. Full suite re-run on port `4000` after cleanup: `PASS=95 FAIL=0 SKIP=0`.
  2. Server boot/output no longer emitted the previous duplicate-index / `new` deprecation warnings during this run.

## Update 2026-05-07 - Stage 5.22 Bulk-Operations UI Handoff
- `client/src/pages/ReservationsPage.jsx`:
  1. Added direct operator entrypoint button to Bulk jobs screen (`/pms/bulk-jobs`) from Reservations header.
  2. Added contextual CTA during running background bulk jobs: "פתח בעבודות Bulk" with `jobId` handoff.
  3. Added contextual CTA in bulk result summary (when result came from background job) to jump to the exact job details.
- `client/src/pages/BulkJobsPage.jsx`:
  1. Added query-param focus flow (`?jobId=...`) for cross-screen handoff from Reservations.
  2. Matching job row now auto-expands and is visually highlighted.
  3. Added focus chip in header with quick clear action.
  4. Added warning banner when focused job is not present under current filters/page + quick filter reset.
- Validation:
  1. `npm --prefix client run build` passed.

## Update 2026-05-07 - Stage 5.22.1 Bulk Retry Failed + Action Guard
- `client/src/pages/BulkJobsPage.jsx`:
  1. Added `Retry Failed` job action for failed bulk jobs (only shown when job has failed items).
  2. `Retry Failed` now fetches detailed job results and re-enqueues only failed reservation IDs.
  3. Shared retry payload creation via `buildRetryPayload(...)` to keep retry/retry-failed behavior consistent.
  4. Added per-job busy guard in row actions:
     - disables `Cancel` / `Retry` / `Retry Failed` while request is in-flight
     - shows spinner on `Retry` during processing
  5. Wired row busy state from page-level `actionBusy` set to prevent duplicate clicks/race actions.
- Validation:
  1. `npm --prefix client run build` passed.

## Update 2026-05-07 - Stage 5.22.2 Focused Job Live View (Cross-Page/Filter)
- `client/src/pages/BulkJobsPage.jsx`:
  1. Added dedicated focused-job loading flow by `jobId` (`fetchFocusedJob`) via `GET /bulk-actions/jobs/:jobId` even when the job is not in current page/filter set.
  2. Added red error banner when focused job fetch fails.
  3. Added focused-job detached card view: if focused job is outside current table page/filters, it is still rendered in a standalone highlighted table section.
  4. Upgraded refresh flow with `refreshAll(...)` so manual refresh and retry refresh both list + focused job together.
  5. Extended polling logic to keep polling when either:
     - any visible table job is active
     - focused detached job is active
  6. Updated active counter to include detached focused job without double-counting.
  7. Focus highlight/auto-expand in the main table now keys off `focusInTable` (only when focused job is actually inside current page rows).
- Validation:
  1. `npm --prefix client run build` passed.

## Update 2026-05-07 - Stage 5.22.3 Focused Job Auto-Jump to Correct Page
- Backend (`server/routes/reservations.js`):
  1. Extended `GET /api/reservations/bulk-actions/jobs` with optional `focusJobId`.
  2. Added `focus` metadata in response:
     - `jobId`, `notFound`, `matchesFilters`, `inPage`, `page`
  3. When focused job matches active filters but is outside current pagination page, server computes target page and returns it for UI jump.
- Frontend API (`client/src/utils/api.js`):
  1. `reservations.bulkJobsList(...)` now forwards optional `focusJobId` query param.
- Bulk Jobs UI (`client/src/pages/BulkJobsPage.jsx`):
  1. `fetchJobs(...)` now requests list with `focusJobId`.
  2. Added automatic page sync: if server returns `focus.matchesFilters=true` and `inPage=false`, UI updates `filters.page` to `focus.page` automatically.
  3. Existing detached focused-job fallback remains for cases where focused job does not match current filters or cannot be resolved.
- Validation:
  1. `node --check server/routes/reservations.js` passed.
  2. `npm --prefix client run build` passed.
