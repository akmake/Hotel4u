from pathlib import Path
import json, urllib.request, concurrent.futures, html

root = Path(__file__).parent / 'opera-cloud'
root.mkdir(exist_ok=True)
items = [
('קבלה','הכנת הגעות','26.2','c_31844_pre_arrivals_screen_and_opera_control_added'),
('קבלה','הגעות וזמני הגעה','26.2','c_31706_reservation_search_and_quick_edit_updated_with_eta_and_etd_1'),
('קבלה','עזיבות וזמני יציאה','26.2','c_31706_reservation_search_and_quick_edit_updated_with_eta_and_etd_2'),
('קבלה','אורחים שוהים','26.2','c_31706_reservation_search_and_quick_edit_updated_with_eta_and_etd_3'),
('קבלה','תור לחדרים לא מוכנים','26.2','c_20820_queue_rooms_module_added'),
('חדרים','שיבוץ חדר','26.2','c_30723_room_type_room_info_link_added_to_room_assignment'),
('חדרים','לוח שהיות וחסימות','26.2','c_30878_new_reservation_colors_added_2'),
('חדרים','העברת חדר בלוח','26.2','c_30778_room_reassignment_in_room_diary_updated'),
('הזמנות','יצירת הזמנה','24.4','rr_c_rss_reservation_sales_screen_updated'),
('הזמנות','עריכה מהירה','26.2','c_31549_linked_profiles_communication_notes_preferences_attachments_and_relationships_managing_options_added_1'),
('הזמנות','פרטי שהייה יומיים','26.2','c_31483_quick_edit_added_to_daily_details_1'),
('הזמנות','הערות ומשימות מעקב','26.2','c_31579_reservation_notes_and_traces_updated_3'),
('הזמנות','חיפוש ורשימת המתנה','26.2','c_31808_waitlist_from_reservation_sales_screen_added_1'),
('אורחים','פרופיל אורח','26.2','c_31549_linked_profiles_communication_notes_preferences_attachments_and_relationships_managing_options_added_3'),
('אורחים','חברה ונלווים מקושרים','26.2','c_31549_linked_profiles_communication_notes_preferences_attachments_and_relationships_managing_options_added_5'),
('כספים','חשבון וחיובים','25.5','c_27602_credit_bill_from_billing_opera_control_added'),
('כספים','אפשרויות הפקת חשבונות','26.2','c_30734_batch_folios_updated'),
('כספים','ניתוב חיובים למשלם','26.2','c_32976_add_payment_to_existing_routing_instruction_updated_1'),
('כספים','הוספת אמצעי תשלום','26.2','c_32976_add_payment_to_existing_routing_instruction_updated_2'),
('כספים','תשלומי חבילות','26.2','c_31787_package_postings_display_updated'),
('חדרנות','לוח חדרנות','26.2','c_30777_a_attendant_in_room_indicator_added_to_housekeeping_board'),
('חדרנות','סטטוס חדר וחסימות','26.2','c_30403_room_status_updated_for_oo_and_os'),
('חדרנות','גיליון משימות','26.2','c_30404_reservation_details_and_icons_in_task_sheets_updated_2'),
('תחזוקה','פתיחת בקשת תחזוקה','26.2','c_29436_usability_improved_in_task_companion_rm_maint_rm_status_and_post_it_1'),
('תחזוקה','חסימת חדר','26.2','c_29436_usability_improved_in_task_companion_rm_maint_rm_status_and_post_it_2'),
('הכנסות והפצה','מלאי מחירים והגבלות','26.2','c_29348_inventory_and_rate_availability_consolidated_screen_added'),
('הכנסות והפצה','הגבלות מכירה','26.2','c_24165_manage_restriction_screen_updated_1'),
('הכנסות והפצה','הגנה ממכירת יתר','26.2','c_32102_sellable_availability_updated'),
('הכנסות והפצה','מיפוי חדרים בערוצים','26.2','c_23766_copy_channel_room_flow_added'),
('סגירת יום','דוחות סגירת יום','26.2','c_30736_sequence_added_to_end_of_day_final_reports'),
('קבוצות','הגבלות הזמנה מבלוק','26.1','c_3034_block_restrictions_validation_added'),
('קבוצות','דוח ביטולי קבוצות','26.1','c_26625_block_cancellation_summary_report_updated'),
]

def collect(entry):
    category,title,version,name=entry
    base=f'https://docs.oracle.com/en/industries/hospitality/opera-cloud/{version}/oprnc/'
    url=base+'img/'+name+'.png'
    filename=name+'.png'
    result=dict(category=category,title=title,version=version,image=url,source=base+'c_feature_summary.htm',file=filename)
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req,timeout=35) as response:
            data=response.read()
        if not data.startswith(b'\x89PNG'):
            raise ValueError('Response is not PNG')
        (root/filename).write_bytes(data)
        result['downloaded']=True
    except Exception as error:
        result['downloaded']=False
        result['error']=str(error)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results=list(pool.map(collect,items))
(root/'manifest.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
parts=['<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OPERA Cloud — ספריית מסכי מקור</title><style>body{font:16px/1.6 Arial,sans-serif;margin:0;background:#f4f4f4;color:#202020}header,nav{padding:24px;background:white}nav a{display:inline-block;margin:5px 10px}main{padding:24px}section{margin-bottom:40px}article{background:white;padding:20px;margin:20px 0}img{display:block;max-width:100%;height:auto;margin:15px auto}a{color:#1354a0}h1{margin:0}small{color:#555}</style><header><h1>OPERA Cloud — ספריית מסכי מקור</h1><p>32 צילומים · מקור: תיעוד Oracle · גרסאות 24.4–26.2 · נאסף 14.10.2026</p><p>צילומי תיעוד רשמיים, לא עיצובים שנוצרו עבור Hotel4u. אינם כיסוי מלא של המערכת. מסכי קבוצות כאן חלקיים; כניסה מלאה ודשבורד עדיין דורשים השלמה.</p></header><nav>']
categories=list(dict.fromkeys(x['category'] for x in results))
for index,category in enumerate(categories):
    parts.append(f'<a href="#section-{index}">{html.escape(category)}</a>')
parts.append('</nav><main>')
for index,category in enumerate(categories):
    parts.append(f'<section id="section-{index}"><h2>{html.escape(category)}</h2>')
    for item in results:
        if item['category']!=category:continue
        image=item['file'] if item['downloaded'] else item['image']
        parts.append(f'<article><h3>{html.escape(item["title"])}</h3><small>גרסה {item["version"]}</small><a href="{item["image"]}"><img loading="lazy" src="{image}" alt="{html.escape(item["title"])}"></a><a href="{item["source"]}">תיעוד המקור של Oracle</a> · <a href="{item["image"]}">תמונה מקורית בגודל מלא</a></article>')
    parts.append('</section>')
parts.append('</main></html>')
(root/'index.html').write_text('\n'.join(parts),encoding='utf-8')
print(json.dumps({'catalogued':len(results),'downloaded':sum(x['downloaded'] for x in results),'failed':[(x['title'],x.get('error')) for x in results if not x['downloaded']]},ensure_ascii=False))
