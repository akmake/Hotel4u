# יומן העברת מסכים לשפה החדשה (2026-10-28)

שכבה משותפת: `client/src/components/kit/approved.css` + `PageBar` / `BackArrow` / `LegacyPage` ב־`kit/index.jsx`. כל `<Page title=…>` מקבל: רקע אפור, שורת כותרת אחת עם חץ חזרה חכם (history → אחרת מסך־אב), כפתורי Material, כרטיסים לבנים, רשימות כשורות־כרטיס. מסכים ישנים (`.page-header`) מקבלים אותו מראה דרך המחלקה `ui-page is-approved is-legacy` + `<BackArrow />`.

| מסך | מה השתנה | לא נבדק |
|---|---|---|
| in-house, departures, arrivals, arrival-queue, reservations (רשימה), invoices | כותרת אחת + חזרה, פעולה ראשית בכותרת (הזמנה חדשה / Walk-in), פאנל פרטים רק בבחירה (in-house), הוסרו כפתורי מעבר בין מסכים | עין |
| reservations/new | כותרת + חזרה חכמה, ללא סרגל דביק | עין |
| guests, rooms, room-rack ("לוח חדרים שבועי"), companies, leads, opportunities, reports, rates, settings | `.page-header` → שורת כותרת עם חזרה, כרטיסים/שורות | עין, פריסת room-rack |
| housekeeping (+status/my/inspection/rooms/lost-found), maintenance (+preventive), meals, ops-reports | כותרת + חזרה | עין |
| fin: folio, reports, receivables, accounting; night-audit (+report) | כותרת + חזרה, הוסרו כותרות כפולות | עין |
| admin: users, policy, audit, charge-codes, tax, fiscal, board, setup; me; work; bulk-jobs; automation; channel-manager | כותרת + חזרה | עין |
| דיאלוגים משותפים (Modal) | פינות 12px וכפתורי Material | עין |

לא נגעתי: tape-chart-classic, /pms/design/*, ובמסכים המאושרים. build עובר; הבודק ללא ממצאים חדשים (נשאר ממצא ישן ב־ReportsPage:273). לא נעשה commit.
