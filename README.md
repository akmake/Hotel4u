# אפיון מוצר v1 — מערכת מלאה לניהול מלון

## 0. מטרת המסמך

מסמך זה מגדיר את מערכת הליבה לניהול מלון מקצה לקצה: הזמנות, זמינות חדרים, צ׳ק־אין, צ׳ק־אאוט, חדרנות, תחזוקה, תשלומים, פוליו, ערוצי מכירה, מנוע הזמנות, אורחים, דוחות, הרשאות ואוטומציות.

המטרה אינה לבנות רק מערכת הזמנות, אלא **Hotel Operating System** — מערכת שהמלון חי עליה בזמן אמת.

---

## 1. הנחות עבודה

כדי להתקדם בלי להיתקע בשאלות, המסמך מניח את ההנחות הבאות:

1. המערכת מיועדת למלון עצמאי או רשת קטנה/בינונית.
2. המערכת תתמוך בעתיד ב־multi-property, גם אם MVP יתחיל ממלון אחד.
3. המערכת תהיה SaaS בענן.
4. ממשק ראשון יהיה Web, ובהמשך Mobile לחדרנות/תחזוקה ואולי קיוסק/אורח.
5. המערכת תתמוך בעברית ואנגלית לפחות.
6. המערכת תתמוך במטבעות, מסים, מדיניות ביטול ותשלומים שונים.
7. המערכת לא תשמור כרטיס אשראי מלא. יש להשתמש בטוקניזציה דרך ספק תשלומים.
8. כל פעולה כספית או תפעולית קריטית תירשם ב־audit log.
9. המערכת צריכה להיבנות עם מחשבה על אינטגרציות: OTA, מנוע הזמנות, תשלומים, POS, מנעולים, חשבוניות, הנהלת חשבונות.

---

## 2. חזון מוצר

המערכת תאפשר למלון לדעת בכל רגע:

* מי מגיע היום.
* מי עוזב היום.
* אילו חדרים זמינים, מלוכלכים, תפוסים או חסומים.
* אילו הזמנות בסיכון.
* אילו תשלומים פתוחים.
* אילו אורחים דורשים טיפול מיוחד.
* אילו משימות חדרנות/תחזוקה תקועות.
* אילו ערוצי מכירה לא מסונכרנים.
* מה מצב ההכנסות, התפוסה והתחזית.

המערכת צריכה להפוך את ניהול המלון ממצב של תגובה מאוחרת למצב של **שליטה יזומה**.

---

## 3. עקרונות מוצר

### 3.1 מקור אמת אחד

ה־PMS הוא מקור האמת של המלון. חדר, הזמנה, אורח, פוליו, תשלום וסטטוס חדר חייבים להיות עקביים בכל המסכים והאינטגרציות.

### 3.2 מניעת טעויות לפני תיקון טעויות

המערכת לא רק תאפשר לתקן, אלא תנסה למנוע:

* הזמנה כפולה.
* צ׳ק־אין לחדר לא נקי.
* צ׳ק־אאוט עם יתרה פתוחה.
* מכירת חדר out of order.
* חיוב ללא הרשאה.
* שינוי מחיר ללא audit.

### 3.3 תפעול בזמן אמת

סטטוסי חדרים, מלאי, הזמנות ותשלומים צריכים להתעדכן בזמן אמת ככל האפשר.

### 3.4 כל פעולה קריטית חייבת היסטוריה

אסור למחוק מידע עסקי קריטי. פעולות כספיות יבוטלו באמצעות void/refund/adjustment ולא באמצעות מחיקה.

### 3.5 המערכת צריכה להיות בנויה לפי תהליכים, לא לפי טבלאות

המשתמש לא רוצה “לערוך רשומה”. הוא רוצה:

* להכניס אורח.
* להוציא אורח.
* לסגור חשבון.
* להכין חדר.
* לפתור תקלה.
* למכור חדר.
* למנוע בעיה.

---

## 4. משתמשים ותפקידים

### 4.1 הנהלה

אחראית על תפוסה, הכנסות, תפעול, חריגים, עובדים, דוחות ואיכות שירות.

צרכים מרכזיים:

* תמונת מצב יומית.
* הכנסות ותפוסה.
* חריגים וסיכונים.
* ביצועי צוות.
* דוחות פיננסיים.
* ביצועי ערוצי מכירה.

### 4.2 מנהל קבלה / Front Desk Manager

אחראי על תפעול פרונט־דסק, arrivals, departures, הקצאות חדרים, טיפול באורחים ובעיות בזמן אמת.

צרכים מרכזיים:

* arrivals/departures.
* חדרים מוכנים ולא מוכנים.
* guest requests.
* balance issues.
* room moves.
* אישור חריגים.

### 4.3 פקיד קבלה / Receptionist

משתמש יומי מרכזי במערכת.

צרכים מרכזיים:

* חיפוש הזמנות.
* יצירת הזמנות.
* צ׳ק־אין.
* צ׳ק־אאוט.
* גבייה.
* הנפקת מסמכים.
* מענה לבקשות אורחים.

### 4.4 מנהל חדרנות

אחראי על הקצאת משימות ניקיון, סטטוס חדרים, בדיקות איכות והחזרת חדרים למלאי.

צרכים מרכזיים:

* חדרים שצריך לנקות.
* סדרי עדיפויות לפי arrivals.
* שיוך חדרניות.
* בדיקת חדרים.
* חריגות ונזקים.

### 4.5 חדרנית

מבצעת משימות ניקיון ודיווח שטח.

צרכים מרכזיים:

* רשימת משימות אישית.
* סטטוס חדר.
* סימון התחלה/סיום.
* דיווח תקלה.
* דיווח חפץ שנמצא.
* הערות מיוחדות.

### 4.6 תחזוקה

אחראית על תקלות, חדרים חסומים, ציוד, תחזוקה מונעת וספקים.

צרכים מרכזיים:

* פתיחת תקלה.
* קבלת משימה.
* עדכון סטטוס.
* חסימת חדר.
* שחרור חדר לאחר תיקון.

### 4.7 כספים / Cashier / Finance

אחראים על חיובים, קופות, תשלומים, חשבוניות, פיקדונות, החזרים, התאמות ודוחות.

צרכים מרכזיים:

* folios.
* תשלומים.
* זיכויים.
* חשבוניות.
* סגירת קופה.
* night audit.
* התאמות.

### 4.8 מנהל הכנסות / Revenue Manager

אחראי על מחירים, זמינות, restrictions ותחזיות.

צרכים מרכזיים:

* rate plans.
* מחירים לפי תאריך.
* stop sell.
* minimum stay.
* channel performance.
* תחזית תפוסה.

### 4.9 איש מכירות / Sales

אחראי על חברות, קבוצות, סוכנים, חוזים ואירועים.

צרכים מרכזיים:

* corporate accounts.
* group blocks.
* negotiated rates.
* rooming lists.
* הצעות מחיר.

### 4.10 בעלים / Owner

רוצה תמונת מצב בלי להיכנס לתפעול.

צרכים מרכזיים:

* הכנסות.
* תפוסה.
* רווחיות.
* השוואה לתקופה קודמת.
* חריגים גדולים.

---

## 5. מודולי מערכת

המערכת תחולק למודולים הבאים:

1. Property Setup.
2. Rooms & Inventory.
3. Reservations.
4. Rate Management.
5. Front Desk.
6. Check-in.
7. Check-out.
8. Guest Profiles & CRM.
9. Folio, Billing & Payments.
10. Housekeeping.
11. Maintenance.
12. Booking Engine.
13. Channel Manager / Distribution.
14. Groups & Corporate.
15. POS & Ancillary Services.
16. Messaging & Guest Experience.
17. Reports & BI.
18. Users, Roles & Permissions.
19. Audit & Compliance.
20. Integrations.
21. Automation & Command Center.

---

# חלק א׳ — Property Setup

## 6. ניהול מלון

### 6.1 ישות Hotel / Property

שדות מרכזיים:

* מזהה מלון.
* שם המלון.
* שם משפטי.
* כתובת.
* מדינה.
* עיר.
* אזור זמן.
* מטבע ברירת מחדל.
* שפות פעילות.
* מספר עוסק / חברה.
* פרטי מס.
* טלפון.
* אימייל.
* אתר.
* לוגו.
* שעות צ׳ק־אין.
* שעות צ׳ק־אאוט.
* מדיניות ביטול ברירת מחדל.
* מדיניות ילדים.
* מדיניות חיות.
* מדיניות עישון.
* סטטוס פעיל/לא פעיל.

### 6.2 מבנים, קומות ואזורים

פונקציות:

* יצירת מבנה.
* יצירת קומה.
* יצירת אגף.
* שיוך חדר למבנה/קומה/אגף.
* הגדרת אזורים ציבוריים לתחזוקה.
* הגדרת אזורי חדרנות.

### 6.3 הגדרות מלון כלליות

פונקציות:

* הגדרת תבניות מסמכים.
* הגדרת תבניות מייל/SMS/WhatsApp.
* הגדרת מסים.
* הגדרת היטלים.
* הגדרת אמצעי תשלום.
* הגדרת מדיניות פיקדון.
* הגדרת כללי מספור הזמנות.
* הגדרת כללי מספור חשבוניות.
* הגדרת שדות חובה לאורח.
* הגדרת שדות חובה לצ׳ק־אין.
* הגדרת שדות חובה לצ׳ק־אאוט.

---

# חלק ב׳ — Rooms & Inventory

## 7. סוגי חדרים

### 7.1 Room Type

שדות:

* שם סוג חדר.
* קוד פנימי.
* תיאור קצר.
* תיאור מלא.
* מספר אורחים בסיסי.
* מספר אורחים מקסימלי.
* מספר מבוגרים מקסימלי.
* מספר ילדים מקסימלי.
* סוג מיטה.
* אפשרות מיטה נוספת.
* אפשרות מיטת תינוק.
* גודל חדר.
* נוף.
* מתקנים.
* תמונות.
* סטטוס למכירה.
* סדר תצוגה במנוע הזמנות.

### 7.2 חוקי מכירה לפי סוג חדר

פונקציות:

* סגור למכירה.
* פתוח למכירה.
* overbooking מותר.
* מקסימום overbooking.
* מכירה רק בערוצים מסוימים.
* מכירה רק ל־rate plans מסוימים.
* הצגה או הסתרה באתר.

## 8. חדר פיזי

### 8.1 Room

שדות:

* מספר חדר.
* סוג חדר.
* מבנה.
* קומה.
* אגף.
* סטטוס תפעולי.
* סטטוס ניקיון.
* סטטוס תפוסה.
* נגישות.
* smoking / non-smoking.
* connecting room.
* חדר חלופי מועדף.
* הערות פנימיות.
* תאריך שיפוץ אחרון.
* סטטוס פעיל/לא פעיל.

### 8.2 סטטוסי חדר

סטטוס תפוסה:

* Vacant.
* Occupied.
* Reserved.
* Due In.
* Due Out.
* Checked Out.

סטטוס ניקיון:

* Clean.
* Dirty.
* Inspected.
* Pickup.
* Turndown Required.

סטטוס תפעולי:

* Available.
* Out of Order.
* Out of Service.
* Maintenance Hold.
* Owner Hold.
* Internal Use.

### 8.3 כללי חדרים

* חדר out of order לא ניתן למכירה.
* חדר out of service יכול להיות זמין למכירה עתידית לפי הגדרת תאריך.
* חדר checked out הופך ל־dirty אוטומטית.
* חדר dirty לא ניתן לצ׳ק־אין ללא הרשאה מיוחדת.
* חדר עם תקלה קריטית לא ניתן לשחרור למכירה.
* שינוי סטטוס חדר קריטי דורש audit.

## 9. מלאי וזמינות

### 9.1 Inventory Date

יש לנהל מלאי ברמת תאריך וסוג חדר.

שדות:

* תאריך.
* סוג חדר.
* סך חדרים פיזיים.
* חדרים למכירה.
* חדרים חסומים.
* חדרים out of order.
* הזמנות מאושרות.
* הזמנות tentative.
* allotment.
* overbooking מותר.
* יתרה זמינה.

### 9.2 חישוב זמינות

זמינות למכירה = מלאי פיזי פעיל - חסימות - out of order - הזמנות מאושרות ± overbooking מותר.

החישוב חייב לתמוך ב:

* הזמנה של כמה לילות.
* הזמנה של כמה חדרים.
* מעבר חדר באמצע שהייה.
* חסימה חלקית לפי תאריך.
* release allotment.
* ביטול הזמנה.
* שינוי תאריכים.
* שינוי סוג חדר.
* no-show.
* early departure.
* extension.

### 9.3 מניעת הזמנה כפולה

דרישות:

* נעילת זמינות בזמן יצירת הזמנה.
* timeout אם הזמנה לא הושלמה.
* idempotency key להזמנות מערוצים חיצוניים.
* בדיקת זמינות לפני אישור סופי.
* queue לעדכוני ערוצים.
* audit לכל שינוי מלאי.

---

# חלק ג׳ — Rate Management

## 10. Rate Plans

### 10.1 Rate Plan

שדות:

* שם.
* קוד.
* סוג: public / corporate / package / OTA / promo / group.
* refundable / non-refundable.
* כולל ארוחת בוקר.
* כולל חצי פנסיון.
* כולל פנסיון מלא.
* כולל הכל.
* מדיניות ביטול.
* מדיניות פיקדון.
* ערוצים פעילים.
* סוגי חדרים פעילים.
* סטטוס.

### 10.2 Rate Rules

פונקציות:

* מחיר לפי תאריך.
* מחיר לפי יום בשבוע.
* מחיר לפי עונה.
* מחיר לפי מספר אורחים.
* מחיר לילד.
* מחיר לאורח נוסף.
* מחיר לפי length of stay.
* מחיר לפי lead time.
* מחיר לפי source/channel.
* מחיר לפי חברה.
* מחיר לפי סוכן.
* מחיר לפי קוד מבצע.
* מחיר לפי מועדון לקוחות.

### 10.3 Restrictions

פונקציות:

* Minimum Length of Stay.
* Maximum Length of Stay.
* Closed to Arrival.
* Closed to Departure.
* Stop Sell.
* Sell Limit.
* Release Days.
* Advance Purchase.
* Last Minute.
* Blackout Dates.

### 10.4 Override מחיר

דרישות:

* שינוי מחיר ידני מחייב הרשאה.
* שינוי מחיר ידני מחייב סיבה.
* יש לשמור מחיר מקורי ומחיר חדש.
* יש לשמור מי שינה ומתי.
* שינוי מחיר אחרי check-in דורש הרשאה גבוהה יותר.

---

# חלק ד׳ — Reservations

## 11. הזמנה

### 11.1 Reservation

שדות מרכזיים:

* מספר הזמנה.
* מקור הזמנה.
* סטטוס.
* אורח ראשי.
* תאריך הגעה.
* תאריך עזיבה.
* מספר לילות.
* מספר חדרים.
* מספר אורחים.
* שפה.
* מטבע.
* rate plan.
* מחיר.
* מסים.
* תוספות.
* מדיניות ביטול.
* מדיניות פיקדון.
* guarantee type.
* payment status.
* confirmation sent.
* הערות אורח.
* הערות פנימיות.
* בקשות מיוחדות.
* source.
* market segment.
* company.
* travel agent.
* group.
* external reservation id.
* channel reservation id.
* created by.
* updated by.

### 11.2 סטטוסי הזמנה

* Draft.
* Quote.
* Hold.
* Pending Payment.
* Confirmed.
* Modified.
* Cancelled.
* Waitlisted.
* No-show.
* Checked-in.
* In-house.
* Checked-out.
* Partially Checked-in.
* Partially Checked-out.

### 11.3 Reservation Room

בכל הזמנה יכולים להיות כמה חדרים.

שדות:

* הזמנה.
* סוג חדר מוזמן.
* חדר פיזי מוקצה.
* תאריך הגעה.
* תאריך עזיבה.
* rate plan.
* מחיר ללילה.
* אורחים משויכים לחדר.
* סטטוס חדר בהזמנה.

### 11.4 Stay Segment

נדרש כדי לתמוך במעבר חדר או שינוי מחיר באמצע שהייה.

שדות:

* Reservation Room.
* מתאריך.
* עד תאריך.
* סוג חדר.
* חדר פיזי.
* מחיר.
* rate plan.
* סיבת שינוי.

### 11.5 פעולות הזמנה

* יצירת הזמנה.
* חיפוש זמינות.
* שמירת הצעת מחיר.
* אישור הזמנה.
* שינוי תאריכים.
* שינוי סוג חדר.
* שינוי חדר פיזי.
* שינוי מספר אורחים.
* שינוי מחיר.
* שינוי rate plan.
* הוספת תוספות.
* הסרת תוספות.
* הוספת הערה.
* הוספת בקשה מיוחדת.
* שליחת אישור.
* ביטול.
* גביית דמי ביטול.
* סימון no-show.
* גביית no-show fee.
* שכפול הזמנה.
* מיזוג הזמנות.
* פיצול הזמנה.
* העברת חיובים.
* קישור לקבוצה.
* קישור לחברה.
* קישור לסוכן.

### 11.6 מקרי קצה בהזמנות

* אורח מזמין שני חדרים אבל מגיע רק לחדר אחד.
* אורח משנה תאריך דרך OTA אחרי שהמלון כבר הקצה חדר.
* אורח מבטל חדר אחד מתוך הזמנה של שלושה חדרים.
* אורח מקצר שהייה אחרי צ׳ק־אין.
* אורח מאריך שהייה והחדר שלו תפוס בהמשך.
* אורח משודרג לחדר אחר ללא שינוי מחיר.
* אורח משודרג עם תוספת מחיר.
* הזמנה נכנסת מערוץ חיצוני בדיוק כשפקיד יוצר הזמנה ידנית.
* הזמנה עם תשלום מראש נדרשת לזיכוי חלקי.
* הזמנה non-refundable מבוטלת.
* הזמנת קבוצה עוברת מ־tentative ל־confirmed.

---

# חלק ה׳ — Front Desk

## 12. Dashboard יומי

המסך המרכזי של הקבלה.

### 12.1 כרטיסי מצב

* Arrivals today.
* Departures today.
* In-house guests.
* Available clean rooms.
* Dirty rooms.
* Out of order rooms.
* Rooms not assigned.
* Open balances.
* VIP arrivals.
* Early check-in requests.
* Late checkout requests.
* Failed payments.
* Unsynced reservations.

### 12.2 רשימות פעולה

* אורחים שמגיעים ואין להם חדר מוקצה.
* אורחים שמגיעים והחדר לא נקי.
* אורחים שעוזבים ויש להם יתרה פתוחה.
* הזמנות pending payment.
* בקשות אורחים שלא טופלו.
* תקלות פתוחות בחדרים של arrivals.
* חדרים dirty שמיועדים ל־arrival היום.

## 13. Room Rack / Tape Chart

לוח גרפי של חדרים מול תאריכים.

פונקציות:

* הצגת חדרים לפי סוג/קומה/סטטוס.
* הצגת הזמנות על ציר זמן.
* drag & drop להקצאת חדר.
* שינוי חדר.
* זיהוי קונפליקטים.
* צבע לפי סטטוס.
* פילטר לפי חדרים זמינים/מלוכלכים/חסומים.
* פתיחת הזמנה מתוך הלוח.
* חסימת חדר מתוך הלוח.

---

# חלק ו׳ — Check-in

## 14. תהליך צ׳ק־אין

### 14.1 תנאים לפני צ׳ק־אין

המערכת תבדוק:

* ההזמנה קיימת.
* תאריך ההגעה נכון או יש הרשאת early check-in.
* יש חדר מוקצה או ניתן להקצות חדר.
* החדר נקי/מאושר או יש הרשאה לעקוף.
* פרטי אורח חובה מולאו.
* מסמך מזהה קיים אם נדרש.
* אמצעי תשלום קיים אם נדרש.
* פיקדון שולם אם נדרש.
* חתימה על תנאים קיימת אם נדרש.
* אין חסימה/blacklist.

### 14.2 פעולות צ׳ק־אין

* פתיחת הזמנה.
* אימות פרטים.
* הוספת/סריקת מסמך מזהה.
* צילום/העלאת מסמך.
* חתימה דיגיטלית.
* גביית פיקדון.
* pre-authorization.
* הקצאת חדר.
* שינוי חדר.
* שדרוג חדר.
* הוספת שירותים.
* הפקת מפתח.
* פתיחת folio.
* שינוי סטטוס reservation ל־in-house.
* שינוי סטטוס חדר ל־occupied.
* שליחת welcome message.

### 14.3 צ׳ק־אין חלקי

דרישות:

* הזמנה עם כמה חדרים יכולה לעבור check-in חלקי.
* כל חדר בהזמנה מקבל סטטוס משלו.
* folio יכול להיות לכל חדר או לכל הזמנה.
* אורח ראשי יכול להגיע לפני אורחים נוספים.

### 14.4 Walk-in

תהליך:

1. חיפוש זמינות להיום.
2. בחירת סוג חדר.
3. יצירת פרופיל אורח.
4. בחירת מחיר.
5. גביית תשלום/פיקדון.
6. הקצאת חדר.
7. ביצוע צ׳ק־אין.

---

# חלק ז׳ — Check-out

## 15. תהליך צ׳ק־אאוט

### 15.1 תנאים לפני צ׳ק־אאוט

המערכת תבדוק:

* יתרה פתוחה.
* חיובים שלא נסגרו.
* תשלומים pending.
* folio לא מאוזן.
* late checkout.
* חיובי מיני־בר/נזק פתוחים.
* חיובים מ־POS שלא נמשכו.

### 15.2 פעולות צ׳ק־אאוט

* פתיחת folio.
* בדיקת חיובים.
* הוספת חיובים אחרונים.
* פיצול חיובים.
* העברת חיובים.
* ביצוע תשלום.
* ביצוע refund אם צריך.
* הפקת חשבונית/קבלה.
* שליחת מסמך לאורח.
* סגירת folio.
* שינוי סטטוס הזמנה ל־checked-out.
* שינוי סטטוס חדר ל־dirty.
* יצירת משימת ניקיון.
* שליחת הודעת תודה/סקר.

### 15.3 Checkout חלקי

נדרש כאשר:

* חדר אחד מתוך הזמנה מרובת חדרים עוזב.
* אורח אחד עוזב מתוך כמה אורחים.
* חיובים מסוימים נסגרים מול חברה וחלק מול אורח.

### 15.4 Express Checkout

פונקציות:

* שליחת folio לאישור לפני עזיבה.
* תשלום בלינק.
* אישור דיגיטלי.
* סגירת check-out ללא מעבר בקבלה.
* יצירת חריגה אם יש בעיה בתשלום.

---

# חלק ח׳ — Folio, Billing & Payments

## 16. Folio

### 16.1 הגדרה

Folio הוא חשבון חיובים ותשלומים של אורח, חדר, חברה, קבוצה או סוכן.

### 16.2 סוגי folio

* Guest folio.
* Room folio.
* Company folio.
* Group master folio.
* Agent folio.
* House account.

### 16.3 Folio Line

שדות:

* מזהה שורה.
* folio.
* סוג שורה: charge / payment / refund / adjustment / tax / fee / discount.
* תיאור.
* סכום.
* מטבע.
* מס.
* מחלקה.
* תאריך שירות.
* תאריך רישום.
* מקור: PMS / POS / manual / channel.
* נוצר על ידי.
* סטטוס: posted / voided / refunded / adjusted.
* reference.

### 16.4 פעולות Folio

* הוספת חיוב.
* הוספת תשלום.
* הוספת הנחה.
* הוספת adjustment.
* void.
* refund.
* split charge.
* split payment.
* transfer charge.
* transfer between folios.
* routing rules.
* סגירת folio.
* פתיחת folio מחדש בהרשאה.
* הפקת חשבונית.
* הפקת קבלה.

## 17. Billing Windows / Routing

נדרש כדי לחלק חיובים.

דוגמאות:

* חדר וארוחת בוקר לחברה.
* מיני־בר לאורח.
* חניה לאורח אחר.
* לילה ראשון משולם מראש.
* מסים בנפרד.

פונקציות:

* יצירת routing rule.
* routing לפי סוג חיוב.
* routing לפי תאריך.
* routing לפי אחוז.
* routing לפי חברה/סוכן.
* חריגים ידניים.

## 18. תשלומים

### 18.1 אמצעי תשלום

* מזומן.
* כרטיס אשראי.
* העברה בנקאית.
* Pay by link.
* שובר.
* נקודות מועדון.
* תשלום חברה.
* OTA virtual card.

### 18.2 פעולות תשלום

* authorization.
* capture.
* sale.
* refund.
* void.
* partial payment.
* deposit.
* pre-authorization.
* release authorization.
* tokenization.
* payment link.
* retry failed payment.

### 18.3 כללי תשלום

* אין לשמור מספר כרטיס מלא.
* אין להציג CVV.
* יש לשמור token בלבד.
* פעולות refund/void דורשות הרשאה.
* יש לשמור correlation id מול ספק התשלומים.
* payment failure מייצר משימה.

## 19. Night Audit

תהליך סגירת יום.

פונקציות:

* בדיקת arrivals שלא נכנסו.
* סימון no-show.
* posting אוטומטי של room charges.
* בדיקת departures שלא יצאו.
* בדיקת יתרות פתוחות.
* בדיקת קופות פתוחות.
* נעילת יום עסקי.
* יצירת דוחות.
* העברת תאריך עסקי.
* audit exceptions.

---

# חלק ט׳ — Guest Profiles & CRM

## 20. פרופיל אורח

### 20.1 שדות

* שם פרטי.
* שם משפחה.
* מין אם נדרש.
* תאריך לידה.
* מדינה.
* אזרחות.
* שפה.
* טלפון.
* אימייל.
* כתובת.
* מסמך מזהה.
* מספר דרכון.
* תוקף דרכון.
* העדפות.
* אלרגיות.
* הערות פנימיות.
* VIP level.
* blacklist flag.
* marketing consent.
* privacy consent.
* loyalty id.

### 20.2 היסטוריה

* שהיות קודמות.
* הכנסה כוללת.
* תלונות.
* בקשות.
* העדפות חדר.
* ביטולים/no-show.
* תשלומים בעייתיים.

### 20.3 פעולות CRM

* איחוד פרופילים כפולים.
* זיהוי אורח חוזר.
* תיוג.
* סגמנטציה.
* שליחת קמפיין.
* הודעות לפני הגעה.
* הודעות בזמן שהייה.
* הודעות אחרי עזיבה.
* סקר שביעות רצון.

### 20.4 פרטיות

דרישות:

* ניהול consent.
* יכולת anonymization לפי מדיניות.
* הגבלת גישה לפרטי זהות.
* הגבלת ייצוא נתונים.
* audit לצפייה במידע רגיש.
* מדיניות retention.

---

# חלק י׳ — Housekeeping

## 21. לוח חדרנות

### 21.1 תצוגות

* כל החדרים.
* חדרים dirty.
* חדרים due out.
* חדרים due in.
* חדרים VIP.
* חדרים עם בקשות מיוחדות.
* חדרים עם תקלות.
* חדרים לפי חדרנית.

### 21.2 משימת ניקיון

שדות:

* חדר.
* סוג משימה: checkout clean / stayover / deep clean / turndown / pickup.
* עדיפות.
* תאריך.
* משויך ל.
* זמן התחלה.
* זמן סיום.
* סטטוס.
* supplies.
* הערות.
* תמונות.
* בדיקת מפקחת.

### 21.3 סטטוסי משימה

* New.
* Assigned.
* In Progress.
* Paused.
* Completed.
* Failed Inspection.
* Inspected.
* Cancelled.

### 21.4 פעולות חדרנית

* צפייה במשימות שלי.
* התחלת ניקיון.
* סיום ניקיון.
* דיווח בעיה.
* דיווח נזק.
* דיווח חפץ שנמצא.
* בקשת עזרה.
* סימון DND.
* סימון no service.

### 21.5 בדיקת מפקחת

* אישור חדר.
* החזרת חדר לניקיון.
* הוספת הערה.
* העלאת תמונה.
* שחרור חדר למלאי.

---

# חלק יא׳ — Maintenance

## 22. תקלות ותחזוקה

### 22.1 Maintenance Ticket

שדות:

* מזהה.
* חדר/אזור.
* קטגוריה.
* תיאור.
* דחיפות.
* מדווח על ידי.
* משויך ל.
* סטטוס.
* תמונות.
* חלקים נדרשים.
* ספק חיצוני.
* עלות.
* תאריך יעד.
* תאריך פתרון.

### 22.2 קטגוריות תקלה

* חשמל.
* מים.
* מיזוג.
* ריהוט.
* ניקיון.
* בטיחות.
* מנעול.
* אינטרנט.
* טלוויזיה.
* רעש.
* אחר.

### 22.3 סטטוסים

* New.
* Assigned.
* In Progress.
* Waiting for Parts.
* Waiting for Vendor.
* Resolved.
* Verified.
* Closed.
* Reopened.

### 22.4 כללים

* תקלה קריטית יכולה להעביר חדר ל־out of order.
* סגירת תקלה קריטית דורשת אישור.
* חדר לא חוזר למכירה עד אישור.
* תקלה בחדר עם arrival היום מייצרת התראה.

---

# חלק יב׳ — Booking Engine

## 23. מנוע הזמנות באתר

### 23.1 תהליך אורח

1. בחירת תאריכים.
2. בחירת מספר אורחים.
3. הצגת חדרים זמינים.
4. בחירת rate plan.
5. בחירת תוספות.
6. הזנת פרטים.
7. תשלום/פיקדון.
8. אישור הזמנה.
9. קבלת מייל/WhatsApp.

### 23.2 פונקציות

* זמינות בזמן אמת.
* מחירים בזמן אמת.
* תצוגת חדרים.
* תמונות.
* מדיניות ביטול.
* promo code.
* upsell.
* cross-sell.
* תשלום מקוון.
* multi-language.
* multi-currency.
* mobile-first.
* התאמה למותג.
* abandoned booking recovery.
* שינוי הזמנה עצמי.
* ביטול עצמי לפי מדיניות.

### 23.3 תוספות במנוע הזמנות

* ארוחת בוקר.
* חניה.
* late checkout.
* early check-in.
* בקבוק יין.
* ספא.
* העברה משדה תעופה.
* מיטת תינוק.
* מיטה נוספת.
* חבילות רומנטיות.

---

# חלק יג׳ — Distribution / Channel Manager

## 24. ערוצי מכירה

### 24.1 ערוצים

* Booking.com.
* Expedia.
* Agoda.
* Airbnb.
* GDS.
* אתר המלון.
* Call center.
* Walk-in.
* Travel agents.
* Corporate.

### 24.2 מיפוי ערוצים

נדרש למפות:

* סוגי חדרים.
* rate plans.
* מדיניות ביטול.
* מסים.
* תוספות.
* סטטוסי הזמנה.
* מזהי הזמנה חיצוניים.

### 24.3 סנכרון

המערכת צריכה לתמוך ב:

* עדכון זמינות.
* עדכון מחירים.
* עדכון restrictions.
* קבלת הזמנה.
* קבלת שינוי הזמנה.
* קבלת ביטול.
* אישור קבלה לערוץ.
* retry במקרה כשל.
* queue.
* reconciliation.
* channel health dashboard.

### 24.4 בעיות נפוצות

* הזמנה נכנסת פעמיים.
* ביטול לא התקבל.
* שינוי מחיר לא נדחף לערוץ.
* mapping שגוי.
* ערוץ שולח חדר שלא קיים.
* OTA virtual card לא פעיל עדיין.
* הפרשי מטבע.
* הפרשי מס.

---

# חלק יד׳ — Groups, Corporate & Agents

## 25. חברות וסוכנים

### 25.1 Company Profile

שדות:

* שם חברה.
* ח.פ./מספר חברה.
* כתובת.
* איש קשר.
* תנאי תשלום.
* credit limit.
* negotiated rates.
* מסמכי חוזה.
* סטטוס.

### 25.2 Travel Agent

שדות:

* שם סוכן.
* עמלה.
* תנאי תשלום.
* פרטי קשר.
* קודי rate.
* סטטוס.

## 26. קבוצות

### 26.1 Group Block

שדות:

* שם קבוצה.
* מארגן.
* תאריכים.
* מספר חדרים לפי סוג.
* release date.
* rate plan.
* סטטוס.
* master folio.
* מדיניות ביטול.
* rooming list.

### 26.2 פעולות קבוצה

* יצירת block.
* שינוי block.
* release rooms.
* room pickup.
* ייבוא rooming list.
* שיוך אורחים לחדרים.
* צ׳ק־אין קבוצתי.
* צ׳ק־אאוט קבוצתי.
* חיוב master.
* חיוב אישי.
* דוח pickup.

---

# חלק טו׳ — POS & Ancillary Services

## 27. שירותים נלווים

### 27.1 מחלקות הכנסה

* Rooms.
* Food & Beverage.
* Spa.
* Parking.
* Laundry.
* Minibar.
* Room Service.
* Events.
* Other.

### 27.2 חיוב לחדר

דרישות:

* POS יכול לשלוח חיוב ל־folio.
* יש לוודא שהאורח in-house.
* יש לבדוק הרשאת charge to room.
* יש לשמור מקור עסקה.
* ביטול POS צריך להתבטא ב־folio.

### 27.3 שירותים להזמנה

* הוספה בזמן הזמנה.
* הוספה בזמן check-in.
* הוספה בזמן stay.
* חיוב חד־פעמי.
* חיוב יומי.
* חיוב לפי אדם.
* חיוב לפי חדר.

---

# חלק טז׳ — Messaging & Guest Experience

## 28. תקשורת אורחים

### 28.1 ערוצים

* Email.
* SMS.
* WhatsApp.
* Push בעתיד.
* In-app guest portal בעתיד.

### 28.2 תבניות הודעה

* אישור הזמנה.
* שינוי הזמנה.
* ביטול.
* בקשת תשלום.
* לפני הגעה.
* צ׳ק־אין אונליין.
* הודעת welcome.
* הצעת upsell.
* לפני עזיבה.
* חשבונית.
* סקר.

### 28.3 אוטומציות הודעה

* X ימים לפני הגעה.
* ביום ההגעה.
* לאחר check-in.
* לפני check-out.
* לאחר check-out.
* לאחר תשלום נכשל.
* לאחר בקשה שלא טופלה.

## 29. Guest Requests

פונקציות:

* פתיחת בקשה.
* קטגוריה.
* עדיפות.
* שיוך למחלקה.
* SLA.
* סטטוס.
* הודעה לאורח.
* סגירה.
* מדידת זמן טיפול.

קטגוריות:

* מגבות.
* ניקיון.
* תחזוקה.
* אוכל.
* תחבורה.
* תלונה.
* שאלה כללית.

---

# חלק יז׳ — Reports & BI

## 30. דוחות תפעוליים

* Arrivals.
* Departures.
* In-house.
* No-show.
* Cancellations.
* Room status.
* Housekeeping productivity.
* Maintenance open tickets.
* VIP arrivals.
* Guest requests.

## 31. דוחות כספיים

* Revenue by date.
* Revenue by department.
* Payment report.
* Deposit report.
* Refund report.
* Open folios.
* Trial balance.
* Cashier closure.
* Tax report.
* AR aging.
* Invoice report.

## 32. דוחות ניהול הכנסות

* Occupancy.
* ADR.
* RevPAR.
* Pickup.
* Forecast.
* Pace.
* Channel performance.
* Market segment.
* Source report.
* Cancellation rate.
* Average length of stay.

## 33. Dashboard הנהלה

כרטיסים:

* תפוסה היום.
* תפוסה מחר.
* הכנסות היום.
* הכנסות חודשיות.
* ADR.
* RevPAR.
* open balances.
* rooms out of order.
* guest satisfaction.
* channel issues.

---

# חלק יח׳ — Users, Roles & Permissions

## 34. תפקידים

* Super Admin.
* Chain Admin.
* Property Admin.
* General Manager.
* Front Desk Manager.
* Receptionist.
* Housekeeping Manager.
* Housekeeper.
* Maintenance Manager.
* Technician.
* Finance Manager.
* Cashier.
* Revenue Manager.
* Sales Manager.
* Auditor.
* Owner Read Only.

## 35. הרשאות קריטיות

* יצירת הזמנה.
* שינוי הזמנה.
* ביטול הזמנה.
* סימון no-show.
* שינוי מחיר.
* override מחיר.
* check-in.
* check-out.
* פתיחת folio.
* סגירת folio.
* refund.
* void.
* adjustment.
* מחיקת שורה טכנית אם מותר.
* הפקת חשבונית.
* שינוי סטטוס חדר.
* חסימת חדר.
* שחרור חדר.
* ניהול תעריפים.
* ניהול ערוצים.
* צפייה בדוחות כספיים.
* ייצוא נתונים.
* ניהול משתמשים.
* צפייה ב־audit log.

## 36. Audit Log

כל פעולה קריטית תכלול:

* מי ביצע.
* מתי.
* מאיזה IP/device.
* מה היה הערך הקודם.
* מה הערך החדש.
* סיבה אם נדרשת.
* אובייקט קשור.

---

# חלק יט׳ — Integrations

## 37. אינטגרציות חובה

* Payment gateway.
* Tokenization.
* Accounting.
* Tax invoice system.
* Channel manager.
* Booking engine.
* OTA APIs.
* POS.
* Door locks / key cards.
* Passport scanner.
* Email.
* SMS.
* WhatsApp.
* CRM.
* BI.
* Revenue management.
* Kiosk.
* Guest portal.

## 38. Integration Event Log

כל אינטגרציה צריכה log:

* source.
* destination.
* event type.
* payload id.
* request.
* response.
* status.
* retry count.
* error message.
* timestamp.

## 39. Webhooks

אירועים אפשריים:

* reservation.created.
* reservation.modified.
* reservation.cancelled.
* guest.checked_in.
* guest.checked_out.
* room.status_changed.
* payment.succeeded.
* payment.failed.
* folio.closed.
* invoice.created.
* maintenance.created.
* housekeeping.completed.

---

# חלק כ׳ — Automation & Command Center

## 40. Command Center

זה המסך שיהפוך את המערכת לחכמה.

### 40.1 Alerts

* אורח מגיע תוך שעתיים והחדר לא נקי.
* אורח מגיע ואין חדר מוקצה.
* חדר out of order עם הזמנה עתידית.
* הזמנה pending payment לפני הגעה.
* תשלום נכשל.
* checkout עם יתרה פתוחה.
* channel sync failed.
* overbooking risk.
* VIP arrival.
* guest complaint open.
* housekeeping delayed.
* maintenance SLA breached.

### 40.2 Recommendations

* הצע room move.
* הצע upgrade בתשלום.
* הצע early check-in בתשלום.
* הצע late checkout בתשלום.
* הצע לפתוח חדרים לערוץ עם ביקוש גבוה.
* הצע להעלות מחיר בתאריכים עם תפוסה גבוהה.
* הצע להוריד מחיר בתאריכים חלשים.

### 40.3 Automation Rules

מבנה כלל:

* Trigger.
* Conditions.
* Action.
* Exceptions.
* Owner.
* Log.

דוגמאות:

* כאשר הזמנה נוצרת ומוגדרת non-refundable → שלח payment link.
* כאשר חדר checked-out → צור housekeeping task.
* כאשר housekeeping completed → שנה סטטוס ל־clean pending inspection.
* כאשר inspection approved → שנה סטטוס ל־clean.
* כאשר תשלום נכשל → שלח הודעה ופתח משימה.
* כאשר אורח VIP מגיע מחר → צור משימה למנהל.

---

# חלק כא׳ — מודל דאטה ראשוני

## 41. ישויות עיקריות

### Property

* id
* name
* legal_name
* timezone
* default_currency
* address
* settings

### RoomType

* id
* property_id
* code
* name
* capacity_base
* capacity_max
* amenities
* active

### Room

* id
* property_id
* room_type_id
* number
* floor
* building
* operational_status
* housekeeping_status
* occupancy_status

### InventoryDate

* id
* property_id
* room_type_id
* date
* physical_count
* sellable_count
* blocked_count
* booked_count
* overbooking_limit

### RatePlan

* id
* property_id
* code
* name
* type
* cancellation_policy_id
* deposit_policy_id
* active

### RateDate

* id
* rate_plan_id
* room_type_id
* date
* price
* min_los
* max_los
* cta
* ctd
* stop_sell

### GuestProfile

* id
* property_id
* first_name
* last_name
* email
* phone
* country
* language
* vip_level
* consent_flags

### Reservation

* id
* property_id
* confirmation_number
* status
* primary_guest_id
* arrival_date
* departure_date
* source
* market_segment
* company_id
* agent_id
* group_id
* payment_status

### ReservationRoom

* id
* reservation_id
* booked_room_type_id
* assigned_room_id
* status
* arrival_date
* departure_date

### StaySegment

* id
* reservation_room_id
* from_date
* to_date
* room_type_id
* room_id
* rate_plan_id
* price

### Folio

* id
* reservation_id
* owner_type
* owner_id
* status
* currency
* balance

### FolioLine

* id
* folio_id
* type
* department
* description
* amount
* tax_amount
* status
* service_date
* posted_at
* created_by

### Payment

* id
* folio_id
* provider
* payment_method
* token_id
* amount
* currency
* status
* provider_reference

### HousekeepingTask

* id
* room_id
* type
* priority
* status
* assigned_to
* due_at
* started_at
* completed_at

### MaintenanceTicket

* id
* room_id
* area_id
* category
* priority
* status
* assigned_to
* description

### AuditLog

* id
* actor_id
* action
* entity_type
* entity_id
* before
* after
* reason
* created_at

---

# חלק כב׳ — זרימות קריטיות

## 42. יצירת הזמנה ידנית

1. פקיד בוחר תאריכים ומספר אורחים.
2. המערכת מציגה זמינות לפי סוג חדר.
3. הפקיד בוחר סוג חדר ו־rate plan.
4. המערכת מחשבת מחיר, מסים ותנאים.
5. הפקיד יוצר/בוחר אורח.
6. הפקיד מוסיף בקשות ותוספות.
7. המערכת בודקת מדיניות פיקדון.
8. אם נדרש תשלום — נשלח לינק או נגבה תשלום.
9. ההזמנה מקבלת סטטוס confirmed/pending payment.
10. המלאי מתעדכן.
11. נשלח אישור.

## 43. שינוי הזמנה

1. פתיחת הזמנה.
2. בחירת שינוי: תאריכים/חדר/מחיר/אורחים.
3. המערכת בודקת זמינות והשפעה כספית.
4. מוצגת השוואה: לפני/אחרי.
5. המשתמש מאשר.
6. נרשם audit.
7. המלאי מתעדכן.
8. folio מתעדכן אם יש צורך.
9. נשלחת הודעה לאורח אם נדרש.

## 44. ביטול הזמנה

1. המשתמש לוחץ ביטול.
2. המערכת מציגה מדיניות ביטול.
3. המערכת מחשבת דמי ביטול.
4. המשתמש בוחר סיבת ביטול.
5. אם יש תשלום מראש — המערכת מחשבת refund/fee.
6. ההזמנה עוברת cancelled.
7. המלאי משתחרר.
8. נשלחת הודעת ביטול.

## 45. צ׳ק־אין

1. פתיחת arrivals.
2. בחירת אורח.
3. בדיקת תנאים מוקדמים.
4. השלמת פרטים חסרים.
5. הקצאת חדר.
6. גביית פיקדון/authorization.
7. חתימה.
8. הפקת מפתח.
9. שינוי סטטוס ל־in-house.
10. שליחת welcome.

## 46. צ׳ק־אאוט

1. פתיחת departures.
2. בחירת חדר/אורח.
3. בדיקת folio.
4. הוספת חיובים אחרונים.
5. פיצול/העברה אם צריך.
6. גבייה/זיכוי.
7. הפקת חשבונית.
8. סגירת folio.
9. שינוי סטטוס ל־checked-out.
10. חדר עובר ל־dirty.
11. נוצרת משימת ניקיון.

## 47. חדרנות

1. חדר checked-out.
2. המערכת יוצרת משימת ניקיון.
3. מנהל חדרנות משייך חדרנית.
4. חדרנית מתחילה משימה.
5. חדרנית מסיימת.
6. מפקחת בודקת.
7. אם מאושר — חדר clean.
8. אם לא מאושר — החדר חוזר למשימה.

---

# חלק כג׳ — MVP

## 48. MVP שלב 1 — מערכת פנימית למלון

חובה לכלול:

1. ניהול מלון.
2. חדרים וסוגי חדרים.
3. מלאי וזמינות.
4. Rate plan בסיסי.
5. יצירת הזמנה ידנית.
6. שינוי/ביטול הזמנה.
7. Room rack.
8. Arrivals/departures.
9. צ׳ק־אין.
10. צ׳ק־אאוט.
11. Folio בסיסי.
12. תשלומים ידניים/סימון תשלום.
13. חדרנות בסיסית.
14. תחזוקה בסיסית.
15. דוחות יומיים.
16. משתמשים והרשאות.
17. Audit log.

לא לכלול בשלב 1:

* Channel Manager מלא.
* Booking Engine ציבורי.
* POS מלא.
* CRM מתקדם.
* BI מתקדם.
* קבוצות מורכבות.
* תשלומים אוטומטיים מלאים.

## 49. MVP שלב 2 — מכירה ותשלומים

כולל:

* Booking Engine.
* Payment Gateway.
* Pay by link.
* Channel Manager ראשון.
* הודעות אורחים.
* חשבוניות.
* Night Audit.
* דוחות כספיים בסיסיים.

## 50. MVP שלב 3 — הרחבה עסקית

כולל:

* קבוצות.
* חברות וסוכנים.
* POS.
* CRM.
* אוטומציות מתקדמות.
* BI.
* multi-property.
* mobile housekeeping.
* kiosk/self-service.

---

# חלק כד׳ — דרישות לא פונקציונליות

## 51. ביצועים

* חיפוש זמינות עד 1 שנייה במלון רגיל.
* פתיחת הזמנה עד 1 שנייה.
* עדכון סטטוס חדר בזמן אמת או כמעט בזמן אמת.
* תמיכה בעומס ערוצים חיצוניים.

## 52. אמינות

* אין לאבד הזמנה.
* אין לאבד תשלום.
* retry לכל אינטגרציה.
* idempotency לכל פעולה חיצונית.
* גיבויים.
* monitoring.

## 53. אבטחה

* MFA למנהלים.
* הרשאות לפי תפקיד.
* הצפנת מידע רגיש.
* audit log.
* הפרדת סביבות.
* tokenization לתשלומים.
* rate limiting.
* session timeout.

## 54. פרטיות

* שמירת consent.
* ייצוא נתוני אורח בהרשאה.
* מחיקה/אנונימיזציה לפי מדיניות.
* הגבלת גישה למסמכי זיהוי.

## 55. זמינות מערכת

יעד עתידי:

* 99.9% uptime לפחות.
* degraded mode אם אינטגרציות נופלות.
* אפשרות ייצוא arrivals/departures במקרה חירום.

---

# חלק כה׳ — מקרי קצה שחייבים לתכנן מראש

## 56. Reservations

* הזמנה של כמה חדרים.
* צ׳ק־אין חלקי.
* צ׳ק־אאוט חלקי.
* מעבר חדר באמצע שהייה.
* הארכת שהייה.
* קיצור שהייה.
* שינוי מחיר באמצע שהייה.
* ביטול חלקי.
* no-show חלקי.
* אורח מחליף אורח ראשי.
* חברה משלמת רק חלק מהחיובים.

## 57. Inventory

* overbooking מאושר.
* חדר out of order בתקופה שיש עליו הזמנה.
* חדר חוזר למלאי מוקדם מהצפוי.
* OTA שולח הזמנה בזמן שהמלאי בדיוק נמכר באתר.
* channel sync delayed.

## 58. Billing

* תשלום מראש גדול מסכום סופי.
* refund חלקי.
* חיוב נזק אחרי checkout.
* folio נסגר ואז נמצאה טעות.
* חיוב POS נכנס אחרי checkout.
* כרטיס נכשל.
* OTA virtual card לא זמין עד יום ההגעה.
* תשלום חברה עם credit limit.

## 59. Housekeeping

* חדר נקי אבל יש תקלה.
* חדר dirty אבל מנהל מאשר צ׳ק־אין חריג.
* DND כל היום.
* חדרנית מדווחת lost & found.
* מפקחת דוחה ניקיון.

---

# חלק כו׳ — שאלות פתוחות להמשך

1. האם המערכת מיועדת קודם למלון בישראל או לשוק בינלאומי?
2. האם צריך תמיכה מיידית בחשבוניות ישראליות?
3. האם התשלום הראשוני יהיה דרך ספק ישראלי או Stripe/Adyen ודומיהם?
4. האם Booking Engine הוא חלק מהגרסה הראשונה או שלב שני?
5. האם המלון הראשון הוא קטן, בינוני או גדול?
6. האם יש מסעדה/ספא/POS כבר בגרסה הראשונה?
7. האם יש צורך ב־mobile app או ש־web responsive מספיק?
8. האם המערכת מיועדת לשימוש פנימי בלבד או גם למכירה כ־SaaS למלונות אחרים?
9. האם יש דרישה לתמיכה ברשת מלונות כבר מהיום הראשון?
10. האם המערכת צריכה להתחרות במערכות קיימות או להיבנות עבור מלון ספציפי?

---

# חלק כז׳ — ההחלטות הכי חשובות עכשיו

## 60. החלטה 1 — לבנות קודם PMS פנימי

לא להתחיל מ־Booking Engine. קודם PMS: חדרים, מלאי, הזמנות, צ׳ק־אין, צ׳ק־אאוט, folio, חדרנות.

## 61. החלטה 2 — מודל הזמנות מתקדם מהיום הראשון

גם אם MVP פשוט, המודל חייב לתמוך ב:

* multi-room.
* room move.
* stay segments.
* folios מרובים.
* guest profiles נפרדים.

## 62. החלטה 3 — Folio לא יהיה “חשבונית”

Folio הוא ספר חיובים. חשבונית היא מסמך שיוצא ממנו. אסור לערבב.

## 63. החלטה 4 — מלאי לפי תאריך וסוג חדר

אין לחשב זמינות רק מהזמנות בזמן אמת בכל מסך. צריך שכבת InventoryDate עקבית, עם מנגנון עדכון ואימות.

## 64. החלטה 5 — כל שינוי קריטי עובר Audit

במיוחד מחיר, תשלום, סטטוס חדר, ביטול, refund, הרשאות ונתוני אורח.

---

# חלק כח׳ — הצעד הבא

המשך המסמך צריך להתפצל לשלושה מסמכי המשך:

1. **Screen Specification** — אפיון מסכים מלא.
2. **Data Model & ERD** — מודל דאטה, קשרים וסטטוסים.
3. **API Specification** — endpoints, events, webhooks ו־permissions.

הסדר המומלץ:

1. לנעול את מודל הדאטה.
2. לפרק את 5 הזרימות הקריטיות למסכים.
3. להגדיר MVP sprint plan.
4. לכתוב API.
5. לעצב UX.

הזרימות הראשונות לפירוק:

* יצירת הזמנה.
* שינוי/ביטול הזמנה.
* צ׳ק־אין.
* צ׳ק־אאוט.
* חדרנות והחזרת חדר למלאי.

---

## סיכום חד

המערכת צריכה להיבנות סביב חמישה אובייקטים שאסור לטעות בהם:

1. Reservation.
2. Stay Segment.
3. Room Assignment.
4. Folio.
5. Inventory Date.

אם חמשת אלו בנויים נכון — אפשר להרחיב לערוצים, תשלומים, CRM, קבוצות, POS ו־BI.

אם הם בנויים לא נכון — המערכת תישבר בדיוק במקומות שמלונות באמת חיים בהם: שינויי הזמנה, מעבר חדר, חיובים, ביטולים, צ׳ק־אין חלקי, OTA ותפעול חדרים.

---

# חלק כט׳ — מנגנונים פנימיים שיושמו

## 65. Authentication & Session Management

### 65.1 JWT Auth

המערכת משתמשת ב־JWT עם שני טוקנים:

* **Access token** — תוקף 8 שעות, נשלח ב־Authorization header.
* **Refresh token** — תוקף 7 ימים, מחדש access token.

### 65.2 נקודות קצה

* `POST /api/auth/login` — אימות עם email + password, החזרת שני טוקנים.
* `POST /api/auth/refresh` — חידוש access token.
* `POST /api/auth/logout` — logout סטייטלס עם audit.
* `GET /api/auth/me` — פרטי המשתמש הנוכחי.
* `POST /api/auth/change-password` — שינוי סיסמה עם אימות הסיסמה הקיימת.

### 65.3 Middleware

* `attachActor(req)` — מפרסר את ה־JWT ומחבר actor לכל request.
* `requireRoles(req, roles)` — אוכף גישה לפי תפקיד, מחזיר 403 אם לא מורשה.
* `assertPropertyScope(req, propertyId)` — מוודא שהמשתמש שייך לאותו מלון (super_admin מעקף).

### 65.4 Rate Limiting

* כל ה־API — 300 בקשות ל־15 דקות לכל IP.
* נקודות Auth — 20 בקשות ל־15 דקות לכל IP.

---

## 66. InventoryLock — מניעת Race Conditions

### 66.1 הגדרה

כאשר שתי הזמנות נוצרות בו-זמנית לאותו חדר ותאריכים, ה-PMS חייב למנוע מצב שבו שתיהן יאושרו.

`InventoryLock` הוא נעילה זמנית על מלאי בזמן יצירת הזמנה.

### 66.2 שדות

* `property`, `roomType`, `arrivalDate`, `departureDate`, `roomsCount`.
* `idempotencyKey` — מזהה ייחודי למניעת כפילויות.
* `source` — pms / booking_engine / channel / api.
* `status` — pending / consumed / released / expired.
* `expiresAt` — TTL אוטומטי (MongoDB TTL index).

### 66.3 זרימה

1. לפני יצירת הזמנה — נוצר lock עם TTL.
2. הזמנה מאושרת — lock עובר consumed, מלאי מתעדכן.
3. הזמנה נכשלה או פגה — lock עובר expired, מלאי משתחרר אוטומטית.
4. כל lock כולל idempotencyKey — שליחה כפולה מערוץ חיצוני לא תיצור שתי הזמנות.

---

## 67. ChannelUpdateQueue — תור עדכוני ערוצים

### 67.1 הגדרה

כל שינוי מלאי, מחיר או restriction שנוצר ב-PMS נדחף לתור לשם שליחה לערוצי מכירה חיצוניים.

### 67.2 שדות

* `property`, `channel`, `eventType` — availability / rate / restriction / stop_sell.
* `payload` — נתוני העדכון.
* `idempotencyKey` — מניעת כפילות שליחה.
* `status` — pending / sent / failed / retrying / cancelled.
* `attempts`, `nextAttemptAt`, `lastError`.

### 67.3 כללים

* כל שינוי מלאי מפעיל `enqueueChannelUpdate`.
* retry אוטומטי על כשלים.
* כל עדכון נרשם ב-`IntegrationLog`.
* ערוצים: Booking.com, Expedia, Agoda, GDS ועוד.

---

## 68. RateOverrideLog — היסטוריית שינויי מחיר

### 68.1 הגדרה

כל שינוי מחיר ידני מחוץ לתעריף המוגדר נרשם בלוג ייעודי.

### 68.2 שדות

* `property`, `ratePlan`, `roomType`, `date`.
* `originalPrice`, `newPrice`, `reason`.
* `changedBy`, `changedByName`, `changedByRole`.
* `afterCheckIn` — האם השינוי בוצע לאחר צ׳ק־אין.
* `approvedHighPrivilege` — האם השינוי אושר על ידי גורם בכיר.

### 68.3 כללים

* שינוי מחיר לאחר צ׳ק־אין דורש הרשאה גבוהה יותר.
* שינוי מחיר תמיד דורש סיבה.
* לא ניתן למחוק שורות מה-log.

---

## 69. StaySegment — מעבר חדר ושינוי מחיר mid-stay

### 69.1 הגדרה

כאשר אורח עובר חדר או משנה rate plan באמצע שהייה, לא משנים את הזמנה המקורית — יוצרים StaySegment חדש.

### 69.2 שדות

* `reservationRoom`, `reservation`, `property`.
* `fromDate`, `toDate`.
* `roomType`, `room`.
* `ratePerNight`, `ratePlan`.
* `changeReason`, `createdBy`, `createdByName`.

### 69.3 שימושים

* upgrade לסוג חדר יקר יותר באמצע שהייה.
* מעבר לחדר פיזי אחר (אותו סוג, נזק / בקשת אורח).
* שינוי מחיר למחצית שהייה.
* כל segment מחויב בנפרד ב-folio.

---

## 70. Automation Rules — מנוע אוטומציות

### 70.1 מבנה

כל חוק מורכב מ:

* `trigger` — האירוע המפעיל.
* `conditions[]` — תנאים (field / operator / value).
* `action` — הפעולה לביצוע.
* `actionParams` — פרמטרים לפעולה.
* `exceptions[]` — מתי לא להפעיל.
* `owner` — מי הגדיר.
* `lastRunAt`, `runCount`, `lastError` — מעקב ביצוע.

### 70.2 Triggers

* `reservation_created`
* `reservation_confirmed`
* `reservation_cancelled`
* `reservation_no_show`
* `check_in`
* `check_out`
* `payment_failed`
* `payment_received`
* `housekeeping_completed`
* `maintenance_created`
* `maintenance_resolved`
* `room_status_changed`
* `vip_arrival_tomorrow`
* `balance_open_at_checkout`

### 70.3 Actions

* `send_message` — מייל / SMS / WhatsApp לאורח.
* `create_notification` — הודעה למשתמש פנימי.
* `create_housekeeping_task` — משימת ניקיון.
* `create_maintenance_ticket` — תקלת תחזוקה.
* `change_room_status` — שינוי סטטוס חדר.
* `post_charge` — חיוב אוטומטי ל-folio.
* `send_payment_link` — שליחת Pay by Link.
* `flag_reservation` — סימון הזמנה לטיפול.
* `notify_role` — שליחת התראה לתפקיד.
* `webhook` — שליחת webhook לשרת חיצוני.

### 70.4 דוגמאות פועלות

* הזמנה non-refundable נוצרת → שלח payment link.
* חדר checked-out → צור housekeeping task.
* housekeeping completed → שנה סטטוס ל-clean pending inspection.
* תשלום נכשל → שלח הודעה ופתח משימה.
* VIP מגיע מחר → התראה למנהל.
* balance פתוחה ביציאה → דגל הזמנה + התראה לקבלה.

---

## 71. Webhooks

### 71.1 הגדרה

המערכת מאפשרת הרשמה ל-webhooks חיצוניים לאירועי ליבה.

### 71.2 אירועים

* `reservation.created`
* `reservation.modified`
* `reservation.cancelled`
* `guest.checked_in`
* `guest.checked_out`
* `room.status_changed`
* `payment.succeeded`
* `payment.failed`
* `folio.closed`
* `invoice.created`
* `maintenance.created`
* `housekeeping.completed`

### 71.3 אבטחה

* כל webhook חתום ב-HMAC-SHA256 עם secret ייחודי לכל מנוי.
* לאחר 5 כשלים רצופים — webhook מושבת אוטומטית.
* כל delivery נרשם ב-IntegrationLog.

---

## 72. IntegrationLog — לוג אינטגרציות

כל קריאה לשירות חיצוני נרשמת:

* `source` — 24 מקורות אפשריים (Booking.com, Expedia, Stripe, ועוד).
* `destination`, `eventType`, `direction` — inbound / outbound.
* `payloadId`, `requestBody`, `responseBody`.
* `statusCode`, `status` — success / failed / retrying / partial / skipped.
* `retryCount`, `errorMessage`, `durationMs`.
* `relatedEntity` — קישור לישות ב-PMS.

---

## 73. Notification System

### 73.1 סוגי התראות (21 סוגים)

* הזמנות: `reservation_created`, `reservation_modified`, `reservation_cancelled`, `no_show`, `vip_arrival`.
* תפעול: `room_dirty`, `room_ooo`, `check_in_pending`, `check_out_pending`.
* כספי: `payment_failed`, `balance_open`, `deposit_due`.
* חדרנות: `housekeeping_delayed`, `inspection_failed`.
* תחזוקה: `maintenance_sla_breach`, `maintenance_critical`.
* ערוצים: `channel_sync_failed`, `overbooking_risk`.
* מערכת: `audit_alert`, `system_health`.

### 73.2 עדיפויות

* `info` / `warning` / `urgent` / `critical`.

### 73.3 ערוצי שליחה

* In-app (frontend notifications).
* Email.
* SMS.
* Push (עתידי).

### 73.4 כללים

* התראות נשמרות עם TTL (נמחקות אוטומטית לאחר X ימים).
* ניתן לקרוא / לבטל / לדחות.
* ניתן לשלוח לתפקיד שלם (לא רק למשתמש ספציפי).

---

# חלק ל׳ — סטטוס מימוש MVP שלב 1

## 74. מה מומש (Backend)

| מודול | סטטוס |
|-------|--------|
| Property Setup | ✅ מלא |
| Room Types | ✅ מלא |
| Physical Rooms + Statuses | ✅ מלא |
| Inventory & Availability | ✅ מלא (כולל locks) |
| Rate Plans + Rate Dates | ✅ מלא |
| Rate Restrictions | ✅ מלא |
| Rate Override Log | ✅ מלא |
| Reservations (כל הזרימות) | ✅ מלא |
| Stay Segments | ✅ מלא |
| Guest Profiles | ✅ מלא |
| Check-in / Check-out | ✅ מלא |
| Partial Check-in / Check-out | ✅ מלא |
| Folio + Lines | ✅ מלא |
| Payments + Tokenization | ✅ מלא |
| Housekeeping Tasks | ✅ מלא |
| Maintenance Tickets | ✅ מלא |
| Groups & Corporate | ✅ מלא |
| Companies + Agents | ✅ מלא |
| Users, Roles & Permissions | ✅ מלא |
| Audit Log | ✅ מלא |
| Webhooks | ✅ מלא |
| Automation Rules (model) | ✅ model — engine בפיתוח |
| Notifications | ✅ model + routes |
| Integration Log | ✅ מלא |
| Channel Update Queue | ✅ מלא |
| Reports | 🟡 בפיתוח |
| Night Audit | 🟡 בפיתוח |
| Auth & JWT | ✅ מלא |

## 75. מה חסר לפני שלב 2

1. **Night Audit flow** — closing יום עסקי, posting room charges, no-show sweep.
2. **Email / SMS שליחה** — חיבור לספק (SendGrid, Twilio, או WhatsApp API).
3. **Pay by Link** — יצירת לינק תשלום + אימות token + סגירת folio.
4. **Promo codes** — לוגיקת אימות קוד מבצע ב-rate plan.
5. **Reports** — פירוט דוחות תפעוליים + כספיים.
6. **Frontend wiring** — חיבור כל מסכי הלקוח ל-API (כרגע חלק ממסכי הפרונטאנד משתמשים ב-mockData).
7. **Multi-language UI** — i18n לעברית + אנגלית.

## 76. שלב 2 — Booking Engine + תשלומים

1. Booking Engine ציבורי — חיבור API לזמינות ומחירים בזמן אמת.
2. Payment Gateway — Stripe / Cardcom / Hyp.
3. Pay by Link — מייל עם לינק תשלום מאובטח.
4. Channel Manager ראשון — Booking.com XML / REST API.
5. Night Audit — flow מלא.
6. חשבוניות — ממשק לספק חשבוניות ישראלי.
7. דוחות כספיים — מלאים.

## 77. שלב 3 — הרחבה עסקית

1. POS — ממשק קופה מלא.
2. CRM מתקדם — קמפיינים, סגמנטציה, loyalty.
3. BI — dashboards מתקדמים, KPI, תחזיות.
4. Multi-property — ניהול כמה מלונות מחשבון אחד.
5. Mobile Housekeeping — app לחדרניות.
6. Kiosk / Self check-in — נקודת קצה ציבורית.
7. Automation Engine — ביצוע חוקי אוטומציה בפועל.
