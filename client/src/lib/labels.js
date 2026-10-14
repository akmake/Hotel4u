// Hebrew display labels for enum values coming from the server.
// Keep one source here so screens never show raw enum strings ("property_admin", "dirty").

export const ROLE_LABELS = {
  super_admin: 'מנהל מערכת',
  property_admin: 'מנהל נכס',
  general_manager: 'מנהל כללי',
  front_desk_manager: 'מנהל קבלה',
  receptionist: 'פקיד/ת קבלה',
  housekeeping_manager: 'מנהל/ת משק',
  housekeeper: 'חדרן/ית',
  maintenance_manager: 'מנהל אחזקה',
  technician: 'טכנאי',
  finance_manager: 'מנהל כספים',
  cashier: 'קופאי/ת',
  revenue_manager: 'מנהל הכנסות',
  sales_manager: 'מנהל מכירות',
  auditor: 'מבקר/ת',
  owner_readonly: 'בעלים (צפייה)',
  // legacy sales roles
  admin: 'מנהל',
  sales: 'מכירות',
  maintenance: 'אחזקה',
  shift_manager: 'אחראי משמרת',
};

export const roleLabel = (role) => ROLE_LABELS[role] || role || '';

// Room dimensions are separate (spec 01): cleanliness ≠ operational status ≠ occupancy.
export const CLEAN_LABELS = {
  clean: 'נקי',
  dirty: 'מלוכלך',
  cleaning: 'בניקיון',
  inspected: 'נבדק',
  pickup: 'לסידור',
  turndown_required: 'הכנת לילה',
};

export const OPS_LABELS = {
  available: 'זמין',
  out_of_order: 'מושבת (OOO)',
  out_of_service: 'מחוץ לשירות (OOS)',
  maintenance_hold: 'המתנה לתחזוקה',
  owner_hold: 'שמור לבעלים',
  internal_use: 'שימוש פנימי',
};

export const QUEUE_REASON_LABELS = {
  cleaning: 'ממתין לניקיון',
  inspection: 'ממתין לבדיקה',
  maintenance: 'תקלה בחדר',
  assignment: 'ממתין לשיבוץ',
  occupied: 'החדר עדיין תפוס',
};

export const GUARANTEE_LABELS = {
  none: 'ללא',
  credit_card: 'כרטיס אשראי',
  deposit: 'מקדמה',
  voucher: 'שובר',
  company_guarantee: 'ערבות חברה',
};

export const ID_DOC_LABELS = {
  id_card: 'תעודת זהות',
  passport: 'דרכון',
  drivers_license: 'רישיון נהיגה',
  other: 'אחר',
};

export const cleanLabel = (v) => CLEAN_LABELS[v] || v || '—';
export const opsLabel = (v) => OPS_LABELS[v] || v || '—';

export const REQUEST_CATEGORY_LABELS = {
  towels: 'מגבות', cleaning: 'ניקיון', maintenance: 'תחזוקה', food: 'אוכל', transport: 'הסעה',
  complaint: 'תלונה', amenities: 'מוצרי אירוח', noise: 'רעש', temperature: 'טמפרטורה', general: 'כללי',
};

export const CHARGE_DEPARTMENT_LABELS = {
  minibar: 'מיניבר', f_and_b: 'מזון ומשקאות', spa: 'ספא', parking: 'חניה', laundry: 'כביסה',
  telephone: 'טלפון', damage: 'נזק', other: 'אחר',
};

// Department of a posted line, including lodging posted by day close.
export const LINE_DEPARTMENT_LABELS = { ...CHARGE_DEPARTMENT_LABELS, rooms: 'לינה', room: 'לינה' };

export const SETTLEMENT_LABELS = {
  paid: 'שולם וסגור',
  company_ar: 'הועבר לחייבים (חברה)',
  approved_open: 'יתרה פתוחה באישור מנהל',
};

export const PAY_METHOD_LABELS = {
  cash: 'מזומן', credit_card: 'כרטיס אשראי (מסוף חיצוני)', bank_transfer: 'העברה בנקאית', cheque: 'שיק', voucher: 'שובר',
};

// Finance (FIN-01…FIN-12)
export const LINE_TYPE_LABELS = {
  charge: 'חיוב', payment: 'תשלום', deposit: 'מקדמה', refund: 'החזר', adjustment: 'תיקון', discount: 'הנחה', tax: 'מס', fee: 'עמלה',
};
export const REFUND_REASON_LABELS = { cancellation: 'ביטול', overpayment: 'תשלום עודף', complaint: 'תלונה', other: 'אחר' };
export const DOC_TYPE_LABELS = {
  tax_invoice: 'חשבונית מס', tax_invoice_receipt: 'חשבונית מס/קבלה', receipt: 'קבלה', proforma: 'חשבון עסקה',
  credit_note: 'מסמך זיכוי', debit_note: 'מסמך חיוב',
};
export const DOC_STATUS_LABELS = { draft: 'טיוטה', issued: 'הונפק', cancelled: 'בוטל', pending_allocation: 'ממתין למספר הקצאה' };
export const DAY_STEP_LABELS = { post_nights: 'רישום חיובי לינה', no_shows: 'טיפול בהגעות שלא הגיעו', snapshot: 'דוח יום', advance: 'סימון היום כסגור' };
export const RUN_STATUS_LABELS = { pending: 'ממתין', running: 'רץ', failed: 'נכשל', done: 'הושלם', skipped: 'דולג' };

// Operations (spec OPS-01…OPS-06)
export const TASK_TYPE_LABELS = {
  checkout_clean: 'ניקיון עזיבה', stayover: 'ניקיון שהייה', deep_clean: 'ניקיון יסודי',
  turndown: 'הכנת ערב', pickup: 'רענון', arrival_prep: 'הכנה להגעה',
};

export const TASK_STATUS_LABELS = {
  new: 'לא שובץ', assigned: 'ממתין', in_progress: 'בביצוע', paused: 'נעצר',
  completed: 'הסתיים', failed_inspection: 'הוחזר לניקיון', inspected: 'נבדק', cancelled: 'בוטל',
};

export const PRIORITY_LABELS = { urgent: 'דחוף', high: 'גבוהה', medium: 'רגילה', low: 'נמוכה' };

export const PAUSE_REASON_LABELS = { no_access: 'אין גישה לחדר', dnd: 'האורח ביקש לא להפריע', supplies: 'חסר ציוד', issue: 'תקלה בחדר' };

export const TICKET_STATUS_LABELS = {
  new: 'חדש', assigned: 'שובץ', in_progress: 'בטיפול', waiting_parts: 'ממתין לחלקים', waiting_vendor: 'ממתין לספק',
  resolved: 'תוקן — לאישור', verified: 'אושר', closed: 'סגור', reopened: 'נפתח מחדש',
};

export const TICKET_PRIORITY_LABELS = { critical: 'מסוכנת', high: 'דחופה', medium: 'רגילה', low: 'נמוכה' };

export const TICKET_CATEGORY_LABELS = {
  electricity: 'חשמל', water: 'מים ואינסטלציה', hvac: 'מיזוג', furniture: 'ריהוט', cleaning: 'ניקיון',
  safety: 'בטיחות', lock: 'מנעול', internet: 'אינטרנט', tv: 'טלוויזיה', noise: 'רעש', other: 'אחר',
};

export const GUEST_IMPACT_LABELS = { none: 'ללא השפעה', block: 'חסימת החדר', move: 'נדרש מעבר אורח' };

export const LOST_STATUS_LABELS = { found: 'נמצא', stored: 'נשמר', returned: 'נמסר', disposed: 'טופל' };

export const LOST_CATEGORY_LABELS = {
  document: 'מסמך זיהוי', electronics: 'אלקטרוניקה', jewelry: 'תכשיט', clothing: 'ביגוד', money: 'כסף', hazardous: 'חפץ מסוכן', other: 'אחר',
};

export const DISPOSAL_LABELS = { donated: 'נתרם', discarded: 'הושמד', police: 'נמסר למשטרה' };

// Reservations (RSV-01…RSV-04)
export const RES_STATUS_LABELS = {
  draft: 'טיוטה', quote: 'הצעת מחיר', hold: 'מוחזקת', pending_payment: 'ממתינה לתשלום', confirmed: 'מאושרת', modified: 'עודכנה',
  cancelled: 'בוטלה', waitlisted: 'רשימת המתנה', no_show: 'לא הגיע', checked_in: 'בבית', in_house: 'בבית', checked_out: 'יצא',
  partially_checked_in: 'נכנס חלקית', partially_checked_out: 'יצא חלקית',
};
export const SOURCE_LABELS = {
  direct: 'ישיר', phone: 'טלפון', walk_in: 'הגעה ללא הזמנה', corporate: 'חברה', agent: 'סוכן', booking: 'Booking.com',
  expedia: 'Expedia', agoda: 'Agoda', airbnb: 'Airbnb', gds: 'GDS',
};
export const QUOTE_CHANNEL_LABELS = { email: 'דוא״ל', link: 'קישור', print: 'הדפסה' };
