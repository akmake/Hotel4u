# אפיון מוצר v1 — מערכת CRM מתקדמת מאוד

## 0. מטרת המסמך

מסמך זה מאפיין מערכת CRM מתקדמת לניהול מלא של קשרי לקוחות, מכירות, שיווק, שירות, הצלחת לקוח, אוטומציות, דאטה, AI, אינטגרציות, הרשאות ודוחות.

המטרה אינה לבנות “רשימת אנשי קשר”, אלא **Customer Operating System** — מערכת שמרכזת את כל האמת העסקית על לקוחות, לידים, עסקאות, תקשורת, משימות, הכנסות, בעיות, הזדמנויות וסיכונים.

---

## 1. הגדרה נכונה של CRM מתקדם

CRM מתקדם הוא מערכת שמנהלת את כל מחזור החיים של הלקוח:

1. זיהוי ליד.
2. קליטת ליד.
3. ניקוד ותיעדוף.
4. העברה לנציג מתאים.
5. יצירת פעילות מכירה.
6. ניהול הזדמנות.
7. הצעת מחיר.
8. סגירת עסקה.
9. העברה לאונבורדינג.
10. שירות ותמיכה.
11. הצלחת לקוח.
12. חידוש.
13. שדרוג.
14. שימור.
15. ניתוח דאטה ולמידה עסקית.

מערכת CRM טובה לא רק שומרת מידע. היא אומרת לארגון:

* מי הלקוחות החשובים.
* מי הלידים הכי חמים.
* איזו עסקה בסיכון.
* מי לא טופל בזמן.
* מה הפעולה הבאה הנכונה.
* איפה צוואר הבקבוק במכירות.
* איזה מקור לידים באמת רווחי.
* איזה לקוח בסכנת נטישה.
* איזה נציג צריך עזרה.
* איזה תהליך לא עובד.

---

## 2. הנחות עבודה

כדי להתקדם ללא עצירה על שאלות, המסמך מניח את ההנחות הבאות:

1. המערכת תהיה SaaS בענן.
2. המערכת תהיה multi-tenant — כלומר תוכל לשרת כמה חברות/ארגונים.
3. המערכת תתמוך גם ב־B2B וגם ב־B2C, עם אפשרות להגדיר מודל עבודה לכל לקוח מערכת.
4. המערכת תתמוך בעברית ואנגלית.
5. המערכת תתמוך בצוותי מכירות, שיווק, שירות, הצלחת לקוח והנהלה.
6. המערכת תתמוך בהרשאות מורכבות, שדות מותאמים, pipelines מותאמים ותהליכים מותאמים.
7. המערכת תתחבר לערוצי תקשורת: אימייל, טלפון, WhatsApp, SMS, אתר, טפסים, צ׳אט, רשתות חברתיות.
8. המערכת תתחבר לכלים חיצוניים: הנהלת חשבונות, ERP, BI, מערכות תשלום, קלנדר, דוא״ל, טלפוניה, marketing automation ו־support desk.
9. כל פעולה חשובה תירשם ב־audit log.
10. AI יהיה חלק מהמערכת, אבל לא במקום לוגיקה עסקית יציבה.

---

## 3. חזון מוצר

המערכת צריכה להפוך את ניהול הלקוחות מתהליך מפוזר לתהליך מנוהל, מדיד וחכם.

במקום שהמידע יהיה מפוזר בין:

* מיילים.
* אקסלים.
* WhatsApp.
* זיכרון של נציגים.
* מערכת חשבוניות.
* מערכת תמיכה.
* מערכת שיווק.
* שיחות טלפון.

המערכת תייצר מקור אמת אחד לכל לקוח ולכל קשר עסקי.

החזון:

* כל אינטראקציה מתועדת.
* כל ליד מקבל טיפול.
* כל עסקה נמצאת בשלב ברור.
* כל משימה מקבלת בעלים.
* כל חריגה צפה בזמן.
* כל מנהל רואה תמונת מצב אמיתית.
* כל תהליך ניתן לאוטומציה.
* כל החלטה מבוססת דאטה.

---

## 4. עקרונות מוצר

### 4.1 מערכת סביב תהליך, לא סביב טופס

המשתמש לא רוצה “למלא כרטיס לקוח”. הוא רוצה:

* לסגור עסקה.
* לטפל בליד.
* לחזור ללקוח בזמן.
* להבין מה קרה בשיחה האחרונה.
* לדעת מה הפעולה הבאה.
* לראות מי תקוע.

לכן המערכת צריכה להיות בנויה סביב זרימות עבודה.

### 4.2 מקור אמת אחד ללקוח

כל המידע על לקוח צריך להתחבר לכרטיס אחד:

* פרטים.
* אנשי קשר.
* חברות קשורות.
* עסקאות.
* תכתובות.
* שיחות.
* פגישות.
* משימות.
* הצעות מחיר.
* חשבוניות.
* תשלומים.
* תיקים פתוחים.
* סקרים.
* היסטוריית רכישות.
* הערות פנימיות.

### 4.3 דאטה נקי לפני AI

AI על דאטה מלוכלך מייצר שטויות מהר יותר. לכן לפני המלצות חכמות צריך:

* מניעת כפילויות.
* שדות חובה.
* נורמליזציה.
* validation.
* ownership ברור.
* היסטוריית שינויים.
* מקור נתונים ברור.

### 4.4 CRM צריך להיות יוזם

מערכת מתקדמת לא מחכה שהמשתמש יחפש. היא מתריעה:

* ליד חם לא טופל.
* עסקה לא זזה יותר מדי זמן.
* לקוח אסטרטגי פתח קריאת שירות קריטית.
* לקוח לא נענה כבר שבועיים.
* pipeline לא עומד ביעד.
* renewal מתקרב.
* נציג שינה סכום עסקה בצורה חריגה.

### 4.5 כל שינוי עסקי קריטי חייב audit

שינוי סכום עסקה, שלב pipeline, בעלות על לקוח, מחיקת ליד, שינוי סטטוס, הנחה, הצעה, forecast או הרשאה — חייבים היסטוריה.

---

# חלק א׳ — משתמשים ותפקידים

## 5. סוגי משתמשים

### 5.1 Super Admin

מנהל מערכת ברמת הפלטפורמה.

יכולות:

* ניהול tenants.
* ניהול תוכניות/חבילות.
* צפייה בבריאות מערכת.
* ניהול אינטגרציות גלובליות.
* ניהול אבטחה.

### 5.2 Company Admin

מנהל מערכת מטעם החברה שמשתמשת ב־CRM.

יכולות:

* ניהול משתמשים.
* ניהול הרשאות.
* הגדרת pipelines.
* הגדרת שדות.
* הגדרת אוטומציות.
* הגדרת אינטגרציות.
* ניהול תבניות.

### 5.3 Sales Manager

מנהל מכירות.

צרכים:

* צפייה ב־pipeline.
* forecast.
* ביצועי נציגים.
* עסקאות בסיכון.
* לידים שלא טופלו.
* משימות פתוחות.
* אישור הנחות.
* coaching לנציגים.

### 5.4 Sales Representative

נציג מכירות.

צרכים:

* לידים שלי.
* עסקאות שלי.
* משימות להיום.
* תיעוד שיחות.
* שליחת מיילים.
* קביעת פגישות.
* יצירת הצעות מחיר.
* עדכון שלבים.
* המלצות לפעולה הבאה.

### 5.5 SDR / BDR

נציג פיתוח עסקי שמטפל בלידים לפני מכירה מלאה.

צרכים:

* תור לידים.
* ניקוד לידים.
* cadences.
* שיחות, מיילים ו־LinkedIn tasks.
* qualification.
* העברה ל־Account Executive.

### 5.6 Account Executive

אחראי על ניהול הזדמנות עד סגירה.

צרכים:

* הזדמנויות.
* stakeholders.
* meeting notes.
* proposal.
* quote.
* negotiation.
* close plan.
* forecast.

### 5.7 Account Manager

אחראי על לקוחות קיימים.

צרכים:

* חשבונות קיימים.
* חוזים.
* חידושים.
* upsell.
* cross-sell.
* שביעות רצון.
* health score.

### 5.8 Customer Success Manager

אחראי על הצלחת לקוח, אימוץ, שימור וצמיחה.

צרכים:

* onboarding.
* adoption metrics.
* health score.
* renewal risk.
* playbooks.
* QBR.
* escalation.

### 5.9 Support Agent

אחראי על טיפול בפניות שירות.

צרכים:

* tickets.
* SLA.
* customer history.
* knowledge base.
* escalations.
* תיעוד פתרון.

### 5.10 Marketing Manager

אחראי על קמפיינים, לידים, מסעות לקוח ומדידת מקורות.

צרכים:

* campaign management.
* lead sources.
* forms.
* segmentation.
* email campaigns.
* nurture flows.
* attribution.
* ROI.

### 5.11 Finance / Operations

אחראים על הצעות, חוזים, חשבוניות, תשלומים וסנכרון עם מערכות פיננסיות.

צרכים:

* אישור עסקאות.
* מחירונים.
* הנחות.
* חשבוניות.
* תשלומים.
* סטטוס חוזה.

### 5.12 Executive / Owner

רוצה תמונת מצב ניהולית.

צרכים:

* revenue forecast.
* pipeline value.
* win rate.
* sales cycle.
* churn risk.
* top accounts.
* team performance.
* campaign ROI.

---

# חלק ב׳ — מבנה המערכת

## 6. מודולים עיקריים

המערכת תכלול את המודולים הבאים:

1. Tenant & Company Setup.
2. Users, Teams & Permissions.
3. Accounts.
4. Contacts.
5. Leads.
6. Opportunities / Deals.
7. Pipelines.
8. Activities & Tasks.
9. Communication Hub.
10. Sales Cadences.
11. Quotes / CPQ בסיסי.
12. Products & Price Books.
13. Contracts.
14. Customer Success.
15. Support Tickets.
16. Marketing Automation.
17. Campaigns & Attribution.
18. Forms & Lead Capture.
19. Data Quality & Duplicates.
20. Workflow Automation.
21. AI Assistant & AI Agents.
22. Reports & Dashboards.
23. Integrations.
24. Audit & Compliance.
25. Mobile / Field CRM.
26. Command Center.

---

# חלק ג׳ — Tenant & Company Setup

## 7. Tenant

Tenant הוא הארגון שמשתמש במערכת.

שדות:

* tenant_id.
* שם חברה.
* שם משפטי.
* מדינה.
* אזור זמן.
* שפה ראשית.
* מטבע ראשי.
* תעשייה.
* גודל חברה.
* תוכנית מנוי.
* סטטוס.
* הגדרות אבטחה.
* הגדרות דאטה.
* הגדרות פרטיות.

## 8. הגדרות ארגון

פונקציות:

* הגדרת מבנה צוותים.
* הגדרת תפקידים.
* הגדרת pipelines.
* הגדרת שלבי מכירה.
* הגדרת שדות מותאמים.
* הגדרת views.
* הגדרת scoring.
* הגדרת SLA.
* הגדרת תבניות מייל.
* הגדרת תבניות WhatsApp/SMS.
* הגדרת תבניות מסמך.
* הגדרת שדות חובה.
* הגדרת חוקי ownership.
* הגדרת חוקי duplicate detection.
* הגדרת מדיניות retention.

---

# חלק ד׳ — Users, Teams & Permissions

## 9. משתמשים

שדות:

* user_id.
* tenant_id.
* שם.
* אימייל.
* טלפון.
* תפקיד.
* צוות.
* מנהל ישיר.
* סטטוס.
* אזור גיאוגרפי.
* שפה.
* הרשאות.
* last login.
* MFA status.

## 10. צוותים

פונקציות:

* יצירת צוות.
* שיוך משתמשים.
* מנהל צוות.
* יעד צוות.
* טריטוריה.
* סוג צוות: sales / support / success / marketing.
* visibility rules.

## 11. הרשאות

### 11.1 מודל הרשאות

המערכת צריכה לתמוך בשילוב של:

* Role Based Access Control — הרשאה לפי תפקיד.
* Record Level Access — הרשאה לפי רשומה.
* Field Level Security — הרשאה לפי שדה.
* Team Visibility — הרשאה לפי צוות.
* Territory Access — הרשאה לפי אזור.
* Owner Based Access — בעל הרשומה.

### 11.2 הרשאות קריטיות

* צפייה בליד.
* יצירת ליד.
* עריכת ליד.
* מחיקת ליד.
* המרת ליד ללקוח/עסקה.
* שינוי owner.
* שינוי סכום עסקה.
* שינוי שלב עסקה.
* שינוי forecast category.
* אישור הנחה.
* יצירת quote.
* שליחת quote.
* סגירת עסקה כ־won/lost.
* מחיקת account.
* ייצוא דאטה.
* צפייה בשדות רגישים.
* ניהול אוטומציות.
* ניהול אינטגרציות.
* צפייה בדוחות הנהלה.
* צפייה ב־audit log.

---

# חלק ה׳ — Accounts

## 12. Account

Account מייצג חברה, ארגון או לקוח עסקי.

שדות:

* account_id.
* tenant_id.
* שם חשבון.
* סוג: prospect / customer / partner / vendor / churned.
* תעשייה.
* אתר.
* טלפון.
* כתובת.
* מדינה.
* גודל חברה.
* הכנסה שנתית משוערת.
* מספר עובדים.
* owner.
* parent account.
* account tier.
* source.
* status.
* health score.
* lifecycle stage.
* ARR / MRR אם רלוונטי.
* תאריך תחילת לקוח.
* תאריך חידוש.
* payment status.
* notes.

## 13. סוגי Accounts

* Prospect.
* Active Customer.
* Strategic Account.
* Partner.
* Reseller.
* Vendor.
* Former Customer.
* Blacklisted.

## 14. Hierarchy

נדרש לתמוך ב:

* חברת אם.
* חברות בנות.
* סניפים.
* מחלקות.
* קשר בין כמה accounts.

דוגמה:

חברת אם גלובלית → סניף ישראל → מחלקת רכש → אנשי קשר.

## 15. Account 360

מסך Account צריך להציג:

* פרטים כלליים.
* אנשי קשר.
* עסקאות פתוחות.
* עסקאות סגורות.
* תיקים פתוחים.
* משימות.
* שיחות.
* מיילים.
* פגישות.
* חוזים.
* חשבוניות.
* תשלומים.
* שימוש במוצר אם מחובר.
* health score.
* סיכוני churn.
* הזדמנויות upsell.
* Timeline מלא.

---

# חלק ו׳ — Contacts

## 16. Contact

Contact מייצג אדם.

שדות:

* contact_id.
* tenant_id.
* account_id.
* שם פרטי.
* שם משפחה.
* תפקיד.
* מחלקה.
* אימייל.
* טלפון.
* מובייל.
* LinkedIn URL.
* מדינה.
* שפה.
* seniority.
* buyer role.
* decision maker flag.
* influencer flag.
* technical buyer flag.
* economic buyer flag.
* do not contact.
* marketing consent.
* source.
* owner.
* lifecycle stage.
* last contacted.
* next action.

## 17. Buyer Roles

במערכת B2B מתקדמת חייבים להבין מי האדם בעסקה.

תפקידים אפשריים:

* Decision Maker.
* Economic Buyer.
* Technical Buyer.
* Champion.
* Influencer.
* User.
* Legal.
* Procurement.
* Blocker.

## 18. Contact Timeline

Timeline צריך לכלול:

* מיילים.
* שיחות.
* פגישות.
* הודעות WhatsApp/SMS.
* פתיחת קמפיינים.
* מילוי טפסים.
* ביקור באתר אם יש tracking.
* פתיחת tickets.
* הערות.
* משימות.
* מסמכים שנשלחו.
* quotes.

---

# חלק ז׳ — Leads

## 19. Lead

Lead הוא אדם או חברה שעדיין לא הוסמכו כהזדמנות או לקוח.

שדות:

* lead_id.
* tenant_id.
* שם.
* חברה.
* אימייל.
* טלפון.
* תפקיד.
* מקור.
* campaign.
* medium.
* landing page.
* form id.
* lead score.
* fit score.
* intent score.
* status.
* owner.
* assigned_at.
* SLA deadline.
* last activity.
* qualification notes.

## 20. סטטוסי Lead

* New.
* Open.
* Attempting Contact.
* Contacted.
* Qualified.
* Unqualified.
* Converted.
* Nurturing.
* Disqualified.
* Duplicate.

## 21. Lead Sources

* Website Form.
* Landing Page.
* Chat.
* WhatsApp.
* Phone.
* Email.
* Referral.
* Partner.
* Event.
* Webinar.
* Paid Search.
* Paid Social.
* Organic.
* LinkedIn.
* Manual Import.
* API.

## 22. Lead Scoring

מערכת מתקדמת צריכה לחשב כמה סוגי ציון:

### 22.1 Fit Score

כמה הליד מתאים לפרופיל לקוח אידיאלי.

פרמטרים:

* תעשייה.
* גודל חברה.
* תפקיד.
* מדינה.
* תקציב.
* סוג צורך.

### 22.2 Engagement Score

כמה הליד פעיל.

פרמטרים:

* פתיחת מיילים.
* הקלקות.
* ביקורים באתר.
* הורדת מסמכים.
* השתתפות בוובינר.
* תגובות.

### 22.3 Intent Score

כמה הליד מראה כוונת רכישה.

פרמטרים:

* ביקור בדף מחיר.
* בקשת דמו.
* חיפוש פתרון.
* תגובה מהירה.
* פעילות גבוהה בזמן קצר.

### 22.4 Negative Score

מוריד ניקוד.

דוגמאות:

* אימייל אישי לא עסקי אם B2B.
* מדינה לא נתמכת.
* חברה קטנה מדי.
* סטודנט/ספק.
* unsubscribe.
* spam complaint.

## 23. Lead Routing

כללי routing:

* לפי מדינה.
* לפי שפה.
* לפי גודל חברה.
* לפי תעשייה.
* לפי מוצר מבוקש.
* לפי עומס נציגים.
* round robin.
* לפי source.
* לפי account ownership.
* לפי partner.

דרישות:

* כל ליד חייב owner.
* אם אין owner — הליד נכנס לתור חריגים.
* SLA מתחיל מרגע הקצאה.
* אם נציג לא מטפל בזמן — escalation.

## 24. Lead Conversion

המרת ליד יכולה ליצור:

* Account.
* Contact.
* Opportunity.
* Task.
* Meeting.

כללים:

* לבדוק כפילויות לפני המרה.
* אם Account כבר קיים — לקשר אליו.
* אם Contact כבר קיים — לעדכן במקום ליצור כפול.
* לשמר source/campaign attribution.
* לשמר כל ה־timeline.
* לתעד מי ביצע המרה ומתי.

---

# חלק ח׳ — Opportunities / Deals

## 25. Opportunity

Opportunity היא הזדמנות מכירה עם פוטנציאל הכנסה.

שדות:

* opportunity_id.
* account_id.
* primary_contact_id.
* owner.
* pipeline.
* stage.
* amount.
* currency.
* expected_close_date.
* probability.
* forecast_category.
* source.
* campaign.
* product interest.
* competitors.
* next step.
* close plan.
* loss reason.
* win reason.
* created_at.
* updated_at.

## 26. Pipeline

המערכת חייבת לתמוך בכמה pipelines.

דוגמאות:

* New Business.
* Enterprise Sales.
* SMB Sales.
* Renewals.
* Upsell.
* Partnerships.
* Implementation.

## 27. שלבי מכירה לדוגמה

Pipeline בסיסי:

1. New Opportunity.
2. Discovery.
3. Qualified.
4. Demo / Presentation.
5. Proposal.
6. Negotiation.
7. Legal / Procurement.
8. Closed Won.
9. Closed Lost.

Pipeline SaaS Enterprise:

1. SQL.
2. Discovery Completed.
3. Business Case.
4. Technical Validation.
5. Security Review.
6. Procurement.
7. Contract Sent.
8. Closed Won.
9. Closed Lost.

## 28. Stage Rules

כל שלב יכול להגדיר:

* שדות חובה.
* משימות חובה.
* מסמכים חובה.
* הסתברות ברירת מחדל.
* SLA לשהייה בשלב.
* אישור מנהל.
* תנאים למעבר שלב.

דוגמה:

אי אפשר לעבור ל־Proposal בלי:

* סכום עסקה.
* תאריך סגירה צפוי.
* decision maker.
* product selected.
* next meeting date.

## 29. Opportunity Health

המערכת תחשב בריאות עסקה.

פרמטרים:

* זמן בשלב.
* פעילות אחרונה.
* תאריך next step.
* נוכחות decision maker.
* מספר stakeholders.
* תגובת לקוח.
* שינויי סכום.
* שינויי close date.
* competitor mentioned.
* sentiment.
* email engagement.

סטטוסים:

* Healthy.
* Needs Attention.
* At Risk.
* Critical.

## 30. Forecasting

Forecast צריך לתמוך ב:

* Pipeline value.
* Weighted pipeline.
* Commit.
* Best Case.
* Pipeline.
* Closed.
* Omitted.
* Forecast by rep.
* Forecast by team.
* Forecast by region.
* Forecast by product.
* Forecast by month/quarter.

## 31. Close Lost

סגירת עסקה כ־lost מחייבת:

* סיבת הפסד.
* מתחרה אם ידוע.
* הערת נציג.
* האם להחזיר לנ nurture.
* תאריך follow-up עתידי אם רלוונטי.

סיבות הפסד:

* מחיר.
* אין תקציב.
* אין צורך.
* מתחרה.
* תזמון.
* חוסר התאמה.
* אין החלטה.
* פיצ׳ר חסר.
* בעיית אמון.
* אחר.

## 32. Closed Won

סגירה כ־won צריכה להפעיל:

* יצירת customer account.
* יצירת onboarding project.
* יצירת contract.
* יצירת invoice או sync למערכת פיננסית.
* הודעה ל־Customer Success.
* סגירת משימות מכירה פתוחות או העברתן.
* עדכון ARR/MRR אם רלוונטי.

---

# חלק ט׳ — Activities & Tasks

## 33. Activity

Activity היא כל אינטראקציה או פעולה.

סוגים:

* Call.
* Email.
* Meeting.
* WhatsApp.
* SMS.
* Note.
* Task.
* LinkedIn Task.
* Demo.
* Proposal Sent.
* Contract Sent.
* Internal Note.

## 34. Task

שדות:

* task_id.
* related entity: lead/contact/account/opportunity/ticket.
* owner.
* due date.
* priority.
* status.
* type.
* description.
* reminder.
* outcome.

סטטוסים:

* Open.
* In Progress.
* Completed.
* Deferred.
* Cancelled.
* Overdue.

## 35. Activity Timeline

כל Account/Contact/Lead/Opportunity צריך Timeline מאוחד.

Timeline יכלול:

* פעילויות ידניות.
* פעילויות אוטומטיות.
* מיילים.
* שיחות.
* פגישות.
* tickets.
* מסמכים.
* שינויי סטטוס.
* שינויי owner.
* שינויי סכום.
* AI summaries.

## 36. Next Best Action

המערכת תציע פעולה הבאה:

* התקשר עכשיו.
* שלח מייל המשך.
* קבע פגישה.
* בקש decision maker.
* שלח הצעה.
* עדכן close date.
* escalate למנהל.
* העבר ל־nurture.
* סגור כ־lost.

---

# חלק י׳ — Communication Hub

## 37. ערוצי תקשורת

המערכת צריכה לחבר:

* Email.
* Calendar.
* Phone / VoIP.
* WhatsApp Business.
* SMS.
* Live Chat.
* Website forms.
* Social inbox.
* Video meetings.

## 38. Email Sync

דרישות:

* חיבור Gmail/Outlook.
* שליחה מתוך CRM.
* תיעוד אוטומטי ל־Contact/Account/Deal.
* email tracking.
* פתיחה/הקלקה אם מותר לפי מדיניות.
* templates.
* sequences.
* unsubscribe.
* shared inbox.

## 39. Calendar Sync

פונקציות:

* קביעת פגישות.
* סנכרון Google/Outlook Calendar.
* meeting links.
* reminders.
* תיעוד פגישה ל־CRM.
* סיכום פגישה.
* משימות המשך.

## 40. Phone / VoIP

פונקציות:

* click to call.
* call logging.
* call recording אם מותר.
* call outcome.
* transcription.
* sentiment.
* call queue.
* callback.

## 41. WhatsApp / SMS

פונקציות:

* שליחה מתוך CRM.
* תבניות מאושרות.
* תיעוד אוטומטי.
* opt-in/opt-out.
* conversation ownership.
* handoff בין משתמשים.
* SLA.

---

# חלק יא׳ — Sales Cadences / Sequences

## 42. Cadence

Cadence הוא רצף פעולות מובנה לנציג.

דוגמה:

* יום 1: שליחת מייל.
* יום 2: שיחת טלפון.
* יום 4: מייל המשך.
* יום 7: LinkedIn task.
* יום 10: שיחה שנייה.
* יום 14: break-up email.

## 43. פונקציות Cadence

* יצירת cadence.
* שיוך לידים.
* עצירה אוטומטית אחרי תגובה.
* עצירה אחרי פגישה שנקבעה.
* personalization tokens.
* A/B testing.
* מדידת conversion.
* השוואת ביצועי cadences.
* הגבלת שליחה יומית.
* מניעת spam.

## 44. Outcomes

כל פעילות cadence חייבת outcome:

* Connected.
* No Answer.
* Left Voicemail.
* Interested.
* Not Interested.
* Meeting Booked.
* Bad Fit.
* Wrong Contact.
* Call Back Later.

---

# חלק יב׳ — Products, Price Books, Quotes / CPQ

## 45. Product Catalog

שדות מוצר:

* product_id.
* שם מוצר.
* SKU.
* קטגוריה.
* תיאור.
* מחיר בסיס.
* מטבע.
* billing type.
* active.

סוגי חיוב:

* חד־פעמי.
* חודשי.
* שנתי.
* לפי משתמש.
* לפי שימוש.
* לפי חבילה.

## 46. Price Book

נדרש לתמוך במחירונים שונים:

* Standard.
* Enterprise.
* Partner.
* Region-specific.
* Promotional.
* Custom account pricing.

## 47. Quote

Quote היא הצעת מחיר רשמית.

שדות:

* quote_id.
* opportunity_id.
* account_id.
* contact_id.
* version.
* status.
* currency.
* valid until.
* line items.
* discounts.
* taxes.
* terms.
* approval status.

סטטוסים:

* Draft.
* Pending Approval.
* Approved.
* Sent.
* Viewed.
* Accepted.
* Rejected.
* Expired.

## 48. Quote Approval

כללים:

* הנחה מעל אחוז מסוים דורשת אישור.
* מחיר מתחת למחיר מינימום דורש אישור.
* תנאי תשלום חריגים דורשים אישור.
* התחייבות משפטית חריגה דורשת אישור.

## 49. E-signature

פונקציות:

* שליחת quote לחתימה.
* מעקב צפייה.
* חתימה דיגיטלית.
* שמירת מסמך חתום.
* שינוי סטטוס עסקה.

---

# חלק יג׳ — Contracts

## 50. Contract

שדות:

* contract_id.
* account_id.
* opportunity_id.
* start date.
* end date.
* renewal date.
* contract value.
* billing terms.
* status.
* signed document.
* owner.

סטטוסים:

* Draft.
* Sent.
* Under Review.
* Signed.
* Active.
* Expiring Soon.
* Renewed.
* Terminated.
* Expired.

## 51. Renewals

פונקציות:

* התראה לפני חידוש.
* יצירת renewal opportunity.
* חישוב contract value.
* זיהוי סיכון churn.
* המלצת upsell.
* מעקב משא ומתן.

---

# חלק יד׳ — Customer Success

## 52. Customer Success Workspace

מיועד ללקוחות קיימים.

מסך לקוח צריך להציג:

* health score.
* usage metrics.
* open tickets.
* NPS/CSAT.
* renewal date.
* ARR/MRR.
* onboarding status.
* success plan.
* risks.
* opportunities.
* stakeholders.

## 53. Health Score

Health score מחושב לפי:

* שימוש במוצר.
* תדירות התחברות.
* פתיחת tickets.
* חומרת tickets.
* תשלומים.
* sentiment.
* תוצאות סקרים.
* זמן מאז פגישה אחרונה.
* adoption milestones.
* renewal proximity.

סטטוסים:

* Healthy.
* Watch.
* At Risk.
* Critical.

## 54. Onboarding

פונקציות:

* יצירת onboarding project אחרי Closed Won.
* milestones.
* משימות.
* owner.
* due dates.
* customer tasks.
* internal tasks.
* progress.
* blockers.

## 55. Playbooks

דוגמאות:

* לקוח חדש.
* לקוח בסיכון.
* renewal ב־90 יום.
* usage נמוך.
* ticket קריטי.
* upsell opportunity.

כל playbook כולל:

* trigger.
* משימות.
* תבניות הודעה.
* owner.
* SLA.
* exit criteria.

---

# חלק טו׳ — Support Tickets

## 56. Ticket

שדות:

* ticket_id.
* account_id.
* contact_id.
* subject.
* description.
* channel.
* priority.
* severity.
* category.
* status.
* owner.
* team.
* SLA.
* first response due.
* resolution due.
* created_at.
* closed_at.

## 57. סטטוסי Ticket

* New.
* Open.
* Pending Customer.
* Pending Internal.
* Escalated.
* Solved.
* Closed.
* Reopened.

## 58. SLA

פונקציות:

* SLA לפי priority.
* SLA לפי customer tier.
* SLA לפי חוזה.
* התראות לפני הפרה.
* escalation אוטומטי.
* pause SLA כשממתינים ללקוח.

## 59. Knowledge Base

פונקציות:

* מאמרי עזרה.
* קישור מאמר ל־ticket.
* הצעת מאמר לנציג.
* הצעת מאמר ללקוח.
* מדידת שימוש במאמרים.
* עדכון מאמר מתוך פתרון ticket.

## 60. Escalation

תיק יועבר escalation כאשר:

* SLA עומד להישבר.
* לקוח אסטרטגי.
* severity critical.
* ticket נפתח מחדש כמה פעמים.
* sentiment שלילי.
* המילים “cancel”, “lawyer”, “urgent”, “refund” מופיעות.

---

# חלק טז׳ — Marketing Automation

## 61. Campaign

שדות:

* campaign_id.
* name.
* type.
* owner.
* budget.
* start date.
* end date.
* target audience.
* status.
* source.
* expected revenue.
* actual revenue.

סוגים:

* Email Campaign.
* Webinar.
* Event.
* Paid Search.
* Paid Social.
* Referral.
* Partner Campaign.
* Newsletter.
* Nurture.

## 62. Segments

פילוח לפי:

* lifecycle stage.
* industry.
* country.
* company size.
* engagement.
* product interest.
* last activity.
* lead score.
* customer status.
* renewal date.
* health score.

## 63. Journey Builder

מערכת למסעות לקוח.

דוגמאות:

* ליד הוריד מדריך → שלח מייל → אם פתח → שלח הזמנה לדמו → אם לא פתח → שלח תזכורת.
* לקוח חדש → סדרת onboarding.
* לקוח בסיכון → playbook שימור.
* renewal מתקרב → רצף חידוש.

## 64. Email Marketing

פונקציות:

* template builder.
* personalization.
* dynamic content.
* A/B testing.
* unsubscribe.
* suppression lists.
* deliverability controls.
* open/click tracking.
* bounce handling.
* spam complaint handling.

## 65. Attribution

המערכת צריכה לתמוך ב:

* first touch attribution.
* last touch attribution.
* multi-touch attribution.
* campaign influence.
* ROI לפי מקור.
* cost per lead.
* cost per opportunity.
* cost per won deal.

---

# חלק יז׳ — Forms & Lead Capture

## 66. Forms

פונקציות:

* יצירת טופס.
* שדות מותאמים.
* שדות נסתרים.
* UTM capture.
* captcha.
* double opt-in אם נדרש.
* routing אחרי שליחה.
* יצירת lead/contact.
* שליחת תודה.
* חיבור ל־campaign.

## 67. Website Tracking

פונקציות:

* tracking script.
* זיהוי מבקר ידוע.
* page views.
* form submissions.
* visit source.
* session history.
* scoring.
* intent alerts.

## 68. Chat / Chatbot

פונקציות:

* live chat.
* chatbot qualification.
* routing לנציג.
* יצירת lead/ticket.
* תיעוד שיחה.
* handoff לנציג אנושי.
* appointment booking.

---

# חלק יח׳ — Data Quality

## 69. Duplicate Detection

כפילויות לפי:

* אימייל.
* טלפון.
* שם חברה.
* domain.
* website.
* external id.
* שילוב שם + חברה.

פונקציות:

* זיהוי כפילות בזמן יצירה.
* זיהוי כפילות בייבוא.
* merge wizard.
* בחירת ערך מנצח.
* שמירת היסטוריה.
* מניעת יצירה אוטומטית של כפילות מאינטגרציה.

## 70. Data Enrichment

פונקציות:

* השלמת פרטי חברה לפי domain.
* השלמת תעשייה.
* השלמת גודל חברה.
* אימות אימייל.
* אימות טלפון.
* זיהוי LinkedIn.
* enrichment ידני/אוטומטי.

## 71. Validation Rules

דוגמאות:

* אי אפשר לסגור עסקה בלי סכום.
* אי אפשר להעביר לשלב Proposal בלי decision maker.
* אי אפשר ליצור Contact בלי אימייל או טלפון.
* אי אפשר לשנות owner בלי סיבה בחשבונות אסטרטגיים.
* אי אפשר למחוק Account עם עסקאות סגורות.

## 72. Imports

פונקציות:

* ייבוא CSV.
* mapping שדות.
* preview.
* duplicate detection.
* validation.
* rollback import.
* import history.
* owner assignment.
* source tagging.

---

# חלק יט׳ — Workflow Automation

## 73. Workflow Engine

מבנה workflow:

* Trigger.
* Conditions.
* Actions.
* Delays.
* Branches.
* Exceptions.
* Stop conditions.
* Audit.

## 74. Triggers

דוגמאות:

* Lead created.
* Lead score changed.
* Opportunity stage changed.
* Deal amount changed.
* Task overdue.
* Email opened.
* Form submitted.
* Ticket escalated.
* Contract expiring.
* Customer health changed.
* Payment failed.

## 75. Actions

דוגמאות:

* Create task.
* Send email.
* Send WhatsApp.
* Assign owner.
* Update field.
* Create opportunity.
* Create ticket.
* Notify manager.
* Add to campaign.
* Remove from sequence.
* Create renewal deal.
* Call webhook.

## 76. Workflow Examples

### 76.1 Lead SLA

אם ליד חדש נוצר ולא נוצרה פעילות תוך 30 דקות:

* שלח התראה לנציג.
* אחרי שעה שלח למנהל.
* אחרי שעתיים העבר לנציג אחר.

### 76.2 Deal Risk

אם עסקה מעל 50,000 נמצאת באותו שלב מעל 14 ימים ואין next step:

* סמן At Risk.
* צור משימה לנציג.
* שלח התראה למנהל.

### 76.3 Renewal

90 יום לפני תאריך חידוש:

* צור renewal opportunity.
* צור משימה ל־CSM.
* שלח playbook.
* בדוק health score.

### 76.4 Customer Escalation

אם לקוח enterprise פותח ticket critical:

* שלח התראה ל־CSM.
* שלח התראה למנהל תמיכה.
* צור משימת follow-up למנהל account.

---

# חלק כ׳ — AI Assistant & AI Agents

## 77. עקרונות AI במערכת

AI צריך לעזור למשתמש לעבוד מהר וחכם יותר, אבל לא לבצע פעולות רגישות בלי בקרה.

עקרונות:

* AI מסביר למה הוא ממליץ.
* AI מציג confidence.
* AI לא משנה שדות קריטיים בלי אישור.
* AI לא שולח הודעות רגישות בלי preview.
* כל פעולה של AI נרשמת.
* אפשר לכבות AI ברמת tenant/מודול.

## 78. AI Assistant

יכולות:

* סיכום כרטיס לקוח.
* סיכום שיחה.
* סיכום מיילים.
* יצירת follow-up email.
* ניסוח הצעת ערך.
* זיהוי next steps.
* זיהוי סיכונים בעסקה.
* המלצה על עדכון שלב.
* המלצה על שאלות לפגישה.
* חיפוש מידע במערכת בשפה טבעית.

## 79. AI Lead Scoring

AI יכול לחשב:

* הסתברות המרה.
* התאמה ל־ICP.
* כוונת רכישה.
* סיכוי no-show לפגישה.
* עדיפות טיפול.

## 80. AI Deal Coaching

המערכת תזהה:

* חסר decision maker.
* אין next step.
* close date לא ריאלי.
* סכום השתנה בלי הסבר.
* לקוח לא הגיב הרבה זמן.
* competitor הוזכר.
* legal/procurement לא מעורבים בשלב מאוחר מדי.

## 81. AI Email / Message Generator

פונקציות:

* מייל follow-up אחרי פגישה.
* מייל הצעת ערך.
* מייל break-up.
* תשובה ללקוח.
* ניסוח הודעת WhatsApp.
* התאמת טון.
* התאמת שפה.
* הכנסת פרטים מתוך CRM.

## 82. AI Agents

סוכני AI אפשריים:

### 82.1 Lead Qualification Agent

* קורא ליד חדש.
* בודק מקור, חברה, תפקיד, היסטוריה.
* מציע score.
* מציע owner.
* מציע הודעת פתיחה.

### 82.2 Sales Follow-up Agent

* מזהה עסקאות בלי פעילות.
* מציע follow-up.
* מכין טיוטה.
* יוצר משימה.

### 82.3 Customer Risk Agent

* מזהה health score יורד.
* מנתח tickets ופעילות.
* מציע playbook.

### 82.4 Data Hygiene Agent

* מזהה כפילויות.
* מזהה שדות חסרים.
* מציע merge.
* מציע תיקון פורמט.

## 83. מגבלות AI

AI לא יבצע ללא אישור:

* מחיקת רשומות.
* שינוי owner בחשבונות אסטרטגיים.
* סגירת עסקה.
* שליחת quote.
* אישור הנחה.
* refund.
* שינוי הרשאות.
* ייצוא דאטה.

---

# חלק כא׳ — Reports & Dashboards

## 84. Sales Dashboard

מדדים:

* pipeline value.
* weighted pipeline.
* deals created.
* deals won.
* deals lost.
* win rate.
* average deal size.
* average sales cycle.
* stage conversion.
* stage aging.
* activities per rep.
* quota attainment.
* forecast.

## 85. Lead Dashboard

מדדים:

* leads by source.
* new leads.
* qualified leads.
* conversion rate.
* response time.
* SLA breaches.
* lead score distribution.
* cost per lead.
* source ROI.

## 86. Marketing Dashboard

מדדים:

* campaign performance.
* MQLs.
* SQLs.
* attribution.
* email opens.
* clicks.
* unsubscribes.
* form submissions.
* landing page conversion.
* campaign revenue.

## 87. Customer Success Dashboard

מדדים:

* health score distribution.
* churn risk.
* renewal pipeline.
* adoption.
* expansion opportunities.
* NPS.
* CSAT.
* open escalations.

## 88. Support Dashboard

מדדים:

* open tickets.
* first response time.
* resolution time.
* SLA compliance.
* tickets by category.
* tickets by priority.
* reopen rate.
* agent workload.
* customer satisfaction.

## 89. Executive Dashboard

מדדים:

* revenue forecast.
* closed revenue.
* pipeline coverage.
* sales velocity.
* churn risk.
* net revenue retention.
* campaign ROI.
* top accounts.
* team performance.
* strategic risks.

## 90. Report Builder

פונקציות:

* בחירת entity.
* בחירת שדות.
* פילטרים.
* group by.
* charts.
* export.
* scheduled reports.
* dashboard widgets.
* permissions.

---

# חלק כב׳ — Command Center

## 91. מטרת Command Center

מסך אחד שמראה מה חשוב עכשיו.

לא טבלאות. לא חיפוש. אלא מערכת שמציפה חריגים והמלצות.

## 92. Alerts

* ליד חם לא טופל.
* עסקה גדולה תקועה.
* עסקה בלי next step.
* נציג לא עומד ביעד פעילות.
* ticket קריטי ללקוח אסטרטגי.
* renewal קרוב בלי owner.
* לקוח בסיכון churn.
* campaign עם ROI נמוך.
* הרבה כפילויות חדשות.
* אינטגרציה נכשלה.
* ייבוא דאטה נכשל.

## 93. Recommendations

* העבר ליד לנציג אחר.
* צור follow-up.
* בקש מעורבות מנהל.
* צור renewal opportunity.
* הפעל playbook שימור.
* סגור ליד כלא רלוונטי.
* עדכן forecast.
* בצע merge לרשומות כפולות.
* שלח קמפיין nurture.

## 94. Prioritization

כל alert יקבל:

* severity.
* business impact.
* owner.
* due date.
* recommended action.
* reason.

---

# חלק כג׳ — Integrations

## 95. אינטגרציות חובה

* Gmail.
* Outlook.
* Google Calendar.
* Microsoft Calendar.
* WhatsApp Business.
* SMS provider.
* VoIP provider.
* Website forms.
* Landing pages.
* Marketing tools.
* LinkedIn/Sales Navigator אם אפשרי.
* ERP.
* Accounting.
* Payment provider.
* E-signature.
* BI.
* Data warehouse.
* Support tools.
* Product analytics.
* Slack/Teams.
* Zapier/Make.
* Webhooks/API.

## 96. Integration Event Log

כל אירוע אינטגרציה צריך לכלול:

* integration name.
* direction: inbound/outbound.
* event type.
* entity.
* external id.
* request payload.
* response payload.
* status.
* retry count.
* error.
* created_at.

## 97. API

המערכת צריכה API עבור:

* Accounts.
* Contacts.
* Leads.
* Opportunities.
* Activities.
* Tasks.
* Tickets.
* Campaigns.
* Users.
* Custom Objects.
* Webhooks.

## 98. Webhooks

אירועים:

* lead.created.
* lead.updated.
* lead.converted.
* contact.created.
* account.created.
* opportunity.created.
* opportunity.stage_changed.
* opportunity.closed_won.
* opportunity.closed_lost.
* task.completed.
* ticket.created.
* ticket.escalated.
* quote.sent.
* quote.accepted.
* customer.health_changed.

---

# חלק כד׳ — Customization Platform

## 99. Custom Fields

סוגי שדות:

* Text.
* Number.
* Currency.
* Date.
* DateTime.
* Boolean.
* Picklist.
* Multi-select.
* Lookup.
* Formula.
* URL.
* Email.
* Phone.
* File.

## 100. Custom Objects

המערכת צריכה לאפשר יצירת אובייקטים מותאמים.

דוגמאות:

* Properties בנדל״ן.
* Vehicles בליסינג.
* Policies בביטוח.
* Courses בחינוך.
* Patients בבריאות אם מותר רגולטורית.
* Projects בחברות שירותים.

## 101. Page Layouts

פונקציות:

* עיצוב כרטיס לפי תפקיד.
* הסתרת שדות.
* שדות חובה לפי שלב.
* sections.
* related lists.
* widgets.

## 102. Views

פונקציות:

* רשימות שמורות.
* פילטרים.
* Kanban.
* Table.
* Calendar.
* Map אם רלוונטי.
* owner views.
* team views.

---

# חלק כה׳ — Audit, Security & Compliance

## 103. Audit Log

כל פעולה קריטית תירשם:

* מי ביצע.
* מתי.
* מאיזה IP.
* מאיזה device.
* איזו רשומה.
* ערך קודם.
* ערך חדש.
* סיבה אם נדרש.

פעולות חובה ל־audit:

* יצירה/מחיקה של רשומה.
* שינוי owner.
* שינוי stage.
* שינוי סכום.
* שינוי close date.
* שינוי הרשאות.
* ייצוא דאטה.
* שינוי workflow.
* שינוי integration.
* צפייה בשדות רגישים אם מוגדר.

## 104. Security

דרישות:

* MFA.
* SSO/SAML בעתיד.
* session timeout.
* IP allowlist.
* encryption at rest.
* encryption in transit.
* field-level encryption לשדות רגישים.
* rate limiting.
* API keys management.
* permission testing.

## 105. Privacy

דרישות:

* consent management.
* unsubscribe.
* do not contact.
* data retention.
* right to export.
* right to delete/anonymize בהתאם למדיניות.
* privacy logs.
* limitation על ייצוא המוני.

---

# חלק כו׳ — Mobile CRM

## 106. Mobile Use Cases

* נציג שטח רואה לקוחות קרובים.
* תיעוד פגישה מיד אחרי פגישה.
* הקלטת note קולית.
* קבלת משימות.
* עדכון deal stage.
* צילום מסמך.
* חתימה במקום.
* WhatsApp/Call מהכרטיס.

## 107. דרישות Mobile

* responsive web בשלב ראשון.
* mobile app בשלב מתקדם.
* offline notes.
* push notifications.
* quick actions.
* click to call.
* meeting summary.

---

# חלק כז׳ — מודל דאטה ראשוני

## 108. ישויות מרכזיות

### Tenant

* id
* name
* status
* plan
* settings
* created_at

### User

* id
* tenant_id
* name
* email
* role_id
* team_id
* status

### Team

* id
* tenant_id
* name
* manager_id
* type

### Role

* id
* tenant_id
* name
* permissions

### Account

* id
* tenant_id
* name
* type
* industry
* website
* owner_id
* parent_account_id
* lifecycle_stage
* health_score

### Contact

* id
* tenant_id
* account_id
* first_name
* last_name
* email
* phone
* title
* buyer_role
* owner_id

### Lead

* id
* tenant_id
* name
* email
* company
* source
* score
* status
* owner_id
* campaign_id

### Opportunity

* id
* tenant_id
* account_id
* primary_contact_id
* owner_id
* pipeline_id
* stage_id
* amount
* currency
* close_date
* forecast_category
* status

### Pipeline

* id
* tenant_id
* name
* type

### PipelineStage

* id
* pipeline_id
* name
* order
* probability
* required_fields

### Activity

* id
* tenant_id
* entity_type
* entity_id
* type
* subject
* body
* owner_id
* occurred_at

### Task

* id
* tenant_id
* entity_type
* entity_id
* owner_id
* due_at
* status
* priority

### Campaign

* id
* tenant_id
* name
* type
* budget
* status

### Ticket

* id
* tenant_id
* account_id
* contact_id
* subject
* priority
* severity
* status
* owner_id

### Quote

* id
* tenant_id
* opportunity_id
* account_id
* version
* status
* total_amount

### QuoteLine

* id
* quote_id
* product_id
* quantity
* unit_price
* discount
* total

### Product

* id
* tenant_id
* name
* sku
* billing_type
* active

### Workflow

* id
* tenant_id
* name
* trigger
* conditions
* actions
* status

### AuditLog

* id
* tenant_id
* actor_id
* action
* entity_type
* entity_id
* before
* after
* created_at

### IntegrationEvent

* id
* tenant_id
* integration
* direction
* event_type
* status
* payload
* error
* created_at

---

# חלק כח׳ — זרימות קריטיות

## 109. קליטת Lead מטופס אתר

1. משתמש ממלא טופס.
2. המערכת קולטת UTM ו־source.
3. נבדקת כפילות.
4. נוצר Lead או מעודכן Lead קיים.
5. מחושב lead score.
6. נבחר owner לפי routing.
7. נפתחת משימת follow-up.
8. נשלחת הודעת תודה.
9. SLA מתחיל.
10. אם אין טיפול בזמן — escalation.

## 110. Lead Qualification

1. נציג פותח Lead.
2. רואה source, score, היסטוריה ופעילות.
3. מבצע שיחה/מייל.
4. מתעד outcome.
5. ממלא שדות qualification.
6. בוחר Qualified/Unqualified/Nurture.
7. אם Qualified — ממיר ל־Account/Contact/Opportunity.
8. אם Unqualified — בוחר סיבה.

## 111. יצירת Opportunity

1. בוחרים Account.
2. בוחרים Contact ראשי.
3. בוחרים pipeline.
4. ממלאים amount, close date, product interest.
5. המערכת בודקת שדות חובה.
6. נוצרה Opportunity בשלב ראשון.
7. נוצרת משימת next step.
8. נכנסת ל־forecast אם מוגדר.

## 112. מעבר שלב בעסקה

1. נציג משנה שלב.
2. המערכת בודקת שדות חובה.
3. המערכת מציגה חסרים.
4. אם הכל תקין — השלב מתעדכן.
5. probability מתעדכן.
6. forecast מתעדכן.
7. נוצרות משימות אוטומטיות לשלב החדש.
8. נרשם audit.

## 113. Closed Won

1. נציג מסמן Closed Won.
2. המערכת דורשת סכום סופי, מוצרים ותאריך סגירה.
3. נבדק quote/contract אם נדרש.
4. נוצר Contract.
5. נוצר Onboarding Project.
6. Customer Success מקבל משימה.
7. Finance מקבל הודעה.
8. Account lifecycle משתנה ל־Customer.

## 114. Ticket קריטי ללקוח קיים

1. Ticket נוצר מערוץ כלשהו.
2. המערכת מזהה Account ו־tier.
3. אם tier גבוה ו־severity critical — escalation.
4. CSM מקבל התראה.
5. Support Manager מקבל התראה.
6. SLA מתחיל.
7. כל הפעילות נרשמת ב־Timeline של הלקוח.

## 115. Renewal

1. 90 יום לפני תאריך חידוש נוצר renewal opportunity.
2. Health score נבדק.
3. אם יש סיכון — playbook שימור מופעל.
4. Account Manager מקבל משימות.
5. נשלחת הודעה מתוזמנת אם מוגדר.
6. pipeline renewal מתעדכן.

---

# חלק כט׳ — מקרי קצה שחייבים לתכנן

## 116. Leads

* ליד בלי אימייל אבל עם טלפון.
* ליד כפול מאותו טופס.
* ליד שהוא כבר לקוח קיים.
* ליד מחברה שכבר קיימת כ־Account.
* ליד עם source חסר.
* ליד שנכנס בלילה ואין נציג זמין.
* ליד ממדינה לא נתמכת.
* ליד לא רלוונטי אבל בעל פוטנציאל עתידי.

## 117. Accounts / Contacts

* איש קשר עובד בשתי חברות.
* חברה בת וחברת אם.
* מיזוג חברות.
* לקוח אסטרטגי מחליף owner.
* איש קשר ביקש לא לקבל שיווק.
* איש קשר נמחק אבל היסטוריית עסקאות צריכה להישמר.

## 118. Opportunities

* עסקה מפוצלת לכמה מוצרים.
* עסקה עברה נציג באמצע.
* סכום עסקה השתנה משמעותית.
* close date נדחה כמה פעמים.
* עסקה נסגרה won ואז בוטלה.
* עסקה lost חזרה לחיים.
* quote פג תוקף.
* הנחה דורשת אישור.

## 119. Activities

* מייל נכנס בלי התאמה ללקוח.
* שיחה מתועדת על contact לא נכון.
* פגישה בוטלה.
* נציג עוזב חברה ויש להעביר משימות.
* פעילות פרטית לא צריכה להסתנכרן ל־CRM.

## 120. Data

* ייבוא CSV עם שדות שגויים.
* כפילות בין Lead ו־Contact.
* אינטגרציה יוצרת כפילויות.
* מחיקה בטעות.
* שדה חובה נוסף אחרי שכבר יש רשומות קיימות.

---

# חלק ל׳ — MVP

## 121. MVP שלב 1 — CRM Sales Core

חובה לכלול:

1. Tenants.
2. Users & Roles.
3. Accounts.
4. Contacts.
5. Leads.
6. Opportunities.
7. Pipelines.
8. Activities.
9. Tasks.
10. Basic Email Logging ידני או חיבור בסיסי.
11. Lead Routing בסיסי.
12. Views.
13. Dashboards בסיסיים.
14. Custom fields בסיסי.
15. Import CSV.
16. Duplicate detection בסיסי.
17. Audit log.

לא לכלול בשלב 1:

* AI agents מלאים.
* Marketing automation מתקדם.
* CPQ מלא.
* Support מלא.
* Customer Success מלא.
* Data enrichment מתקדם.
* Mobile app native.

## 122. MVP שלב 2 — Automation & Communication

כולל:

* Email sync.
* Calendar sync.
* Workflow automation.
* Sequences/Cadences.
* Forms.
* Lead scoring.
* WhatsApp/SMS בסיסי.
* Report builder.
* Webhooks.
* API בסיסי.

## 123. MVP שלב 3 — Revenue Platform

כולל:

* Quotes.
* Product catalog.
* Price books.
* Approval flows.
* Contracts.
* Forecasting מתקדם.
* AI assistant.
* Deal health.
* Command Center.

## 124. MVP שלב 4 — Full Customer Operating System

כולל:

* Customer Success.
* Support tickets.
* Knowledge base.
* Marketing automation מתקדם.
* Attribution.
* AI agents.
* Data enrichment.
* Advanced permissions.
* Native mobile app.
* Data warehouse sync.

---

# חלק לא׳ — דרישות לא פונקציונליות

## 125. ביצועים

* פתיחת כרטיס לקוח עד 1 שנייה במצב רגיל.
* חיפוש גלובלי עד 1–2 שניות.
* שמירת פעילות מיידית.
* תמיכה בייבוא גדול באמצעות job async.
* Dashboards כבדים ירוצו על שכבת aggregation.

## 126. אמינות

* אין לאבד פעילות.
* אין לאבד מייל מסונכרן.
* אינטגרציות עם retry.
* idempotency לאירועים נכנסים.
* import rollback.
* גיבויים.
* monitoring.

## 127. אבטחה

* MFA.
* RBAC.
* Field permissions.
* Audit.
* Encryption.
* API rate limits.
* SSO בעתיד.
* הפרדת tenants מוחלטת.

## 128. פרטיות וציות

* consent.
* unsubscribe.
* do not contact.
* retention.
* export.
* anonymization.
* data processing logs.

## 129. Scalability

המערכת צריכה לתמוך ב:

* חברות קטנות עם 5 משתמשים.
* חברות בינוניות עם מאות משתמשים.
* מיליוני activities.
* אינטגרציות רבות.
* custom fields רבים.
* workflows רבים.

---

# חלק לב׳ — החלטות קריטיות

## 130. החלטה 1 — CRM הוא לא Contact Manager

אסור להתחיל ולסיים ב־Accounts/Contacts. הליבה היא תהליכים:

* lead to opportunity.
* opportunity to customer.
* customer to renewal.
* ticket to resolution.
* campaign to revenue.

## 131. החלטה 2 — מודל דאטה חייב להיות גמיש אבל לא פרוץ

צריך custom fields/custom objects, אבל לא להפוך הכל ל־JSON בלי מבנה. יש לשמור ישויות ליבה חזקות.

## 132. החלטה 3 — Timeline מאוחד הוא קריטי

בלי Timeline, המשתמש לא יודע מה קרה עם הלקוח.

## 133. החלטה 4 — Ownership ברור לכל רשומה

כל Lead, Account, Opportunity, Ticket ו־Task צריכים בעלים או תור ברור.

## 134. החלטה 5 — AI מגיע אחרי תהליך ודאטה

AI לא מחליף pipeline, scoring, ownership, workflow ו־audit. הוא יושב מעליהם.

## 135. החלטה 6 — Reporting צריך להיבנות מהיום הראשון

אם לא מתכננים reporting נכון, אחר כך אי אפשר לענות על שאלות בסיסיות:

* מה מקור הלידים הכי רווחי?
* למה עסקאות נתקעות?
* מי הנציג הכי יעיל?
* איפה איבדנו הכנסות?
* איזה לקוחות בסיכון?

---

# חלק לג׳ — מסכים עיקריים

## 136. Global Home

* My tasks.
* My leads.
* My deals.
* Alerts.
* Recommended actions.
* Recent activity.
* Performance snapshot.

## 137. Lead Inbox

* לידים חדשים.
* לידים לפי score.
* SLA.
* owner.
* source.
* status.
* quick actions.

## 138. Account 360

* overview.
* contacts.
* opportunities.
* activities.
* tickets.
* contracts.
* revenue.
* health.
* notes.
* timeline.

## 139. Opportunity Board

* Kanban לפי stages.
* drag and drop.
* סכומים.
* health.
* next step.
* owner.
* warnings.

## 140. Activity Center

* tasks.
* calls.
* emails.
* meetings.
* overdue.
* today.
* upcoming.

## 141. Sales Manager Dashboard

* pipeline.
* forecast.
* reps.
* stuck deals.
* SLA.
* conversion.
* alerts.

## 142. Campaign Dashboard

* leads.
* conversions.
* revenue.
* cost.
* ROI.
* attribution.

## 143. Customer Success Workspace

* customers.
* health.
* renewals.
* risks.
* playbooks.
* adoption.

## 144. Support Workspace

* tickets.
* SLA.
* queues.
* escalations.
* knowledge base.

## 145. Admin Settings

* users.
* roles.
* teams.
* fields.
* pipelines.
* workflows.
* integrations.
* templates.
* audit.

---

# חלק לד׳ — הצעד הבא

המשך נכון צריך להתפצל לשלושה מסמכי המשך:

1. **Data Model & ERD** — מודל ישויות, קשרים, סטטוסים, הרשאות ושדות.
2. **Screen Specification** — פירוק כל מסך לרכיבים, פעולות ומצבי קצה.
3. **Workflow & API Specification** — אוטומציות, אירועים, webhooks ו־API.

הסדר המומלץ:

1. לנעול ישויות ליבה.
2. להגדיר pipeline ו־lead flow.
3. להגדיר account/contact/opportunity 360.
4. להגדיר הרשאות.
5. להגדיר MVP.
6. לפרק מסכים.
7. להגדיר API ואינטגרציות.

---

## סיכום חד

מערכת CRM מתקדמת צריכה להיבנות סביב 7 אובייקטים שאסור לטעות בהם:

1. Account.
2. Contact.
3. Lead.
4. Opportunity.
5. Activity.
6. Task.
7. Timeline.

ולצידם 5 מנועים:

1. Routing.
2. Scoring.
3. Workflow Automation.
4. Reporting.
5. Permissions.

אם אלה בנויים נכון — אפשר להרחיב ל־AI, שיווק, שירות, הצלחת לקוח, CPQ, חוזים, אינטגרציות ו־BI.

אם הם בנויים לא נכון — ה־CRM יהפוך מהר מאוד לאקסל יקר עם ממשק יפה.

---

# הרחבה v2 — CRM מסונכרן עם מערכת המלון הראשית

## 146. הגדרת הקשר בין שתי המערכות

המערכת הראשית שאופיינה קודם היא **Hotel Operating System** — מערכת התפעול של המלון: חדרים, הזמנות, צ׳ק־אין, צ׳ק־אאוט, פוליו, תשלומים, חדרנות, תחזוקה וערוצי מכירה.

מערכת ה־CRM היא שכבת **Customer Intelligence & Engagement** — מערכת שמנהלת את הקשר עם אורחים, לקוחות, חברות, סוכנים, קבוצות, לידים, קמפיינים, שירות, שימור, מכירות, דאטה ו־AI.

הקשר הנכון:

* Hotel OS מנהל את הפעולה המלונאית.
* CRM מנהל את היחסים, ההזדמנויות, התקשורת והערך העסקי סביב הלקוח.
* שתי המערכות צריכות להסתנכרן, אבל לא לבלבל תחומי אחריות.

### 146.1 דוגמה פשוטה

אורח מזמין חדר באתר המלון.

ב־Hotel OS:

* נוצרת Reservation.
* ננעל מלאי חדרים.
* נפתח Folio.
* נוצרת משימת חדרנות לפני הגעה.

ב־CRM:

* נוצר או מתעדכן Guest Profile.
* מתועד מקור ההזמנה.
* נוצר Timeline event.
* מחושב ערך לקוח.
* מופעל מסע pre-arrival.
* נבדקת אפשרות upsell.
* לאחר עזיבה מופעל follow-up וסקר.

### 146.2 עקרון חלוקת אחריות

אסור ששתי המערכות ינסו לנהל את אותו דבר במקביל.

Hotel OS הוא מקור האמת עבור:

* חדרים.
* מלאי.
* זמינות.
* הזמנות.
* צ׳ק־אין.
* צ׳ק־אאוט.
* פוליו.
* חיובים.
* תשלומים.
* חדרנות.
* תחזוקה.
* סטטוס שהייה.

CRM הוא מקור האמת עבור:

* קשרי לקוחות.
* העדפות אורח.
* היסטוריית תקשורת.
* קמפיינים.
* לידים.
* לקוחות עסקיים.
* סוכנים וחברות.
* משימות מכירה ושימור.
* שירות לקוחות.
* נאמנות.
* סגמנטים.
* churn risk.
* marketing consent.
* customer lifetime value.

---

# חלק לה׳ — מודל סנכרון בין CRM ל־Hotel OS

## 147. מטרת הסנכרון

הסנכרון צריך לאפשר למלון:

* לראות תמונה מלאה של כל אורח.
* להפעיל שיווק מותאם אישית.
* לזהות אורחים חוזרים.
* להציע upsell בזמן הנכון.
* לטפל בתלונות ובעיות לפני שהן מתפוצצות.
* להבין ערך לקוח לאורך זמן.
* לחבר בין הזמנות, שהיות, תשלומים, שירות ותקשורת.
* לנהל חברות, קבוצות וסוכנים בצורה עסקית.
* לייצר דאטה אמין להנהלה.

## 148. ארכיטקטורת סנכרון מומלצת

### 148.1 Event Driven Architecture

ה־Hotel OS ישלח אירועים ל־CRM בכל פעולה חשובה.

דוגמאות:

* reservation.created.
* reservation.modified.
* reservation.cancelled.
* reservation.no_show.
* guest.checked_in.
* guest.checked_out.
* room.upgraded.
* payment.failed.
* folio.closed.
* invoice.created.
* complaint.created.
* maintenance.issue_affecting_guest.
* housekeeping.delay_affecting_arrival.

ה־CRM יגיב לאירועים באמצעות:

* עדכון פרופיל לקוח.
* יצירת פעילות Timeline.
* יצירת משימה.
* שליחת הודעה.
* הפעלת קמפיין.
* הפעלת AI recommendation.
* יצירת alert.
* עדכון scoring.

### 148.2 API דו־כיווני

בנוסף לאירועים, שתי המערכות צריכות API לקריאות יזומות.

CRM צריך למשוך מ־Hotel OS:

* היסטוריית הזמנות.
* שהיות.
* סטטוס שהייה נוכחי.
* פוליו סופי.
* סכומי הכנסה.
* סוגי חדרים מועדפים.
* תקלות או תלונות שקשורות לשהייה.
* סטטוס תשלום.

Hotel OS צריך למשוך מ־CRM:

* העדפות אורח.
* VIP level.
* marketing consent.
* blacklist / watchlist.
* notes חשובים.
* guest tags.
* loyalty tier.
* customer risk.
* open service cases.
* upsell eligibility.

### 148.3 Integration Middleware

כדי לא לקשור את שתי המערכות בקוד קשיח, מומלץ לבנות שכבת Integration Hub.

תפקידיה:

* קבלת events.
* validation.
* mapping.
* retry.
* idempotency.
* error handling.
* logs.
* dead letter queue.
* monitoring.
* replay של אירועים.
* ניהול גרסאות payload.

## 149. Source of Truth לפי ישות

| ישות                | מקור אמת                    | הערה                                        |
| ------------------- | --------------------------- | ------------------------------------------- |
| Guest Profile בסיסי | CRM                         | שם, תקשורת, העדפות, consent                 |
| Reservation         | Hotel OS                    | אין לנהל הזמנות ב־CRM                       |
| Stay                | Hotel OS                    | CRM רק מציג ומנתח                           |
| Room Assignment     | Hotel OS                    | CRM לא משנה חדרים                           |
| Folio               | Hotel OS                    | CRM רואה סיכום הכנסות                       |
| Payment             | Hotel OS / Payment Provider | CRM לא שומר כרטיסים                         |
| Company Account     | CRM                         | אבל חוזים ומחירים יכולים להשפיע על Hotel OS |
| Travel Agent        | CRM                         | Hotel OS משתמש בו להזמנה                    |
| Campaign            | CRM                         | משפיע על מקור הזמנה                         |
| Service Case        | CRM                         | יכול לפתוח משימה ב־Hotel OS                 |
| Guest Request       | CRM או Hotel OS לפי סוג     | בקשה תפעולית עוברת ל־Hotel OS               |
| Housekeeping        | Hotel OS                    | CRM רק מקבל השפעה על חוויה                  |
| Maintenance         | Hotel OS                    | CRM מקבל אירועים שמשפיעים על אורח           |
| Loyalty             | CRM                         | Hotel OS מקבל tier והטבות                   |

## 150. כללי סנכרון קריטיים

1. כל אירוע חייב event_id ייחודי.
2. כל אירוע חייב timestamp.
3. כל אירוע חייב source_system.
4. כל אירוע חייב entity_id פנימי וחיצוני.
5. כל אירוע חייב version.
6. אירועים חייבים להיות idempotent.
7. אין ליצור כפילות Guest/Contact בלי בדיקת duplicate.
8. ביטול הזמנה לא מוחק היסטוריה ב־CRM.
9. שינוי סטטוס שהייה נרשם ב־Timeline.
10. Payment failed יוצר alert, אבל לא שולח הודעה בלי בדיקת מדיניות.
11. כל פעולה שיווקית ב־CRM חייבת consent.
12. העדפות אורח מה־CRM צריכות להיות זמינות בפרונט־דסק לפני צ׳ק־אין.
13. VIP level חייב להופיע ב־Hotel OS בזמן הקצאת חדר.
14. תלונה פתוחה ב־CRM חייבת להופיע ב־Hotel OS בזמן check-in/check-out.
15. אירוע שקשור לשירות חדר, ניקיון או תחזוקה חייב להגיע למודול התפעולי המתאים.

---

# חלק לו׳ — ישויות משותפות בין CRM ל־Hotel OS

## 151. Unified Guest Profile

זהו הפרופיל המאוחד של אורח.

שדות:

* guest_crm_id.
* hotel_os_guest_id.
* external_ids.
* שם פרטי.
* שם משפחה.
* אימייל.
* טלפון.
* WhatsApp.
* מדינה.
* שפה.
* תאריך לידה אם מותר.
* marketing consent.
* communication preferences.
* VIP level.
* loyalty tier.
* tags.
* preferences.
* allergies.
* special notes.
* blacklist/watchlist.
* total stays.
* total nights.
* total revenue.
* last stay date.
* next stay date.
* average spend.
* preferred room type.
* preferred channel.
* last complaint.
* open cases.
* satisfaction score.
* churn/return probability.

## 152. Guest Identity Resolution

כדי למנוע כפילויות, יש לבנות מנוע זיהוי אורח.

התאמה חזקה:

* אותו אימייל.
* אותו מספר טלפון.
* אותו מספר loyalty.
* אותו external id מערוץ הזמנה.

התאמה בינונית:

* שם + טלפון דומה.
* שם + אימייל דומה.
* שם + מדינה + תאריך לידה.
* שם + היסטוריית הזמנה דומה.

התאמה חלשה:

* שם דומה בלבד.
* אותו domain.
* אותו מקור הזמנה.

פעולות:

* auto merge בהתאמה חזקה בלבד אם המדיניות מאפשרת.
* הצעת merge למשתמש בהתאמה בינונית.
* סימון חשד לכפילות בהתאמה חלשה.
* שמירת היסטוריית merge.
* אפשרות undo merge.

## 153. Stay History

ה־CRM צריך להציג היסטוריית שהיות מה־Hotel OS.

שדות:

* stay_id.
* reservation_id.
* property_id.
* arrival_date.
* departure_date.
* nights.
* room_type_booked.
* room_type_actual.
* rate_plan.
* source.
* channel.
* booking_value.
* actual_spend.
* status.
* checked_in_at.
* checked_out_at.
* satisfaction_after_stay.

## 154. Revenue Summary

ה־CRM לא צריך לנהל Folio, אבל צריך לקבל סיכום עסקי.

שדות:

* total_room_revenue.
* total_f&b_revenue.
* total_spa_revenue.
* total_parking_revenue.
* total_other_revenue.
* total_refunds.
* total_discounts.
* total_net_revenue.
* average_daily_rate.
* average_spend_per_stay.
* average_spend_per_night.

## 155. Preferences

העדפות אורח צריכות להסתנכרן ל־Hotel OS.

סוגי העדפות:

* מיטה זוגית/נפרדת.
* קומה גבוהה.
* קומה נמוכה.
* קרוב למעלית.
* רחוק ממעלית.
* חדר שקט.
* נוף לים.
* נגישות.
* כריות.
* טמפרטורה.
* שעת הגעה.
* שעת עזיבה מועדפת.
* אלרגיות.
* שפה מועדפת.
* ערוץ תקשורת מועדף.

כללים:

* העדפה אינה התחייבות.
* העדפה קריטית צריכה להופיע כהתראה.
* העדפה רפואית/רגישה דורשת הרשאות.
* עדכון העדפה ב־Hotel OS צריך לחזור ל־CRM.

## 156. Company / Corporate Account

במלונות שעובדים עם חברות, ה־CRM הוא מקור האמת ל־Company Account.

שדות:

* company_id.
* שם חברה.
* industry.
* account owner.
* negotiated rates.
* contract dates.
* credit limit.
* payment terms.
* contacts.
* total bookings.
* total room nights.
* total revenue.
* open opportunities.
* renewal date.
* satisfaction.
* risk level.

סנכרון ל־Hotel OS:

* company profile.
* negotiated rate eligibility.
* billing instructions.
* credit limit warning.
* authorized bookers.
* contract validity.

## 157. Travel Agent / Partner Profile

CRM צריך לנהל סוכנים ושותפים.

שדות:

* agent_id.
* שם סוכן.
* חברה.
* מדינה.
* אנשי קשר.
* commission rate.
* payment terms.
* market segment.
* production volume.
* cancellation rate.
* average booking value.
* preferred properties.
* contract.
* notes.

סנכרון ל־Hotel OS:

* agent id.
* commission rules.
* booking source.
* payment handling.
* invoice recipient.

---

# חלק לז׳ — CRM לאורחים פרטיים, חברות, קבוצות וסוכנים

## 158. B2C Guest CRM

מיועד לאורחים פרטיים.

מטרות:

* זיהוי אורח חוזר.
* התאמת חוויה אישית.
* upsell.
* cross-sell.
* loyalty.
* שימור.
* קמפיינים.
* סקרים.
* טיפול בתלונות.

פונקציות:

* Guest 360.
* Stay history.
* Preferences.
* Loyalty.
* Marketing journeys.
* Birthday/anniversary campaigns.
* Win-back campaigns.
* VIP alerts.
* Complaint follow-up.
* Review requests.

## 159. B2B Corporate CRM

מיועד לחברות שמזמינות חדרים לעובדים או קבוצות.

מטרות:

* ניהול חוזים.
* ניהול מחירים מוסכמים.
* ניהול אנשי קשר.
* ניהול הזדמנויות מכירה.
* ניהול חידושים.
* זיהוי חברות עם פוטנציאל גבוה.

פונקציות:

* Account 360.
* Corporate pipeline.
* Negotiated rates.
* Contract renewal.
* Production report.
* Account plans.
* Corporate campaigns.
* Meeting follow-ups.

## 160. Group Sales CRM

מיועד לקבוצות, אירועים, כנסים ומשלחות.

פונקציות:

* Group lead.
* Group opportunity.
* Event details.
* Room block request.
* Meeting rooms.
* Catering requirements.
* Budget.
* Decision makers.
* Proposal.
* Contract.
* Follow-up.
* Conversion to Hotel OS group block.

זרימה:

1. ליד קבוצה נכנס ל־CRM.
2. נוצרה Opportunity מסוג Group.
3. Sales מנהל משא ומתן.
4. נוצרת הצעת מחיר.
5. לאחר זכייה, CRM שולח ל־Hotel OS בקשה ליצור Group Block.
6. Hotel OS מנהל חדרים, rooming list, חיובים וצ׳ק־אין.
7. CRM ממשיך לנהל קשר, follow-up, upsell וסיכום הכנסות.

## 161. Agent / Partner CRM

מיועד לסוכני נסיעות, מארגני קבוצות, שותפים וערוצי מכירה.

פונקציות:

* Partner profile.
* Commission tracking.
* Production reports.
* Partner campaigns.
* Contract renewal.
* Dispute handling.
* Preferred offers.
* Performance score.

---

# חלק לח׳ — AI במערכת CRM שמחוברת ל־Hotel OS

## 162. תפקיד ה־AI בפלטפורמה

AI צריך להיות שכבה שמבינה את הקשר בין:

* מי האורח.
* מה ההיסטוריה שלו.
* מה הוא הזמין.
* מה ההעדפות שלו.
* כמה הוא שווה למלון.
* האם הוא בסיכון חוויה.
* האם יש הזדמנות מכירה.
* האם יש בעיה תפעולית שמשפיעה עליו.
* מה הפעולה הבאה הנכונה.

AI לא מחליף את Hotel OS ולא מחליף CRM. הוא מנתח, ממליץ, מסכם, מתעדף ומייצר טיוטות.

## 163. AI Guest 360 Summary

בכל כרטיס אורח, AI יציג סיכום קצר:

* מי האורח.
* כמה פעמים שהה.
* מה ההעדפות שלו.
* מה קרה בשהייה האחרונה.
* האם היו תלונות.
* מה ערך הלקוח.
* האם הוא VIP.
* מה הפעולה הבאה המומלצת.

דוגמה לתוצר:

“אורח חוזר, 4 שהיות בשנתיים האחרונות, מעדיף חדר שקט בקומה גבוהה, הזמין בעבר late checkout פעמיים. בשהייה האחרונה התלונן על רעש וקיבל פיצוי. מגיע מחר דרך האתר הישיר. מומלץ להקצות חדר מרוחק ממעלית ולשלוח הצעת upgrade לסוויטה.”

## 164. AI Pre-Arrival Risk Detection

AI יזהה בעיות לפני הגעה.

סימנים:

* אורח VIP מגיע והחדר לא מוקצה.
* העדפה חשובה לא תואמת לחדר מוקצה.
* אורח עם תלונה קודמת מקבל חדר דומה לבעיה הקודמת.
* תשלום נכשל.
* מסמך חסר.
* arrival מוקדם והחדר עדיין dirty.
* בקשה מיוחדת לא טופלה.
* אורח בסיכון שביעות רצון.

פעולות מומלצות:

* להתריע לפרונט־דסק.
* להציע room assignment אחר.
* לפתוח משימה למנהל.
* לשלוח הודעה מותאמת לאורח.
* להציע פיצוי קטן מראש אם צריך.

## 165. AI Upsell Engine

מנוע upsell צריך להציע הצעות לפי דאטה.

מקורות דאטה:

* סוג חדר שהוזמן.
* סוגי חדרים זמינים.
* היסטוריית שדרוגים.
* ערך אורח.
* Anlass: יום הולדת, יום נישואין, חופשה זוגית, נסיעה עסקית.
* אורך שהייה.
* עונתיות.
* תפוסה.
* מחיר רגישות.
* מקור הזמנה.
* נאמנות.

סוגי הצעות:

* שדרוג חדר.
* ארוחת בוקר.
* late checkout.
* early check-in.
* חניה.
* ספא.
* בקבוק יין.
* חבילה רומנטית.
* העברה משדה תעופה.
* סיור/חוויה.

כללים:

* לא להציע upsell אם האורח כועס או עם complaint פתוח.
* לא להציע שדרוג שאין מלאי.
* לא להציע מוצר שלא זמין בתאריך.
* לא לשלוח יותר מדי הצעות.
* הצעה צריכה להיות מתועדת ב־Timeline.
* תוצאה צריכה להיכנס לדוחות conversion.

## 166. AI Review & Reputation Agent

לאחר עזיבה, AI יחליט איזה follow-up לשלוח.

אם השהייה תקינה:

* שלח סקר.
* בקש ביקורת.
* הצע הצטרפות למועדון.

אם הייתה תלונה:

* אל תבקש ביקורת ציבורית מיד.
* פתח case למנהל.
* שלח הודעה אישית.
* הצע פיצוי או follow-up.

אם האורח VIP:

* בקש ממנהל לשלוח הודעה אישית.

## 167. AI Complaint Analyzer

כאשר אורח מתלונן, AI יסווג:

* נושא התלונה.
* חומרה.
* דחיפות.
* מחלקה אחראית.
* האם מדובר באורח VIP.
* האם היו תלונות קודמות.
* האם יש סיכון ביקורת שלילית.
* האם נדרש פיצוי.

קטגוריות:

* ניקיון.
* רעש.
* שירות.
* תחזוקה.
* תשלום.
* חדר.
* אוכל.
* איחור.
* יחס צוות.
* ציפיות לא תואמות.

## 168. AI Marketing Segmentation

AI יכול להציע סגמנטים:

* אורחים שחוזרים כל קיץ.
* אורחים שהזמינו סוויטות.
* אורחים עסקיים באמצע שבוע.
* אורחים שקנו ספא.
* אורחים שביטלו בגלל מחיר.
* אורחים שלא חזרו מעל שנה.
* אורחים עם פוטנציאל VIP.
* חברות עם ירידה בהזמנות.
* סוכנים עם ביטולים רבים.

## 169. AI Revenue Recommendations

AI ינתח קשר בין CRM ל־Hotel OS ויציע:

* איזה אורחים כדאי לטרגט לקמפיין.
* איזה חברות ירדו בכמות room nights.
* איזה סוכנים מביאים הכנסה איכותית.
* איזה סוגי upsell עובדים.
* איזה קמפיין מייצר הזמנות ישירות.
* איפה יש פוטנציאל cross-sell.
* אילו לקוחות כדאי לשמר לפני עונה חלשה.

## 170. AI Front Desk Assistant

במסך צ׳ק־אין, AI יכול להציג לנציג:

* סיכום אורח.
* העדפות חשובות.
* הזהרות.
* הצעות upsell.
* שיחה מומלצת.
* notes רגישים בהרשאה.

דוגמה:

“האורח חוזר בפעם השלישית, ביקש בעבר חדר שקט. יש לו יום הולדת במהלך השהייה. מומלץ לברך אותו ולהציע late checkout בהנחה.”

## 171. AI Sales Agent לחברות וקבוצות

ל־Corporate/Group Sales:

* סיכום Account.
* זיהוי ירידה בהזמנות חברה.
* יצירת follow-up.
* הצעת מחיר ראשונית.
* ניתוח סיכוי סגירה.
* הכנת agenda לפגישה.
* יצירת account plan.
* זיהוי renewal risk.

## 172. AI Data Hygiene Agent

פונקציות:

* מציאת כפילויות אורחים.
* מציאת אימיילים לא תקינים.
* זיהוי חברות כפולות.
* זיהוי contacts לא משויכים.
* זיהוי guests בלי consent ברור.
* זיהוי רשומות עם מקור חסר.
* הצעת merge.
* ניקוי tags כפולים.

---

# חלק לט׳ — אוטומציות מתקדמות משולבות Hotel OS + CRM

## 173. מבנה כלל אוטומציה

כל אוטומציה תיבנה כך:

* Trigger.
* Conditions.
* Data sources.
* Actions.
* Human approval if needed.
* Fail handling.
* Audit.
* Metrics.

## 174. Pre-Arrival Automation

Trigger:

* reservation.created או 7/3/1 ימים לפני arrival.

Conditions:

* סוג אורח.
* מקור הזמנה.
* סטטוס תשלום.
* consent.
* העדפות.
* VIP.
* סטטוס חדר.

Actions:

* שליחת הודעת pre-arrival.
* שליחת לינק לצ׳ק־אין אונליין.
* הצעת upsell.
* יצירת משימה לפרונט אם VIP.
* יצירת משימה אם בקשה מיוחדת.
* בדיקת מסמכים חסרים.

## 175. Room Readiness Automation

Trigger:

* arrival היום.

Conditions:

* החדר לא נקי.
* אורח VIP.
* early check-in.
* חדר עם תקלה פתוחה.

Actions:

* התראה לחדרנות.
* העלאת priority לניקיון.
* התראה לפרונט.
* המלצת חדר חלופי.
* עדכון CRM alert.

## 176. Upsell Automation

Trigger:

* הזמנה מאושרת.
* 5 ימים לפני הגעה.
* חדרים משודרגים זמינים.

Conditions:

* consent קיים.
* אין complaint פתוח.
* יש מלאי מתאים.
* אורח לא קיבל כבר הצעה דומה.
* propensity score מספיק גבוה.

Actions:

* שליחת הצעת upsell.
* יצירת offer record.
* מעקב פתיחה/הקלקה.
* אם התקבל — עדכון Hotel OS.
* אם נדחה — עדכון CRM.

## 177. In-Stay Service Automation

Trigger:

* guest.checked_in.

Actions:

* שליחת welcome message.
* יצירת אפשרות בקשות שירות.
* אחרי X שעות שליחת “הכול בסדר?” לאורחים מסוימים.
* אם מתקבלת תגובה שלילית — פתיחת case.
* אם בקשה תפעולית — פתיחת משימה ב־Hotel OS.

## 178. Complaint Escalation Automation

Trigger:

* complaint.created.

Conditions:

* severity.
* VIP.
* אורח חוזר.
* מילות מפתח.
* שהייה פעילה.

Actions:

* יצירת Service Case.
* התראה למנהל תורן.
* פתיחת משימה למחלקה המתאימה.
* תיעוד ב־Timeline.
* מעקב SLA.
* לאחר פתרון — הודעת follow-up.

## 179. Post-Stay Automation

Trigger:

* guest.checked_out.

Conditions:

* folio closed.
* complaint status.
* satisfaction risk.
* guest type.
* consent.

Actions:

* שליחת תודה.
* שליחת חשבונית אם נדרש.
* שליחת סקר.
* בקשת ביקורת רק אם אין סיכון גבוה.
* קמפיין win-back עתידי.
* עדכון CLV.
* עדכון segment.

## 180. Loyalty Automation

Trigger:

* stay.completed.

Actions:

* חישוב נקודות.
* עדכון tier.
* שליחת עדכון לאורח.
* סנכרון הטבות ל־Hotel OS.
* אם עבר tier — יצירת alert לשהייה הבאה.

## 181. Corporate Account Automation

Trigger:

* booking.created עם company_id.

Actions:

* עדכון production של החברה.
* עדכון room nights.
* עדכון revenue.
* בדיקת חוזה פעיל.
* אם חברה עברה יעד — התראה למנהל account.
* אם ירידה מול שנה קודמת — יצירת משימת follow-up.

## 182. Group Lead Automation

Trigger:

* טופס group inquiry.

Actions:

* יצירת Lead מסוג Group.
* יצירת Opportunity.
* בדיקת זמינות ראשונית ב־Hotel OS.
* יצירת משימה ל־Sales.
* שליחת מייל אוטומטי.
* אם אין טיפול תוך SLA — escalation.

## 183. Failed Payment Automation

Trigger:

* payment.failed.

Conditions:

* reservation status.
* arrival date.
* payment policy.
* guest type.

Actions:

* יצירת task לפרונט/כספים.
* שליחת payment link אם מותר.
* סימון reservation at risk.
* התראה אם arrival קרוב.
* אם לא שולם עד deadline — הפעל מדיניות ביטול.

## 184. No-Show Automation

Trigger:

* reservation.no_show.

Actions:

* עדכון CRM Timeline.
* חישוב no-show history.
* הפעלת fee לפי Hotel OS.
* סימון risk profile אם חוזר.
* שליחת הודעה לפי מדיניות.
* עדכון scoring.

## 185. Recovery Automation לאורח לא מרוצה

Trigger:

* low survey score.
* complaint unresolved.
* negative sentiment.

Actions:

* פתיחת case למנהל.
* עצירת קמפיינים שיווקיים זמניים.
* יצירת משימת שיחה אישית.
* הצעת פיצוי אם מאושר.
* מעקב עד סגירה.
* לאחר סגירה — קמפיין win-back מותאם.

---

# חלק מ׳ — שיווק מתקדם למלונות בתוך ה־CRM

## 186. Marketing Strategy Layer

מערכת השיווק צריכה לעבוד על בסיס דאטה אמיתי מה־Hotel OS.

לא לשלוח “מבצע כללי לכל הרשימה”, אלא:

* קמפיינים לפי היסטוריית שהייה.
* קמפיינים לפי עונה.
* קמפיינים לפי העדפות.
* קמפיינים לפי ערך לקוח.
* קמפיינים לפי סיבת נסיעה.
* קמפיינים לפי מקור הזמנה.
* קמפיינים לפי תאריכים מיוחדים.
* קמפיינים לפי ביקוש וחדרים זמינים.

## 187. סגמנטים שיווקיים למלון

דוגמאות סגמנטים:

* אורחים חוזרים.
* אורחים שלא חזרו 12 חודשים.
* אורחי סוויטות.
* אורחים שהזמינו דרך OTA.
* אורחים שהזמינו ישירות.
* אורחים עסקיים.
* אורחים משפחתיים.
* זוגות.
* אורחים עם ילדים.
* אורחים שהשתמשו בספא.
* אורחים שקנו ארוחת בוקר.
* אורחים שביטלו בעבר.
* אורחים עם תלונה שנפתרה.
* אורחים עם דירוג שביעות רצון גבוה.
* אורחים עם יום הולדת קרוב.
* חברות עם ירידה בהזמנות.
* סוכנים עם פוטנציאל גבוה.

## 188. Campaign Types

### 188.1 Pre-arrival Campaign

מטרה:

* הכנה לשהייה.
* איסוף מידע חסר.
* upsell.
* הפחתת עומס בקבלה.

תוכן:

* לינק לצ׳ק־אין אונליין.
* שעות הגעה.
* שירותים במלון.
* הצעות שדרוג.
* העדפות.
* מידע שימושי.

### 188.2 In-stay Campaign

מטרה:

* שיפור חוויה בזמן אמת.
* מכירת שירותים.
* זיהוי בעיות לפני ביקורת שלילית.

תוכן:

* “הכול בסדר?”
* שירותים זמינים.
* ספא/מסעדה.
* פעילויות.
* בקשות שירות.

### 188.3 Post-stay Campaign

מטרה:

* סקר.
* ביקורת.
* שימור.
* הזמנה חוזרת.

תוכן:

* תודה.
* חשבונית.
* סקר.
* בקשת review.
* מבצע להזמנה הבאה.

### 188.4 Win-back Campaign

מטרה:

* להחזיר אורחים שלא חזרו.

תנאים:

* לא שהה מעל X חודשים.
* היה מרוצה בעבר.
* consent קיים.
* יש הצעה רלוונטית.

### 188.5 OTA-to-Direct Campaign

מטרה:

* להעביר אורחים שהזמינו דרך OTA להזמנה ישירה בעתיד.

תוכן:

* הטבות להזמנה ישירה.
* קוד אישי.
* גמישות ביטול.
* הטבת late checkout.

### 188.6 Corporate Campaign

מטרה:

* הגדלת הזמנות מחברות.

תוכן:

* מחיר חברה.
* הצעה לעובדים.
* סיכום production.
* פנייה לחידוש חוזה.

### 188.7 Event / Group Campaign

מטרה:

* יצירת לידים לאירועים וקבוצות.

תוכן:

* חדרי ישיבות.
* כנסים.
* חתונות.
* משלחות.
* אירועי חברה.

## 189. Campaign Personalization

כל הודעה יכולה להשתמש ב:

* שם אורח.
* שפה.
* תאריכי שהייה.
* סוג חדר.
* העדפות.
* loyalty tier.
* היסטוריית רכישות.
* אירוע מיוחד.
* מקור הזמנה.
* סגמנט.

## 190. Marketing Consent

חובה לנהל:

* הסכמה לשיווק באימייל.
* הסכמה ל־SMS.
* הסכמה ל־WhatsApp.
* תאריך הסכמה.
* מקור הסכמה.
* טקסט ההסכמה.
* ביטול הסכמה.
* suppression list.

כלל:

* הודעות תפעוליות מותרות לפי צורך שירותי.
* הודעות שיווקיות דורשות consent מתאים.
* צריך להפריד בין service messages לבין marketing messages.

## 191. Campaign Attribution מול Hotel OS

כדי לדעת אם קמפיין הצליח, צריך לחבר להזמנות.

שדות:

* campaign_id.
* promo_code.
* landing_page.
* UTM source.
* UTM medium.
* UTM campaign.
* booking_id.
* revenue.
* stay date.
* booking date.

מדדים:

* opens.
* clicks.
* conversions.
* bookings.
* room nights.
* revenue.
* direct booking uplift.
* cancellation rate.
* ROI.

---

# חלק מא׳ — שירות לקוחות מתקדם משולב מלון

## 192. Service Case

Service Case ב־CRM מנהל בעיות, תלונות ובקשות שאינן רק משימות תפעוליות.

שדות:

* case_id.
* guest_id.
* reservation_id.
* stay_id.
* property_id.
* category.
* severity.
* priority.
* status.
* owner.
* department.
* SLA.
* source channel.
* sentiment.
* compensation requested.
* compensation approved.
* resolution.
* follow-up required.

## 193. Service Categories

* תלונת ניקיון.
* תלונת רעש.
* בעיית תחזוקה.
* חיוב שגוי.
* שירות לא טוב.
* בעיית צ׳ק־אין.
* בעיית צ׳ק־אאוט.
* בעיית הזמנה.
* בקשת החזר.
* בקשה מיוחדת.
* lost & found.
* ביקורת שלילית.

## 194. חיבור Service Case ל־Hotel OS

כאשר case הוא תפעולי:

* ניקיון → Housekeeping Task.
* תחזוקה → Maintenance Ticket.
* חיוב → Finance/Folio review.
* חדר → Front Desk task.
* lost & found → Lost & Found module.

ה־CRM מנהל את התקשורת והמעקב מול האורח.
ה־Hotel OS מנהל את הביצוע התפעולי.

## 195. SLA לשירות אורחים

SLA ייקבע לפי:

* חומרה.
* VIP level.
* שהייה פעילה או לאחר עזיבה.
* channel.
* סוג תלונה.
* customer tier.

דוגמה:

* VIP in-house critical complaint: תגובה תוך 5 דקות.
* רגיל in-house complaint: תגובה תוך 15 דקות.
* post-stay complaint: תגובה תוך 24 שעות.
* billing issue: תגובה תוך יום עסקים.

## 196. Compensation Management

פיצויים אפשריים:

* הנחה.
* זיכוי.
* שדרוג.
* late checkout.
* ארוחת בוקר.
* נקודות loyalty.
* voucher.
* refund.

כללים:

* פיצוי כספי דורש הרשאה.
* פיצוי משפיע על folio דרך Hotel OS בלבד.
* CRM מתעד את הסיבה והאישור.
* כל פיצוי נרשם ב־Timeline.
* פיצוי צריך להופיע בדוחות service recovery.

## 197. Voice of Customer

המערכת תאסוף:

* סקרים.
* NPS.
* CSAT.
* ביקורות חיצוניות.
* תלונות.
* הודעות WhatsApp.
* שיחות.
* מיילים.

ניתוח:

* sentiment.
* קטגוריות בעיות.
* מגמות.
* מחלקות בעייתיות.
* השפעה על חזרה עתידית.
* השפעה על ביקורות.

---

# חלק מב׳ — דאטה, BI ו־Customer Intelligence

## 198. Customer Data Layer

צריך להקים שכבת דאטה מאוחדת שמחברת:

* Guest Profile.
* Contact.
* Account.
* Reservation.
* Stay.
* Folio summary.
* Payment summary.
* Campaigns.
* Activities.
* Service Cases.
* Surveys.
* Loyalty.
* Channel data.

## 199. Customer 360 Data Model

לכל אורח/לקוח צריך להציג:

* זהות.
* קשרים.
* היסטוריית שהיות.
* הכנסות.
* העדפות.
* תקשורת.
* קמפיינים.
* שירות.
* שביעות רצון.
* loyalty.
* סיכון.
* הזדמנויות.

## 200. מדדי CRM למלון

### 200.1 Guest Metrics

* total guests.
* repeat guests.
* repeat rate.
* average stays per guest.
* average nights per guest.
* average spend per guest.
* customer lifetime value.
* direct booking rate.
* OTA dependency.
* guest satisfaction.
* complaint rate.
* review conversion.

### 200.2 Revenue Metrics

* revenue by segment.
* revenue by campaign.
* revenue by guest type.
* revenue by company.
* revenue by agent.
* upsell revenue.
* ancillary revenue.
* direct booking revenue.
* recovered revenue.

### 200.3 Marketing Metrics

* campaign conversion.
* campaign revenue.
* cost per booking.
* email engagement.
* WhatsApp engagement.
* promo code usage.
* win-back success.
* OTA-to-direct conversion.

### 200.4 Service Metrics

* cases opened.
* cases resolved.
* SLA compliance.
* average response time.
* compensation cost.
* repeat complaint rate.
* NPS.
* CSAT.
* negative review prevention.

### 200.5 Corporate Metrics

* room nights by company.
* revenue by company.
* contract utilization.
* renewal risk.
* account growth.
* account decline.
* top producers.

## 201. Data Warehouse / Analytics

לשלב מתקדם, יש לייצא דאטה ל־warehouse.

טבלאות מומלצות:

* dim_guest.
* dim_account.
* dim_property.
* dim_room_type.
* dim_channel.
* dim_campaign.
* fact_reservation.
* fact_stay.
* fact_revenue.
* fact_campaign_event.
* fact_service_case.
* fact_activity.
* fact_survey.
* fact_upsell_offer.

## 202. Data Quality Rules

כללים:

* guest בלי אימייל ובלי טלפון הוא פרופיל חלקי.
* reservation בלי source פוגעת בדוחות.
* campaign בלי attribution לא נמדד.
* company booking בלי company_id לא תיכנס לדוח corporate.
* complaint בלי category לא ניתנת לניתוח.
* guest preference בלי source צריכה אימות.
* duplicate guests חייבים תור טיפול.

## 203. Data Governance

דרישות:

* data ownership.
* field definitions.
* retention rules.
* privacy controls.
* consent management.
* audit.
* export controls.
* deletion/anonymization workflow.
* data quality dashboard.

---

# חלק מג׳ — אינטגרציות מורחבות

## 204. אינטגרציות עם Hotel OS

Endpoints/Events עיקריים:

### From Hotel OS to CRM

* reservation.created.
* reservation.modified.
* reservation.cancelled.
* reservation.no_show.
* guest.checked_in.
* guest.checked_out.
* folio.closed.
* payment.failed.
* room.upgrade_accepted.
* guest.request_created.
* complaint.created.
* service.recovered.

### From CRM to Hotel OS

* guest.profile_updated.
* guest.preference_updated.
* guest.vip_level_updated.
* guest.blacklist_updated.
* guest.consent_updated.
* upsell.offer_accepted.
* corporate.account_updated.
* negotiated_rate_updated.
* service.case_requires_operation.
* loyalty.tier_updated.

## 205. אינטגרציות תקשורת

* Email provider.
* SMS provider.
* WhatsApp Business API.
* Push notifications.
* Web chat.
* Call center.
* VoIP.
* Review platforms.

## 206. אינטגרציות שיווק

* Website tracking.
* Landing pages.
* Meta Ads.
* Google Ads.
* Google Analytics.
* Tag Manager.
* Email marketing.
* Marketing attribution.
* Promo code engine.

## 207. אינטגרציות מכירה וקבוצות

* e-signature.
* document generation.
* proposal builder.
* corporate contract system.
* meeting room/event system.
* group booking tool.

## 208. אינטגרציות פיננסיות

* accounting.
* invoicing.
* payment provider.
* revenue reports.
* refunds.
* commission settlement.

## 209. אינטגרציות שירות

* Helpdesk.
* Knowledge base.
* Review management.
* Survey tools.
* Lost & found.
* Maintenance.
* Housekeeping.

## 210. Integration Health Dashboard

יש להציג:

* סטטוס כל אינטגרציה.
* אירועים שנכשלו.
* retries.
* זמן סנכרון אחרון.
* מספר אירועים בתור.
* dead letter queue.
* שגיאות mapping.
* alerts.

---

# חלק מד׳ — מסכים מורחבים ל־CRM המלונאי

## 211. Guest 360 Screen

רכיבים:

* פרטי אורח.
* VIP / loyalty.
* שהייה נוכחית.
* שהיות קודמות.
* הזמנות עתידיות.
* העדפות.
* הכנסות.
* תקשורת.
* קמפיינים.
* תלונות.
* סקרים.
* AI summary.
* recommended actions.

פעולות מהירות:

* שלח הודעה.
* צור משימה.
* פתח case.
* עדכן העדפה.
* הצע upsell.
* הוסף tag.
* פתח הזמנה ב־Hotel OS.

## 212. Arrival Intelligence Screen

מסך שמיועד לפני יום הגעה.

מציג:

* arrivals מ־Hotel OS.
* אורחים VIP.
* אורחים חוזרים.
* אורחים עם תלונות קודמות.
* אורחים עם העדפות מיוחדות.
* אורחים עם תשלום חסר.
* אורחים שמתאימים ל־upsell.
* חדרים לא מוכנים.
* AI recommendations.

## 213. In-House Experience Screen

מציג אורחים שנמצאים עכשיו במלון:

* guest status.
* room.
* open requests.
* open complaints.
* satisfaction risk.
* upsell opportunities.
* service recovery tasks.
* messages.

## 214. Post-Stay Follow-up Screen

מציג:

* guests checked out.
* folio status.
* survey status.
* complaint status.
* review eligibility.
* win-back eligibility.
* campaign enrollment.

## 215. Corporate Account 360

מציג:

* חברה.
* אנשי קשר.
* חוזים.
* negotiated rates.
* הזמנות חברה.
* room nights.
* הכנסות.
* מגמות.
* הזדמנויות.
* renewal.
* AI account summary.

## 216. Group Sales Workspace

מציג:

* group leads.
* opportunities.
* availability snapshot מה־Hotel OS.
* proposal.
* room block draft.
* follow-ups.
* conversion to group block.

## 217. Marketing Command Center

מציג:

* סגמנטים.
* קמפיינים פעילים.
* revenue attribution.
* direct booking uplift.
* OTA-to-direct performance.
* win-back campaigns.
* AI segment suggestions.

## 218. Service Recovery Command Center

מציג:

* תלונות פתוחות.
* VIP complaints.
* SLA breaches.
* negative sentiment.
* compensation approvals.
* unresolved post-stay issues.
* reviews at risk.

---

# חלק מה׳ — API ואירועים מפורטים

## 219. Event Payload בסיסי

כל event צריך לכלול:

* event_id.
* event_type.
* event_version.
* source_system.
* tenant_id.
* property_id.
* entity_type.
* entity_id.
* occurred_at.
* correlation_id.
* payload.

## 220. reservation.created

Payload:

* reservation_id.
* guest_id.
* property_id.
* arrival_date.
* departure_date.
* room_type.
* rate_plan.
* source.
* channel.
* booking_value.
* status.
* company_id.
* agent_id.
* campaign_id.

CRM actions:

* create/update guest.
* append Timeline.
* update future stays.
* calculate segment.
* trigger pre-arrival journey.
* check upsell eligibility.

## 221. guest.checked_in

Payload:

* guest_id.
* reservation_id.
* stay_id.
* room_id.
* room_type.
* checked_in_at.
* front_desk_user.

CRM actions:

* update guest status to in-house.
* append Timeline.
* trigger welcome journey.
* show active service eligibility.
* check open cases.

## 222. guest.checked_out

Payload:

* guest_id.
* reservation_id.
* stay_id.
* checked_out_at.
* nights.
* revenue_summary.
* complaint_flag.

CRM actions:

* update stay history.
* update CLV.
* trigger post-stay journey.
* survey eligibility.
* review eligibility.
* win-back scheduling.

## 223. upsell.offer_accepted

Payload from CRM to Hotel OS:

* offer_id.
* guest_id.
* reservation_id.
* product_type.
* amount.
* currency.
* fulfillment_date.

Hotel OS actions:

* update reservation.
* add charge or package.
* notify front desk/housekeeping if needed.
* confirm availability.

## 224. service.case_requires_operation

Payload from CRM to Hotel OS:

* case_id.
* guest_id.
* reservation_id.
* room_id.
* category.
* priority.
* description.
* requested_department.

Hotel OS actions:

* create task/ticket.
* assign department.
* update status back to CRM.

---

# חלק מו׳ — MVP מורחב מחובר למערכת המלון

## 225. MVP שלב 1 — CRM מחובר בסיסית ל־Hotel OS

חובה:

1. Guest Profile ב־CRM.
2. סנכרון reservation.created.
3. סנכרון guest.checked_in.
4. סנכרון guest.checked_out.
5. Guest Timeline.
6. Stay History.
7. Preferences.
8. VIP tags.
9. Marketing consent.
10. Manual service case.
11. Basic post-stay survey.
12. Basic dashboards.
13. Duplicate detection בסיסי.
14. Audit log.

## 226. MVP שלב 2 — אוטומציות ושיווק

כולל:

1. Pre-arrival journey.
2. Post-stay journey.
3. Upsell offers.
4. Segments.
5. Campaigns.
6. WhatsApp/SMS/Email integration.
7. OTA-to-direct campaign.
8. Corporate account sync.
9. Service case to Hotel OS task.
10. Campaign attribution להזמנות.

## 227. MVP שלב 3 — AI ו־Command Centers

כולל:

1. AI Guest Summary.
2. AI Pre-arrival Risk.
3. AI Upsell Engine.
4. AI Complaint Analyzer.
5. Arrival Intelligence.
6. In-House Experience screen.
7. Service Recovery Command Center.
8. Marketing Command Center.
9. Customer Lifetime Value.
10. Churn/return prediction.

## 228. MVP שלב 4 — Full Customer Intelligence Platform

כולל:

1. Corporate CRM מלא.
2. Group Sales CRM.
3. Agent/Partner CRM.
4. Loyalty engine.
5. Advanced attribution.
6. Data warehouse.
7. AI agents.
8. Advanced data governance.
9. Multi-property guest intelligence.
10. Cross-property marketing.

---

# חלק מז׳ — מקרי קצה בסנכרון CRM + Hotel OS

## 229. כפילויות אורחים

מצבים:

* אורח הזמין דרך Booking עם אימייל מוסתר.
* אותו אורח הזמין פעם עם טלפון ופעם עם אימייל.
* שם באנגלית ושם בעברית.
* זוג משתמש באותו אימייל.
* חברה מזמינה עבור עובד.

דרישה:

* לא לבצע merge אגרסיבי מדי.
* לשמור external identities.
* לא למחוק שהיות.
* לא לאבד consent.

## 230. ביטול הזמנה

כאשר reservation.cancelled:

* CRM לא מוחק guest.
* stay future מוסר או מסומן cancelled.
* campaign journey נעצר.
* אם הביטול בגלל מחיר/זמן — אפשר להכניס ל־win-back.
* אם נגבו דמי ביטול — revenue summary מתעדכן.

## 231. שינוי תאריכים

כאשר reservation.modified:

* pre-arrival journey מתזמן מחדש.
* upsell offers נבדקות מחדש.
* room readiness alerts מתעדכנות.
* campaign attribution נשמר.

## 232. אורח in-house עם תלונה

אם complaint נפתח בזמן שהייה:

* CRM יוצר Service Case.
* Hotel OS מקבל task תפעולי.
* Front Desk רואה alert.
* אם לא נפתר לפני checkout — checkout screen מציג warning.
* post-stay review request נעצר עד טיפול.

## 233. תשלום נכשל

אם payment.failed:

* CRM מסמן reservation at risk.
* נפתחת משימה.
* לא נשלחת הודעה שיווקית.
* אם arrival קרוב — escalation.
* אם policy מאפשרת — payment reminder.

## 234. VIP חדש

אם CRM מעדכן guest.vip_level:

* Hotel OS מקבל עדכון.
* Arrival list מציגה VIP.
* Housekeeping מקבל notes אם נדרש.
* Manager מקבל alert לפני הגעה.

## 235. Consent conflict

אם מקור אחד אומר opt-in ומקור אחר opt-out:

* opt-out מנצח.
* יש לשמור היסטוריה.
* אין לשלוח שיווק עד בירור.
* הודעות תפעוליות עדיין יכולות להישלח לפי צורך שירותי.

## 236. Multi-property

אם אורח שהה בכמה מלונות ברשת:

* CRM מציג היסטוריה רוחבית.
* Hotel OS של כל מלון רואה רק מה שמותר לפי הרשאות.
* VIP/loyalty יכול להיות גלובלי.
* notes רגישים יכולים להיות property-specific.
* קמפיינים יכולים להיות cross-property.

---

# חלק מח׳ — החלטות קריטיות להרחבה

## 237. CRM לא מנהל חדרים

גם אם CRM מציע upsell או מזהה העדפה, הוא לא מקצה חדר ולא משנה מלאי. הוא שולח בקשה או המלצה ל־Hotel OS.

## 238. Hotel OS לא מנהל שיווק

Hotel OS יכול לשלוח הודעות תפעוליות, אבל מסעות שיווק, סגמנטים, attribution ו־consent צריכים להיות ב־CRM.

## 239. Timeline מאוחד הוא חובה

כל אירוע משמעותי מה־Hotel OS צריך להופיע ב־CRM Timeline:

* הזמנה.
* שינוי.
* ביטול.
* צ׳ק־אין.
* צ׳ק־אאוט.
* תלונה.
* פיצוי.
* סקר.
* קמפיין.
* upsell.

## 240. Guest Preferences חייבות להיות דו־כיווניות

אם אורח מעדכן העדפה בצ׳ק־אין, זה צריך לחזור ל־CRM.
אם CRM יודע העדפה, Hotel OS צריך לראות אותה לפני הגעה.

## 241. AI חייב להיות מוגבל בהרשאות

AI יכול להמליץ ולנסח, אבל לא:

* לשנות הזמנה בלי אישור.
* להבטיח שדרוג בלי מלאי.
* לשלוח שיווק בלי consent.
* לתת פיצוי בלי הרשאה.
* לסמן אורח blacklist לבד.
* למחוק/למזג פרופילים בלי בקרה.

## 242. דאטה חייב להיות מדיד מהיום הראשון

כדי שהמערכת תהיה חזקה, כל פעולה צריכה למדוד תוצאה:

* האם upsell נפתח.
* האם upsell נקנה.
* האם קמפיין יצר הזמנה.
* האם תלונה נפתרה.
* האם אורח חזר.
* האם חברה ירדה בהזמנות.
* האם OTA-to-direct הצליח.

---

# חלק מט׳ — סיכום הרחבה

ה־CRM המורחב הוא לא מערכת נפרדת מהמלון. הוא שכבת המוח העסקי והשיווקי של ה־Hotel OS.

ה־Hotel OS עונה על השאלה:

**מה קורה במלון עכשיו?**

ה־CRM עונה על השאלות:

* מי הלקוח?
* מה הוא שווה לנו?
* מה הוא צריך?
* מה עבר עליו?
* איך נגרום לו לחזור?
* איך נמכור לו יותר בלי לפגוע בחוויה?
* איזה לקוחות/חברות/סוכנים כדאי לפתח?
* איפה יש סיכון שירותי או עסקי?

האינטגרציה ביניהם צריכה להיבנות סביב:

1. Guest 360.
2. Stay History.
3. Timeline.
4. Preferences.
5. Consent.
6. Campaigns.
7. Service Cases.
8. Upsell.
9. Corporate/Group Sales.
10. AI Recommendations.

אם זה ייבנה נכון, המערכת לא תהיה רק PMS + CRM. היא תהיה פלטפורמת מלונאות חכמה שמנהלת גם את התפעול וגם את הקשר העסקי עם הלקוח.
