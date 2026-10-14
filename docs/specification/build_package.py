from pathlib import Path
import json, csv, re, html, collections, zipfile, hashlib
from screen_catalog import SCREENS
from field_contracts import REQUIRED, CONDITIONAL, DEFAULTS

B=Path(__file__).parent
S=json.loads((B/'sources.json').read_text(encoding='utf-8'))
for s in S:
    s['checked_at']='2026-10-14'
    if s['id']=='L21':
        s.update(url='https://www.pcisecuritystandards.org/faqs/1280/',status='full',finding='נקרא FAQ 1280: אסור לשמור CVV אחרי הרשאה, גם מוצפן או בהסכמת לקוח. PCI הוא תקן וחובה חוזית לפי הסדר הסליקה, לא חוק ישראלי כשלעצמו.')
    if s['id'] in {'L03','L04','L07','L08','L09','L11','L15','L18','L19','L20'}:s['status']='partial-pdf'
extras=[('L22','למ״ס — רשימת סקרים','https://www.cbs.gov.il/he/Pages/search/SearchResultsPolls.aspx','official','indexed','אותר סקר מלונות: פדיון, מועסקים ושכר. רשימת סקרים אינה אימות תחולה או שאלון מלא לכל נכס.'),('L23','משרד האוצר — עיקרי תקציב 2026','https://www.gov.il/BlobFolder/policy/state-budget-main-2026/he/state-budget_2026_Files_state-budget-main-2026-file.pdf','official','indexed','מסמך 2026 מתאר הטבת מע״מ בשיעור אפס לתיירים ופטור אילת. זה אינו נוסח חוק או בדיקת כל תנאי הזכאות; ההצעה L19 אינה הוכחת ביטול.'),('L24','מרכז המחקר של הכנסת — ביטול שירותי תיירות','https://fs.knesset.gov.il/24/Committees/24_cs_bg_627186.pdf','historic','indexed','מסמך 2022 מנתח ביטול מרחוק ופרונטלי. קריאה מלאה נחסמה בהפניה לדף תחזוקה; אין להשתמש בו לאימות נוסח 2026.')]
extras += [('L25','רשות המסים — הוראת ביצוע מזומן 1/2024','https://www.gov.il/BlobFolder/policy/inst-1-2024/he/ReduceTheUseOfCash_reduce-the-use-of-cash-110324.pdf','official','indexed','סעיפים 5.1.1–5.1.4 מפרטים סכום עסקה רגילה 6,000 וסכום קבלה מתייר 40,000 והנמוך מ־10% והתקרה מעל הסף. נדרש אימות שינויים עד 2026 לפני הפעלה.'),('L26','הרשות להגנת הפרטיות — כלי תסקיר מעודכן לתיקון 13','https://mojforms.justice.gov.il/mojaemprivacyprotectionauthority/dpiaform.html','official','full','נקראו שאלות והמלצות: יידוע לפי סעיף 11, תכלית, הסכמה, עיון ותיקון, ספקים, מידע עודף והעברה לחו״ל. הכלי בגרסת בטא ומצהיר שאינו חוות דעת או תסקיר מלא.'),('L27','תקנות העברת מידע מחוץ לישראל','https://www.gov.il/BlobFolder/news/post_schrems_update/he/TakanotHul.pdf','official','indexed','תקנות 1–3 עוסקות בתנאי העברה והתחייבות המקבל; העברה אינה מוסדרת רק על ידי הצפנה. PDF לא נפתח באמצעות כלי הרשת.'),('L28','הכנסת — הרחבת איסור ספאם, 2018','https://main.knesset.gov.il/News/PressReleases/pages/press21.05.18ws.aspx','historic','indexed','הודעה רשמית על תיקון להגדרת דבר פרסומת; אינה נוסח משולב עדכני של סעיף 30א ואינה סוגרת את כל חריגי הדיוור.')]
for id,title,url,kind,status,finding in extras:
    if not any(s['id']==id for s in S):S.append(dict(id=id,title=title,url=url,kind=kind,status=status,finding=finding,checked_at='2026-10-14'))
(B/'sources.json').write_text(json.dumps(S,ensure_ascii=False,indent=2),encoding='utf-8')
sourceids={s['id'] for s in S}; ids={s['id'] for s in SCREENS}
mods={'platform':'זהות והקשר עבודה','frontdesk':'קבלה ושהייה','reservations':'הזמנות והצעות','inventory':'מלאי וחדרים','finance':'כספים ומסמכים','operations':'חדרנות תחזוקה ובטיחות','guests':'אורחים ושירות','groups':'קבוצות חברות ואירועים','revenue':'תעריפים והכנסות','integrations':'חיבורים וספקים','guestportal':'מנוע הזמנות ופורטל אורח','services':'שירותים POS ורכש','admin':'הגדרות ציות ובקרה','reporting':'דוחות והנהלה','extensions':'פרופילים וממשקי הרחבה'}
types={'readonly':'קריאה בלבד; נשלף ממקור אמת','restricted':'קריאה מוסווית; חשיפה בהרשאה מפורשת','reference':'בחירת רשומה בהיקף מורשה; מזהה ולא שם חופשי','enum':'בחירה מהערכים המפורטים בכלל; ערך חדש דורש תצורה וגרסה','money':'מספר עשרוני ומטבע; אין חישוב float; עיגול לפי מדיניות מאושרת','text':'טקסט Unicode; אורך לפי 02 או כלל מפורש','date':'תאריך מקומי לנכס; אינו רגע UTC','datetime':'תאריך ושעה עם אזור זמן; זמן שרת נשמר','daterange':'תחילה וסיום; סוף אינו לפני תחילה; בדיקת מקטעים','time':'שעה מקומית; אין להמיר ליום עסקי אוטומטית','email':'פורמט כתובת; קיום/בעלות דורשים אימות נפרד','secret':'קלט מוסתר; אין לוג או export','otp':'קוד קצר בתוקף; ניסיונות מוגבלים','token':'מזהה סודי חד פעמי; תוקף וניצול בשרת','boolean':'שני מצבים; ללא הסכמה מסומנת מראש','multiselect':'בחירות בהיקף מורשה; רשימת מזהים וספירה','file':'חוזה U01–U04: גודל, סוג, סריקה והרשאה','signature':'חוזה U05–U06; signer, נוסח וזמן; לא חתימה fiscal','integer':'שלם בתחום העסקי; ברירת מוצר לא שלילי','decimal':'מספר עשרוני בתחום מוגדר; precision לפי מדד','identifier':'טקסט מזהה; שומר אפסים; ייחודיות לפי היקף','phone':'קידומת בינלאומית וטקסט מספר; בעלות לא נובעת מפורמט','rule':'כלל בעל גרסה, תנאים, תוצאה ומאשר','calendar':'לוח עם גרסה, אזור ושייכות לכלל','schedule':'מועד/מחזור, אזור זמן ובעל אחריות','mapping':'מפתח מקור ליעד, גרסה וערכים לא ממופים','grid':'מטריצה; validation לכל תא ותוצאה לכל שורה','array':'רשומות חוזרות עם מזהה וכלל לכל שורה','checklist':'פריטים עם מצב, ראיה ואחראי; לא checkbox שאינו מאומת','provider':'ביצוע אצל ספק מורשה; token/תוצאה, לא סודות אצל PMS'}
errors=[]; unresolved=[]; proposed=[]
if len(ids)!=len(SCREENS):errors.append('duplicate screens')
for s in SCREENS:
    if s['id'] not in REQUIRED:errors.append(s['id']+' lacks field decision')
    req=set(REQUIRED.get(s['id'],'').split('|'))-{''}
    if req-{f['label'] for f in s['fields']}:errors.append(s['id']+' invalid field decision')
    s['sources']=[x for x in s['sources'] if x]
    for n,f in enumerate(s['fields'],1):
        f['id']=f"{s['id']}-F{n:02}"
        f['control_contract']=types[f['type']]
        key=(s['id'],f['label'])
        if f['type'] in {'readonly','restricted'}:f['requirement']='מחושב/תצוגה; לא קלט משתמש'
        elif key in CONDITIONAL:f['requirement']=CONDITIONAL[key]
        elif 'חובה' in f['rule'] or 'נדרש' in f['rule']:f['requirement']='חובה או חובה מותנית לפי הכלל המקורי'
        elif f['label'] in req:f['requirement']='חובה לאישור הרשומה/פעולה הרלוונטית; סינון אינו התחייבות (החלטת מוצר מוצעת)';proposed.append(f['id'])
        else:f['requirement']='רשות; חסר אינו יוצר הסכמה, זכאות או ערך חוקי (החלטת מוצר מוצעת)';proposed.append(f['id'])
        if key in DEFAULTS:f['default']=DEFAULTS[key]+' (הצעת מוצר)'
        elif f['type']=='readonly':f['default']='מקור אמת לפי הכלל; חסר מוצג לא זמין, לא אפס'
        elif any(x in f['rule'] for x in ('ברירת מחדל','כבוי','נגזר','נקבע')):f['default']='לפי הכלל המפורש'
        elif f['type']=='boolean':f['default']='false; unknown מקור חיצוני נשאר לא מוכרע'
        else:f['default']='ריק ביצירה; ערך שמור בעריכה; בסינון ללא הגבלה. הקשר רשומה מאומת נשמר במעבר'
    for n,a in enumerate(s['actions'],1):
        a['id']=f"{s['id']}-A{n:02}"
        if a['target'] not in ids:errors.append(a['id']+' missing target')
    if not s['fields'] or not s['actions'] or not s['exceptions']:errors.append(s['id']+' incomplete')
    for x in s['sources']:
        if x not in sourceids:errors.append(s['id']+' unknown source '+x)

screensdir=B/'screens';screensdir.mkdir(exist_ok=True)
def clean(x):return str(x).replace('|',' / ').replace('\n',' ')
for mod,name in mods.items():
    rows=[s for s in SCREENS if s['module']==mod]
    lines=[f'# {name}',f'{len(rows)} מסכים. לכל מסך נוסף החוזה הרוחבי ב־02; זו הצעת מוצר, לא רשימת כפתורים שהועתקה ממערכת קיימת.','דרישת חובה מתייחסת לאישור הרשומה או הפעולה העסקית; בשדות חיפוש וסינון אין בכך דרישה למלא פילטר. חובה מותנית מפורטת בשורה. ברירת מוצר מוצעת אינה חובה חוקית. שמירת טיוטה מאפשרת חסרים ומסמנת אותם לפני אישור. פרטי מערכות חיצוניות אינם מוקלדים במקום תשובת ספק.','']
    for s in rows:
        incoming=[f"{q['id']} — {a['label']}" for q in SCREENS for a in q['actions'] if a['target']==s['id'] and q['id']!=s['id']]
        lines += [f"## {s['id']} — {s['title']}",f"**סוג:** {s['kind']} · **תפקיד:** {s['role']}",f"**מטרה:** {s['goal']}", '**כניסות מתוכננות:** '+('; '.join(incoming) or 'הפעלה דרך ניווט המודול/קישור מורשה'), '**הקשר חובה:** ארגון ונכס מורשים; ישות כספית כשחל; מזהה רשומה/יחידת שהייה לפעולה פרטנית. מעבר מעביר הקשר ואינו יוצר הרשאה.', '**הרשאה:** תפקיד המסך + scope + זכות פעולה + תקרה/מאשר לפי 05. אין היתר פעולה מכוח הצגת כפתור.', '**חזרה וסגירה:** חזרה לכניסה האחרונה עם סינון ומיקום; טיוטה לפי F12. פעולה מאושרת אינה מתבטלת בסגירת החלון.', '**חוזה רכיבים:** C01–C10 בכל מסך; L01–L17 ברשימות לפי רכיב; F01–F16 בטפסים/אשפים; U01–U08 כשיש מסמך/חתימה. רכיב שאינו רלוונטי אינו מוצג.', '', '### שדות', '| מזהה | שדה | סוג ורכיב | חובה | כלל ואימות | ברירת מחדל |', '|---|---|---|---|---|---|']
        for f in s['fields']:lines.append('| '+' | '.join(clean(x) for x in (f['id'],f['label'],f['type']+': '+f['control_contract'],f['requirement'],f['rule'],f['default']))+' |')
        lines += ['', '### פעולות ויעדי מעבר', '| מזהה | כפתור/פעולה | יעד | כלל ביצוע והשלכה |', '|---|---|---|---|']
        for a in s['actions']:lines.append('| '+' | '.join(clean(x) for x in (a['id'],a['label'],a['target'],a['rule']))+' |')
        lines += ['', '**קדם־תנאי לכל כתיבה:** הרשאה תקפה, נתוני חובה לפי כלל, גרסה עדכנית, אין חסם עסקי/משפטי פעיל. סכום/טווח/רשומה מוצגים לפני התחייבות משמעותית לפי 02.', '**כשל ושחזור:** שגיאת שדה נשארת ליד הקלט; conflict מחייב רענון והכרעה; כשל ודאי מאפשר retry מבוקר; תוצאה כספית unknown עוברת לבירור INT-02. מצב מסך אינו ראיה שהספק ביצע פעולה.', '**חריגים ייחודיים:** '+'; '.join(s['exceptions']), '**מקורות דפוס/דין:** '+(', '.join(s['sources']) if s['sources'] else 'החלטת מוצר; ללא טענה שמקור חיצוני מחייב את המסך.'), '**בדיקת קבלה:** כל Fxx ניתן לעריכה נבדק לפי כלל וסוג; כל Axx נבדק בהרשאה מורשית/אסורה, הצלחה וכשל וביעד. נדרשים תרחישי 07 הרלוונטיים והכרעות שדות פתוחות לפני בנייה.', '']
    (screensdir/(mod+'.md')).write_text('\n'.join(lines),encoding='utf-8')
(B/'screens.json').write_text(json.dumps(SCREENS,ensure_ascii=False,indent=2),encoding='utf-8')
with (B/'screen-actions.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['screen','action_id','label','target','rule'])
    for s in SCREENS:
        for a in s['actions']:w.writerow([s['id'],a['id'],a['label'],a['target'],a['rule']])
with (B/'field-decisions.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['screen','field_id','label','type','requirement','rule','default'])
    for s in SCREENS:
        for q in s['fields']:w.writerow([s['id'],q['id'],q['label'],q['type'],q['requirement'],q['rule'],q['default']])
legend={'full':'עמוד נפתח ונקרא לממצא המצוטט','partial-pdf':'PDF נפתח ונקראו חלקים רלוונטיים; לא כל סעיף ולא נוסח משולב עדכני','indexed':'קטעי אינדוקס רשמיים בלבד; קריאה מלאה לא הושלמה','browser':'נבדקו תמונות ותיאורים בדפדפן; לא מדריך מלא','pending':'אותר, אימות לא הושלם'}
src=['# מאגר מקורות ויומן מחקר','תאריך בדיקה: 14.10.2026. שימוש במקור היסטורי, הצעה או תקן מסומן במפורש. נתוני הורדה אינם ראיית קריאה; טקסט PDF שחולץ עלול להיות משובש בעברית.','## משמעות מצב הקריאה']+[f'- {k}: {v}' for k,v in legend.items()]
for s in S:src += [f"## {s['id']} — {s['title']}",f"סוג: {s['kind']} · מצב: {legend.get(s['status'],s['status'])}",f"[פתיחת המקור הרשמי/המקורי]({s['url']})",s['finding']]
(B/'09-source-register.md').write_text('\n\n'.join(src),encoding='utf-8')
report=dict(version='0.1',date='2026-10-14',screens=len(SCREENS),modules=len(mods),fields=sum(len(s['fields']) for s in SCREENS),actions=sum(len(s['actions']) for s in SCREENS),sources=len(S),planned_acceptance_tests=52,structural_errors=errors,fields_without_explicit_requiredness=len(unresolved),proposed_product_requiredness_decisions=len(proposed),unresolved_field_ids=unresolved,legal_signoff=False,software_tests_executed=False)
(B/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(B/'10-validation-report.md').write_text(f'''# תוצאות בדיקה מבנית ומגבלות

99 מסכים · 15 מודולים · 810 שדות · 562 פעולות · {len(S)} מקורות · 52 תרחישי קבלה מתוכננים.

נבדקו: ייחודיות מזהי מסכים, קיום יעד לכל פעולה, קיום מקור לכל הפניה במקטלוג, ושדות/פעולות/חריגים בכל מסך. מספר שגיאות מבניות: {len(errors)}. זה אינו בדיקת התוכנה הקיימת.

לכל שדה הוגדר מעמד קלט/חובה/חובה מותנית/רשות וברירת מחדל. **{len(proposed)} הכרעות חובה/רשות הן הצעות מוצר מפורשות שהושלמו בנפרד מהכלל המקורי**, וניתנות לעריכה ב־field_contracts.py; הן אינן מוצגות כחובה חוקית או כתוצאה של צפייה במערכת ספק. ערכי enum/מדיניות שאינם ממצים דורשים הכרעה נוספת לפני בנייה. ערך חסר אינו מומר להסכמה, זכאות, אפס כספי או הצלחת ספק.

המחקר כולל קריאה מלאה של עמודים מסוימים, קריאה חלקית של PDF ואינדוקס בלבד של מקורות אחרים. אין סקירת רו״ח/עו״ד, בדיקת נגישות מוסמכת או sandbox ספקים. 52 בדיקות הקבלה הן דרישות עתידיות; הן לא סומנו כעוברות. שערי השחרור מפורטים ב־08.

קובץ validation.json מאפשר לסקריפט לבדוק ספירות, יעדים וחוסרים בצורה מפורשת. תיקון שדה או פעולה מחייב עדכון המקור ובנייה מחדש, לא שינוי הספירה בלבד.
''',encoding='utf-8')

coverage=['# מטריצת כיסוי והיקף','הספירות הן כלי עקיבות, לא הוכחה לאיכות או לתאימות. מודולי ליבה מפורטים ברמת קלט ופעולה; מודולי הרחבה מסוימים מגדירים ממשק וגבול אחריות בלבד.','| מודול | מסכים | שדות | פעולות | קובץ מקור |','|---|---|---|---|---|']
for mod,name in mods.items():
    group=[s for s in SCREENS if s['module']==mod]
    coverage.append(f'| {name} | {len(group)} | {sum(len(s["fields"]) for s in group)} | {sum(len(s["actions"]) for s in group)} | screens/{mod}.md |')
coverage += ['','## מה נבדק ומה לא','בכל מסך: שדות, סוגים, כללי חובה ותנאי, ברירות מחדל, פעולות, יעדים, כניסות, scope, חזרה, חריגים וקישורי מקורות כשיש. ההתנהגות הרוחבית יורשת את רכיבי 02 ולא מוסיפה כפתורים שקיומם לא הוגדר.','32 נושאי ציות נרשמו במטריצה IL01–IL32. לא כולם אומתו; 12 שערי שחרור מגדירים את הראיה והמקצוע הנדרשים. מסמך המקורות מפריד קריאה, אינדוקס, היסטוריה והצעות חוק.','52 תרחישי קבלה מכסים ליבה ומקרי קצה; בנוסף נדרשת בדיקה לכל שדה ולכל פעולה. אלו דרישות לבדיקה עתידית, ולא תוצאות של התוכנה.','מנוע שכר, מטבח, בריכה, נדל״ן ושירותי נסיעות אינם מאופיינים כאן במלואם. EXT-01/02 ומסכי הציות אינם מספיקים לבניית מוצרים ענפיים אלה.','אין הוכחה שכל זרימה פועלת אצל צוות מלון בפועל: טרם בוצעה תצפית/הרצה תפעולית. אין ספק חיצוני שהוסמך על ידי החבילה.','## קבצים לבדיקה אוטומטית','screens.json: המודל המפורט; screen-actions.csv: כל קשת ניווט; field-decisions.csv: כל שדה וכלל; sources.json: מאגר מקור ומצב; validation.json: בדיקה מבנית; reading-validation.json: בדיקת חיפוש, יעדים ורוחב מסמך ב־1440 ו־390 פיקסלים.','קובצי evidence הם חומרי מחקר שנשלפו; הם אינם בתוך ZIP, כדי להפריד מסמכי עבודה ממקורות גולמיים. החבילה ניתנת לקריאה offline; קישורים חיצוניים דורשים אינטרנט.']
(B/'11-coverage-matrix.md').write_text('\n'.join(coverage),encoding='utf-8')

# Small offline Markdown renderer for the subset used by these source files.
def inline(t):
    t=html.escape(t)
    t=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m:f'<a href="{m[2]}">{m[1]}</a>',t)
    t=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',t)
    t=re.sub(r'`([^`]+)`',r'<code>\1</code>',t)
    t=re.sub(r'(?<![\w-])((?:SYS|FD|RSV|INV|FIN|OPS|GST|GRP|REV|INT|WEB|SVC|ADM|BI|EXT)-\d{2}|[LO]\d{2})(?![\w-])',lambda m:f'<a class="ref" href="#{m[1]}">{m[1]}</a>',t)
    return t
def render(md):
    ls=md.splitlines();o=[];i=0
    while i<len(ls):
        l=ls[i].strip()
        if not l:i+=1;continue
        if l.startswith('|'):
            rows=[]
            while i<len(ls) and (ls[i].strip().startswith('|') or not ls[i].strip()):
                z=ls[i].strip();i+=1
                if not z:continue
                cells=[x.strip() for x in z.strip('|').split('|')]
                if all(re.fullmatch(r':?-+:?',c) for c in cells):continue
                rows.append(cells)
            o.append('<div class="table-scroll"><table>')
            for j,row in enumerate(rows):o.append('<tr>'+''.join(f'<{"th" if j==0 else "td"}>{inline(c)}</{"th" if j==0 else "td"}>' for c in row)+'</tr>')
            o.append('</table></div>');continue
        m=re.match(r'^(#{1,6}) (.*)',l)
        if m:
            level=min(len(m[1])+1,6);idmatch=re.match(r'((?:SYS|FD|RSV|INV|FIN|OPS|GST|GRP|REV|INT|WEB|SVC|ADM|BI|EXT)-\d{2}|[LO]\d{2})',m[2])
            o.append(f'<h{level}'+(f' id="{idmatch[1]}"' if idmatch else '')+'>'+inline(m[2])+f'</h{level}>')
        elif re.match(r'^(?:- |\d+\. )',l):o.append('<p class="item">'+inline(l)+'</p>')
        else:o.append('<p>'+inline(l)+'</p>')
        i+=1
    return '\n'.join(o)
paths=sorted(B.glob('[0-9][0-9]-*.md'))+list(screensdir.glob('*.md'))
nav=[];sections=[]
for p in paths:
    title=p.read_text(encoding='utf-8').splitlines()[0].lstrip('# ')
    key='doc-'+p.stem
    nav.append(f'<a href="#{key}">{html.escape(title)}</a>')
    sections.append(f'<section id="{key}">{render(p.read_text(encoding="utf-8"))}</section>')
css='''*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:20px}body{margin:0;background:#f7f6f2;color:#202b32;font:16px/1.7 Arial,sans-serif}a{color:#175266}aside{position:fixed;right:0;top:0;bottom:0;width:275px;overflow:auto;padding:24px;background:#fff;border-left:1px solid #ddd}aside a{display:block;margin:10px 0;text-decoration:none;font-size:14px}main{margin-right:275px;padding:45px 5vw;max-width:1550px}header{border-bottom:2px solid #253e47;padding-bottom:24px}h1{font-size:34px}h2{font-size:27px}h3{font-size:22px;border-bottom:1px solid #ddd;padding-bottom:8px;scroll-margin-top:20px}section{margin-top:70px;padding-top:12px;border-top:1px solid #ccc}p{max-width:1000px}table{border-collapse:collapse;width:100%;min-width:760px;font-size:14px;line-height:1.6}th,td{text-align:right;vertical-align:top;padding:11px;border:1px solid #ddd;overflow-wrap:anywhere}th{background:#e9efef}.table-scroll{overflow:auto;margin:20px 0}.ref,code{white-space:nowrap;direction:ltr;unicode-bidi:isolate}.status{padding:14px;border-right:4px solid #aa7639;background:#fff8e9}input{width:100%;padding:12px;font:inherit;border:1px solid #bbb}#results a{display:block}button{font:inherit;padding:8px 14px;background:#fff;border:1px solid #999;cursor:pointer}.item{padding-right:12px}@media(max-width:800px){aside{position:relative;width:100%;max-height:360px;border-bottom:1px solid #ddd}main{margin:0;padding:22px 16px}h1{font-size:26px}section{margin-top:45px}}@media print{aside,.tools{display:none}main{margin:0;padding:0}body{background:#fff;font-size:10pt}section{break-before:page}.table-scroll{overflow:visible}table{min-width:0;font-size:8pt}tr{break-inside:avoid}a{color:inherit;text-decoration:none}}'''
search=json.dumps([dict(id=s['id'],title=s['title'],module=mods[s['module']]) for s in SCREENS],ensure_ascii=False)
css+='table td:first-child,table th:first-child{min-width:105px;white-space:nowrap;font-size:13px}'
page='<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotel4u — חבילת אפיון</title><style>'+css+'</style></head><body><aside><strong>Hotel4u · אפיון 0.1</strong>'+''.join(nav)+'</aside><main><header><p>14 באוקטובר 2026 · מקור עריכה: מסמכי Markdown וקטלוג JSON</p><h1>אפיון פלטפורמה לניהול אירוח</h1><p>99 מסכים · 15 מודולים · 810 שדות · 562 פעולות · 31 מקורות</p><p class="status">גרסה מחקרית עם חוסרים גלויים. לא אישור ציות ולא מפרט סופי לבנייה. ראו שערי שחרור ודוח בדיקה.</p><div class="tools"><label for="search">איתור מסך לפי שם או מזהה</label><input id="search" placeholder="לדוגמה: כניסה, FIN-06, חדרנות"><div id="results" aria-live="polite"></div><p><button onclick="window.print()">הדפסה / שמירה כ־PDF</button></p></div></header>'+''.join(sections)+f'<script>const screens={search}; const box=document.getElementById("search"),results=document.getElementById("results");box.addEventListener("input",()=>{{results.replaceChildren();const q=box.value.trim().toLowerCase();if(!q)return;screens.filter(s=>(s.id+" "+s.title+" "+s.module).toLowerCase().includes(q)).forEach(s=>{{const a=document.createElement("a");a.href="#"+s.id;a.textContent=s.id+" — "+s.title;results.append(a)}})}});</script></main></body></html>'
page=page.replace('31 מקורות',f'{len(S)} מקורות')
(B/'index.html').write_text(page,encoding='utf-8')
anchors=set(re.findall(r'\bid="([^"]+)"',page));refs=re.findall(r'href="#([^"]+)"',page)
broken=sorted(set(refs)-anchors)
report['html_broken_anchors']=broken;report['html_duplicate_ids']=[k for k,v in collections.Counter(re.findall(r'\bid="([^"]+)"',page)).items() if v>1]
report['html_sha256']=hashlib.sha256((B/'index.html').read_bytes()).hexdigest()
if (B/'reading-validation.json').exists():
    reading=json.loads((B/'reading-validation.json').read_text(encoding='utf-8'))
    report['reading_check_current']=reading.get('htmlSha256')==report['html_sha256']
    report['reading_check_pass']=reading.get('pass',False) if report['reading_check_current'] else None
(B/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
with zipfile.ZipFile(B/'Hotel4u-specification-v0.1.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in paths+[B/'index.html',B/'screens.json',B/'sources.json',B/'validation.json',B/'field-decisions.csv',B/'screen-actions.csv',B/'screen_catalog.py',B/'field_contracts.py',B/'build_package.py']+([B/'reading-validation.json'] if (B/'reading-validation.json').exists() else []):
        z.write(p,p.relative_to(B))
print(json.dumps({k:v for k,v in report.items() if k not in {'unresolved_field_ids'}},ensure_ascii=False))
if errors or broken or report['html_duplicate_ids']:raise SystemExit(1)
