# BUILT.md — PMS Frontend Implementation Log

> Every screen, component, and design decision documented here.
> Reference this before touching any PMS page.

---

## Design System

### Tokens

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1a1c1c` | Body text |
| `--ink-soft` | `#63635f` | Secondary text, labels |
| `--accent` | `#4d6054` | Primary green — buttons, KPI values, icons |
| `--accent-mid` | `#65796c` | Secondary green — mint button |
| `--accent-soft` | `#384b40` | Dark green — hover states |
| `--accent-bg` | `#d2e8d8` | Light green — chip bg, avatar bg, pill ok |
| `--border` | `rgba(195,200,194,0.4)` | Card borders, dividers |
| `--card-bg` | `rgba(255,252,247,0.72)` | Card background with glassmorphism |
| `--page-bg` | `#f3f4f3` | Page background |
| `--danger` | `#ba1a1a` | Error, critical alerts |
| `--danger-bg` | `#ffdad6` | Danger pill / alert bg |
| `--warn-bg` | `#fff3cd` | Warning alert bg |

### Typography

| Role | Font | Usage |
|---|---|---|
| Display | EB Garamond (Google Fonts) | Page titles, KPI values, card headings |
| Body/Numbers | Manrope (Google Fonts) | Everything else |

### Component Classes (pd- prefix)

All Dashboard components use `pd-*` BEM-like classes in `DashboardPage.css`.
This CSS file is **self-contained** — it does not rely on Tailwind tokens.
Other PMS pages should migrate to Tailwind tokens for consistency (future work).

---

## Pages Implemented

### 1. DashboardPage (`/pms/`)

**File:** `client/src/pages/DashboardPage.jsx`
**CSS:** `client/src/pages/DashboardPage.css`
**Status:** ✅ Built — v2 (May 2026)

#### Layout Sections (top to bottom)

```
┌─────────────────────────────────────────────────────────────┐
│  TOPBAR: Property title + date + live dot + refresh + clock  │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────┤
│ OCC% │ ADR  │RevPAR│ Rev  │Arriv │Depart│In-Hse│ Mainten.  │
│ KPI  │ KPI  │ KPI  │ KPI  │ KPI  │ KPI  │ KPI  │  KPI      │
├──────┴──────┴──────┴──────┴──────┴──────┴──────┴───────────┤
│  QUICK ACTIONS (horizontal scroll pill buttons)              │
├─────────────────────────────────────────────────────────────┤
│  ALERTS (collapsible, per-alert dismiss)                     │
├─────────────────────────────────┬───────────────────────────┤
│  MAIN COLUMN                    │  SIDE COLUMN              │
│  ┌──────────────────────────┐   │  ┌─────────────────────┐  │
│  │ Room Mix Bar             │   │  │ Housekeeping Status  │  │
│  └──────────────────────────┘   │  └─────────────────────┘  │
│  ┌─────────────┬────────────┐   │  ┌─────────────────────┐  │
│  │ Arrivals    │ Departures │   │  │ Maintenance Count   │  │
│  │ [with tabs] │            │   │  └─────────────────────┘  │
│  └─────────────┴────────────┘   │  ┌─────────────────────┐  │
│  ┌──────────────────────────┐   │  │ 7-Day Occ Chart     │  │
│  │ In-House Table           │   │  └─────────────────────┘  │
│  └──────────────────────────┘   │  ┌─────────────────────┐  │
│                                 │  │ 7-Day Forecast Strip│  │
│                                 │  └─────────────────────┘  │
└─────────────────────────────────┴───────────────────────────┘
```

#### KPI Tiles (8 total, 4×2 grid)

| # | Label | Value Source | Variant | Route |
|---|---|---|---|---|
| 1 | תפוסה | `s.occupancy` | accent (green bg) | `/pms/reservations` |
| 2 | ADR | `todayRevenue / arrivals.length` | default | `/pms/rates` |
| 3 | RevPAR | `todayRevenue / s.totalRooms` | default | `/pms/reports` |
| 4 | הכנסות היום | `todayDaily.revenue` | default | `/pms/reports` |
| 5 | הגעות | `arrivals.length` + `checkedInToday` | default + progress bar | `/pms/check-in` |
| 6 | יציאות | `departures.length` + `checkedOutToday` | default + progress bar | `/pms/check-out` |
| 7 | אורחים בבית | `s.inHouse` + VIP count | default | `/pms/reservations` |
| 8 | תחזוקה | `s.maintenanceOpen` | warn (red tint) if > 0 | `/pms/maintenance` |

**KPI variants:**
- `default` — white card, green icon bg, green value text
- `accent` — dark green gradient bg (used for occupancy hero tile)
- `warn` — light red tint bg, red icon, red value (maintenance when issues exist)

**Progress bar:** thin 3px bar at bottom of arrival/departure tiles, shows % of check-ins/check-outs completed for today.

#### Alert System

Three severity levels, each with distinct colors:

| Severity | Icon | Border/BG | Icon colors |
|---|---|---|---|
| `danger` | AlertCircle | Red tint `rgba(186,26,26,0.25)` | `#ba1a1a` on `#ffdad6` |
| `warning` | AlertTriangle | Amber tint `rgba(180,130,0,0.25)` | `#856404` on `#fff3cd` |
| `info` | Info | Muted green `rgba(77,96,84,0.2)` | `#4d6054` on `#d2e8d8` |

Each alert has: dismiss (×) button, "לטיפול" action button that routes to the relevant page.
Dismissed alerts are tracked in local state (`Set<id>`), not persisted.

#### Arrival Filter Tabs

Tabs: **הכל** | **ממתינים** | **בוצע** | **VIP**

- `all` → show all arrivals
- `pending` → `res.status !== 'in_house'`
- `done` → `res.status === 'in_house'`
- `vip` → `res.isVip || res.primaryGuest?.vipLevel > 0`

VIP tab shows count badge when VIP guests exist.
Done rows are rendered with 0.68 opacity + greyed avatar + "צ'ק-אין ✓" badge.

The chip next to the card header shows `X/Y` format (e.g., `3/8`).

#### Quick Actions (6 pills)

Primary (dark green): Check-in, Check-out, New Reservation
Secondary (light gray): Tape Chart, Reservations, Housekeeping

Horizontal scroll on mobile, no wrap.

#### Data Sources

| Data | API Call | State key |
|---|---|---|
| KPIs | `dashboard.stats(propertyId)` | `statsRaw` |
| Alerts | `dashboard.alerts(propertyId)` | `alertsRaw` |
| Arrivals list | `dashboard.arrivals(propertyId)` | `arrData` |
| Departures list | `dashboard.departures(propertyId)` | `depData` |
| In-house list | `dashboard.inhouse(propertyId)` | `inHouseData` |
| 7-day history | `reports.summary(propertyId, -6d, today)` | `reportRaw` |
| 7-day forecast | `reports.summary(propertyId, today, +8d)` | `forecastRaw` |

Auto-refresh: every 3 minutes (`180_000ms` interval on `refreshKey`).

#### Computed Values

```js
checkedInToday  = arrivals.filter(r => r.status === 'in_house').length
checkedOutToday = departures.filter(r => r.status === 'checked_out').length
vipInHouse      = inhouse.filter(r => r.isVip || r.primaryGuest?.vipLevel > 0).length
adr             = todayRevenue / arrivals.length  (fallback: s.adr)
revpar          = todayRevenue / s.totalRooms     (fallback: s.revpar)
hkPct           = hkCompleted / hkTotal * 100
```

#### Side Column Components

**Housekeeping card** — 4-metric grid: פתוח / בביצוע / הושלם / דחוף
- Urgent metric gets red tint if `s.hkUrgent > 0`
- Chip in header shows `{hkPct}% הושלם`

**Maintenance card** — large number display
- Number turns red (`has-issues` class) when `s.maintenanceOpen > 0`

**OccupancyChart** — Recharts `BarChart`, 7-day history
- Today's bar: `#4d6054` (dark green), other bars: `#b6ccbd` (muted)
- Tooltip in Hebrew

**ForecastStrip** — 7-day forward grid
- Today tile: dark green background
- Shows: weekday, day number, occupancy %, arrivals (+N), departures (-N)

#### Responsive Breakpoints

| Breakpoint | Change |
|---|---|
| `>1200px` | 2-column grid (main + side) |
| `≤1200px` | 1-column, side on top, side becomes 2-col grid |
| `≤960px` | Full single column stack, 4-col KPIs |
| `≤640px` | 2-col KPIs, 2-col side metrics, 4-col forecast |

---

## Spec Reference

Full product specification: `PMS_PRODUCT_SPEC.md` (at project root)
Covers: all 11 modules with wireframes, state machines, business rules, edge cases.

---

## PMS Pages — Build Status

| Page | Route | Status | Notes |
|---|---|---|---|
| Dashboard | `/pms/` | ✅ Built v2 | 8 KPIs, arrival tabs, alert severity |
| Tape Chart | `/pms/tape-chart` | 🟡 Exists, needs visual overhaul | User likes the features, not the design |
| Reservations | `/pms/reservations` | 🔴 Needs rebuild | |
| Reservation Detail | `/pms/reservations/:id` | 🔴 Needs rebuild | |
| Check-In | `/pms/check-in` | 🔴 Needs rebuild | |
| Check-Out | `/pms/check-out` | 🔴 Needs rebuild | |
| Folio | `/pms/folio` | 🔴 Needs rebuild | |
| Invoices | `/pms/invoices` | 🔴 Needs rebuild | |
| Guests | `/pms/guests` | 🔴 Needs rebuild | |
| Rooms | `/pms/rooms` | 🔴 Needs rebuild | |
| Housekeeping | `/pms/housekeeping` | 🔴 Needs rebuild | |
| Maintenance | `/pms/maintenance` | 🔴 Needs rebuild | |
| Companies | `/pms/companies` | 🔴 Needs rebuild | |
| Reports | `/pms/reports` | 🔴 Needs rebuild | |
| Night Audit | `/pms/night-audit` | 🔴 Needs rebuild | |
| Rates | `/pms/rates` | 🔴 Needs rebuild | |
| Room Rack | `/pms/room-rack` | 🔴 Placeholder | |

---

## Architecture Decisions

### Two-System Architecture (Intentional)
- **Ziporiclass** (`/`, `/admin/*`) — legacy sales system. Beloved by sales team. DO NOT touch.
- **PMS** (`/pms/*`) — new hotel management system. Frontend being rebuilt.
- Goal: make PMS good enough that Ziporiclass becomes redundant over time.

### Auth Flow
- PMS routes guarded by `PmsRoleGuard` in `App.jsx`
- Auth via `middleware/authContext.js` → `attachActor` + `requireActor`
- Token in HttpOnly cookie

### CSS Strategy
- DashboardPage uses custom `pd-*` CSS classes (historical)
- All new PMS pages should use **Tailwind tokens only** (no custom CSS files)
- Migration path: convert `pd-*` classes to Tailwind inline eventually

### Data Fetching
- Hook: `useApi(fn, deps, skip)` from `client/src/hooks/useApi.js`
- API utils: `client/src/utils/api.js` — exports `{ dashboard, reports, reservations, ... }`

### RTL
- All PMS pages use `dir="rtl"` on root element
- Hebrew as primary language, English for field names/codes where conventional (ADR, RevPAR, VIP, OOO)

---

## Next Build Priority

1. **ReservationsPage** — list view with filters, drawer for detail, status chips
2. **CheckInPage** — step-by-step wizard: guest ID verify → room assign → payment → key
3. **CheckOutPage** — folio review → payment → room status update
4. **TapeChart** — keep all functionality, redesign visuals to match new design system
