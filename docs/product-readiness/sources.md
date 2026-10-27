# מקורות וראיות

נבדק: 27.10.2026. שימוש בתיעוד מוצר הוא ראיה לדפוס תפעולי בלבד. ההרחבה של דפוס לתנאי קבלה עבור Hotel4u היא הצעת מוצר/הנדסה, ומסומנת כך.

| מזהה | מקור | מצב ואופן שימוש |
|---|---|---|
| S01 | [Oracle 26.1 — Checking in Reservations](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.1/ocsuh/t_checking_in_reservations.htm) | נפתח כעת; בסיס למחקר תהליך קליטה. לא מפרט מלא לכל תהליך הקבלה שלנו |
| S02 | [Oracle 26.4 — Managing Scheduled Room Moves](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.4/ocsuh/t_managing_reservations_managing_scheduled_room_moves.htm) | נקרא: מעבר מתוכנן כולל מקור ויעד, זמן והערות ומצב החדר המיועד; תכנון וביצוע הם שלבים נפרדים |
| S03 | [Oracle 25.1 — About End of Day](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/c_endofday_procedures.htm) | נקרא: סגירת יום כוללת רצף פעולות ובקרות. זו גרסת 25.1; המדיניות שלנו טעונה הגדרה, ולא העתקה אוטומטית של חסמי הספק |
| S04 | [Mews — How to find and solve overbookings](https://help.mews.com/s/article/overbookings-how-to-find-solve-them?language=en_US) | נקרא: סימון הזמנות עודפות/לא משובצות ותהליך פתרון בלוח. אין להסיק מכאן שהזמנה עודפת צריכה להיות מותרת בכל מלון |
| S05 | [Oracle — Swap or Shift Assigned Rooms](https://apexapps.oracle.com/pls/apex/f?p=44785%3A24%3A3729872095757%3A%3ANO%3ARP%2C24%3AP24_CONTENT_ID%2CP24_PREV_PAGE%3A32202%2C2) | תקציר תוצאת חיפוש בלבד, תאריך הפרסום 26.09.2022; עמוד נוסף נכשל בפתיחה והסרטון לא נצפה. התקציר מתייחס להזמנות עם תאריכי הגעה וסוגי חדר תואמים. אינו ראיה להחלפת שתי שהיות שכבר נכנסו |
| U01 | רשימת הדרישות של בעל המוצר בשיחה | הגעות, אנשים, לולים, הערות, חדר, מעבר והחלפה, ארוחות, קופה, חיפוש ומידע חדרים |
| U02 | דברי בעל המוצר על תוכנת החשבוניות הנפרדת | נמסר שהתקבל אישור עם תעודה. מסמכי האישור ותחולת החיבור הנוכחי לא נבדקו כאן |
| P01 | הצעת מוצר הנגזרת מהתרחיש | תכנון מוצע, למשל פרטי בקשת לול; נדרשת הכרעה תפעולית |
| E01 | דרישת אמינות הנדסית מוצעת | פעולה שלמה, בטיחות בניסיון חוזר, מקביליות, הזרקת כשל ושחזור; אינה טענה שמדריך ספק מכתיב מימוש טכני זהה |
| H01 | האפיון הקודם בפרויקט | `docs/specification/00-scope-and-use.md`, `08-open-questions-and-release-gates.md`, `11-coverage-matrix.md`, `13-opera-gap-analysis.md`. נקראו החלקים שנשלפו בסבב זה; לא אומתו מחדש כל המקורות והטענות שלהם |

## ראיות הקוד שנקראו

עדכון לאחר הבדיקה הסטטית: [דוח הריצה](room-moves-results.md) מתעד 16 תרחישים מול בסיס מקומי מבודד; סיכוני הקיבולת, השמירה החלקית והבעלות בנעילה שוחזרו, וכן התגלה שיבוץ כפול של יחידות מאותה הזמנה. ההערות להלן מתארות את נקודת המוצא הסטטית; בדוח נמצאת הראיה המעודכנת.

הנתיבים יחסיים לשורש הפרויקט, כדי שישמרו תקפים בהעברת התיקייה. `code_evidence` בטבלה מפנה לפונקציה/עמוד; יש לפתוח את הקובץ בגרסת הקוד הנבדקת לפני שינוי.

- `server/services/stayChangeService.js`: `moveRoom` בודקת יעד, ניקיון, התנגשות ומחיר; לאחר מכן שומרת מקטעים, יחידה, הזמנה, חדרים, משימות ומלאי ברצף. לא נמצאה מעטפת עסקה או שחזור בתוך הפונקציה שנקראה. בדיקת קיבולת נמצאה באזור שינוי הזמנה אחר בקובץ, ולא ב־moveRoom. לא בוצע שחזור כשל בזמן ריצה.
- `server/services/locks.js`: נעילה עם תוקף, ללא חידוש/אסימון בעלות שנמצא בקובץ. זה מצדיק בדיקת פעולה שמתארכת מעבר לתוקף, ולא הכרזה על תקלה מוכחת.
- `server/services/paymentGateway.js`: רק ספק mock ממומש; `paymentsAvailable` מחזירה false לספק אחר ובייצור להדמיה. רישום אמצעי תשלום בדוח אינו סליקה בפועל.
- `client/src/pages/ArrivalsPage.jsx`, `server/services/frontDeskService.js`: פרטי אורח/חדר והרכב מוצגים; סכום ששולם והערות מיוחדות אינם בטבלת ההגעות. סכומי מבוגרים וילדים נלקחים מההזמנה עבור שורת יחידה.
- `server/models/Reservation.js`, `ReservationRoom.js`: לא נמצא שדה כמות לולים בקבצים שנבדקו. `RoomType.cribAllowed` הוא כשירות סוג חדר, ולא בקשת אספקה לשהייה.
- `client/src/pages/InHousePage.jsx`: כמות אנשים בפרטי השהייה הנבחרת, לא עמודה ברשימה.
- `server/services/documentService.js:listDocuments`, `client/src/pages/InvoicesPage.jsx`: חיפוש מסמך/נמען/הזמנה; לא נמצא סינון סכום בפונקציה.
- `server/services/financeReportsService.js`, `client/src/pages/fin/FinanceReportsPage.jsx`: תקבולים לפי אמצעי וטווח תאריכים; מסך קופות מטפל ביום מסוים.
- `client/src/pages/sys/HotelSetupPage.jsx`, `server/models/Room.js`: פרטי סוג חדר, תפוסה מרבית ואבזור; קומה והערה פנימית בחדר הפיזי.
- `client/src/pages/inv/RoomChartPage.jsx`: לוח מחובר ל־ops.roomChart, פעולת גרירה מפנה לדיאלוג מעבר.
- `client/src/pages/ops/MealsPage.jsx`, `server/services/mealCountService.js`: דוח צפי וזכאות לפי סוג אירוח. נדרשת בדיקה נפרדת לצריכה בפועל ושינויי פנסיון לאורך השהייה.
- `server/scripts/stayIntegration.mjs`: קיימים תרחישי ניקיון, התנגשות, מחיר, מקטעים ותחזוקה; לא הורצו בסבב זה.

## מה עדיין לא נעשה במחקר

לא נערכו ראיונות עם צוותי מלונות, לא בוצעה ביקורת מקצועית, לא נבחן כל מדריך OPERA/Mews, ולא הושלם מחקר לכל תחומי המוצר או לכל מדינה. אין רשימת דרישות סופית או אחוז כיסוי מוכח. הבדיקות המבודדות אינן פיילוט במלון ואינן בדיקת כל המוצר.
