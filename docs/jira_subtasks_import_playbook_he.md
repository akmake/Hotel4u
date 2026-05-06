# Jira Subtasks Import Playbook (שלב 2)

תאריך: 6 במאי 2026  
מטרה: לייבא את פירוק ה-Subtasks בצורה יציבה, בלי orphan subtasks ובלי אובדן Parent-child.

## קבצים מוכנים

1. `Stories + Epics` (שלב 1): `docs/jira_backlog_reservations_cloudbeds_parity_import.csv`
2. `Subtasks בלבד` (שלב 2): `docs/jira_backlog_reservations_cloudbeds_subtasks_import.csv`
3. `Subtasks עם Parent Key ידני`: `docs/jira_backlog_reservations_cloudbeds_subtasks_import_by_parent_key.csv`
4. `מיפוי Story Ref -> Jira Key`: `docs/jira_story_key_mapping_template.csv`
5. `ייבוא מלא היררכי במכה אחת (מומלץ)`: `docs/jira_backlog_reservations_cloudbeds_full_hierarchy_import.csv`

## בחירה בין 2 מסלולים

1. מסלול A (מומלץ): ייבוא יחיד של הקובץ המאוחד `full_hierarchy`.
2. מסלול B: אם שלב 1 כבר יובא, מייבאים את `subtasks_import_by_parent_key` אחרי מילוי `Parent Key` לכל שורה.

## Preflight Checks

1. Subtasks מופעלים ב-Jira.
2. Issue Types קיימים: `Epic`, `Story`, `Sub-task`.
3. שדות קיימים בפרויקט: `Parent`, `Priority`, `Components`, `Labels`, `Sprint`.
4. Encoding בקבצים הוא `UTF-8`.

## מסלול A: ייבוא מלא במכה אחת (הכי בטוח)

1. בחר `External System Import -> CSV` (לא ה-importer הפשוט).
2. העלה: `docs/jira_backlog_reservations_cloudbeds_full_hierarchy_import.csv`.
3. מיפוי שדות חובה:
1. `Issue Type` -> Issue Type
2. `Issue ID` -> Issue ID
3. `Parent` -> Parent
4. `Summary` -> Summary
5. `Description` -> Description
6. `Priority` -> Priority
7. `Labels` -> Labels
8. `Components` -> Components
9. `Sprint` -> Sprint
10. `Epic Name` -> Epic Name
11. `Story Points` -> Story Points
4. ודא שבסדר הקובץ ההורים מופיעים לפני ילדים (כבר מסודר אצלך).
5. הרץ Import.

## מסלול B: שלב 1 כבר יובא בעבר

1. ייצא רשימת Stories מהפרויקט (כולל Issue Key + Story Ref אם שמרת Issue ID).
2. מלא את `docs/jira_story_key_mapping_template.csv` בעמודת `Jira Story Key`.
3. עדכן לכל Subtask ב-`docs/jira_backlog_reservations_cloudbeds_subtasks_import_by_parent_key.csv` את `Parent Key` לפי `Story Ref`.
4. ייבא את קובץ ה-Subtasks המעודכן דרך `External System Import -> CSV`.
5. מיפוי שדות:
1. `Issue Type` -> Issue Type
2. `Parent Key` -> Parent
3. `Summary` -> Summary
4. `Description` -> Description
5. `Priority` -> Priority
6. `Labels` -> Labels
7. `Components` -> Components
8. `Sprint` -> Sprint
6. הרץ Import.

## Post-Import Validation (חובה)

1. הרץ JQL:
`type = Sub-task AND parent is EMPTY`
תוצאה צפויה: `0`.

2. הרץ JQL:
`type = Sub-task AND project = <PROJECT_KEY>`
וודא שנוצרו `108` תתי-משימות.

3. הרץ בדיקת מדגם:
1. Story `RES001` או המקבילה שלה בפרויקט.
2. ודא שיש את כל תתי-המשימות ו-QA sub-tasks תחתיה.

## הערה קריטית

אם אתה רואה שגיאה שקשורה ל-`Parent` או `Issue type is sub-task but parent not specified`, זה אומר שהמיפוי של Parent לא תקין או שהייבוא רץ דרך כלי לא תומך היררכיה מלאה.

## מקורות

1. https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/
2. https://support.atlassian.com/jira/kb/keep-issue-parent-child-mapping-during-csv-import-to-jira-cloud/
3. https://support.atlassian.com/jira/kb/how-to-fix-orphan-sub-tasks/
4. https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/
