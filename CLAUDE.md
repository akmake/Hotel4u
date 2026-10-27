# hotel4u — CLAUDE.md (short)

Hotel PMS. Full codebase index (models, routes, services, feature notes by date): **docs/codebase-index.md** — read only the section you need (grep it), never the whole file.

## Stack & run
Node ESM + Express + MongoDB/Mongoose, React + Vite client (`client/`), Socket.IO, node-cron. JWT auth (cookie / Bearer).
```
server/: npm run dev (nodemon) · npm run dev:safe (DISABLE_WHATSAPP=1) · npm run seed / seed:big
client/: npm run dev (vite :5173, proxies /api + /socket.io to :4000)
```
Seed login: `admin@galil.co.il` / `hotel4u123`. Server :4000.

## Rules that matter
- PMS API is `/api/pms/*` (attachActor + requireActor). Every query is scoped by `property`. Role checks via `requireRoles`.
- Dates of stays are `YYYY-MM-DD` strings; timestamps are Date. Business date = `businessDateOf(property)`.
- State changes are audited (`auditService.audit`), which also emits live updates (`pms:change`, client `useLiveRefresh`).
- ESM only, no `require()`. Errors via `httpError` / `AppError`.
- **Invoices/receipts are issued by the separate invoicer system (`../invoicer`) over its API only** — never extend the legacy in-app document stack. `LEGACY_LOCAL_DOCUMENTS=1` never in production.
- Payment gateway is `mock` only (refuses in production) — a real clearing provider is not chosen yet.
- Client UI kit: `client/src/components/kit` + `kit.css`. Availability calendar styles: `.ac-*`.

## QA (one nearest suite per change; most need the live server + same DB)
`npm run qa:frontdesk | qa:departures | qa:ops | qa:finance | qa:booking | qa:stay | qa:books | qa:groups | qa:invoicer | qa:identity | qa:platform` (in `server/`).

## Where things are (sections in docs/codebase-index.md)
Front desk / arrivals / check-in → "frontdesk.js". Availability, room blocks, monthly board → "Availability + room blocks" (+ `services/availabilityBoardService.js`, docs/product/monthly-availability-board.md). Setup → "Hotel setup". Prices → "Price engine". Kitchen / housekeeping reports, MFA, live updates → "Basics batch". Public booking `/book` → "Public booking site". Charge codes, day close, reversals → "Charge codes". Invoicer → "Invoicing lives in a separate system". Models / legacy routes / services → their INDEX sections.
