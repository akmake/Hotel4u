# Hotel4u Reservations: Jira-Ready Backlog מפורט

תאריך עדכון: 6 במאי 2026  
מבוסס על: [מחקר עומק Cloudbeds](/c:/Users/yosef dahan/Documents/GitHub/hotel4u/docs/cloudbeds_reservations_deep_research_he.md)  
מטרה: להפוך את המחקר למסגרת Delivery אופרטיבית ברמת Jira, עם פירוק מלא לאפיקים, סטוריז, סאב-טאסקים, קריטריוני קבלה, תלויות ו-QA.

## 1) הנחות הפעלה מחייבות

1. עובדים בספרינטים של 2 שבועות.
2. קיבולת ספרינט ממוצעת לצוות: 30-36 Story Points.
3. צוות ברירת מחדל: 1 PM, 1 Tech Lead, 2 FE, 2 BE, 1 QA, 1 UX, 1 DevOps חצי משרה.
4. הפיתוח מתחיל ממצב "אין מערכת קיימת" עבור מודול הזמנות.
5. אין העתקת UI/נכסים מוגנים; מממשים פונקציונליות וזרימות בלבד.
6. Timezone מוצר: לכל נכס timezone משלו; כל חישובי Check-in/out חייבים להתבצע לפי timezone של הנכס.

## 2) הגדרת Jira לפני העלאת הבקלוג

## 2.1 סוגי Issues

1. Epic
2. Story
3. Task
4. Sub-task
5. Bug
6. Spike

## 2.2 Status Workflow מוצע

1. Backlog
2. Ready
3. In Progress
4. In Review
5. QA
6. UAT
7. Done
8. Blocked

## 2.3 שדות חובה לכל Story

1. Summary
2. Description (User Story + Context)
3. Acceptance Criteria (Gherkin)
4. Story Points
5. Priority
6. Component
7. Labels
8. Sprint
9. Dependencies
10. Test Notes

## 2.4 Components מוצעים

1. Reservations-Frontend
2. Reservations-Backend
3. Calendar
4. Folio-Payments
5. Channels-OTA
6. RBAC-Audit
7. Messaging
8. Platform
9. QA-Automation

## 2.5 תגים (Labels) מוצעים

1. `reservations-core`
2. `checkin-checkout`
3. `calendar-assignment`
4. `folio`
5. `ota-sync`
6. `rbac`
7. `audit`
8. `bulk-actions`
9. `reporting`
10. `mvp`
11. `prod-core`
12. `advanced-parity`

## 2.6 Definition of Ready

1. יש תיאור עסקי ברור.
2. יש Acceptance Criteria מלא.
3. יש הערכת SP.
4. התלויות ידועות.
5. UX/Schema/API זמינים לסטורי.

## 2.7 Definition of Done

1. כל AC עבר.
2. קוד נבדק ואושר PR.
3. בדיקות יחידה + אינטגרציה עברו.
4. בדיקות QA ידניות עברו.
5. Audit/RBAC נשמרו.
6. תיעוד API/UX עודכן.

## 3) Epic Register

| Epic Key | Epic Name | Outcome | ספרינטי יעד |
|---|---|---|---|
| H4U-EP01 | Platform Foundations for Reservations | בסיס דאטה, API, state machine, תקני זמן ושגיאות | S0-S1 |
| H4U-EP02 | Reservations List and Search | מסך הזמנות מלא עם חיפוש, פילטרים, ייצוא ועמודות | S1-S2 |
| H4U-EP03 | New Reservation Flow | יצירת הזמנה Simple/Split עם תשלום ואישור | S2-S3 |
| H4U-EP04 | Reservation Details Workspace | מסך/Drawer פרטי הזמנה מלא כולל לשוניות ופעולות | S3-S4 |
| H4U-EP05 | Calendar and Assignment Engine | יומן תפעולי והקצאות חדרים מלאות | S3-S5 |
| H4U-EP06 | Guest Lifecycle Operations | Check-in/out, cancel, no-show, confirmation pending | S4-S5 |
| H4U-EP07 | Folio and Payments Core | חיובים, תשלומים, החזרים, התאמות ותיעוד כספי | S4-S6 |
| H4U-EP08 | OTA Rules and Reconciliation | כללי שינוי/ביטול OTA וסנכרון ערוצים | S5-S7 |
| H4U-EP09 | Messaging and Guest Communication | Compose, templates, delivery status, rate limits | S5-S6 |
| H4U-EP10 | Bulk Actions and Operational Speed | פעולות מרובות בטוחות עם ולידציות | S6-S7 |
| H4U-EP11 | RBAC, Audit and Compliance | הרשאות מפורטות ו-traceability מלאה | S1-S8 |
| H4U-EP12 | QA Automation, Observability and Release | בדיקות E2E, ניטור, SLA ושחרור לפרודקשן | S2-S8 |

## 4) Sprint Plan על ציר זמן

| Sprint | טווח | מטרה עיקרית | Exit Criteria |
|---|---|---|---|
| S0 | שבועות 1-2 | יסודות פלטפורמה ו-DB | API בסיסי ו-schema יציב |
| S1 | שבועות 3-4 | רשימת הזמנות + הרשאות בסיס | Create/List/Search בסיסי עובד |
| S2 | שבועות 5-6 | זרימת הזמנה חדשה Simple | הזמנה ישירה מקצה לקצה |
| S3 | שבועות 7-8 | Reservation Details + Calendar בסיס | עריכה/הקצאה/סטטוסים פועלים |
| S4 | שבועות 9-10 | Check-in/out + Folio בסיס | תהליך אירוח מלא |
| S5 | שבועות 11-12 | OTA/Messaging/Unassigned | תפעול יומי יציב |
| S6 | שבועות 13-14 | Bulk actions + Payments הרחבה | מהירות תפעול גבוהה |
| S7 | שבועות 15-16 | הקשחה, reconciliation, audit | מוכנות UAT |
| S8 | שבועות 17-18 | UAT, תיקונים, Go-Live | שחרור פרודקשן |

## 5) Backlog מפורט (Jira-Ready)

פורמט קבוע לכל Story:
1. Jira Fields
2. User Story
3. Acceptance Criteria
4. Sub-tasks
5. QA Test Cases
6. Dependencies

---

## EPIC H4U-EP01: Platform Foundations for Reservations

### H4U-RES-001

1. Jira Fields: `Story` | Epic `H4U-EP01` | Priority `Highest` | SP `8` | Component `Platform, Reservations-Backend` | Sprint `S0`
2. User Story: כצוות פיתוח, אנחנו צריכים סכמת נתונים מלאה להזמנות כדי לאפשר עקביות, חוקים תפעוליים ו-traceability.
3. Acceptance Criteria:
1. Given schema migration ריקה, when מריצים `up`, then נוצרות טבלאות `reservations`, `reservation_segments`, `reservation_assignments`, `guests`, `folios`, `folio_transactions`, `reservation_activity_log`, `channel_links`.
2. Given foreign key invalid, when יוצרים רשומה, then הטרנזקציה נכשלת עם שגיאת ולידציה סטנדרטית.
3. Given מחיקה לוגית של הזמנה, when מבצעים query רגיל, then הרשומה לא חוזרת בלי `include_deleted=true`.
4. Sub-tasks:
1. הגדרת ERD סופי.
2. כתיבת migration ראשוני.
3. אינדקסים ל-`reservation_id`, `check_in`, `status`, `source`.
4. soft-delete pattern.
5. seeded enums לסטטוסים.
6. review של DBA/Tech Lead.
7. מסמך schema versioning.
4. QA Test Cases:
1. הרצת מיגרציה מסביבת dev מאפס.
2. אימות cascade rules.
3. בדיקת performance ל-query רשימת הזמנות (10k רשומות).
5. Dependencies:
1. אין.

### H4U-RES-002

1. Jira Fields: `Story` | Epic `H4U-EP01` | Priority `Highest` | SP `8` | Component `Reservations-Backend` | Sprint `S0`
2. User Story: כ-Operations, אנחנו צריכים State Machine קשיח לסטטוסי הזמנה כדי למנוע מעברים לא חוקיים.
3. Acceptance Criteria:
1. Given status `Confirmed`, when action `check_in` ו-arrival<=today ויש assignment, then status נהיה `In-House`.
2. Given status `In-House`, when action `check_out` ו-departure<=today, then status נהיה `Checked Out`.
3. Given מעבר אסור, when API מקבל request, then מוחזר `409` עם קוד שגיאה ברור.
4. Sub-tasks:
1. הגדרת transition matrix.
2. 구현 guard layer.
3. unit tests לכל transition.
4. event emit לכל שינוי סטטוס.
5. חיבור activity log.
6. API error mapping.
4. QA Test Cases:
1. ניסיון check-in ללא assignment.
2. ניסיון check-out מוקדם מהיום.
3. cancel מסטטוסים שונים.
5. Dependencies:
1. `H4U-RES-001`.

### H4U-RES-003

1. Jira Fields: `Story` | Epic `H4U-EP01` | Priority `High` | SP `5` | Component `Reservations-Backend, Platform` | Sprint `S0`
2. User Story: כ-Frontend, אנחנו צריכים חוזה API אחיד כדי לבנות מסכים יציבים וללא פרשנות.
3. Acceptance Criteria:
1. Given כל endpoint חדש, when request invalid, then error schema אחיד כולל `code`, `message`, `details`, `trace_id`.
2. Given OpenAPI build, when CI רץ, then spec מתעדכן ונבדק.
3. Sub-tasks:
1. כתיבת OpenAPI v3 ל-endpoints הראשיים.
2. תבנית response/error אחידה.
3. דוגמיות request/response לתיעוד.
4. lint ל-spec ב-CI.
4. QA Test Cases:
1. contract tests מול JSON schema.
2. backward compatibility check.
5. Dependencies:
1. `H4U-RES-001`.

### H4U-RES-004

1. Jira Fields: `Story` | Epic `H4U-EP01` | Priority `Highest` | SP `5` | Component `Platform` | Sprint `S0`
2. User Story: כ-Front Desk, אנחנו צריכים שכל חישובי תאריכים יעבדו לפי timezone נכס כדי למנוע טעויות check-in/out.
3. Acceptance Criteria:
1. Given property timezone מוגדר, when מחשבים `today`, then הערך נקבע לפי timezone נכס ולא לפי שרת.
2. Given הזמנה סביב חצות, when בודקים guards, then מתקבלת החלטה נכונה לפי נכס.
3. Sub-tasks:
1. מודול timezone מרכזי.
2. policy document לתאריכים.
3. unit tests סביב DST.
4. integration tests ל-check-in/out.
4. QA Test Cases:
1. נכס UTC+2, שרת UTC.
2. מעבר שעון קיץ.
5. Dependencies:
1. `H4U-RES-002`.

### H4U-RES-005

1. Jira Fields: `Story` | Epic `H4U-EP01` | Priority `Medium` | SP `3` | Component `Platform` | Sprint `S1`
2. User Story: כ-QA, אנחנו צריכים dataset קבוע לבדיקות אוטומציה על כל מצבי הסטטוס.
3. Acceptance Criteria:
1. Given script seed, when מריצים בסביבה נקייה, then מתקבלים לפחות 60 reservations כולל direct/OTA/split/canceled/no-show.
2. Sub-tasks:
1. seed script.
2. fixtures ל-edge cases.
3. reset script.
4. QA Test Cases:
1. בדיקת idempotency לסקריפט.
5. Dependencies:
1. `H4U-RES-001`.

### H4U-RES-006

1. Jira Fields: `Story` | Epic `H4U-EP01` | Priority `Medium` | SP `3` | Component `Platform, Reservations-Frontend` | Sprint `S1`
2. User Story: כ-Product, אנחנו צריכים Feature Flags ל-rollout מדורג של מסכים חדשים.
3. Acceptance Criteria:
1. Given flag כבוי, when משתמש נכנס, then רואה UI קלאסי.
2. Given flag דלוק, when משתמש נכנס, then רואה UI חדש.
3. Sub-tasks:
1. flag service.
2. middleware לחשיפת flags ל-client.
3. telemetry לפי flag.
4. QA Test Cases:
1. בדיקת מעבר בין flag states בלי logout.
5. Dependencies:
1. `H4U-RES-003`.

---

## EPIC H4U-EP02: Reservations List and Search

### H4U-RES-007

1. Jira Fields: `Story` | Epic `H4U-EP02` | Priority `Highest` | SP `8` | Component `Reservations-Backend` | Sprint `S1`
2. User Story: כ-Front Desk, אני צריכה מסך רשימת הזמנות עם pagination/sorting כדי לנהל עומס יומי.
3. Acceptance Criteria:
1. Given רשומות קיימות, when נטען `/reservations`, then מוחזרת רשימה מדופדפת עם total count.
2. Given sort על `check_in`, when מפעילים descending, then הרשומות מסודרות תקין.
3. Sub-tasks:
1. endpoint GET `/reservations`.
2. query builder לסינון+מיון.
3. pagination metadata.
4. caching query parameters.
4. QA Test Cases:
1. paging consistency בעמודים 1-5.
2. sorting correctness fields מרובים.
5. Dependencies:
1. `H4U-RES-001`.

### H4U-RES-008

1. Jira Fields: `Story` | Epic `H4U-EP02` | Priority `High` | SP `8` | Component `Reservations-Frontend` | Sprint `S1`
2. User Story: כ-Front Desk, אני צריכה פילטרים מתקדמים כדי לאתר הזמנות מהר.
3. Acceptance Criteria:
1. Given filters status/source/date/apartment, when apply, then הטבלה מתעדכנת בהתאם.
2. Given refresh, when המסך נטען שוב, then נשמרת תצורת פילטרים אחרונה למשתמש.
3. Sub-tasks:
1. filter panel UI.
2. querystring sync.
3. save preset backend endpoint.
4. clear all / reset behavior.
4. QA Test Cases:
1. שילובי פילטרים סותרים.
2. empty state מדויק.
5. Dependencies:
1. `H4U-RES-007`.

### H4U-RES-009

1. Jira Fields: `Story` | Epic `H4U-EP02` | Priority `High` | SP `5` | Component `Reservations-Frontend` | Sprint `S1`
2. User Story: כ-משתמש תפעולי, אני צריך להגדיר עמודות ותצוגה כדי להתאים את הטבלה לתפקיד שלי.
3. Acceptance Criteria:
1. Given column config modal, when בוחרים/מסירים עמודות, then הטבלה מתעדכנת מיידית.
2. Given logout/login, when חוזרים למסך, then preference נשמר.
3. Sub-tasks:
1. column picker UI.
2. drag reorder.
3. save prefs API.
4. default fallback profile.
4. QA Test Cases:
1. בדיקת 3 משתמשים עם תצוגות שונות.
5. Dependencies:
1. `H4U-RES-007`.

### H4U-RES-010

1. Jira Fields: `Story` | Epic `H4U-EP02` | Priority `Medium` | SP `5` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S2`
2. User Story: כ-Manager, אני צריך Export/Print על תוצאות מסוננות.
3. Acceptance Criteria:
1. Given list filtered, when export XLSX, then הקובץ כולל רק תוצאות נוכחיות לפי עמודות נבחרות.
2. Given print action, when מופעלת, then נפתחת תצוגת הדפסה נקייה.
3. Sub-tasks:
1. export endpoint.
2. xlsx mapping.
3. print stylesheet.
4. rate limit/export guard.
4. QA Test Cases:
1. export with 5k rows.
2. RTL rendering תקין.
5. Dependencies:
1. `H4U-RES-008`.
2. `H4U-RES-009`.

### H4U-RES-011

1. Jira Fields: `Story` | Epic `H4U-EP02` | Priority `High` | SP `3` | Component `Reservations-Backend, Reservations-Frontend` | Sprint `S2`
2. User Story: כ-Agent, אני צריך חיפוש מהיר גלובלי לפי שם/אימייל/מספר הזמנה.
3. Acceptance Criteria:
1. Given 3 תווים ומעלה, when מקלידים, then מתקבלים suggestions תוך פחות מ-300ms בסביבת staging.
2. Given בחירה מהsuggestion, when נלחץ, then נפתח Reservation Details.
3. Sub-tasks:
1. indexed search endpoint.
2. debounced input FE.
3. keyboard navigation.
4. QA Test Cases:
1. חיפוש mixed עברית/אנגלית.
5. Dependencies:
1. `H4U-RES-007`.

### H4U-RES-012

1. Jira Fields: `Story` | Epic `H4U-EP02` | Priority `Medium` | SP `3` | Component `Reservations-Frontend` | Sprint `S2`
2. User Story: כ-Operations Lead, אני צריך מצב New/Classic עם toggle כדי לנהל מעבר הדרגתי.
3. Acceptance Criteria:
1. Given toggle ל-new, when מופעל, then כל כניסה ל-reservations פותחת new view.
2. Given rollback, when מחזירים classic, then אין אובדן data/filter settings.
3. Sub-tasks:
1. UI toggle.
2. persistence user preference.
3. fallback monitor.
4. QA Test Cases:
1. A/B users באותו נכס.
5. Dependencies:
1. `H4U-RES-006`.

---

## EPIC H4U-EP03: New Reservation Flow

### H4U-RES-013

1. Jira Fields: `Story` | Epic `H4U-EP03` | Priority `Highest` | SP `8` | Component `Reservations-Backend` | Sprint `S2`
2. User Story: כ-Front Desk, אני צריכה מנוע Availability אמין להזמנה חדשה.
3. Acceptance Criteria:
1. Given date range and guests, when מבצעים search, then מוחזרת זמינות לפי room types כולל constraints.
2. Given אין רצף לילות, when search, then מוצגת תוצאה מפורשת \"No continuous availability\".
3. Sub-tasks:
1. inventory query builder.
2. overbooking policy hooks.
3. rate plan integration.
4. response with reason codes.
4. QA Test Cases:
1. low inventory edge.
2. full occupancy day באמצע טווח.
5. Dependencies:
1. `H4U-RES-001`.

### H4U-RES-014

1. Jira Fields: `Story` | Epic `H4U-EP03` | Priority `Highest` | SP `8` | Component `Reservations-Frontend` | Sprint `S2`
2. User Story: כ-Agent, אני צריך Wizard ליצירת הזמנה פשוטה מקצה לקצה.
3. Acceptance Criteria:
1. Given Step 1 הושלם, when ממשיכים, then עוברים ל-Guest Details עם סיכום תעריף.
2. Given שדה חובה חסר, when confirm, then מתקבלת ולידציה inline.
3. Given confirm success, when נשמר, then נוצרת הזמנה ומופנה ל-Reservation Details.
4. Sub-tasks:
1. multi-step wizard UI.
2. form state management.
3. backend integration.
4. summary sidebar.
5. cancel draft behavior.
4. QA Test Cases:
1. ניווט אחורה/קדימה בין צעדים.
2. רענון עמוד באמצע flow.
5. Dependencies:
1. `H4U-RES-013`.

### H4U-RES-015

1. Jira Fields: `Story` | Epic `H4U-EP03` | Priority `High` | SP `8` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S3`
2. User Story: כ-Agent, אני צריך תמיכה ב-Split Reservation בין room types שונים.
3. Acceptance Criteria:
1. Given split selection רציפה, when confirm, then נוצרים segments תקינים.
2. Given gap בתאריכים, when מנסים confirm, then המערכת חוסמת ומסבירה שנדרשת הזמנה נוספת.
3. Sub-tasks:
1. split UI selector.
2. segment validation server-side.
3. segment persistence model.
4. room move indicator.
4. QA Test Cases:
1. split ל-2 segments.
2. split ל-3 segments עם שינוי rate plan.
5. Dependencies:
1. `H4U-RES-013`.

### H4U-RES-016

1. Jira Fields: `Story` | Epic `H4U-EP03` | Priority `High` | SP `5` | Component `Reservations-Frontend` | Sprint `S3`
2. User Story: כ-Property Admin, אני צריך שליטה בשדות חובה בפרטי אורח.
3. Acceptance Criteria:
1. Given policy של שדות חובה, when הזנה חסרה, then אי אפשר לשמור.
2. Given country selected, when נדרש פורמט טלפון/מסמך, then ולידציה מותאמת מדינה.
3. Sub-tasks:
1. required fields config source.
2. validation library.
3. localized error messages.
4. QA Test Cases:
1. אורח ללא אימייל.
2. אורח עם מסמך לא תקין לפי policy.
5. Dependencies:
1. `H4U-RES-014`.

### H4U-RES-017

1. Jira Fields: `Story` | Epic `H4U-EP03` | Priority `High` | SP `5` | Component `Folio-Payments, Reservations-Frontend` | Sprint `S3`
2. User Story: כ-Agent, אני צריך Step של Confirm and Pay עם אפשרויות charge/preauth/skip.
3. Acceptance Criteria:
1. Given payment type `charge`, when הצלחה, then נשמר transaction ומופיע ב-folio.
2. Given `skip payment`, when confirm, then reservation נשמרת ללא transaction.
3. Sub-tasks:
1. payment options UI.
2. gateway abstraction call.
3. transaction logging.
4. rollback logic במקרה שגיאה.
4. QA Test Cases:
1. payment declined.
2. timeout gateway.
5. Dependencies:
1. `H4U-RES-014`.
2. `H4U-RES-025`.

### H4U-RES-018

1. Jira Fields: `Story` | Epic `H4U-EP03` | Priority `Medium` | SP `3` | Component `Messaging, Reservations-Frontend` | Sprint `S3`
2. User Story: כ-Agent, אני צריך פופאפ סיום שמאפשר לשלוח מייל אישור או להמשיך בלי לשלוח.
3. Acceptance Criteria:
1. Given booking success, when choose `send`, then נוצר email job.
2. Given choose `continue without send`, then flow נסגר בלי job.
3. Sub-tasks:
1. modal UI.
2. template selector.
3. enqueue email call.
4. QA Test Cases:
1. send with invalid email.
2. send with template missing.
5. Dependencies:
1. `H4U-RES-014`.
2. `H4U-RES-031`.

---

## EPIC H4U-EP04: Reservation Details Workspace

### H4U-RES-019

1. Jira Fields: `Story` | Epic `H4U-EP04` | Priority `Highest` | SP `8` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S3`
2. User Story: כ-Agent, אני צריך מסך פרטי הזמנה עם Header מלא כדי לקבל תמונת מצב מיידית.
3. Acceptance Criteria:
1. Given reservation פתוחה, when details נטענים, then header מציג guest, id, statuses, dates, source, nights, guests.
2. Given balance breakdown, when נפתח dropdown, then מוצגים subtotal/taxes/payments/balance.
3. Sub-tasks:
1. details endpoint aggregate.
2. header UI.
3. balance breakdown widget.
4. loading/empty/error states.
4. QA Test Cases:
1. canceled reservation.
2. OTA reservation עם origin שונה מ-source.
5. Dependencies:
1. `H4U-RES-007`.
2. `H4U-RES-013`.

### H4U-RES-020

1. Jira Fields: `Story` | Epic `H4U-EP04` | Priority `High` | SP `8` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S3`
2. User Story: כ-Agent, אני צריך Actions Menu מלא (Invoice/Email/Print/Export/Delete).
3. Acceptance Criteria:
1. Given action `Print Confirmation`, when נלחץ, then מתקבל מסמך הדפסה.
2. Given action `Export XLSX/PDF`, when נלחץ, then מתקבל קובץ תואם.
3. Given action `Delete Reservation`, when אין הרשאה, then מוצגת חסימה.
4. Sub-tasks:
1. actions dropdown UI.
2. permissions per action.
3. backend actions endpoints.
4. confirm dialogs.
4. QA Test Cases:
1. delete blocked by role.
2. export for Hebrew guest data.
5. Dependencies:
1. `H4U-RES-019`.
2. `H4U-RES-034`.

### H4U-RES-021

1. Jira Fields: `Story` | Epic `H4U-EP04` | Priority `High` | SP `8` | Component `Reservations-Frontend` | Sprint `S4`
2. User Story: כ-Agent, אני צריך לשוניות מלאות בדף הזמנה לתפעול יעיל.
3. Acceptance Criteria:
1. Given tabs קיימות, when מעבר טאב, then נטען תוכן הטאב בלי אובדן context.
2. Given tabs `Accommodations`, `Folio`, `Guest Details`, `Credit Cards`, `Notes`, `Documents`, `Activity`, `Email Messages`, then כולן נגישות לפי הרשאות.
3. Sub-tasks:
1. tabs shell UI.
2. lazy loading לכל טאב.
3. route state management.
4. permission gating per tab.
4. QA Test Cases:
1. משתמש בלי גישה ל-credit cards.
2. deep link לטאב `Folio`.
5. Dependencies:
1. `H4U-RES-019`.
2. `H4U-RES-034`.

### H4U-RES-022

1. Jira Fields: `Story` | Epic `H4U-EP04` | Priority `High` | SP `5` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S4`
2. User Story: כ-Agent, אני צריך עריכה מהירה מתוך `Accommodations` (תאריכים, הקצאה, room move).
3. Acceptance Criteria:
1. Given quick edit, when מעדכנים תאריכים חוקיים, then rate recalculation מתבצע.
2. Given lock assignment, when מופעל, then auto-reassign לא משנה חדר.
3. Sub-tasks:
1. quick edit panel.
2. lock/unlock assignment API.
3. validation for date edits.
4. QA Test Cases:
1. move room with split reservation.
5. Dependencies:
1. `H4U-RES-023`.
2. `H4U-RES-015`.

---

## EPIC H4U-EP05: Calendar and Assignment Engine

### H4U-RES-023

1. Jira Fields: `Story` | Epic `H4U-EP05` | Priority `Highest` | SP `8` | Component `Calendar, Reservations-Backend` | Sprint `S3`
2. User Story: כ-Front Desk, אני צריכה יומן חדרים עם תצוגת הקצאות מלאה.
3. Acceptance Criteria:
1. Given טווח תאריכים, when calendar נטען, then מוצגים חדרים, הזמנות, חסימות ומוני unassigned.
2. Given click על הזמנה, when summary opens, then פעולות status/details/quick edit זמינות.
3. Sub-tasks:
1. calendar grid backend model.
2. reservation bar rendering.
3. tooltip/summary panel.
4. color legend integration.
4. QA Test Cases:
1. 200 חדרים ו-30 ימים.
2. overlapping events display.
5. Dependencies:
1. `H4U-RES-007`.

### H4U-RES-024

1. Jira Fields: `Story` | Epic `H4U-EP05` | Priority `High` | SP `8` | Component `Calendar, Reservations-Backend` | Sprint `S4`
2. User Story: כ-Agent, אני צריך Assignments engine שמזהה ומטפל ב-Unassigned.
3. Acceptance Criteria:
1. Given reservation ללא חדר, when פותחים assignment tool, then מוצגות אופציות חוקיות לפי זמינות רציפה.
2. Given assignment נשמר, when refresh, then unassigned counter קטן בהתאם.
3. Sub-tasks:
1. assignment suggestion API.
2. assignment modal UI.
3. conflict detection.
4. assignment audit event.
4. QA Test Cases:
1. no continuous availability edge.
2. locked room excluded.
5. Dependencies:
1. `H4U-RES-023`.

### H4U-RES-025

1. Jira Fields: `Story` | Epic `H4U-EP05` | Priority `Medium` | SP `5` | Component `Calendar` | Sprint `S4`
2. User Story: כ-Agent, אני צריך פעולות availability מהירות (new reservation/block/courtesy hold/OOS).
3. Acceptance Criteria:
1. Given slot ביומן, when מפעילים פעולה, then האירוע נוצר ומוצג בזמן אמת.
2. Given OOS, when room marked, then engine availability מתחשב בכך.
3. Sub-tasks:
1. availability actions menu.
2. CRUD endpoint לחסימות.
3. sync with availability engine.
4. QA Test Cases:
1. block overlapping reservation.
5. Dependencies:
1. `H4U-RES-013`.
2. `H4U-RES-023`.

---

## EPIC H4U-EP06: Guest Lifecycle Operations

### H4U-RES-026

1. Jira Fields: `Story` | Epic `H4U-EP06` | Priority `Highest` | SP `8` | Component `Reservations-Backend, Reservations-Frontend` | Sprint `S4`
2. User Story: כ-Front Desk, אני צריכה לבצע Check-in ב-4 נקודות כניסה שונות.
3. Acceptance Criteria:
1. Given calendar/dashboard/reservations/accommodations entry points, when action `check_in`, then כולם מפעילים אותו service backend.
2. Given missing assignment, when check-in requested, then מתקבלת הודעת חסימה.
3. Sub-tasks:
1. unified check-in endpoint.
2. FE hooks ב-4 מסכים.
3. guard messages localized.
4. activity tracking.
4. QA Test Cases:
1. check-in from each entry point.
2. check-in past date.
5. Dependencies:
1. `H4U-RES-002`.
2. `H4U-RES-024`.

### H4U-RES-027

1. Jira Fields: `Story` | Epic `H4U-EP06` | Priority `High` | SP `5` | Component `Reservations-Backend, Reservations-Frontend` | Sprint `S4`
2. User Story: כ-Front Desk, אני צריכה Check-out בטוח עם בקרת יתרה.
3. Acceptance Criteria:
1. Given balance due > 0 ו-policy דורשת סגירה, when check-out requested, then מוצגת חסימה או warning לפי הרשאה.
2. Given check-out success, when הסטטוס מתעדכן, then folio snapshot נשמר.
3. Sub-tasks:
1. checkout guards.
2. policy config.
3. warning modal.
4. snapshot writer.
4. QA Test Cases:
1. unpaid balance with manager override.
2. zero balance normal flow.
5. Dependencies:
1. `H4U-RES-026`.
2. `H4U-RES-029`.

### H4U-RES-028

1. Jira Fields: `Story` | Epic `H4U-EP06` | Priority `High` | SP `5` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S5`
2. User Story: כ-Agent, אני צריך ביטול הזמנה Direct כולל מסלולי מייל ובקרת חיובים/החזרים.
3. Acceptance Criteria:
1. Given cancellation action, when מבוצעת, then status נהיה `Canceled`.
2. Given email option selected, when confirm, then נשלח template מתאים.
3. Given pending transactions, when cancel, then מטופלים לפי policy.
4. Sub-tasks:
1. cancel modal עם 3 אפשרויות הודעה.
2. cancellation fee helper.
3. transaction cleanup rules.
4. audit note.
4. QA Test Cases:
1. cancel with partial payment.
2. cancel without email.
5. Dependencies:
1. `H4U-RES-031`.
2. `H4U-RES-029`.

### H4U-RES-029

1. Jira Fields: `Story` | Epic `H4U-EP06` | Priority `Medium` | SP `5` | Component `Reservations-Backend, Folio-Payments` | Sprint `S5`
2. User Story: כ-Finance, אני צריך ניהול No-Show עם גבייה/פטור ומעקב כספי.
3. Acceptance Criteria:
1. Given status change ל-`No Show`, when policy דורשת fee, then נוצרת עסקה מתאימה.
2. Given no-show reservation, when פותחים folio, then מוצג snapshot נפרד (current vs before no-show).
3. Sub-tasks:
1. no-show endpoint.
2. no-show fee configuration.
3. folio snapshot model.
4. QA Test Cases:
1. no-show with fee.
2. no-show without fee.
5. Dependencies:
1. `H4U-RES-027`.

---

## EPIC H4U-EP07: Folio and Payments Core

### H4U-RES-030

1. Jira Fields: `Story` | Epic `H4U-EP07` | Priority `Highest` | SP `8` | Component `Folio-Payments, Reservations-Frontend` | Sprint `S4`
2. User Story: כ-Agent, אני צריך טאב Folio עם Add menu מלא.
3. Acceptance Criteria:
1. Given folio tab, when click `Add`, then קיימות אפשרויות Payment/Product/Tax/Room Revenue/Adjustment/Refund/Cancellation fee/No-show fee.
2. Given transaction נוצרה, when refresh, then מופיעה ברשימה עם סטטוס תקין.
3. Sub-tasks:
1. folio transaction list UI.
2. add menu actions.
3. transaction posting API.
4. error handling.
4. QA Test Cases:
1. add adjustment חיובי ושלילי.
2. add cancellation fee.
5. Dependencies:
1. `H4U-RES-021`.

### H4U-RES-031

1. Jira Fields: `Story` | Epic `H4U-EP07` | Priority `Highest` | SP `8` | Component `Folio-Payments` | Sprint `S4`
2. User Story: כ-Agent, אני צריך לעבד תשלום דרך gateway עם Charge/Preauth/Record-only.
3. Acceptance Criteria:
1. Given gateway success, when charge, then transaction type `Payment` נשמר עם reference id.
2. Given decline/timeout, when חוזרת שגיאה, then transaction לא נרשמת כפוסטד והמשתמש מקבל הודעה ברורה.
3. Sub-tasks:
1. gateway adapter.
2. payment request validator.
3. retries/idempotency key.
4. secure token logging policy.
4. QA Test Cases:
1. duplicate click protection.
2. timeout retry once.
5. Dependencies:
1. `H4U-RES-003`.

### H4U-RES-032

1. Jira Fields: `Story` | Epic `H4U-EP07` | Priority `High` | SP `5` | Component `Folio-Payments, Reservations-Frontend` | Sprint `S5`
2. User Story: כ-Finance, אני צריך פעולות נוספות לכל שורת טרנזקציה (void/allocate/receipt).
3. Acceptance Criteria:
1. Given row actions menu, when select `void`, then העסקה מסומנת void עם audit מלא.
2. Given allocate payment, when apply, then חלוקה מתעדכנת וחישובי balance נשמרים.
3. Sub-tasks:
1. row action menu.
2. void endpoint with rules.
3. allocation endpoint.
4. receipt generator hook.
4. QA Test Cases:
1. void on non-voidable transaction blocked.
2. allocation rounding rules.
5. Dependencies:
1. `H4U-RES-030`.
2. `H4U-RES-031`.

### H4U-RES-033

1. Jira Fields: `Story` | Epic `H4U-EP07` | Priority `Medium` | SP `5` | Component `Folio-Payments` | Sprint `S5`
2. User Story: כ-Manager, אני צריך מסמכי Finance מתוך Folio (invoice/pro-forma/receipt/email/print/export).
3. Acceptance Criteria:
1. Given more actions, when create invoice, then קובץ זמין תחת Documents.
2. Given email folio, when נשלח, then activity/email log מתעדכן.
3. Sub-tasks:
1. invoice service integration.
2. documents linkage.
3. print/export handlers.
4. QA Test Cases:
1. invoice availability by role.
2. export PDF validity.
5. Dependencies:
1. `H4U-RES-020`.
2. `H4U-RES-031`.

---

## EPIC H4U-EP08: OTA Rules and Reconciliation

### H4U-RES-034

1. Jira Fields: `Story` | Epic `H4U-EP08` | Priority `Highest` | SP `8` | Component `Channels-OTA, Reservations-Backend` | Sprint `S5`
2. User Story: כ-Operations, אני צריך להבדיל בין Direct ל-OTA ברמת הרשאות פעולה ותהליכי ביטול.
3. Acceptance Criteria:
1. Given OTA reservation, when משתמש מנסה שינוי אסור, then מוצגת הנחיה לבצע שינוי ב-extranet.
2. Given OTA channel שתומך cancellation דרך PMS, when cancel, then נשלחת פקודת channel תקינה.
3. Sub-tasks:
1. source/origin rule engine.
2. OTA capability matrix.
3. UI banners לפי source.
4. action gating.
4. QA Test Cases:
1. Booking.com modify blocked.
2. supported channel cancel allowed.
5. Dependencies:
1. `H4U-RES-019`.
2. `H4U-RES-028`.

### H4U-RES-035

1. Jira Fields: `Story` | Epic `H4U-EP08` | Priority `High` | SP `8` | Component `Channels-OTA` | Sprint `S6`
2. User Story: כ-Channel Manager, אני צריך webhook ingestion ל-create/update/cancel/no-show מ-OTA.
3. Acceptance Criteria:
1. Given OTA webhook valid, when event מתקבל, then reservation מתעדכנת idempotently.
2. Given duplicate webhook, when אותו event_id מגיע שוב, then לא נוצר שינוי כפול.
3. Sub-tasks:
1. webhook endpoints per channel.
2. signature validation.
3. idempotency store.
4. failure retry queue.
4. QA Test Cases:
1. out-of-order events.
2. duplicate event handling.
5. Dependencies:
1. `H4U-RES-001`.
2. `H4U-RES-034`.

### H4U-RES-036

1. Jira Fields: `Story` | Epic `H4U-EP08` | Priority `High` | SP `5` | Component `Channels-OTA, RBAC-Audit` | Sprint `S6`
2. User Story: כ-Operations Lead, אני צריך reconciliation dashboard לשגיאות סנכרון.
3. Acceptance Criteria:
1. Given sync failure, when נרשמת, then מופיעה ב-dashboard עם root cause ו-action.
2. Given operator marks resolved, when נשמר, then נוצר audit trail.
3. Sub-tasks:
1. reconciliation table model.
2. FE dashboard list + filters.
3. retry sync action.
4. QA Test Cases:
1. failure -> retry success.
2. failure unresolved aging alert.
5. Dependencies:
1. `H4U-RES-035`.
2. `H4U-RES-041`.

---

## EPIC H4U-EP09: Messaging and Guest Communication

### H4U-RES-037

1. Jira Fields: `Story` | Epic `H4U-EP09` | Priority `High` | SP `5` | Component `Messaging, Reservations-Frontend` | Sprint `S5`
2. User Story: כ-Agent, אני צריך Compose Message מתוך הזמנה עם template או תוכן חופשי.
3. Acceptance Criteria:
1. Given compose modal, when בוחרים template ושולחים, then נוצר email event.
2. Given custom message, when submit, then נשמר body sanitized.
3. Sub-tasks:
1. compose modal UI.
2. template picker.
3. sanitize pipeline.
4. send API integration.
4. QA Test Cases:
1. HTML injection blocked.
2. template variables missing.
5. Dependencies:
1. `H4U-RES-021`.

### H4U-RES-038

1. Jira Fields: `Story` | Epic `H4U-EP09` | Priority `Medium` | SP `3` | Component `Messaging` | Sprint `S5`
2. User Story: כ-Compliance, אני צריך Rate Limit למשלוחי מייל.
3. Acceptance Criteria:
1. Given יותר מ-10 מיילים בשעה להזמנה, when user שולח, then action נחסם עם הודעה ברורה.
2. Sub-tasks:
1. limiter service.
2. user feedback mapping.
3. monitoring metrics.
4. QA Test Cases:
1. burst send 12 messages.
5. Dependencies:
1. `H4U-RES-037`.

### H4U-RES-039

1. Jira Fields: `Story` | Epic `H4U-EP09` | Priority `Medium` | SP `5` | Component `Messaging, Reservations-Frontend` | Sprint `S6`
2. User Story: כ-Agent, אני צריך Email Messages tab עם סטטוס sent/delivered/failed/scheduled.
3. Acceptance Criteria:
1. Given sent email, when פותחים tab, then הסטטוס מופיע עם timestamp.
2. Given failed email, when פותחים, then מוצגת סיבת כשל.
3. Sub-tasks:
1. messages log endpoint.
2. tab UI.
3. filtering by status.
4. QA Test Cases:
1. failed then resend success trace.
5. Dependencies:
1. `H4U-RES-037`.

---

## EPIC H4U-EP10: Bulk Actions and Operational Speed

### H4U-RES-040

1. Jira Fields: `Story` | Epic `H4U-EP10` | Priority `High` | SP `8` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S6`
2. User Story: כ-Front Desk Supervisor, אני צריך Bulk Check-in/Check-out בטוח.
3. Acceptance Criteria:
1. Given multiple selected rows, when bulk check-in, then רק רשומות שעוברות guards מתעדכנות והשאר מסומנות שגיאה.
2. Given bulk check-out, when יש outstanding balance, then policy מופעלת לכל רשומה בנפרד.
3. Sub-tasks:
1. bulk selection UX.
2. bulk endpoint.
3. partial success response model.
4. downloadable error report.
4. QA Test Cases:
1. mixed valid/invalid batch.
2. 200 records performance run.
5. Dependencies:
1. `H4U-RES-026`.
2. `H4U-RES-027`.

### H4U-RES-041

1. Jira Fields: `Story` | Epic `H4U-EP10` | Priority `Medium` | SP `5` | Component `Reservations-Frontend, Reservations-Backend` | Sprint `S6`
2. User Story: כ-Operations, אני צריך Bulk Add Payment ו-Bulk Update עם Audit.
3. Acceptance Criteria:
1. Given selected reservations, when bulk add payment, then transaction entries נרשמות לכל reservation עם audit.
2. Given unsupported operation, when request sent, then מתקבלת שגיאה פר-רשומה.
3. Sub-tasks:
1. bulk payment modal.
2. server transaction batching.
3. audit batching.
4. QA Test Cases:
1. batch rollback behavior.
5. Dependencies:
1. `H4U-RES-031`.

### H4U-RES-042

1. Jira Fields: `Story` | Epic `H4U-EP10` | Priority `Medium` | SP `3` | Component `Reservations-Frontend` | Sprint `S7`
2. User Story: כ-Manager, אני צריך Bulk Delete/Restore עם הגנות הרשאה.
3. Acceptance Criteria:
1. Given user ללא הרשאה, when bulk delete, then action חסום.
2. Given restore action, when reservation eligible, then status משוחזר לפי policy.
3. Sub-tasks:
1. delete/restore UI flow.
2. permission checks.
3. irreversible warning copy.
4. QA Test Cases:
1. attempt delete by readonly role.
5. Dependencies:
1. `H4U-RES-034`.

---

## EPIC H4U-EP11: RBAC, Audit and Compliance

### H4U-RES-043

1. Jira Fields: `Story` | Epic `H4U-EP11` | Priority `Highest` | SP `8` | Component `RBAC-Audit` | Sprint `S1`
2. User Story: כ-Owner, אני צריך מטריצת הרשאות מלאה לכל פעולה במודול הזמנות.
3. Acceptance Criteria:
1. Given role matrix, when משתמש מבצע פעולה מחוץ להרשאה, then API מחזיר `403` וה-UI מסתיר פעולה.
2. Given permission update, when user relogs, then הכללים נאכפים מיד.
3. Sub-tasks:
1. permissions catalog.
2. middleware authorization.
3. FE action gating map.
4. admin config seed.
4. QA Test Cases:
1. smoke לכל role.
5. Dependencies:
1. `H4U-RES-003`.

### H4U-RES-044

1. Jira Fields: `Story` | Epic `H4U-EP11` | Priority `Highest` | SP `8` | Component `RBAC-Audit, Reservations-Backend` | Sprint `S2`
2. User Story: כ-Compliance, אני צריך Reservation Activity Log מפורט לכל שינוי.
3. Acceptance Criteria:
1. Given status/price/assignment/payment change, when change נשמר, then log entry נכתב עם actor, before, after, timestamp.
2. Given details page, when פותחים tab Activity, then אפשר לסנן לפי סוג אירוע.
3. Sub-tasks:
1. event model schema.
2. audit writer middleware.
3. activity tab endpoint.
4. FE activity list.
4. QA Test Cases:
1. verify before/after diff accuracy.
5. Dependencies:
1. `H4U-RES-001`.
2. `H4U-RES-043`.

### H4U-RES-045

1. Jira Fields: `Story` | Epic `H4U-EP11` | Priority `High` | SP `5` | Component `RBAC-Audit, Messaging` | Sprint `S6`
2. User Story: כ-Compliance, אני צריך Email Delivery Log ברמת הזמנה.
3. Acceptance Criteria:
1. Given email sent, when delivery callback מתקבל, then סטטוס log מתעדכן.
2. Given failed delivery, when מוצג בטאב, then מופיעה סיבת הכשל.
3. Sub-tasks:
1. provider webhook mapping.
2. status state update.
3. tab integration.
4. QA Test Cases:
1. delivered -> opened chain.
5. Dependencies:
1. `H4U-RES-039`.

---

## EPIC H4U-EP12: QA Automation, Observability and Release

### H4U-RES-046

1. Jira Fields: `Story` | Epic `H4U-EP12` | Priority `High` | SP `8` | Component `QA-Automation` | Sprint `S2`
2. User Story: כ-QA Lead, אני צריך סט בדיקות E2E למסלולים קריטיים.
3. Acceptance Criteria:
1. Given pipeline CI, when run e2e suite, then נבדקים flows:
2. create direct reservation
3. split reservation
4. check-in/out
5. cancel direct
6. no-show
7. bulk check-in
8. Sub-tasks:
1. playwright/cypress setup.
2. page objects.
3. test data bootstrap.
4. parallel execution config.
4. QA Test Cases:
1. flaky test threshold מתחת 2%.
5. Dependencies:
1. `H4U-RES-005`.
2. `H4U-RES-014`.

### H4U-RES-047

1. Jira Fields: `Story` | Epic `H4U-EP12` | Priority `High` | SP `5` | Component `Platform, QA-Automation` | Sprint `S6`
2. User Story: כ-Tech Lead, אני צריך Contract Tests ל-API כדי למנוע שבירות FE-BE.
3. Acceptance Criteria:
1. Given OpenAPI spec, when pipeline runs, then כל endpoints המרכזיים מאומתים.
2. Given breaking change, when detected, then build נכשל.
3. Sub-tasks:
1. schema validators.
2. request-response snapshots.
3. pipeline stage.
4. QA Test Cases:
1. intentional breaking change simulation.
5. Dependencies:
1. `H4U-RES-003`.

### H4U-RES-048

1. Jira Fields: `Story` | Epic `H4U-EP12` | Priority `High` | SP `5` | Component `Platform` | Sprint `S7`
2. User Story: כ-DevOps, אני צריך תצפיתיות מלאה (metrics/logs/traces) לתקלות הזמנות.
3. Acceptance Criteria:
1. Given API request, when trace sampled, then ניתן לעקוב cross-service.
2. Given critical errors, when threshold עובר, then alert נשלח ל-on-call.
3. Sub-tasks:
1. tracing instrumentation.
2. metrics dashboard.
3. alert rules.
4. QA Test Cases:
1. synthetic alert drill.
5. Dependencies:
1. `H4U-RES-035`.

### H4U-RES-049

1. Jira Fields: `Story` | Epic `H4U-EP12` | Priority `High` | SP `8` | Component `Platform, Reservations-Frontend, Reservations-Backend` | Sprint `S8`
2. User Story: כ-PM, אני צריך UAT מובנה + Release Checklist ל-Go-Live בטוח.
3. Acceptance Criteria:
1. Given UAT runbook, when מבוצע, then 100% תרחישי P1/P2 חתומים.
2. Given go-live date, when readiness review, then כל gate criteria מסומנים Pass.
3. Sub-tasks:
1. UAT scenario matrix.
2. defect triage protocol.
3. release rollback plan.
4. comms plan לצוותים.
4. QA Test Cases:
1. dry-run full rehearsal.
5. Dependencies:
1. כל הסטוריז הקריטיים S0-S7.

---

## 6) Backlog Prioritization (MoSCoW)

1. Must Have:
1. `H4U-RES-001` עד `H4U-RES-021`
2. `H4U-RES-023`, `H4U-RES-024`, `H4U-RES-026`, `H4U-RES-027`
3. `H4U-RES-030`, `H4U-RES-031`, `H4U-RES-034`, `H4U-RES-043`, `H4U-RES-044`, `H4U-RES-046`
2. Should Have:
1. `H4U-RES-022`, `H4U-RES-025`, `H4U-RES-028`, `H4U-RES-029`, `H4U-RES-032`, `H4U-RES-033`, `H4U-RES-035`, `H4U-RES-037`, `H4U-RES-039`, `H4U-RES-040`, `H4U-RES-041`, `H4U-RES-047`
3. Could Have:
1. `H4U-RES-012`, `H4U-RES-036`, `H4U-RES-038`, `H4U-RES-042`, `H4U-RES-045`, `H4U-RES-048`
4. Won't Have for MVP:
1. Multi-property advanced ledger.
2. Full revenue management optimization.
3. Advanced AI recommendations.

## 7) Risks and Mitigations ברמת ביצוע

1. סיכון: סיבוכיות OTA מסוימת לפי ערוץ.  
Mitigation: להפעיל capability matrix ו-`H4U-RES-034` לפני rollout רחב.
2. סיכון: טעויות כספיות בפוליו.  
Mitigation: transaction idempotency + audit + QA scenarios מורחבים.
3. סיכון: עומס ביצועים ביומן גדול.  
Mitigation: virtualization FE + aggregated queries + cache.
4. סיכון: רגרסיות במעברי סטטוס.  
Mitigation: state machine tests + contract tests + e2e smoke.

## 8) Jira Import Notes (Cloud)

1. מומלץ לייבא קודם את כל ה-Epics.
2. לייבוא ה-Story child relations ב-Jira Cloud חדש מומלץ להשתמש בשדה `Parent`.
3. לוודא `Summary` קיים בכל שורה ב-CSV.
4. לשמור encoding כ-UTF-8.
5. אם מייבאים Epic Link קלאסי, לוודא שמות Epic ייחודיים.

