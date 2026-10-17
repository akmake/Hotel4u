# Hotel4u ↔ INVOISER — מפרט אינטגרציה פיננסית בין שתי מערכות עצמאיות

> **גרסה:** 2.0 · **עדכון:** 18.10.2026 · **סטטוס:** מסמך אינטגרציה, מפת אחריות ומבחני קבלה.  
> **ארכיטקטורה מאושרת כמטרת מוצר:** Hotel4u היא PMS ומערכת מקור; INVOISER היא מערכת חשבונות/הנפקה עצמאית המחוברת ב־API.  
> **מצב בפועל:** לפי README ו־API במאגר INVOISER, החיבור עדיין לא הופעל ומערכת INVOISER היא **sandbox בלבד**, עם מסמכי TEST ללא תוקף פיסקלי. אין להסיק מכאן שיש הפקת מסמכים חיה.  
> **מקור האמת הרגולטורי והחשבונאי:** [INVOISER — ISRAEL_ACCOUNTING_SPECIFICATION.md](https://github.com/akmake/invoicer/blob/main/docs/ISRAEL_ACCOUNTING_SPECIFICATION.md).  
> **המסמך שקדם לשינוי הארכיטקטורה:** [גרסה היסטורית של המפרט המונוליתי](https://github.com/akmake/Hotel4u/blob/6bd0a93b32ff08b820d3e4e2e275135573738549/docs/specification/14-israel-accounting-engine-implementation.md). תוכנו המלא, כולל מקרי קצה ודרישות חשבונאות, נשמר והותאם במפרט הראשי של INVOISER.

## 1. הסכם בעלות ומקור אמת

**הכלל המחייב:** Hotel4u יכולה להחזיק חיובים, Folios ודוחות תפעוליים, אבל לאחר Cutover היא **אינה מנפיקה קבלות, חשבוניות או זיכויים חדשים במספור עצמאי**. כל מסמך חוקי חדש ייווצר ב־INVOISER בלבד, אחרי שהיא תהיה כשירה לכך.

| נושא | Hotel4u | INVOISER |
|---|---|---|
| מקור הזמנה והזמנה חיצונית | מקור אמת | reference בלבד |
| חדר, שהייה, אורחים, check-in/out | מקור אמת | נתוני שירות רלוונטיים |
| Folio וחיובי מחלקה | מקור תפעולי | Snapshot שורות לחיוב |
| שירות, תעריף, הנחה, שירותי חבילה | מחשב מקור עסקי | Validates tax/document and persists fiscal snapshot |
| מי השוהה / מזמין / משלם | מקור קשרים ומידע | מאמת Party roles ושומר Customer/Issuer Snapshot |
| ניסיון תשלום/תוצאת מסוף | מקור אירוע לפי Provider Ownership מוסכם | רישום תקבול/אסמכתה ופיוס |
| מספר מסמך חשבונאי | אין הקצאה חדשה | בעלות יחידה |
| חשבונית, קבלה, זיכוי | מציג סטטוס ומסמך שהופק | יוצר ומשמר מקור |
| סיווג מס, מע״מ, תיעוד הסכמה וחתימה | אוסף ראיות ופרטי שירות לפי הדין | מפעיל Tax Decision ו־Signing/Delivery |
| הנהלת חשבונות וספר ראשי | תפעול בלבד, בכפוף לבדיקת תחולת הדין על PMS | מקור פקודות יומן ויתרות חשבונאיות |
| רשות המסים | לא מפעיל API הקצאה כמנפיק | מפעיל לאחר מימוש והרשאות |
| קובץ במבנה אחיד ותיק רישום | אינו יוצר "קובץ אחיד" מתחרה | ממומש ומוגש לאחר אישור |
| Audit | Audits עסקיים של PMS | הנפקה, חתימה, הקצאה, תיקונים, ספרים |

**דגש משפטי:** החלוקה הטכנית אינה בהכרח פוטרת את Hotel4u מחובות שנובעות מהפעולות שנותרו בה. יש לבחון עם גורם מקצועי את חובת רישום התוכנה ואת המשמעות של Folio, קופות, דוחות וספרי חשבונות מקומיים.

## 2. איך תעבוד הארכיטקטורה

~~~text
                [Hotel4u — PMS]
     Reservation / Guest / Stay / Folios / Charges
                       |
           Financial Integration Adapter
     (Server Only, Auth, Idempotency, Outbox)
                       |
              HTTPS / INVOISER API v1
                       |
              [INVOISER — sandbox]
     Customers / Workspaces / TEST Documents
     Payments / Journal / Audit / Tax Rules
                       |
                (עתידי בלבד)
 Signing + Live Fiscal Documents + Tax Allocation
     Uniform File + Approved Registration
~~~

- אין לקרוא למסד MongoDB של INVOISER מתוך Hotel4u; אין להכניס dependency למודלים של INVOISER בשרת המלון.
- Hotel4u קוראת רק HTTP API שמתועד ב־INVOISER, ולא מנחשת שמות endpoints.
- שינוי API Breaking דורש גרסה, בדיקות צרכן, תכנית מעבר ועדכון מסמכים בשני המאגרים.
- INVOISER אינה יודעת אם האירוע הגיע מ־Hotel4u או מ־PMS אחר; sourceSystem=hotel4u הוא ערך מקור ולא תלות בקוד.
- מצבי Payment / Document / Allocation / Signature / Delivery נפרדים; לא שדה status יחיד.

## 3. מיפוי ישויות — מסוכן במיוחד לרשתות

### 3.1 אבחנה בין זהויות

- tenant: לקוח SaaS וקבוצת משתמשים במערכת.
- legalEntity: חברה/עוסק שצריכים להפיק מסמכים בשמם.
- property: מלון פיזי, סניף או נכס.
- workspace: סביבת INVOISER שמתקבלת מה־API ונגישה לפי tenant/sourceSystem.
- sourceSystem: מפתח מקור המוגדר למפתח ה־API, למשל hotel4u.
- sourceId: מזהה יציב שה־API של INVOISER מזהה כ־Workspace מקור.
- reservationId: מזהה ההזמנה במערכת המלון.
- folioId: מזהה חשבון אורח, לא מזהה חברה.
- customerId: הלקוח המשפטי למטרת המסמך, לא בהכרח Guest.
- payerId: משלם בפועל.
- issuerId: הישות המשפטית המנפיקה.

**החלטת מיפוי פתוחה וחוסמת:** האם Workspace ב־INVOISER מייצג legalEntity יחידה או הקשר אחר? אסור ליצור Workspace לכל Property בלי בדיקה. חברה עם ארבעה מלונות יכולה להזדקק למנפיק אחד ומספרי מסמכים רציפים לפי הדין; Tenant עם שתי חברות אינו רשאי לערבב מספרי עוסק ומסמכים.

### 3.2 ה־lookup הנדרש

~~~text
Hotel4u.tenantId + Hotel4u.legalEntityId
    → Invoiser.apiSource (hotel4u)
    → Invoiser.workspaceId (מופה מראש)
    → Invoiser.issuerProfile / taxId (מאומת)
~~~

- המיפוי מחזיק createdAt, verifiedBy, legalName, taxId, status, version.
- נדרשת בדיקת התאמה על כל POST document; propertyId לבדו אינו הרשאה.
- Tax ID או issuer משתנים רק באמצעות תהליך מנהל מבוקר — לא משום שמשתמש ערך כתובת מלון.
- נסגר מיפוי? אין למחוק מסמכים היסטוריים, ואסור לשייך מסמך ישן אוטומטית למנפיק חדש.
- sandbox workspace לא הופך ל־live workspace אוטומטית.

## 4. API קיים של INVOISER — מקור טכני מחייב

הנתיבים שלהלן קיימים לפי [docs/API.md ב־INVOISER](https://github.com/akmake/invoicer/blob/main/docs/API.md). Base URL מקומי: http://127.0.0.1:4310; בייצור HTTPS בלבד.

| פעולה ב־Hotel4u | בקשת INVOISER | תגובה/הגבלה |
|---|---|---|
| חיבור עוסק | POST /v1/workspaces | sourceId קבוע, שינוי פרטי עסק בשם אותו מזהה נדחה |
| טעינת רשימת עוסקים למקור | GET /v1/workspaces?sourceId=... | מפתח API תחום למקור |
| חיפוש/יצירת לקוח | GET/POST /v1/workspaces/{id}/customers | רשימת לקוחות מוגבלת ו־scope |
| יצירת טיוטת מסמך | POST /v1/workspaces/{id}/documents | סכומי Decimal String; עד 100 שורות |
| שינוי טיוטה | PATCH /v1/workspaces/{id}/documents/{docId} | Version/optimistic concurrency |
| הנפקת **TEST** | POST /v1/workspaces/{id}/documents/{docId}/issue | TEST בלבד, אין ערך חשבונאי חוקי |
| זיכוי **TEST מלא** | POST /v1/workspaces/{id}/documents/{docId}/credit | דורש reason; לא תומך בזיכוי חלקי |
| קליטת אירוע | POST /v1/workspaces/{id}/events | pending, ללא הפקה/Posting אוטומטיים |
| רישום תקבול | POST /v1/workspaces/{id}/payments/manual | לא מחייב כרטיס, לא מפיק קבלה |
| Payment Intent | POST /v1/workspaces/{id}/payment-intents | חסום ללא Adapter סליקה |
| פקודת יומן | POST /v1/workspaces/{id}/journals | לא ליצור באופן עצמאי ב־Hotel4u אחרי מימוש Posting Engine |

תשובת API הצלחה {success:true,data:...}; שגיאה {success:false,error:{code,message},requestId}. הרשאות ב־Bearer API Key בשרת בלבד; מפתחות מגובבים ומוגבלים ל־sourceSystem ו־tenant.

**אסור ללקוח Hotel4u להציג כפתור "הפק חשבונית מס חוקית" שמפעיל את /issue הנוכחי**: הוא מפיק TEST בלבד.

### 4.1 חוזה מספרים ודיוק

- Amounts, Unit Prices, Quantity, VatRate נשלחים כמחרוזות עשרוניות; לא Numbers של JavaScript שמחשבים אגורות.
- מטבע ISO 4217 + Currency in/out מוגדרים מפורשות בתסריטי המרה.
- שיעור VAT במסמך בדיקה אינו החלטת מס חוקית; ב־LIVE רק Tax Decision של INVOISER קובע.
- UTF-8, עברית ושדות בינלאומיים נשמרים בלי לשנות ניקוד/סימני פיסוק בחשבוניות היסטוריות.
- לכל סכום משויך מקור, מועד שירות, מחלקה, סוג תשלום ומזהה פעולה כשנדרש.
- גוף בקשה ב־API מוגבל כיום ל־256KB; אין לשלוח PDF, צילומי דרכונים או תיעוד נרחב בתוך payload.

## 5. אירועים וחוזה סנכרון

### 5.1 מעטפת אירוע לוגית

~~~json
{
  "eventId": "hotel4u:finance:01",
  "eventType": "folio.charge.posted",
  "sourceSystem": "hotel4u",
  "sourceId": "legal-entity-001",
  "sourceVersion": 1,
  "tenantId": "tenant-001",
  "propertyId": "hotel-001",
  "reservationId": "res-001",
  "folioId": "folio-001",
  "occurredAt": "2026-10-18T10:00:00+03:00",
  "payload": {
    "chargeId": "charge-001",
    "serviceDate": "2026-10-18",
    "description": "לילה אחד",
    "amount": "1180.00",
    "currency": "ILS"
  }
}
~~~

**זו מעטפת מוצר מוצעת, לא גוף הבקשה הקיים של POST /events.** ב־API הנוכחי הגוף הוא לדוגמה type, sourceId, payload תחת Workspace. המתאם יבצע Mapping לפי חוזה ה־API הקיים. אין לשלוח פרטי אורח, דרכון או שדות פיננסיים שאינם נדרשים.

### 5.2 קטלוג אירועים שיש להגדיר

| Event | טריגר | מה עושה INVOISER |
|---|---|---|
| reservation.confirmed | הזמנה אושרה | תיעוד בלבד; אין קבלה |
| reservation.cancelled | הזמנה בוטלה | תהליך בדיקה, לא Delete למסמך |
| stay.checked_in | הגעה | קישור service event/מסמכי אורח נדרשים |
| folio.charge.posted | שורת חיוב פורסמה | שמירת מקור; בחירת מסמך רק לפי כלל מאושר |
| folio.charge.reversed | תוקן חיוב לא־סופי | Event חדש וקישור, ללא מחיקה |
| payment.authorized | נתפסה מסגרת | לא תקבול, אין קבלה |
| payment.captured | התקבלה אינדיקציית חיוב | בירור מקור/מועד תקבול והפקה בהתאם |
| payment.settled | התחשבנות ספק | התאמת סליקה/בנק |
| payment.refunded | החזר בוצע | רישום בנפרד מזיכוי מסמך |
| payment.chargeback | מחלוקת חיוב | היסטוריה/בירור/התאמה |
| folio.document.requested | משתמש מבקש מסמך | יצירת טיוטה לפי הרשאות ונתוני חובה |
| stay.checked_out | עזיבה | סגירת תהליך PMS, לא ביטול אוטומטי של מסמך |

### 5.3 מניעת כפילויות ותקלות

- לכל אירוע מזהה יציב שאינו משתנה ב־Retry; אין להשתמש בזמן נוכחי כ־Idempotency-Key.
- API /events מכניס event ל־pending: Hotel4u לא מסיקה שהמסמך כבר הונפק.
- בעת Timeout מצב הפעולה הוא unknown עד Query/Reconciliation; לא מבצעים Create חדש עם מפתח חדש.
- INVOISER מחזירה מזהה מסמך/תשלום וקישורים. Hotel4u שומרת אותם ברשומת Integration Mapping.
- Document Final/Tax Decision נשמרים רק ב־INVOISER; Hotel4u רשאית לשמור Cache של קריאה.
- אין עסקת DB משותפת למערכות; צריך Outbox ב־Hotel4u ו־Inbox/Idempotency ב־INVOISER.
- שינוי סדר אירועים לא יחזיר מסמך/תשלום לסטטוס ישן.

## 6. Workflows של מערכת המלון

### W01 — הזמנה ללא תשלום

Reservation confirmed → Hotel4u משדרת Event → INVOISER רושמת אירוע לבירור/מידע. לא יוצרים קבלה.

### W02 — מקדמה לפני הגעה

הזמנה → אמצעי תשלום → Capture/Transfer confirmed → Payment Event → INVOISER בוחנת את סוג המסמך, עיתוי מס ו־Ledger לפי דין. לא כל מקדמה יוצרת מסמך זהה; ההכרעה נדרשת מראש.

### W03 — Authorization בלבד

Hotel4u תופסת מסגרת בכרטיס ללא Capture → INVOISER אינה יוצרת תקבול. מוצג ל־Hotel4u סטטוס authorization בלבד.

### W04 — צ׳ק־אאוט מלא

Folio closing preview → זיהוי כל החיובים שטרם זוכו/הופקו → בקשת מסמך מ־INVOISER → אישור סטטוס ו־Document ID → תצוגת מסמך מקור/העתק רק מ־INVOISER. כשל מסירה אינו מבטל חשבונית; חוב פתוח אינו נמחק כדי לפנות חדר.

### W05 — חברה משלמת והאורח משלם תוספות

Guest = אדם השוהה; Customer של חשבונית החדר = חברה; Payer עשוי להיות צד שלישי; Extras ב־Folio נפרד. INVOISER מקבלת Buyer/Payer/Issuer מפורשים; אין שימוש בשם האורח כ־Buyer אוטומטי.

### W06 — ביטול, זיכוי והחזר

Hotel4u מאשרת את השינוי בהזמנה לפי הכללים → INVOISER יוצרת מסמך תיקון לפי דין → מנגנון תשלומים מנסה החזר בנפרד → Hotel4u מציגה מצבים שונים (cancelled, credited, refund_pending/refunded). אם ההחזר נכשל, לא מוחקים את הזיכוי.

### W07 — OTA (Booking / Expedia / סוכן)

מגדירים Contract Role: מי המוכר המשפטי, מי גובה, מי מחזיק כספים, האם מדובר ב־VCC, gross/net, עמלת סוכן. אין להסתמך על "Booking" כמי שמוציא אוטומטית את החשבונית.

### W08 — תייר ושירותים מעורבים

Hotel4u אוספת ראיות זכאות מינימליות ו־Service Category. INVOISER קובעת VAT לכל שורה לפי דין וגרסת כלל מאושרת; אין "דרכון זר = אפס" ואין החלת שיעור לינה אוטומטית על ספא/מסעדה.

### W09 — Day Close

Hotel4u מבצעת Night Audit, שומרת Service Date ו־Business Date נפרדים; INVOISER מנהלת Accounting Date ו־Issued At. סגירת יום לא יוצרת מסמך שני אם ריצת Night Audit חוזרת אחרי תקלה.

### W10 — Legacy Migration

חשבוניות Hotel4u קיימות טרם Cutover נותרות זמינות היסטורית עם מספרן המקורי; לא מנפיקים מחדש אותן חשבוניות ב־INVOISER. חיובים/מקדמות פתוחים עוברים עם אסמכתה, Balance Reconciliation, החלטת רואה חשבון וחותמת Cutover.

## 7. התנהגות Legacy ב־Hotel4u לפני החיבור

ב־Hotel4u קיימים כרגע רכיבים כגון server/services/invoiceService.js, server/models/Invoice.js ו־server/routes/invoice.js, לצד server/services/financeService.js, ledgerService.js ו־touristService.js.

הכלל:
1. לא למחוק אותם באופן גורף: הם משמשים תפעול, נתונים היסטוריים ומסכי מלון.
2. לפני Cutover, לאתר **כל** נתיב שמסוגל להפיק מספר מסמך, לזכות מסמך או לשנות רשומה סופית.
3. להגן על נתיבי LEGACY issuance באמצעות Feature Gate ברור, תיעוד והחלטת מוצר/רגולציה — ולא לשבור הפקת נתוני בדיקה.
4. לאחר Cutover, **נתיבי הנפקה חדשים** עוברים ל־INVOISER בלבד. מציגים מסמכים היסטוריים כקיימים, לא משנים מספר מקור.
5. כל שימוש ברכיבי מלון לצורך דוחות/ספרים נבחן מול שאלת תחולת הרישום על Hotel4u עצמה.
6. לא למחוק או להסתיר רצף מסמכים שנוצר בעבר אם יש חובת שמירה.
7. רווח ברמת מלון, Day Close ו־PMS Ledger לא הופכים אוטומטית לספר ראשי נפרד ומתחרה.

## 8. אבטחה, הרשאות ופרטיות

| כלל | Test |
|---|---|
| API Key נשמר בשרת בלבד (Secret Manager) | אין key ב־React bundle/HTML/Network browser |
| מפתח מוגבל ל־tenant ו־sourceSystem | נסיון Workspace זר מחזיר 403/404 |
| ה־PMS מאמת Property ו־Legal Entity | פקיד מלון א׳ לא מנפיק בשם חברה ב׳ |
| INVOISER מאמתת הרשאה שוב | propertyId שהוזרק בגוף לא מעניק גישה |
| Idempotency על כל פעולה כספית | כפילות אינה יוצרת מסמך/תשלום חדש |
| Webhooks של ספק מאומתים | זיהוי replay/חתימה לא תקינה |
| Audit רגיש וממוזער | לא מופיעים מספרי כרטיס, דרכונים או אסימוני API |
| שמירה ומחיקה | בקשת פרטיות לא מוחקת ספרים שחובה לשמור |
| חתימות וקבצי מקור | Hotel4u אינה מחליפה PDF חתום במקומי |
| תעודת רישום | מוצגת רק אם הונפקה לתוכנה/מהדורה הנכונה |

## 9. שגיאות ומצבים שהממשק חייב להציג

| קוד לוגי | משמעות | תוצאה |
|---|---|---|
| NOT_CONFIGURED | לא קיימים workspace/API key/mapping מאומתים | אין כפתור הנפקה; מסך חיבור |
| SANDBOX_ONLY | INVOISER אינה מאושרת להנפקה חיה | הודעת TEST ברורה |
| INVALID_CUSTOMER | חסרים פרטי buyer/issuer | פעולת עריכה/השלמה |
| TAX_REVIEW_REQUIRED | אין כלל מס מאושר | אין הנפקה; הפניה למורשה |
| PAYMENT_UNKNOWN | לא ידוע אם התשלום התקבל | בירור/פיוס, בלי חיוב חדש |
| ISSUANCE_PENDING | מסמך בהליך | סטטוס + Polling/Query |
| ALLOCATION_PENDING | נדרשת הקצאה שטרם הושלמה | מצב נפרד, לא הצלחה פיקטיבית |
| SIGNATURE_PENDING | מסמך סופי ללא Artifact חתום זמין | בירור + Retry חתימה לפי כללים |
| DELIVERY_FAILED | מסמך הונפק אך המסירה נכשלה | שליחה חוזרת, לא הנפקה נוספת |
| CONFLICT | Version/Idempotency conflict | רענון ופעולה מבוקרת |
| SOURCE_NOT_FOUND | מקור Folio/Charge כבר אינו זמין | חריג לשחזור אסמכתה |
| LEGACY_DOCUMENT | מסמך היסטורי של Hotel4u | צפייה בלבד, ללא הנפקה מחדש |

אלו קודי UX/Domain *מוצעים*, לא סט השגיאות שכבר קיים ב־INVOISER.

## 10. בדיקות קבלה חוצות־מאגרים

| ID | מצב | Expected |
|---|---|---|
| INT-T01 | חברה אחת עם שלושה מלונות | מיפוי נכון לאותו Issuer לפי ההכרעה |
| INT-T02 | שתי חברות באותו Tenant | אין חפיפה של מנפיק/רצף/פרטי מס |
| INT-T03 | 50 ניסיונות להפקת אותה פעולה | מסמך סופי יחיד לאחר יישום LIVE |
| INT-T04 | Hotel4u קיבלה Timeout | Status reconciliation, אין Invoice נוסף |
| INT-T05 | INVOISER תקינה, שרת Hotel4u נופל | המסמך נשמר ואחר כך מסונכרן |
| INT-T06 | Hotel4u שולחת Event כפול | INVOISER מעבדת פעם אחת |
| INT-T07 | חיוב חדר/מסעדה בשיעורי מס שונים | זיהוי ותיעוד taxCode לכל שורה |
| INT-T08 | רשומת אורח נמחקה בפרטיות | חשבונית מקור שנדרשת לשמירה נותרת |
| INT-T09 | Booking משלמת במקום אורח | Buyer/Payer/Issuer אינם מתחלפים |
| INT-T10 | Refund נכשל אחרי זיכוי | מסמך נשאר, Refund נכשל/ממתין |
| INT-T11 | סגירת יום חוזרת | אין כפל חיובי לילה וחשבוניות |
| INT-T12 | מלון משנה שם וכתובת | מסמך היסטורי נשאר עם Snapshot קודם |
| INT-T13 | נשלח Request עם workspaceId זר | חסימת הרשאות |
| INT-T14 | מסמך שמסומן TEST | Hotel4u לא מציגה אותו כחוקי |
| INT-T15 | שורת חיוב הועברה POS → Folio | אין חיוב כפול או הנפקה כפולה |
| INT-T16 | לקוח שילם חצי סכום ושולמה יתרה מאוחר יותר | התאמות ותיעוד לפי אירועים |
| INT-T17 | Old Hotel4u Invoice נשארת בארכיון | אין שינוי מספר או יצירת העתק פיסקלי חדש |
| INT-T18 | שינוי API version | Contract Tests מזהים אי־תאימות |
| INT-T19 | טוקן/API key נשלל | אינטגרציה ננעלת בלי למחוק אירועי עבר |
| INT-T20 | שני Payments באותו זמן | אין הקצאה מעל סכום התקבול/החיוב |

**Test strategy:** Unit/Contract/Integration/E2E/Fault Injection/Concurrency/Restore. כל Test מכיל Setup, Action, Expected, Failure Mode, Audit Assertion, Owner ו־Build/Commit Ref.

## 11. תוכנית Cutover ללא זיהום ספרים

### שלב A — מיפוי
- כל Hotel4u Property משויך ל־Legal Entity, Workspace ו־SourceId לפי מדיניות חתומה.
- מזהים כל נתיב Legacy שיכול להנפיק או לשנות מסמך.
- יוצרים Legacy Document Register עם מספרים וסטטוסים.

### שלב B — Shadow/Sandbox
- מגדירים API Keys לסביבת בדיקות בלבד.
- מייצרים נתוני תרגול וניסיון ליצור מסמכי TEST באמצעות INVOISER.
- משווים מספר שורות, סכומים, תאריכי שירות, זיכויים ומקרי תייר.
- אין להזרים כרטיסי אשראי גולמיים, סיסמאות או מסמכים רגישים.

### שלב C — Compliance Gate
- INVOISER סגרה Gate רגולטורי, מספור, חתימה, שמירה, קובץ מבנה אחיד, רישום ותשתית Production לפי הדין והאישורים הדרושים.
- רואה חשבון מאשר טיפול במקדמות, מס, זיכויים, לקוחות חברות וסוכנים.
- Hotel4u אינה ממשיכה לשמש מנפיק בלתי רשום במסלול הישן רק כדי לעקוף Gate.

### שלב D — Cutover מבוקר
- בוחרים תאריך/שעה/מספרים אסמכתיים וגרסת שני המאגרים.
- מונעים הנפקה כפולה בזמן מעבר.
- מסנכרנים חובות פתוחים, תשלומים ומקדמות עם אישור חשבונאי.
- שומרים אסמכתאות Legacy ונועלים תצורת מקור.
- מפעילים את המתאם רק לאחר Gate חתום.

### שלב E — Reconciliation ו־Rollback
- מוודאים שהפעולות משני הצדדים נסגרות מול מספרי מסמך של INVOISER.
- אם אינטגרציה נפלה אחרי יצירת מסמך חי — **לא** מוחקים אותו ולא מחזירים את המערכת להנפקה מקומית באותו תרחיש.
- תוכנית Rollback למשתמשים/ממשק אינה Rollback של ספרים שכבר פורסמו.
- משמרים נתוני Legacy לפי הדין.

## 12. קישורים, אחריות לשינויים ו־Definition of Done

### 12.1 מקורות האמת

- **מפרט פיסקלי, רגולציה ותיק ביקורת:** [INVOISER — ISRAEL_ACCOUNTING_SPECIFICATION.md](https://github.com/akmake/invoicer/blob/main/docs/ISRAEL_ACCOUNTING_SPECIFICATION.md), כולל פרק 21 — תיק מוכנות.
- **API אמיתי:** [INVOISER — docs/API.md](https://github.com/akmake/invoicer/blob/main/docs/API.md).
- **גבולות ה־sandbox:** [INVOISER — README.md](https://github.com/akmake/invoicer/blob/main/README.md).
- **אפיון חוויית PMS:** [Hotel4u — 03-operational-workflows.md](03-operational-workflows.md).
- **מטריצת ציות ישראלית:** [Hotel4u — 04-israel-compliance.md](04-israel-compliance.md).
- **מסכי כספים:** [Hotel4u — screens/finance.md](screens/finance.md).
- **תוכנית פיתוח:** [Hotel4u — spec-implementation-plan.md](../product/spec-implementation-plan.md).
- **קוד קיים:** [financeService.js](../../server/services/financeService.js), [invoiceService.js](../../server/services/invoiceService.js), [Invoice.js](../../server/models/Invoice.js).

### 12.2 עקרון סנכרון

בכל שינוי של source mapping, שדות API, מסמך, רישום, סף הקצאה או Ownership:
1. מעדכנים את INVOISER docs/API.md (כאשר ה־API משתנה).
2. מעדכנים את INVOISER ISRAEL_ACCOUNTING_SPECIFICATION.md.
3. מעדכנים **את המסמך הזה** ואת Test IDs שלו.
4. מריצים Contract Tests מול שני המאגרים/סביבות.
5. מתעדים Version/Commit, מיגרציה, QA ואישור מקצועי.
6. לא מציגים במסך "מוכן לייצור" אם API רק sandbox.

### 12.3 Definition of Done

- [ ] SourceId, Workspace, Legal Entity ו־Property ממופים ללא ערבוב.
- [ ] אין גישה ישירה ממערכת אחת למסד של האחרת.
- [ ] Hotel4u מחזיקה API Key בשרת בלבד, בלי חשיפת דפדפן.
- [ ] קיים Event/Operation Mapping מזהים יציב.
- [ ] קיימת Idempotency מלאה ו־Unknown Recovery.
- [ ] מצב TEST/LIVE ברור ולא ניתן להתחזות למסמך חוקי.
- [ ] לאחר Cutover אין נתיב Legacy שיוצר מספר חשבונית חדשה.
- [ ] מסמכי Legacy נשמרים ונבדלים מהמסמכים החדשים.
- [ ] כל תרחישי HT-01…HT-25 במפרט INVOISER ומבחני INT-T01…20 נבדקו.
- [ ] ניהול מס, מספור, רישום, חתימה, קובץ אחיד והקצאה נבדקו במערכת המנפיקה.
- [ ] שינוי מהדורה לא שובר Contract Tests או שחזור היסטורי.
- [ ] רואה חשבון/בעל מוצר/אבטחת מידע נתנו אישור Go/No-Go בהתאם לתחומם.

**סיכום:** מסמך זה מוגבל לאינטגרציה ולתהליכי PMS; הפרטים החשבונאיים והרגולטוריים, לרבות בדיקות רשות המסים ומקרי קצה פיסקליים, נמצאים במפרט המלא של INVOISER. זו חלוקת האחריות היחידה שאמורה להנחות את הפיתוח מכאן והלאה.


### 12.4 ממצאים מהשטח ובדיקות הרשות — ב־INVOISER בלבד

מאגר האירועים והבדיקות המעשיות נמצא ב־**[INVOISER — FIELD_FINDINGS_AND_INCIDENT_PLAYBOOK.md](https://github.com/akmake/invoicer/blob/main/docs/FIELD_FINDINGS_AND_INCIDENT_PLAYBOOK.md)**.

המסמך כולל תיעוד של דחיית רישום שדווחה ב־XPlace, פסקי דין על הקצאת מספרים וסירוב, תקלות הרשאה/מסמכים/זיכויים שמפרסמים בתי תוכנה (כספית ו־SUMIT), בעיות הרשאת תאגידים, קשיי קבצים גדולים, ושידור קובץ אחיד ב־2027, עם מקור, רמת ראיה ובדיקות FIELD-T01–FIELD-T28. **ממצאי שטח אינם כשלעצמם דרישות חוק.**

**אחריות Hotel4u:** לשמר מזהי פעולה וקישורים למסמכי INVOISER, להציג "בהמתנה/סורב/בירור" בלי להנפיק שנית, לשמור Deadline ו־LegalEntity בתצוגת חריגים, לא לבטל מסמך מקור ולא לשנות סטטוס רשות ב־PMS. כל לוגיקת סירוב/שימוע/תקינות הקצאה, ספרים ורישום מתנהלת ב־INVOISER; Hotel4u מציגה את התוצאה ומאפשרת הפניית המשתמש לגורם המתאים.

**בדיקות אינטגרציה:** להוסיף הפניה ל־FIELD-T04–T12, T18–T20, T24–T27 לצד INT-T04/INT-T10/INT-T14. תוצאה שנויה במחלוקת אינה הצלחה ואינה סיבה ל־Retry עם מספר חדש.
