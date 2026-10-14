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
