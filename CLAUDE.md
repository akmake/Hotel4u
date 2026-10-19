# hotel4u — CLAUDE.md

Full codebase index. Read this before touching any file. Skip the codebase exploration — it's all here.

---

## Stack & Quick Start

| Layer | Tech |
|---|---|
| Runtime | Node.js (ESM, `"type":"module"`) |
| Framework | Express.js |
| Database | MongoDB via Mongoose |
| Auth | JWT (HttpOnly cookie) + bcryptjs |
| Real-time | Socket.io |
| Scheduling | node-cron |
| Email | Nodemailer |
| WhatsApp | @whiskeysockets/baileys |
| Images | Sharp |
| Validation | zod + express-validator |
| File upload | Multer |

```bash
# from server/
npm run dev          # nodemon, includes WhatsApp
npm run dev:safe     # nodemon, DISABLE_WHATSAPP=1, 4GB heap
npm start            # production
npm run seed         # seed small (12 guests, ~70 reservations)
npm run seed:big     # seed large (60 guests, ~240 reservations, 60-day coverage)
```

Login after seed: `admin@galil.co.il` / `hotel4u123`

---

## Folder Map

```
hotel4u/
├── CLAUDE.md                    ← YOU ARE HERE
├── client/                      React + Vite frontend
└── server/
    ├── app.js                   Express entry, route mounting, Socket.io, schedulers
    ├── index.js                 HTTP server (listens on PORT || 4000)
    ├── socket.js                Socket.IO init
    ├── seed.js                  Small seed (12 guests)
    ├── seedBig.js               Big seed (60 guests, dense reservations)
    ├── config/
    │   ├── db.js                connectDB() — Mongoose connect
    │   ├── middlewares.js       configureMiddlewares(app)
    │   └── routes.js            legacy route config
    ├── middleware/               PMS-specific context layer
    │   ├── authContext.js       attachActor / requireActor / assertPropertyScope / requireRoles
    │   ├── errorHandler.js      Global error formatting
    │   └── permissions.js       Role-based permission checks
    ├── middlewares/              Express middleware
    │   ├── authMiddleware.js    requireAuth / requireAdmin / requireShiftManager / requireMaintenance
    │   ├── requireAuth.js       Bearer-or-cookie auth gate
    │   ├── requireRefresh.js    Refresh token validation
    │   ├── errorHandler.js      JSON error response formatter
    │   ├── rateLimiter.js       express-rate-limit (100 req/15 min public)
    │   └── uploadMiddleware.js  Multer config (50MB limit, MIME validation)
    ├── models/                  Mongoose schemas — see MODEL INDEX below
    ├── controllers/             Request handlers — see CONTROLLER INDEX below
    ├── routes/                  Express routers — see ROUTE INDEX below
    ├── services/                Business logic — see SERVICE INDEX below
    ├── utils/
    │   ├── AppError.js          class AppError(message, statusCode)
    │   ├── tokenHandler.js      createAndSendTokens(user, res)
    │   ├── auditLogger.js       logAction(req, action, entity, entityId, description)
    │   ├── validators.js        express-validator chains + handleValidationErrors
    │   ├── dateHelpers.js       todayYmdInTimezone(timezone)
    │   ├── googleSheets.js      Google Sheets API
    │   ├── pushHandler.js       Web Push (web-push)
    │   ├── invoiceTemplate.js   Invoice HTML template
    │   ├── excelParser.js       XLSX parse
    │   └── excelCleaners.js     Bulk import data cleaning
    ├── lib/
    │   ├── priceCalc.js         Price calculations
    │   └── priceCalculator.js   Alternate price calculator
    ├── scripts/                 One-off utility scripts
    │   ├── createAdmin.js
    │   ├── fix_indexes.js
    │   ├── import-script.js
    │   ├── stage3ReservationsSmoke.mjs
    │   └── stage4ReservationsIntegration.mjs
    └── uploads/                 Static file storage (served at /uploads)
```

---

## app.js — Request Flow

```
Incoming request
  → helmet() → cors() → express.json(50mb) → cookieParser()
  → express-mongo-sanitize()
  → /uploads (static)
  → csurf (cookie-based, skip for /api/pms/*)

  /api/pms/*  → attachActor → requireActor → pmsRouter
  /api/*      → apiRouter  (CSRF protected)
  /*          → apiRouter  (fallback)
  → SPA fallback (../client/dist/index.html)
  → errorHandler
```

**On startup**: `initSocket()` → `initScheduler()` → `initPmsScheduler()` → `initWhatsAppListener()` (unless `DISABLE_WHATSAPP=1`)

---

## MODEL INDEX

### Core PMS Models

#### `models/User.js`
Ref key: `User`
```
firstName, lastName, name (String)
email (String, unique)
passwordHash (String)
role (enum): admin | sales | maintenance | shift_manager | super_admin |
  property_admin | general_manager | front_desk_manager | receptionist |
  housekeeping_manager | housekeeper | maintenance_manager | technician |
  finance_manager | cashier | revenue_manager | sales_manager | auditor | owner_readonly
property (ref: Property)
active (Boolean)
lastLoginAt (Date)
canManagePriceLists, canViewCommissions (Boolean)
failedLoginAttempts, lockUntil (security)
tokenVersion (Number)
twoFactorEnabled, totpSecret (2FA)
cart [{ product: ref, quantity }]
Virtual: fullName, isLocked
Methods: comparePassword(), incrementLoginAttempts(), resetLoginAttempts()
```

#### `models/Property.js`
Ref key: `Property`
```
name (String, required), legalName, propertyCode (String)
timezone (default: 'Asia/Jerusalem'), defaultCurrency (default: 'ILS')
address, city, state, postalCode, country, phone, email, website, logoUrl
activeLanguages ([String], default: ['he','en'])
checkInTime (default:'15:00'), checkOutTime (default:'11:00')
totalRooms (Number)
taxNumber, vatRate, invoicePrefix, invoiceSequence
reservationPrefix, reservationSequence
defaultCancellationHours, defaultCancellationFee
cancellationPolicies [{
  code, name, nameEn, freeUntilHours, feePercent, feeFixedAmount
  feeType: none|first_night|percent|fixed
  nonRefundable, active, descriptionHe, descriptionEn
}]
petPolicy: not_allowed|on_request|allowed
smokingPolicy: non_smoking|designated_areas|allowed
buildings [{ code, name, active, floors [{ number, name, wings [{ code, name }] }] }]
housekeepingZones [{ code, name, roomNumbers [String], active }]
taxes, surcharges, paymentMethods (config arrays)
messageTemplates, documentTemplates (template arrays)
crmSla (lead/opportunity thresholds)
requiredGuestFields, requiredCheckInFields, requiredCheckOutFields ([String])
```

#### `models/Room.js`
Ref key: `Room`
```
property (ref: Property), roomType (ref: RoomType)
number (String, unique per property), floor (Number)
building, wing, housekeepingZone, maintenanceArea (String)
opsStatus: available | out_of_order | out_of_service | maintenance_hold | owner_hold | internal_use
outOfServiceUntil (String YYYY-MM-DD)
cleanStatus: clean | dirty | inspected | pickup | turndown_required
occStatus: vacant | occupied | reserved | due_in | due_out | checked_out
isVip, isSmoking, isAccessible (Boolean)
accessibilityFeatures ([String enum])
connectingRoom, preferredAlternateRoom (ref: Room)
internalNotes (String)
lastRenovatedAt (Date), active (Boolean)
Virtual: isSellable
```

#### `models/RoomType.js`
Ref key: `RoomType`
```
property (ref: Property), code (String, unique per property), name (String)
shortDesc, fullDesc (String)
capacityBase, capacityMax, adultsMax, childrenMax (Number)
baseRate (Number)
bedType: king|queen|twin|double|single|bunk|mixed|other
extraBedAllowed, cribAllowed (Boolean)
roomSizeSqm (Number)
view: sea|garden|city|mountain|pool|interior|courtyard|other
amenities, images ([String])
sellable, showInEngine, closedToSale (Boolean)
sellOnChannels, blockOnChannels, allowRatePlans ([String])
overbookingAllowed (Boolean), overbookingLimit (Number)
active (Boolean), sortOrder (Number)
```

#### `models/Reservation.js`
Ref key: `Reservation`
```
property (ref: Property)
confirmationNumber (String, unique)
idempotencyKey (String, unique sparse)
status: draft|quote|hold|pending_payment|confirmed|modified|cancelled|
  waitlisted|no_show|checked_in|in_house|checked_out|
  partially_checked_in|partially_checked_out
primaryGuest (ref: GuestProfile), additionalGuests ([ref: GuestProfile])
adults, children, roomsCount, nights (Number)
arrivalDate, departureDate (String YYYY-MM-DD)
source: direct|booking|expedia|agoda|airbnb|gds|walk_in|corporate|agent|phone
marketSegment (String)
ratePlan (ref: RatePlan), roomType (ref: RoomType), assignedRoom (ref: Room)
ratePerNight, totalAmount, taxAmount, discountAmount, surchargeAmount (Number)
paymentStatus: unpaid|partial|paid|refunded|balance_due
depositAmount, depositPaid (Number), currency (String)
guaranteeType: none|credit_card|deposit|voucher|company_guarantee
confirmationSent, cancellationPolicy, depositPolicy
quoteExpiresAt, holdExpiresAt, holdReleasedAt (Date)
company (ref: Company), travelAgent (ref: Company)
group, groupCode, groupName (String)
isVip, isOverbooking (Boolean)
specialRequests, guestNotes, internalNotes, language (String)
externalId, channelReservationId (String)
checkedInAt, checkedOutAt, cancelledAt, noShowAt (Date)
createdBy, updatedBy (ref: User)
timestamps
```

#### `models/RatePlan.js` — exports `{ RatePlan, RateDate }`
**RatePlan**:
```
property (ref: Property), code (String, unique per property), name (String)
type: public|corporate|package|ota|promo|group
isRefundable, includesBreakfast, halfBoard, fullBoard, allInclusive (Boolean)
cancellationPolicy, depositPolicy (String)
channels, activeRoomTypes ([String/ref])
pricingRules [{
  name, priority, active, weekdays, seasonFrom, seasonTo
  minGuests, maxGuests, minChildren, maxChildren
  minLos, maxLos, minLeadDays, maxLeadDays
  channels, companies, agents, promoCodes, loyaltyTiers
  adjustmentType, adjustmentValue
  childPricePerNight, extraGuestPricePerNight
}]
sortOrder (Number), active (Boolean)
```

**RateDate**:
```
ratePlan (ref: RatePlan), roomType (ref: RoomType)
date (String YYYY-MM-DD, unique with ratePlan+roomType)
price (Number)
minLos, maxLos (Number)
cta, ctd, stopSell (Boolean)
sellLimit, releaseDays, advancePurchaseMinDays, lastMinuteMaxDays (Number)
blackouts [{ fromDate, toDate, reason }]
weekdayAdjustmentPct, occupancy2Price..4Price (Number)
childPricePerNight, extraGuestPricePerNight (Number)
```

#### `models/InventoryDate.js`
```
property (ref: Property), roomType (ref: RoomType)
date (String YYYY-MM-DD, unique compound)
physicalCount, oooCount, bookedCount, tentativeCount, lockedCount (Number)
blockedCount, allotmentCount, releasedAllotmentCount (Number)
overbookingLimit (Number)
stopSell, closedToArrival, closedToDeparture (Boolean)
minLos, maxLos (Number)
Virtual: sellableCount, effectiveAllotment, availableCount
```

#### `models/GuestProfile.js`
```
property (ref: Property)
firstName, lastName (String, required)
email (String, indexed), phone (String)
gender: M|F|other|unknown
country, citizenship, language (default:'he') (String)
address { line1, city, state, zip, country }
dateOfBirth (Date)
idDocType: passport|id_card|drivers_license|other
passportNumber, passportExpiry
title, company, jobTitle (String)
phones, emails, addresses (typed arrays with primary flag)
loyaltyId, membershipTier, membershipPoints (String/Number)
vipLevel (Number 0-5)
isBlacklisted (Boolean), blacklistReason (String)
roomTypePreference, bedTypePreference, floorPreference, smokingPreference
pillow, newspaper, specialRequests, preferences, allergies, internalNotes (String)
notes ([String/Object])
tags ([String])
marketingConsent, marketingConsentAt, marketingConsentIp (GDPR)
privacyConsent, privacyConsentAt, privacyConsentIp, privacyPolicyVersion (GDPR)
retentionDeleteAfter (Date auto-calc: 7yr from lastStay — Israeli law)
totalStays, totalRevenue, noShowCount, cancellationCount (Number)
lastStay (Date)
isAnonymized (Boolean), mergedInto (ref: GuestProfile)
Virtual: fullName
Pre-save: auto-calc retentionDeleteAfter
```

#### `models/Folio.js`
```
property (ref: Property), reservation (ref: Reservation)
ownerType: guest|room|company|group|house
ownerRef (String), status: open|closed|suspended
currency (default:'ILS')
lines [FolioLine]:
  type: charge|payment|refund|adjustment|tax|fee|discount|deposit
  description, department, serviceDate (String YYYY-MM-DD)
  amount, taxAmount (Number)
  postedAt (Date)
  source: pms|pos|manual|channel|routing|night_audit
  status: posted|voided|refunded|adjusted
  reference, createdBy, voidedAt, voidReason
closedAt (Date), closedBy (ref: User)
Virtual: balance, totalCharges, totalPayments
```

#### `models/Payment.js`
```
property (ref: Property), folio (ref: Folio), reservation (ref: Reservation)
folioLineId (ObjectId)
paymentMethod: cash|credit_card|bank_transfer|pay_by_link|voucher|
  loyalty_points|company_account|ota_virtual_card
operation: authorization|capture|sale|refund|void|partial_refund|
  pre_authorization|release_authorization
amount, currency (Number/String)
status: pending|authorized|captured|sale|failed|voided|refunded|partially_refunded
provider, providerReference, correlationId (String)
tokenId, last4, cardBrand, authCode (String)
refundedAmount (Number), parentPaymentId (ref: Payment)
authorizedAt, capturedAt, failedAt, voidedAt, refundedAt (Date)
failureReason, paymentLinkUrl, paymentLinkExpiry (String/Date)
createdBy (ref: User), notes (String)
```

#### `models/Invoice.js`
```
property, folio, reservation (refs)
type: tax_invoice|tax_invoice_receipt|receipt|proforma|credit_note|debit_note
invoiceNumber (String, unique)
status: draft|issued|cancelled|pending_allocation
issueDate, taxDate, serviceDate (String YYYY-MM-DD)
seller, buyer (PartySchema: name, legalName, vatNumber, idNumber, address, city, country, phone, email)
lines [InvoiceLine]:
  description, quantity, unitPrice, discountPct
  netAmount, vatRate, vatAmount, grossAmount
  serviceDate, department, folioLineId
currency, totalNet, totalVat, totalGross, totalDiscount (Number)
vatRate (Number, default:18)
payments [{ method, amount, reference, paidAt }]
amountPaid, balance (Number)
allocationNumber (Israeli e-invoice), allocationRequestedAt, allocationReceivedAt
relatedInvoiceId, creditedBy (ObjectId/[ObjectId])
issuedBy (ref: User), issuedAt (Date)
Pre-save: lock issued invoices from modification
```

#### `models/Company.js`
```
property (ref: Property)
name (String), type: corporate|agency|tour_operator|government
contactName, contactTitle, email, phone, address, taxId (String)
creditLimit, discountPct (Number 0-100)
paymentTerms, currency (String)
contractNumber, contractStartDate, contractEndDate (String)
contractDocuments [{ name, url, uploadedAt }]
agentCode, commissionPct, rateCodes (String/Number/[String])
notes (String), active (Boolean)
```

#### `models/HousekeepingTask.js`
```
property (ref: Property), room (ref: Room), reservation (ref: Reservation)
type: checkout_clean|stayover|deep_clean|turndown|pickup|arrival_prep
priority: urgent|high|medium|low
status: new|assigned|in_progress|paused|completed|failed_inspection|inspected|cancelled
date (String YYYY-MM-DD), dueTime (String HH:MM)
assignedTo (ref: User), assignedAt, startedAt, completedAt, pausedAt (Date)
pauseReason, cancelReason (String)
inspectedBy (ref: User), inspectedAt (Date)
notes, inspectionNotes (String)
supplies [{ item, qty }]
photos ([String URL])
isDND, isNoService (Boolean)
lostFound [{ itemDescription, foundLocation, reportedBy, status, reportedAt }]
  status: found|claimed|donated|discarded
issueReported { description, reportedAt, ticketId }
autoCreated (Boolean)
```

#### `models/MaintenanceTicket.js`
```
property (ref: Property), room (ref: Room)
areaId (String)
category: electricity|water|hvac|furniture|cleaning|safety|lock|internet|tv|noise|other
description (String)
priority: critical|high|medium|low
status: new|assigned|in_progress|waiting_parts|waiting_vendor|
  resolved|verified|closed|reopened
reportedBy, assignedTo (ref: User)
vendor { name, phone, email }, vendorContact (String)
estimatedCost, actualCost (Number)
dueDate, startedAt, resolvedAt (Date)
photos [{ url, caption, uploadedBy, uploadedAt }]
partsNeeded [{ name, quantity, ordered, orderedAt, notes }]
notes, internalNotes (String/[NoteSchema])
blocksRoom, slaBreach (Boolean)
closingApprovedBy (ref: User), closingApprovedAt (Date)
```

#### `models/GuestRequest.js`
```
property, reservation, room, guest (refs)
category: towels|cleaning|maintenance|food|transport|complaint|
  amenities|noise|temperature|general
description (String)
priority: low|medium|high|urgent
status: open|assigned|in_progress|resolved|closed|cancelled
assignedTo (ref: User), assignedAt (Date)
department (String)
slaMinutes (Number, default:30), dueAt (Date auto-set)
resolvedAt, closedAt (Date)
resolutionNotes (String)
guestNotified (Boolean), guestNotifiedAt (Date)
satisfactionScore (Number 1-5)
createdBy, updatedBy (ref: User)
Virtual: isOverdue
```

#### `models/AutomationRule.js`
```
property (ref: Property), name (String, max 120), description, active
trigger: reservation.created|reservation.modified|reservation.cancelled|
  reservation.noshow|checkin.completed|checkout.completed|room.status_changed|
  payment.failed|payment.succeeded|housekeeping.completed|maintenance.created|
  maintenance.sla_breach|schedule.daily|schedule.hourly
conditions [{ field, operator (eq|ne|gt|lt|gte|lte|in|nin|contains), value }]
action: send_message|send_confirmation|create_housekeeping_task|
  create_maintenance_ticket|post_charge|send_payment_link|create_alert|
  update_room_status|update_reservation|webhook|notify_staff
actionParams (Mixed)
exceptions ([ConditionSchema])
lastRunAt (Date), runCount (Number), lastError (String)
owner, createdBy (ref: User)
```

#### `models/Notification.js`
```
property (ref: Property), recipientUser (ref: User), recipientRole (String)
type (enum of reservation.*|housekeeping.*|maintenance.*|folio.*|
  inventory.*|system.*|automation.*|webhook.*|group.*)
priority: low|normal|high|critical
channel: in_app|email|sms|push
title, body (String)
entityType, entityId, link (String)
read (Boolean), readAt (Date), dismissed (Boolean)
expiresAt (Date, TTL index)
createdBy (ref: User), timestamps
```

#### `models/AuditLog.js`
```
property (ref: Property), entity, entityId (String/ObjectId)
actor (ref: User), actorName, actorRole (String)
action (String: CREATE|UPDATE|DELETE|CHECK_IN|CHECK_OUT|CANCEL|...)
changesBefore, changesAfter (Object)
timestamp (Date, indexed), ipAddress, userAgent (String)
```

### CRM Models (`models/crm/`)

#### `models/crm/CrmLead.js`
```
property (ref: Property)
account (ref: CrmAccount), contact (ref: CrmContact)
fullName, email, phone, companyName, title (String)
source: website_form|import|manual|referral|event|partner|ad|api|other
status: new|working|qualified|disqualified|converted|lost
score { fit, engagement, intent, negative, total } (Number)
owner (ref: User), assignedTeam (String)
nextActionAt, lastActivityAt (Date)
lostReason (String)
convertedOpportunity (ref: CrmOpportunity), convertedAt (Date)
notes, sourceSystem, externalId (String)
tags ([String]), customFields (Map)
active (Boolean)
```

Also in `models/crm/`:  `CrmAccount`, `CrmActivity`, `CrmContact`, `CrmOpportunity`, `CrmPipeline`, `CrmTask`, `CrmTimelineEvent`, `CrmLeadRoutingRule`

### Legacy Models

#### `models/Booking.js` (Ziporiclass legacy)
```
hotel, room (refs), roomNumber, guestName, guestPhone, optimaNumber (String)
arrivalDate, departureDate (Date, indexed)
pax, babies (Number)
status: active|cancelled|manual_fix
source: excel|manual
notes (String)
```

#### `models/Hotel.js` (legacy)
```
name (String)
checklists { departure, stayover, arrival } (each: [{ text, order }])
```

### Other Models (quick reference)

| Model | Purpose |
|---|---|
| `Order.js` | Ziporiclass event/room orders, full order lifecycle |
| `PriceList.js` | Ziporiclass price lists with room configs |
| `Product.js` | Product catalog (name, price, stock, SKU) |
| `BulkActionJob.js` | Async bulk operations (checkin/checkout batches) |
| `InventoryLock.js` | Pessimistic lock for availability |
| `FolioRoutingRule.js` | Auto-routing charges to company/group folios |
| `StaySegment.js` | Multi-room stay management |
| `WebhookSubscription.js` | OTA webhook registrations |
| `Message.js` | Internal staff messages |
| `WhatsAppMessage.js` | Baileys WhatsApp message log |
| `InboundEmail.js` | Inbound email parsing |
| `Announcement.js` | Property-wide announcements |
| `AutoReply.js` | WhatsApp auto-reply rules |
| `AutoReplyLog.js` | Auto-reply execution log |
| `LeadTrigger.js` | Ziporiclass lead trigger rules |
| `Counter.js` | Sequence counters (invoice/reservation numbers) |
| `CommissionHistory.js` | Agent commission history |
| `CommissionReport.js` | Commission aggregation reports |
| `CustomerCard.js` | Loyalty customer cards |
| `Subscription.js` | Product subscriptions |
| `MerchantMap.js` | Payment provider merchant mapping |
| `IntegrationLog.js` | OTA integration sync log |
| `ChannelUpdateQueue.js` | Queued rate/inventory updates to OTAs |
| `GuestRegistrationCard.js` | Physical check-in registration cards |

---

## ROUTE INDEX

All PMS routes are under `/api/pms/*` and require `attachActor` + `requireActor`.
All legacy routes are under `/api/*` and use JWT cookie auth.

### PMS Routes (`routes/pms/` → `/api/pms`)

#### `reservations.js` → `/api/pms/reservations`
```
POST   /                        Create reservation (availability check included)
GET    /                        List (filters: date, status, guest, source, roomType)
GET    /:id                     Single reservation with populated refs
PATCH  /:id                     Modify (dates, guests, rate, room, notes)
POST   /:id/check-in            Check in — sets status:'in_house', checkedInAt
POST   /:id/check-out           Check out — balances folio, sets checkedOutAt
POST   /:id/cancel              Cancel with reason & refund calculation
POST   /:id/mark-no-show        Mark no-show
POST   /:id/send-confirmation   Email confirmation to guest
POST   /bulk                    Bulk action (check-in / cancel / assign-room)
GET    /bulk/:jobId             Track BulkActionJob progress
```

#### `frontdesk.js` → `/api/pms/frontdesk` (spec W03 — see docs/product/spec-implementation-plan.md)
```
GET    /arrivals                       FD-02 rows per stay unit + server readiness reasons (date, q, roomTypeId, assignment, readiness, includeCheckedIn, sort, page)
GET    /reservations/:id/check-in      FD-03 wizard context (units, guarantee, registration, policy)
POST   /reservations/:id/registration  FD-05 registration card (no ID number in audit)
POST   /reservations/:id/check-in      FD-03 complete (unitIds, guarantee, override{enabled,reason}) — full server re-check
GET    /reservations/:id/room-candidates  INV-02 rooms free for every night
POST   /reservations/:id/assign-room   INV-02 assign (reason required when replacing; 409 on conflict)
PATCH  /reservations/:id/eta           expected arrival time
POST   /reservations/:id/no-show       RSV-07 from arrivals (single-room, arrival day only)
GET    /staff                          owner picker (name + role only)
GET|POST /queue, POST /queue/:id/take|prioritize|remove, PATCH /queue/:id   FD-04 waiting queue
```
Service: `services/frontDeskService.js`. Model: `models/ArrivalQueueEntry.js`. Policy: `Property.checkInPolicy`.
QA: `npm run qa:frontdesk` (live server + same DB; cleans up after itself).

#### Availability + room blocks (INV-01 / INV-04, 2026-10-19)
`availabilityService.assessAvailability` computes each night from real data: rooms of the type not out of sale that
night (current opsStatus until `outOfServiceUntil`, or a dated `RoomBlock`) − stays sold as the type − rooms of the type
held by other-type stays − booking locks − manual holds. **No InventoryDate row is required** (rows only add stop sell,
CTA/CTD, min/max stay, overbooking, allotment). `checkAvailability` / `nightlyAvailability` / `roomsFreeForStay` use it;
`frontDeskService.conflictingRoomIds` treats a dated block as a conflict (assignment, moves).
```
GET  /api/pms/ops/availability?from&days      grid: room types × nights + totals + blocks   → screen /pms/availability
GET  /api/pms/ops/room-blocks, POST /ops/rooms/:id/blocks {from,to,kind,reason,confirmOversell}, POST /ops/room-blocks/:id/release {reason}
```
Service `services/roomBlockService.js`, model `models/RoomBlock.js` ([from,to) nights; refused while a stay is assigned to
the room; 409 `oversell` unless confirmed).

#### Hotel setup (ADM-01/02/03, 2026-10-19) — screen `/pms/admin/setup`
```
GET  /api/pms/setup                 property + room types (with room counts) + rooms + readiness checklist
PATCH /setup/property               validated (tax ID check digit, HH:MM, e-mail), audited before/after
POST /setup/room-types, PATCH /setup/room-types/:id   code unique per property; deactivate refused with active rooms / open stays
POST /setup/rooms {roomTypeId, floor, numbers:"101-110, 115, A1-A3"}   bulk, refuses existing numbers
PATCH /setup/rooms/:id              number/floor/type/flags/active; type change or deactivation refused while stays are assigned
```
Service `services/setupService.js`. Old `/properties/room-types` PATCH/DELETE now check property scope.

#### Price engine (2026-10-19) — `services/ratePricing.js priceNight()`
One engine for booking (`bookingService.offersFor`, `priceNights` for stay changes) and the legacy `/rates/quote`:
RateDate row for the night, else **RoomType.baseRate** (no pre-made rows needed) → row occupancy/weekday adjustments →
the plan's `pricingRules` (season/holiday dates, weekdays, guests, LOS, lead days, channel, company) by priority →
child price × children, extra-adult price × adults above `capacityBase`.
Derived rates: `RatePlan.derived {from, pct}` — a night without its own row = parent's price that night ± pct (set in the
rate-plan dialog; one level only). Main property: VIP −15%, CORP −12%, OTA −5% from BAR (taken from the existing calendar). Old `/api/pms/rooms` POST/PATCH/DELETE → 410.

#### More of 2026-10-19
- Pricing rule `appliesTo: 'all'|'base'` — 'base' rules apply only to nights with no calendar row (BAR has Fri/Sat +30% this way).
- Room chart `/pms/tape-chart` (new, `services/roomChartService.js`, `GET /ops/room-chart`): stays on rooms → reservation
  file, empty night → new booking for that room, dated blocks, unassigned count per type. `/pms/room-rack` → room status.
- Guests (`routes/guests.js`): merge moves every reference (reservations, units, cards, requests, messages, lost items,
  folios); anonymize blocked by any open stay and clears all personal fields; edits audited; blacklist needs a reason.
- Automatic day close: `Property.dayClose.auto {enabled,time,arrivals}`, `PUT /finance/day-close/auto`, scheduler every
  5 min (`autoDayCloseTick`) closes days before today; open departures stop it and raise an urgent work item.
- Booking confirmation e-mail: `services/confirmationService.js` — sent automatically on create (when mail is configured
  and the guest has an e-mail), again from the reservation file; marked sent only after the mail server accepted it.

#### Basics batch (2026-10-19, later)
- Kitchen report `GET /ops/meals?from&days` → `/pms/meals` (breakfast after a night, dinner every HB/FB night, lunch FB inner
  days): adults/children/infants (childAges vs boardPricing.infantMaxAge), hold/pending_payment apart as tentative, early
  check-out stops on the day left, by board, groups, guests with allergies/requests/VIP. Roles BOARD_READ (names + allergies).
- Hotel status for housekeeping `GET /ops/hk-overview?date&days` → `/pms/housekeeping/status` (`services/hkOverviewService.js`):
  per room departure (left / still in) · arrival (ETA, VIP, waiting at desk) · stayover, server priority 1–8 (rules listed on the
  screen), arrivals without a room vs clean rooms of the type (shortage), 7-day forecast. No guest names (OPS-01-F05).
  Both reports skip bookings whose arrival day passed without check-in and report them as `staleArrivals`.
- Printable ops reports `/pms/ops-reports?r=` (`pages/ops/OpsReportsPage.jsx`, print A4 + Excel from the same table spec):
  kitchen-daily · kitchen-forecast · dining-list (`GET /ops/reports/dining-list?date`, per room, heads split over units) ·
  dietary · groups · hk-sheets (`GET /ops/reports/hk-sheets?date&floor`, one page per housekeeper in priority order) ·
  hk-movement · hk-staffing (minutes per checkout/stayover/arrival + shift hours → housekeepers needed).
- Room chart drag → `components/stay/DragMoveDialog` (in-house = FD-09 move, future = assignment).
- Ticket photos `POST /ops/tickets/:id/photos` (multipart `photo`, sharp re-encode, `uploads/tickets/<random>.jpg`).
- Preventive maintenance `models/PreventivePlan.js`, `services/preventiveService.js`, `/ops/preventive*`, cron 06:00,
  screen `/pms/maintenance/preventive`; tickets carry `preventive {plan, due}` (no duplicates).
- Company receivables `services/receivablesService.js`, `GET /finance/receivables`, `POST /finance/receivables/:companyId/payments`
  (FIFO or explicit allocation, each part via recordFolioPayment) → `/pms/fin/receivables`.
- Two-factor (TOTP, `utils/totp.js`, `services/mfaService.js`): `/api/auth/login` returns `{mfaRequired, mfaTicket}` when on,
  `POST /api/auth/mfa {ticket, code}` finishes; `/identity/me/mfa/*`, admin `POST /identity/users/:id/mfa/reset`.
  Secrets sealed with `utils/secretBox` (key from TAX_TOKEN_KEY / JWT secret — rotating it voids enrolled secrets).
- Live updates: Socket.IO namespace `/pms` (PMS token, room `property:<id>`); `auditService.audit` emits
  `pms:change {entity, action}`; client `hooks/useLiveRefresh(propertyId, entities, reload)`; vite proxies `/socket.io`.

#### Public booking site (2026-10-19) — `/book` (client `pages/book/*`, own look in `book.css`)
```
GET  /api/public/booking/site?p=        hotel + room types (content, capacity, photos) + payment mode  (no login, rate-limited)
GET  /api/public/booking/search?p&arrival&departure&adults&children&childAges   rooms → offers (rate × board), full price
POST /api/public/booking/start          guest + consent → HOLD (Property.onlineBooking.holdMinutes) + OnlinePayment session → redirectUrl
GET  /session/:token, POST /session/:token/complete | retry | mock-pay     (token = guest capability)
GET|PUT /api/pms/setup/online-booking   on/off, payment full|deposit(%), hold minutes, rate plans sold, texts
POST /api/pms/setup/room-types/:id/photos (multipart photo), PUT .../photos {images}   (services/roomTypePhotoService.js)
```
`services/publicBookingService.js` reuses `bookingService` (server price, signature, hold). Paid → hold→confirmed, deposit line
(credit_card, last4/approval from the provider) via `recordFolioPayment`, confirmation e-mail. Paid after the hold was
released → `needs_refund` + urgent WorkItem. Web bookings always create a new GuestProfile (desk merges), marketSegment `website`.
`services/paymentGateway.js`: only `mock` (refuses in production) — a real clearing provider is still to be chosen and wired
(the manual card rule rejects approvals of 7+ digits; adapt when wiring). Demo content: `node scripts/seedWebsiteContent.mjs`.

#### Charge codes, day-close books, walking back (gaps G1/G4/G6 — docs/specification/13-opera-gap-analysis.md)
```
GET|POST /api/pms/finance/charge-codes, PATCH /charge-codes/:id   ADM-13 catalogue (models/ChargeCode.js). Folio line `department` = code.
GET  /api/pms/finance/day-close/report?date=   trial balance, ledgers, revenue by code, receipts, flash (services/ledgerService.js)
POST /api/pms/finance/folios/:id/close         close a zero-balance window of a finished stay
GET|POST /api/pms/stay/:id/reinstate | reverse-check-in, POST /stay/:id/post-stay-charge   (services/reversalService.js)
```
Every manual charge/payment goes through services/financeService.js + chargeCodeService.js. Legacy line-editing writes
(/folio/:id/void-line|adjustment|discount|refund|reopen|..., POST /payments, /folio-routing/apply) return 410.
QA: `npm run qa:books`.

#### ⚠ Invoicing lives in a separate system (owner decision, 2026-10-19)
**All invoices / receipts / credit notes are issued by our standalone invoicing system (`../invoicer`), reached over its
API only.** Hotel4u does not own fiscal documents: it sends billing events (`services/invoicerClient.js`, outbox topic
`integration.invoicer`, `routes/invoicer.js` → `/api/pms/invoicer/connect|status|overview`) and shows what comes back.
No shared DB, models or users. Env: `INVOICER_API_URL`, `INVOICER_API_KEY` (server only, HTTPS outside localhost).
Details: `docs/specification/16-invoicer-standalone-connection.md`. The in-app document stack below (documentService,
ITA allocation, open format, accounting engine) is legacy — do not extend it; new invoicing work goes to the invoicer API.
Issuing (built 2026-10-19): `POST /finance/folios/:id/documents` → `documentService.issueViaInvoicer` builds the document
from the folio (VAT-inclusive lines `pricesIncludeVat:true`, discounts folded into same-rate charges, payments with their
details), ensures the customer (`externalId hotel4u:vat|id|res:…`), creates the draft + issues with keys
`hotel4u:draft|issue:<requestKey>`, then saves a mirror `Invoice {issuer:'invoicer', external, coveredLineIds}`.
In-app numbering (`nextNumber`) refuses; allocation / send / credit of a mirror return 409 (done in the invoicer).
`LEGACY_LOCAL_DOCUMENTS=1` (never in production) re-enables local numbering for the legacy suites only.
QA: `npm run qa:invoicer` starts the real invoicer (INVOICER_DIR, default ../invoicer) on a disposable Replica Set.

#### Payment details + fiscal documents (FIN-03 details, FIN-06, FIN-10) — legacy, superseded by the invoicer
```
POST /api/pms/finance/folios/:id/payments   body.details per method (financeService.paymentDetails):
     cash {tendered}→change · credit_card {last4, approval, installments, cardBrand} (never full PAN)
     bank_transfer {reference, payDate, payerName} · cheque {number, bank, branch, account, dueDate} · voucher {number, issuer}
     stored on the folio line as `methodRef` (primary ref) + `payDetails`
GET  /api/pms/finance/folios/:id/documents/context   what can be documented, buyer defaults, seller check, threshold
POST /api/pms/finance/folios/:id/documents           issue tax_invoice | tax_invoice_receipt | receipt | proforma (idempotencyKey)
GET  /api/pms/finance/documents?view=all|pending|rejected   list + allocation centre
PATCH /api/pms/finance/documents/:id/allocation      {allocationNumber: 9 digits} | {rejected, reason}
GET  /api/pms/finance/documents/:id/print            HTML; first print = original, then copy; pending allocation = marked copy
```
Service: `services/documentService.js` (allocationRule: business buyer + VAT > 0 + net strictly above the threshold of the
issue date — 5,000 from 2026-06-01). Series per property + type in `Property.docSequences`; `Invoice.allocationStatus`
(not_required|pending|approved|rejected) — status stays 'issued'. Legacy `POST /invoices/folio/:id` returns 410.
Migration: `node scripts/migrateInvoiceNumberIndex.js` (drops the old global unique invoiceNumber index). QA: `npm run qa:documents`.

#### Fiscal completeness — Tax Authority, open format, reports, cash (see docs/product/fiscal-compliance.md)
```
GET|PUT /api/pms/finance/fiscal                 settings: softwareRegNumber, operatorId, emailFrom, allocationMode; series list
PUT  /api/pms/finance/fiscal/series/:type       first number of a series (only before its first document)
POST /api/pms/finance/fiscal/ita/connect|disconnect|retry   OAuth to the Tax Authority; GET /api/ita/callback (public, state-checked)
PATCH /api/pms/finance/documents/:id/allocation  {allocationNumber} | {rejected,reason} | {retry} | {decision: cancel|continue|hearing}
POST /api/pms/finance/documents/:id/send        e-mail a marked copy
GET  /api/pms/finance/reports/journal|vat|receipts|undocumented|allocations   GET /reports/workbook (xlsx)
POST /api/pms/finance/open-format {from,to}     מבנה אחיד 1.31 → { summary, fileName, zipBase64 }
GET  /api/pms/finance/cash?date, POST /cash/close   cashier drawer close (models/CashierClose.js)
```
Services: `taxAuthorityService.js` (ITA Approval v2, decisions, token refresh, retry every 10 min in pmsScheduler),
`unifiedFileService.js` (+ `utils/zipWriter.js`, iconv ISO-8859-8), `financeReportsService.js`. Tokens sealed by
`utils/secretBox.js` (TAX_TOKEN_KEY). Env: ITA_CLIENT_ID/SECRET/REDIRECT_URI/ENV, SOFTWARE_VENDOR_ID/NAME.
Screens: `/pms/fin/reports`, `/pms/admin/fiscal`. QA: `npm run qa:fiscal` — needs the server started with the mock
(ITA_AUTH_BASE/ITA_API_BASE=http://localhost:4899, EMAIL_USER empty); the suite starts the mock itself.

#### `rooms.js` → `/api/pms/rooms`
```
GET    /                        List rooms (filters: floor, type, opsStatus, cleanStatus, occStatus)
GET    /:id                     Single room
PATCH  /:id                     Update opsStatus / cleanStatus / occStatus / notes
POST   /:id/block               Mark out of service (sets opsStatus, logs audit)
POST   /:id/unblock             Release from service
```

#### `housekeeping.js` → `/api/pms/housekeeping`
```
GET    /tasks                   List tasks (filters: date, status, assignedTo, type)
POST   /tasks                   Create task
PATCH  /tasks/:id               Update status / assign / notes
POST   /tasks/:id/complete      Mark complete (upload photos, lost & found)
GET    /zones                   List housekeeping zones for property
```

#### `maintenance.js` → `/api/pms/maintenance`
```
GET    /tickets                 List tickets (filters: status, priority, room, category)
POST   /tickets                 Create ticket
PATCH  /tickets/:id             Update status, assign, add notes/parts
POST   /tickets/:id/close       Close (critical: requires closingApprovedBy)
GET    /sla                     SLA breach metrics
```

#### `guests.js` → `/api/pms/guests`
```
GET    /                        List guests (search by name/email/phone)
POST   /                        Create guest profile
GET    /:id                     Full guest with stay history
PATCH  /:id                     Update preferences, loyalty, notes, blacklist
GET    /:id/history             Reservation history for guest
```

#### `folio.js` → `/api/pms/folio`
```
GET    /:id                     Get folio + all lines
POST   /:reservationId          Create folio for reservation
POST   /:id/charge              Post charge line
POST   /:id/payment             Record payment
POST   /:id/adjust              Post adjustment
POST   /:id/close               Close folio after checkout
```

#### `payments.js` → `/api/pms/payments`
```
POST   /                        Authorize / capture payment
GET    /:id                     Payment details
POST   /:id/refund              Refund (full or partial)
POST   /:id/void                Void authorization
```

#### `invoice.js` → `/api/pms/invoices`
```
GET    /                        List invoices (filters: status, date, type, guest)
POST   /                        Create invoice from folio/reservation
GET    /:id                     Invoice details + PDF generation
PATCH  /:id                     Update draft invoice
POST   /:id/issue               Issue (locks invoice, triggers allocation)
POST   /:id/credit-note         Issue credit note against invoice
```

#### `rates.js` → `/api/pms/rates`
```
GET    /calendars               Rate calendars (date range + roomType + ratePlan)
POST   /calendars/:rpId/:rtId   Set rate on specific rate plan + room type
PATCH  /calendars/:rateId       Update single RateDate (price, restrictions)
POST   /restrictions            Bulk set CTA / CTD / stopSell
GET    /overrides/:propertyId   Rate override history
```

#### `inventory.js` → `/api/pms/inventory`
```
GET    /                        Inventory grid (date range, room types)
PATCH  /:id                     Update InventoryDate (oooCount, stopSell, etc.)
POST   /bulk                    Bulk update inventory for date range
```

#### `dashboard.js` → `/api/pms/dashboard`
```
GET    /stats                   KPIs: occupancy%, ADR, RevPAR, revenue (today/week/month)
GET    /arrivals                Today's arrivals list
GET    /departures              Today's departures list
GET    /inhouse                 In-house guest count + breakdown by roomType
GET    /alerts                  System alerts (no-show risk, maintenance blockers, SLA breach)
```

#### `properties.js` → `/api/pms/properties`
```
GET    /                        List properties
GET    /:id                     Property details + config
POST   /                        Create property (super_admin only)
PATCH  /:id                     Update property config (hours, policies, taxes, etc.)
GET    /room-types              Room types for property
POST   /room-types              Create room type
PATCH  /room-types/:id          Update room type
```

#### `companies.js` → `/api/pms/companies`
```
GET    /                        List companies
POST   /                        Create company
GET    /:id                     Company details + reservations
PATCH  /:id                     Update contract, credit, discount
```

#### `groups.js` → `/api/pms/groups`
```
GET    /                        List group blocks
POST   /                        Create group block (reserves inventory)
PATCH  /:id                     Update group (add/remove rooms)
POST   /:id/release             Release unsold rooms back to inventory
```

#### `guests-requests.js` → `/api/pms/guest-requests`
```
GET    /                        List requests (filters: category, status, priority)
POST   /                        Create request
PATCH  /:id                     Update status / assign / resolve
```

#### `automation.js` → `/api/pms/automation`
```
GET    /rules                   List automation rules
POST   /rules                   Create rule (trigger → conditions → action)
PATCH  /rules/:id               Update rule
DELETE /rules/:id               Delete rule
```

#### `notifications.js` → `/api/pms/notifications`
```
GET    /                        User notifications (unread first, paginated)
POST   /:id/read                Mark read
DELETE /:id                     Dismiss notification
POST   /read-all                Mark all read
```

#### `crm-core.js` → `/api/pms/crm`
```
GET    /leads                   List leads (score, status, owner, date)
POST   /leads                   Create lead
PATCH  /leads/:id               Update status, owner, score, stage
POST   /leads/:id/convert       Convert lead to opportunity
GET    /opportunities           List opportunities
GET    /contacts                Contact list (linked to accounts/leads)
```

#### `audit-log.js` → `/api/pms/audit-log`
```
GET    /                        Audit trail (filterable: entity, actor, action, date)
```

#### `users.js` → `/api/pms/users`
```
GET    /                        List users for property
POST   /                        Create user
PATCH  /:id                     Update role / active status
DELETE /:id                     Deactivate user
```

#### `reports.js` → `/api/pms/reports`
```
GET    /occupancy               Occupancy report (date range)
GET    /revenue                 Revenue breakdown (by source, roomType, ratePlan)
GET    /arrivals-departures     Arrival/departure manifest
GET    /housekeeping            Housekeeping productivity report
```

### Legacy Routes (`routes/` → `/api`)

| File | Mount | Purpose |
|---|---|---|
| `auth.js` | `/api/auth` | login, logout, refresh, /me (public register closed → 410; users are created by an admin) |
| `userRoutes.js` | `/api/users` | User CRUD |
| `bookingRoutes.js` | `/api/bookings` | Ziporiclass booking CRUD |
| `orderRoutes.js` | `/api/orders` | Ziporiclass order management |
| `roomRoutes.js` | `/api/rooms` | Legacy room management |
| `priceListRoutes.js` | `/api/pricelists` | Price list CRUD |
| `leadRoutes.js` | `/api/leads` | Ziporiclass lead management |
| `announcementRoutes.js` | `/api/announcements` | Announcements |
| `chatRoutes.js` | `/api/chat` | Internal chat |
| `whatsappChatRoutes.js` | `/api/whatsapp` | WhatsApp integration |
| `uploadRoutes.js` | `/api/upload` | File uploads (Multer) |
| `referrerRoutes.js` | `/api/referrers` | Referrer management |
| `customerCardRoutes.js` | `/api/customer-cards` | Loyalty cards |
| `pushRoutes.js` | `/api/push` | Web push subscriptions |
| `pbxRoutes.js` | `/api/pbx` | PBX integration |
| `webhookRoutes.js` | `/api/webhooks` | Incoming webhooks (no auth) |
| `adminHotels.js` | `/api/admin/hotels` | Hotel admin |
| `adminOrders.js` | `/api/admin/orders` | Order admin |
| `adminUsers.js` | `/api/admin/users` | User admin |
| `adminDashboard.js` | `/api/admin/dashboard` | Admin KPIs |
| `adminRoomTypes.js` | `/api/admin/room-types` | Room type admin |
| `adminExtraTypes.js` | `/api/admin/extras` | Extra type admin |
| `adminProducts.js` | `/api/admin/products` | Product admin |
| `adminAutoReply.js` | `/api/admin/auto-reply` | WhatsApp auto-reply |
| `adminTriggers.js` | `/api/admin/triggers` | Lead trigger admin |
| `adminCommissions.js` | `/api/admin/commissions` | Commission management |
| `adminAudit.js` | `/api/admin/audit` | Audit log view |

---

## SERVICE INDEX

### `services/reservationService.js`
```
createReservation({ propertyId, data, actorId, actorName, ip })
  → availability check → create Reservation + Folio → audit → notification

checkIn(reservationId, roomId, actorId)
  → validate status → update Reservation (in_house, checkedInAt) → update Room.occStatus

checkOut(reservationId, actorId)
  → validate status → balance Folio → update Reservation (checked_out, checkedOutAt) → Room to dirty

cancelReservation(reservationId, reason, actorId)
  → calc refund → update Reservation → release InventoryDate → optional refund Payment

markNoShow(reservationId, actorId)
  → update Reservation (no_show) → release inventory → notification

modifyReservation(reservationId, updates, actorId)
  → re-check availability if dates changed → update Reservation → audit delta
```

### `services/availabilityService.js`
```
checkAvailability({ propertyId, roomTypeId, arrivalDate, departureDate, requiredRooms })
  → returns { available: Boolean, availableCount, dates: [] }

incrementInventory({ propertyId, roomTypeId, date, quantity })
  → $inc bookedCount on InventoryDate docs

consumeAvailabilityLock(lockId)
  → atomically consume InventoryLock
```

### `services/automationEngine.js`
```
fireEvent(trigger, data, propertyId)
  → load matching AutomationRule docs → eval conditions → exec action
  → actions: sendMessage|createTask|postCharge|sendPaymentLink|webhookDispatch|notifyStaff
```

### `services/notificationService.js` + `notificationDispatcher.js`
```
createNotification({ property, recipientUser, type, title, body, entityType, entityId })
  → saves Notification → dispatches via channel (in_app / email / sms / push)

dispatch(notification)
  → in_app: Socket.io emit to user room
  → email: emailService.sendEmail()
  → sms: smsService.send()
  → push: pushHandler.send()
```

### `services/channelQueueService.js`
```
enqueue(propertyId, roomTypeId, date, type)
  → adds ChannelUpdateQueue entry for OTA sync (Booking/Expedia/Agoda)

processQueue()
  → reads pending updates → calls OTA APIs → marks processed or failed
```

### `services/scheduler.js` + `services/pmsScheduler.js`
```
initScheduler()
  → daily 00:01: retention cleanup, commission reports
  → every 5min: SLA breach check on MaintenanceTickets/GuestRequests

initPmsScheduler()
  → daily 02:00: auto-create housekeeping tasks for next day
  → daily 23:59: night audit (post room charges to open folios)
  → hourly: fire schedule.hourly automation rules
```

### `services/emailService.js`
```
sendEmail(to, subject, html)  → Nodemailer SMTP
buildReservationConfirmationEmail(reservation, property, guest) → HTML string
```

### `services/whatsappService.js`
```
initWhatsAppListener()  → Baileys WebSocket connection
sendMessage(phone, text)
sendTemplate(phone, templateName, params)
```

### `services/roomService.js`
```
updateRoomStatus(roomId, updates, actorId)
  → updates Room.opsStatus / cleanStatus / occStatus → audit → Socket.io emit

syncOccupancyStatus(propertyId, date)
  → reconciles Room.occStatus with active Reservation data
```

### `services/retentionService.js`
```
runRetentionCleanup()
  → finds GuestProfile where retentionDeleteAfter < today
  → anonymizes: clears PII, sets isAnonymized:true (Israeli 7-year GDPR)
```

### `services/invoiceService.js`
```
createInvoice(reservationId, type, actorId)
  → reads Folio → builds Invoice doc → assigns invoiceNumber from Counter

requestAllocation(invoiceId)
  → sends to Israeli tax authority for allocation number
```

---

## CONTROLLER INDEX

### PMS Controllers (inline in route files or `controllers/admin/`)

| File | Key Exports |
|---|---|
| `controllers/authController.js` | `registerUser`, `loginUser`, `logout`, `refresh` |
| `controllers/userController.js` | User CRUD, profile, password reset |
| `controllers/bookingController.js` | Booking CRUD (Ziporiclass) |
| `controllers/orderController.js` | Order lifecycle (Ziporiclass) |
| `controllers/roomController.js` | Room inventory |
| `controllers/rateController.js` | Rate calendar operations |
| `controllers/leadController.js` | Lead management (legacy) |
| `controllers/dashboardController.js` | Stats aggregation |
| `controllers/chatController.js` | Internal chat |
| `controllers/announcementController.js` | Announcements |
| `controllers/uploadController.js` | File upload + Sharp thumbnails |
| `controllers/whatsappChatController.js` | WhatsApp chat interface |
| `controllers/customerCardController.js` | Loyalty cards |
| `controllers/admin/autoReplyController.js` | WhatsApp auto-reply rules |
| `controllers/admin/calendarController.js` | HK/maintenance calendar |
| `controllers/admin/commissionController.js` | Commission calc |
| `controllers/admin/dashboardController.js` | PMS KPI dashboard |
| `controllers/admin/extraTypeController.js` | Extra type CRUD |
| `controllers/admin/hotelAdminController.js` | Hotel admin |
| `controllers/admin/orderAdminController.js` | Order admin |
| `controllers/admin/productAdminController.js` | Product admin |
| `controllers/admin/referralController.js` | Referral management |
| `controllers/admin/roomTypeController.js` | Room type admin |
| `controllers/admin/triggerController.js` | Lead triggers |
| `controllers/admin/userAdminController.js` | User admin |

---

## MIDDLEWARE SUMMARY

### PMS Auth (`middleware/authContext.js`)
```
attachActor(req, res, next)    → decodes JWT → loads User → sets req.actor
requireActor(req, res, next)   → gates: throws 401 if no actor
assertPropertyScope(req, id)   → throws 403 if actor.property !== id (unless super_admin)
requireRoles(req, roles, msg)  → throws 403 if actor.role not in roles
```

### Legacy Auth (`middlewares/authMiddleware.js`)
```
requireAuth          → verifies JWT cookie, loads User
requireAdmin         → role: admin
requireShiftManager  → role: admin | shift_manager
requireMaintenance   → role: admin | maintenance | shift_manager
```

### Error Handling
```
utils/AppError.js    → new AppError(message, statusCode) — isOperational:true
middleware/errorHandler.js → catches AppError → JSON { status, message, [stack in dev] }
```

---

## KEY PATTERNS & CONVENTIONS

### Date Format
All dates stored as `String YYYY-MM-DD` (not Date objects) for reservation dates.
Timestamps (`checkedInAt`, `createdAt` etc.) are `Date` objects.
Helper: `utils/dateHelpers.js → todayYmdInTimezone(timezone)`

### Confirmation Numbers
Auto-generated: `{reservationPrefix || 'RES'}-{sequence}` from `Counter` model.

### Role Hierarchy
```
super_admin > property_admin > general_manager > front_desk_manager
> receptionist | revenue_manager | sales_manager | finance_manager | auditor
> housekeeping_manager > housekeeper
> maintenance_manager > technician
> cashier | owner_readonly
```

### Property Scoping
Every PMS model has a `property` field. All queries must include `{ property: req.actor.property }`.

### Audit Logging
Wrap all state-changing operations with `auditLogger.logAction(req, action, entity, entityId)`.

### Socket.io Rooms
Users join room `property:{propertyId}`. Emit updates there for real-time frontend sync.
Key events: `room:updated`, `reservation:updated`, `task:updated`, `ticket:updated`

### ESM
All files use `import/export`. Node `"type":"module"`. No `require()`.

---

## ENV VARS

```
MONGO_URI              MongoDB connection string (default: mongodb://localhost:27017/hotel4u)
PORT                   HTTP port (default: 4000)
JWT_SECRET             PMS token secret (falls back to JWT_ACCESS_SECRET). No secret in code: production refuses to start without one; dev without one uses a random per-run secret
JWT_REFRESH_SECRET     Refresh token secret
CLIENT_URL             CORS allowed origin
SMTP_HOST/PORT/USER/PASS  Nodemailer SMTP config
DISABLE_WHATSAPP=1     Skip Baileys WhatsApp init (use in dev)
NODE_OPTIONS           e.g. --max-old-space-size=4096
```

---

## SEED FILES

### `server/seed.js` — `npm run seed`
- 1 Property: מלון הגליל, Tiberias
- 4 RoomTypes: STD/DLX/FAM/STE (380/520/650/890 ILS)
- 32 Rooms (floors 1-5)
- 4 RatePlans: BAR/VIP/OTA/CORP + RateDates (-65 to +65 days)
- 4 Companies + 7 Users + 12 Guests
- ~70 Reservations (today + 26 history + 11 future)
- Folios for all non-future reservations
- 10 HK Tasks + 4 Maintenance Tickets

### `server/seedBig.js` — `npm run seed:big`
- Same property + rooms + rate plans
- 60 Guests (Israeli + international + corporate + VIP)
- **~240 Reservations** total:
  - 35 today (in_house + arrivals + checkouts)
  - ~120 historical (past 90 days, dense)
  - ~80 future (next 60 days, 1+ arrival per day)
  - 7 no-shows/cancellations
- Folios for all in-house + history
- 15 HK Tasks + 5 Maintenance Tickets
- Rate dates: -90 to +90 days
