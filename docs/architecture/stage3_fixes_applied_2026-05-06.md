# Stage 3 Fixes Applied (2026-05-06)

## Scope
- Apply critical preflight fixes directly in reservations backend code.
- Apply two high-priority hardening fixes (search/pagination consistency, property-timezone date defaults).

## Fixed
1. Folio enum mismatch in `add-service`
- Before: `POST /reservations/:id/add-service` pushed `type: "service"` while Folio enum did not include `service`.
- After: route now pushes `type: "charge"` with `department` preserving service classification.
- Result: avoids Mongoose enum validation failure on save.

2. Multi-room `totalAmount` calculation in reservation modify flow
- Before: modify path used `rate * nights`, ignoring `roomsCount`.
- After: modify path uses `rate * nights * roomsCount` in both:
  - date/type change path
  - rate-only change path
- Result: pricing stays aligned with create flow and multi-room billing.

3. Availability check in modify flow now validates required room count
- Before: `modifyReservation()` called `checkAvailability()` without `requiredRooms`.
- After: passes `requiredRooms: Math.max(1, Number(res.roomsCount) || 1)`.
- Result: prevents false-positive availability for multi-room updates.

4. `GET /reservations` search/pagination consistency
- Before: extra `q` filtering happened in-memory after `skip/limit`, causing incorrect `total` and hidden matches across pages.
- After:
  - search term is fully pushed into DB filter (`confirmationNumber`, `channelReservationId`, `externalId`, and matched `primaryGuest` IDs by guest fields),
  - `total`, `data`, and pagination now use the same filter.
- Result: stable page results and correct totals.

5. Property-timezone aware "today" for key reservations operations
- Added timezone helpers in `server/utils/dateHelpers.js`:
  - `ymdInTimezone(dateValue, timezone)`
  - `todayYmdInTimezone(timezone)`
- Replaced UTC-based defaults with property-timezone defaults in:
  - check-in arrival guard
  - checkout housekeeping task date
  - cancellation fee service date
  - no-show fee service date
  - upgrade segment `fromDate`
  - add-service default `serviceDate`

6. No-show transition guard after cancellation
- Before: `POST /reservations/:id/no-show` could still succeed after a reservation was already cancelled.
- After:
  - service-level guard in `markNoShow()` allows no-show only from: `confirmed`, `modified`, `pending_payment`, `hold`.
  - route-level pre-check returns structured JSON `409` for invalid status transitions.
- Result: prevents invalid state transitions and inventory side-effects after cancellation.

## Files Changed
- `server/routes/reservations.js`
- `server/services/reservationService.js`
- `server/utils/dateHelpers.js`

## Validation Run
- `node --check server/routes/reservations.js` -> OK
- `node --check server/services/reservationService.js` -> OK
- `node --check server/utils/dateHelpers.js` -> OK
- Isolated runtime validation on local server (`PORT=4010`) with generated valid actor token:
  - Read mode: `PASS=3 FAIL=0 SKIP=0`
  - Write mode: `PASS=7 FAIL=0 SKIP=1`
  - `WRITE-005-ADD-SERVICE-KNOWN-BUG` intentionally skipped because `INCLUDE_KNOWN_BUG_CASES=0`.
 - Follow-up validation with known-bug probe enabled (`INCLUDE_KNOWN_BUG_CASES=1`):
  - Write mode: `PASS=8 FAIL=0 SKIP=0`
  - `WRITE-005-ADD-SERVICE-KNOWN-BUG` returned `201` (service add succeeded without enum failure).

## Remaining Notes
- One non-critical UTC conversion remains in `reservationService` when generating per-night folio lines from reservation date range (`cur.toISOString().split('T')[0]`), which is derived from stay dates rather than "today".
- Main runtime verification now completed successfully in both read and write smoke modes.
