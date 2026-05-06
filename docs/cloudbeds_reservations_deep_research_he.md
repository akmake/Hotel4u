# Cloudbeds PMS: מחקר עומק ומסמך עבודה מפורט למודול ההזמנות

תאריך מחקר: 6 במאי 2026  
שפה: עברית  
היקף: מיפוי תפעולי-מוצרי של מודול ההזמנות ב-Cloudbeds PMS, כולל זרימות, סטטוסים, כפתורים, תלותי הרשאות ומצבי קצה, לצורך מימוש מערכת מקבילה מאפס (ללא העתקת עיצוב/טקסט/קוד).

## 1) מטרת המסמך

1. לתת מפת מערכת מדויקת ברמת Product/UX/Operations סביב הזמנות.
2. לתרגם את המיפוי ל-Blueprint הנדסי ישים לפיתוח פנימי.
3. להבדיל בין עובדות מאומתות ממסמכי Cloudbeds לבין מסקנות תכנון מומלצות.

## 2) מתודולוגיה ומגבלות

### 2.1 מקורות

המחקר מבוסס על תיעוד רשמי של Cloudbeds Help Center, ובנוסף מקור שוק (HotelTechReport) לצורך הקשר תחרותי בלבד.

### 2.2 מגבלות ידועות

1. אין גישת אדמין/סביבת דמו חיה מאומתת למסכים מאחורי הרשאות לקוח ספציפי.
2. לכן, מיפוי "כל כפתור" הוא לפי תיעוד רשמי + אינפרנס מוצרי מבוקר.
3. ייתכנו הבדלי UI בין Classic/New ו/או בין תפקידים (Roles/Privileges).

### 2.3 רמת ודאות

1. **ודאות גבוהה**: תיאורי תפריטים, זרימות Create/Edit/Check-in/Check-out/Cancel, סטטוסים, פעולות Bulk, OTA rules, Assignment, Folio/Payments.
2. **ודאות בינונית**: מיקרו-אינטראקציות נקודתיות שלא תועדו טקסטואלית בכל מסך.
3. **ודאות נמוכה**: התנהגות פנימית לא מתועדת בצד שרת (למשל סדר בדיקות פנימי לכל ולידציה).

## 3) תמונת מצב מהירה

1. מודול ההזמנות ב-Cloudbeds בנוי סביב 4 מוקדי ניווט ראשיים: `Top Menu`, `Reservations`, `Calendar`, `Reservation Details`.
2. יש ריבוי נקודות כניסה לאותה פעולה (למשל Check-in/Check-out דרך Calendar, Dashboard, Status, Occupied toggle).
3. יש הפרדה ברורה בין Direct reservations לבין OTA reservations, במיוחד בביטולים/עדכונים.
4. המערכת מסתמכת מאוד על סטטוסים, הרשאות משתמש, ורישום Audit (Activity/Email logs).
5. יש דגש תפעולי על טיפול ב-Unassigned, Group/Split reservations, ופעולות Bulk.

## 4) מפת מידע (IA) ומסלולי ניווט

## 4.1 כניסות מרכזיות להזמנות

1. `Top Menu`:
- `+` -> יצירת הזמנה חדשה.
- `Calendar` -> ניהול ויזואלי של הזמנות.
- `Reservations` -> טבלת כל ההזמנות.
- `Search bar` -> קיצור ישיר להזמנה, כולל קיצורי Notes/Folio.

2. `Main Menu`:
- `Dashboard` -> פעולות תפעול מהירות.
- `Calendar` -> הקצאות, חסימות, תאריכים, יצירה מהירה.
- `Reservations` -> חיפוש/סינון/ייצוא/Bulk.

## 4.2 מסכים עיקריים במודול

1. Reservations Page (Classic + New).
2. Calendar.
3. New Reservation flow (Simple/Split).
4. Reservation Details Page (Header + Actions + Tabs).
5. Dashboard (Arrivals/Departures/quick actions).
6. Auxiliary flows: Bulk Actions, OTA cancellation/reconciliation, Unassigned assignment, Payment Gateway flow.

## 5) מודל ישויות וסטטוסים (Product Model)

## 5.1 ישויות ליבה

1. Reservation.
2. Accommodation line(s) בתוך הזמנה (כולל split segments).
3. Guest/Booker + Additional Guests.
4. Assignment (Room/Bed).
5. Folio transactions (charges/payments/refunds/adjustments).
6. Payment instruments (Credit cards / gateway tokens).
7. Notes/Documents.
8. Activity log + Email log.

## 5.2 סטטוסים עיקריים

1. `Confirmed`
2. `Confirmation Pending`
3. `In-House`
4. `Checked Out`
5. `Canceled`
6. `No Show`

נוסף בהקשר תשלום ספציפי: סטטוס זמני `Inquiry` בהקשר 3DS מוזכר במסמך Reservation Details.

## 5.3 כללי סטטוס מרכזיים

1. Check-in אפשרי לתאריך הגעה `today/past` בלבד.
2. Check-out אפשרי לתאריך עזיבה `today/past` בלבד.
3. Check-in דורש Assignment לחדר/יחידה.
4. שינוי סטטוס OTA מחייב סנכרון מול הערוץ (במקרים רבים דרך extranet).

## 6) מיפוי כפתורים ופעולות לפי מסך

הטבלאות להלן הן לב המיפוי המבוקש: "כפתור -> יעד/פעולה -> תנאים -> תוצאה".

## 6.1 Top Menu

| כפתור/אזור | יעד/פעולה | תנאים/הקשר | תוצאה |
|---|---|---|---|
| לוגו נכס | Dashboard | זמין גלובלית | מעבר לדשבורד |
| Search bar | חיפוש הזמנה | שם/אימייל/מספר הזמנה | פתיחת רשומה, קיצורי Notes/Folio |
| `+` | New Reservation | הרשאת יצירה | פתיחת זרימת יצירה |
| Calendar icon | Calendar | הרשאה מתאימה | מעבר ליומן |
| Reservations icon | Reservations page | הרשאה מתאימה | מעבר לטבלה |
| Notifications | מרכז התראות | תלוי rollout | צפייה בהתראות |
| Account menu | Profile/Settings/KB/etc | גלובלי | פעולות משתמש/מערכת |

## 6.2 Reservations Page (New)

| רכיב | פעולה | תנאים | תוצאה |
|---|---|---|---|
| Switch to classic/new | החלפת גרסת מסך | זמינות rollout | מעבר classic/new |
| Header: Import | ייבוא הזמנות | הרשאה | פתיחת ייבוא |
| Header: Export | ייצוא | פילטרים/עמודות | קובץ `.xlsx` |
| Header: Print | הדפסה | תצוגה נוכחית | רשימה מודפסת |
| Search bar | חיפוש | שם/אימייל/טלפון/ID | סינון רשומות |
| Filters icon | Filter drawer | - | הפעלת פילטרים ושמירת מצב |
| Configure table | בחירת עמודות + reorder | - | התאמת טבלה למשתמש |

## 6.3 Bulk Actions

| פעולה | מה עושה | תנאים/סיכונים |
|---|---|---|
| Bulk Check-In | צ'ק-אין למספר רשומות | הרשאות + assignment |
| Bulk Check-Out | צ'ק-אאוט מרובה | Balance due ותלויות הרשאה |
| Bulk Add Payment | רישום/הוספת תשלום בפוליו | ב-gateway לא מבצע חיוב בפועל בפעולת bulk |
| Bulk Delete | מחיקה | בלתי הפיך |
| Bulk Restore | שחזור (לפי מסך) | תלוי מצב רשומה/הרשאה |

## 6.4 Calendar

| רכיב | פעולה | הערות |
|---|---|---|
| מספר כחול מעל תאריך | Assignments | פתיחת כלי הקצאות |
| Jump to date | קפיצה לתאריך | ניווט מהיר |
| Room search | חיפוש חדר | סינון יומן |
| Modify availability | New reservation / Block / Courtesy Hold / OOS | גם ישירות מהגריד |
| Today | חזרה להיום | - |
| All Room Types | החלפת תצוגה | לפי room type |
| Legend | הסברים לאייקונים/צבעים | פירוש סטטוסים ותגים |

### 6.4.1 קליק על reservation bar ביומן

| פעולה בפאנל הסיכום | תנאי | תוצאה |
|---|---|---|
| Check in / Confirm / Check out | תלוי status | שינוי סטטוס/מעבר פרטים |
| Reservation details | - | פתיחת Reservation Details |
| Unassign room | אם הוקצה חדר | ביטול הקצאה |
| Quick Edit | - | עריכת תאריכים/פיצול |
| Lock/Unlock assignment | לפי מצב נעילה | נעילת/שחרור הקצאה |

## 6.5 New Reservation Flow

## 6.5.1 נקודות כניסה

1. `+` בטופ בר.
2. Calendar.
3. Reservations page.
4. Dashboard.

## 6.5.2 Simple View (עיקרי)

1. Step 1: Search availability
- בחירת Source.
- תאריכי check-in/check-out.
- allotment/promo code.
- Search.
- בחירת accommodation/מחיר/כמות אורחים/כמות חדרים.
- Booking Details.

2. Step 2: Guest details
- ETA.
- Assignment (אופציונלי).
- Mandatory fields (first name, last name, email, country).
- Add-ons.
- Confirm and Pay.

3. Step 3: Confirm and pay
- Payment type / אפשרות לא לאסוף תשלום עכשיו.
- אופציה ל-auto check-in בסיום.
- Confirm reservation.
- pop-up: send email / continue without sending.

## 6.5.3 Split View

1. בחירת רצף תאריכים על פני room types שונים.
2. אין תמיכה בגאפ בין תאריכים (דורש הזמנה נפרדת).
3. דגל אפור מסמן split requiring room move.
4. ממשיך לאותו שלב פרטי הזמנה ותשלום.

## 6.6 Reservation Details Page

## 6.6.1 Header

1. Guest + Reservation ID.
2. Reservation status + guest status.
3. Reservation metadata (dates/source/nights/guests).
4. Balance due breakdown.
5. Custom fields.

## 6.6.2 Actions menu

| Action family | תתי פעולות |
|---|---|
| Invoice | Email invoice / Generate new invoice |
| Email | Email folio / Compose message |
| Print | Print folio / Print confirmation / Registration cards |
| Export | XLSX / PDF |
| Delete | Delete reservation |

הערה: ב-Booking.com מופיעה גם פעולה Report Guest Misconduct.

## 6.6.3 Tabs

| Tab | שימוש עיקרי |
|---|---|
| Accommodations | עריכה, פיצול, assignment, occupied toggle |
| Folio | חיובים/תשלומים/החזרים/התאמות |
| Guest Details | פרטי אורח, רישום, תמונות |
| Credit Cards | שמירה/ניהול כרטיסים |
| Notes | הערות שהייה |
| Documents | העלאת מסמכים + invoices |
| Reservation Activity | audit trail של שינויים |
| Email Messages | סטטוס מיילים להזמנה זו |

## 6.7 Check-in / Check-out (4 מסלולים רשמיים)

1. Calendar -> reservation -> Check-In/Check-Out.
2. Dashboard -> Arrivals/Departures -> פעולה.
3. Reservation page -> שינוי סטטוס ל-`In-House`/`Checked Out`.
4. Accommodations tab -> toggle `Occupied` YES/NO.

## 6.8 ביטול הזמנה Direct

### תהליך תפעולי מלא

1. יישוב ביטול:
- גביית cancellation revenue/fee, או
- החזר פיקדון, או
- אפסון balance דרך עריכת מחיר.

2. שינוי סטטוס ל-`Canceled`.
3. בחירת אחת מאפשרויות המייל:
- Confirm cancellation
- Cancel and email guest
- Cancel and email guest (without rates)

### דגשים

1. ביטול לא מחזיר תשלום gateway אוטומטית.
2. Pending transactions מוסרים מה-folio אך balance/reporting מחייבים הבנה מדויקת לפי סוג טרנזקציות.

## 6.9 OTA cancellation / modification

1. ביטול OTA בחלק מהערוצים אפשר ישירות ב-PMS (Hostelworld/Tripadvisor/Coliving/VRBO/Expedia).
2. שינויים (תאריכים/חדר/אורח/no-show) עקרונית דרך extranet של הערוץ.
3. אי-סנכרון דו-צדדי יוצר סיכון overbooking.
4. הזמנות OTA שיובאו ידנית ללא source reservation ID תקין עלולות לייצר כפילויות בעדכונים/ביטולים.

## 6.10 Unassigned flow

1. זיהוי:
- ב-Calendar לפי מונה מעל תאריך.
- ב-Reservations לפי `N/A` בעמודת חדר.
- ב-Activity log לפי אירועי assignment.

2. הקצאה:
- דרך Assignments ביומן.
- דרך Assignment dropdown ב-Reservation Details.
- דרך Dashboard (יכול להעביר ל-In-House בהקשר מסוים).

3. סיבות נפוצות ל-Unassigned למרות Availability:
- lack of continuous availability
- locked/blocked/out-of-service units
- full occupancy edge
- shared/split constraints
- auto-assign setup limitations

## 6.11 Messaging from reservation

1. Actions -> Compose Message.
2. Template או Custom.
3. הגבלת אבטחה: עד 10 אימיילים בשעה.
4. מעקב דרך Email Messages tab + Delivery Log.

## 6.12 Payments via gateway

1. Folio -> `+Add` -> Payment.
2. בחירת אורח/folio/סכום/Payment type.
3. מצבי ביצוע:
- Charge
- Pre-authorize
- Record previous payment (no gateway charge)

4. אפשרות ניהול גם מתוך Credit Cards tab (Authorize/Capture/Void).

## 7) זרימות E2E קריטיות לפיתוח

## 7.1 New Direct Reservation -> Check-in -> Check-out

1. כניסה מ-`+`.
2. חיפוש זמינות ובחירת חדרים.
3. מילוי פרטי אורח חובה.
4. Confirm and pay.
5. Assignment (אם לא הוגדר).
6. Check-in.
7. חיובים/תשלומים/התאמות ב-Folio.
8. Check-out.

## 7.2 OTA Reservation lifecycle

1. Import/arrival from channel.
2. שמירת source/origin + third-party ID.
3. שינויים בעיקר דרך OTA extranet.
4. ביטול: לפי channel capability (PMS vs extranet).
5. reconciliation/logging עבור כשלי sync.

## 7.3 Unassigned Handling

1. detect via calendar counter / reservations filter.
2. assign room תוך בדיקת רציפות לילות.
3. lock/unlock assignment לפי צורך תפעולי.
4. audit trail לכל שינוי.

## 8) מצבי קצה וסיכונים

1. שינוי OTA רק בצד PMS -> חוסר סנכרון והחזרת זמינות שגויה.
2. הזמנות ידניות OTA ללא ID תקין -> duplicate upon updates.
3. bulk checkout בלי שליטה על balances -> טעויות גבייה.
4. split reservations + room moves -> עומס תפעולי וסיכון טעויות.
5. past-date reservations + סטטוסים -> תלות בהרשאות ומצבי חדר קודמים.
6. confirmation pending policy -> חוויית לקוח שונה ותלות בתשלום.

## 9) Blueprint הנדסי למימוש מאפס

## 9.1 ארכיטקטורה פונקציונלית

1. `Reservation Core`.
2. `Inventory & Assignment`.
3. `Folio & Payments`.
4. `Channel Sync`.
5. `Messaging`.
6. `Audit/Logs`.
7. `RBAC`.

## 9.2 הצעת Routes (Frontend)

1. `/dashboard`
2. `/reservations`
3. `/reservations/new`
4. `/reservations/:id`
5. `/calendar`
6. `/reports/room-assignments`

## 9.3 הצעת מודל נתונים (high-level)

1. `reservations`
2. `reservation_segments` (ל-split)
3. `reservation_assignments`
4. `guests`
5. `reservation_guests`
6. `folios`
7. `folio_transactions`
8. `payment_methods`
9. `reservation_notes`
10. `reservation_documents`
11. `reservation_activity_log`
12. `channel_links` (source/origin/third_party_id)

## 9.4 סטייט משין מומלץ

1. Allowed transitions:
- `Confirmation Pending -> Confirmed`
- `Confirmed -> In-House`
- `In-House -> Checked Out`
- `Confirmed/In-House -> Canceled` (בכפוף לכללים)
- `Confirmed/Pending -> No Show`

2. Guards:
- Check-in guard: arrival_date <= today AND assignment exists.
- Check-out guard: departure_date <= today.
- OTA guard: enforce reconciliation/extranet rules.
- Balance guard: לפי policy/role לפני checkout.

## 9.5 API חתך ראשוני

1. `POST /reservations/search-availability`
2. `POST /reservations`
3. `PATCH /reservations/:id`
4. `PATCH /reservations/:id/status`
5. `POST /reservations/:id/assignments`
6. `DELETE /reservations/:id/assignments/:assignmentId`
7. `POST /reservations/:id/folio/payments`
8. `POST /reservations/:id/folio/charges`
9. `POST /reservations/:id/messages`
10. `POST /reservations/bulk-actions`
11. `POST /channels/webhooks/{channel}`
12. `GET /reservations/:id/activity`

## 9.6 RBAC מינימלי

1. Create/Modify reservation.
2. Modify past dates.
3. Change reservation status.
4. Bulk actions by type.
5. View/edit PII.
6. View revenue/folio actions.
7. Channel reconciliation permissions.

## 9.7 Audit requirements

לוג מפורט עבור:
1. שינוי סטטוס.
2. assignment add/remove/modify.
3. price edit/split changes.
4. folio transactions.
5. messaging send/resend.
6. OTA sync failures/success.

## 10) תכנית יישום מדורגת

## שלב A: MVP תפעולי (8-12 שבועות)

1. Reservations list + filters.
2. Create (simple view) + reservation details בסיסי.
3. Calendar בסיסי + assignments.
4. Status transitions עיקריים.
5. Folio בסיסי (charges/payments).
6. RBAC בסיסי + activity log.

## שלב B: Production core (4-6 חודשים)

1. Split reservations.
2. Bulk actions.
3. Messaging + templates בסיסיים.
4. OTA rules בסיסיים + webhooks.
5. export/import workflows.
6. מסכי חריגות/No-show/Unassigned tooling.

## שלב C: Advanced parity (9-18 חודשים)

1. Deep reconciliation by channel (כולל Expedia-like).
2. Payment allocation/advanced receipts.
3. full dashboard action drawers.
4. multi-property exports/reporting.
5. automation policies מתקדמות (confirmation pending auto rules, etc.).

## 11) מה עוד צריך כדי להגיע ל"ממש 100%"

1. גישת sandbox/tenant בדמו של המוצר.
2. capture של כל modal state לכל סטטוס.
3. capture של הרשאות role-by-role למסכים.
4. capture של התנהגות בזמן תקלות API/sync (timeouts/retries/duplicates).

## 12) מסקנה אופרטיבית

אפשר לבנות אצלכם מערכת הזמנות ברמה גבוהה מאוד על בסיס המיפוי הזה כבר עכשיו, בלי להעתיק קניין רוחני.

מה שתקבלו מיד:
1. שפה תפעולית ברורה לצוותים.
2. רשימת פיצ'רים וסדרי עדיפויות.
3. State model יציב למניעת regression.
4. בסיס ישים לאפיון טכני וספרינטים.

## 13) מקורות

1. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/16464111837211-General-Information-Cloudbeds-PMS-Menus-and-Site-Map
2. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/217997248-Create-a-new-reservation-in-Cloudbeds-PMS
3. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/221677468-Check-in-and-check-out-guests-in-Cloudbeds-PMS
4. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/18387139910939-Manage-reservations-on-the-calendar
5. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/235146587-Calendar-Everything-you-need-to-know
6. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/8354513114907-Reservation-Details-Page-Everything-you-need-to-know
7. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/17794963964187-Manage-the-Reservation-Details-Page-tabs
8. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/219146188-Cancel-direct-reservations
9. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/216541178-Cancel-or-modify-OTA-reservations
10. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/217997178-Find-and-handle-unassigned-reservations
11. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/218512767-Update-Multiple-Reservations-through-the-Bulk-Action-option
12. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/115000400634-Dashboard-Everything-you-need-to-know
13. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/115004212114-Compose-Message-in-the-Reservation-Details-Page
14. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360040784314-How-to-process-payments-through-payment-gateway
15. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4597542673947-Confirmation-Pending-Page
16. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/15326319135131-Reservations-FAQ
17. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/28409627448091--New-Reservations-Page-Pilot-Everything-you-need-to-know
18. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/22794187290011-Expedia-reconciliation-feature-Cancel-and-update-reservations-from-within-Cloudbeds-PMS
19. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/40771665486363-Your-Cloudbeds-PMS-Daily-Operations-Guide
20. https://hoteltechreport.com/news/best-hotel-tech-list/2026
