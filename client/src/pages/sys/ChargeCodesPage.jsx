// ADM-13 (gap G1) — charge codes and payment methods. Every manual charge picks a code from here;
// the code decides the revenue group in the day report, the VAT treatment, the accounting account
// for export, a default or locked price, and who may post it. Codes are never renamed or deleted:
// a change of meaning is a new code and the old one is deactivated, so history stays readable.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { finance } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { invalidateChargeCodes } from '../../hooks/useChargeCodes';
import { Page, Card, Segmented, DataTable, Tag, Pill, Modal, Field, ErrorBanner, Banner, Spinner, useLoader, useAction, useUrlState, money, formatDateTime } from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';

const CATALOG_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'finance_manager'];
const VAT = { standard: 'חייב במע״מ', exempt: 'פטור', zero: 'מע״מ אפס' };
const LEVEL = { staff: 'כל צוות הקבלה והקופה', manager: 'מנהל משמרת / כספים', system: 'מערכת בלבד' };
const REF_ALWAYS = ['bank_transfer', 'cheque', 'voucher'];
const URL_DEFAULTS = { tab: 'charge', show: 'active' };

function CodeDialog({ open, onClose, propertyId, code, kind, groups, onSaved }) {
  const action = useAction();
  const editing = !!code;
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return;
    setF({
      code: code?.code || '', name: code?.name || '', revenueGroup: code?.revenueGroup || 'misc', vatClass: code?.vatClass || 'standard',
      glAccount: code?.glAccount || '', defaultPrice: code?.defaultPrice ?? '', priceEditable: code ? code.priceEditable : true,
      postLevel: code?.postLevel || 'staff', requireReference: !!code?.requireReference, sortOrder: code?.sortOrder ?? 100, reason: '',
    });
    action.reset();
  }, [open, code?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const e = action.fields;
  const isPayment = kind === 'payment';
  const isRooms = code?.code === 'rooms';
  const vatChanged = editing ? f.vatClass !== code.vatClass : f.vatClass !== 'standard';
  let why = null;
  if (!editing && !/^[a-z][a-z0-9_]{1,23}$/.test(f.code || '')) why = 'קוד: אותיות לטיניות קטנות, ספרות וקו תחתון';
  else if ((f.name || '').trim().length < 2) why = 'נדרש שם';
  else if (!isPayment && f.priceEditable === false && !(Number(f.defaultPrice) > 0)) why = 'מחיר נעול מחייב מחיר';
  else if (!isPayment && vatChanged && (f.reason || '').trim().length < 3) why = 'שינוי סיווג מע״מ מחייב סיבה';
  const submit = () => action.run(async () => {
    const body = isPayment
      ? { name: f.name.trim(), glAccount: f.glAccount, requireReference: f.requireReference, sortOrder: Number(f.sortOrder), version: code?.updatedAt }
      : {
        name: f.name.trim(), revenueGroup: f.revenueGroup, vatClass: f.vatClass, glAccount: f.glAccount,
        defaultPrice: f.defaultPrice === '' ? null : Number(f.defaultPrice), priceEditable: f.priceEditable,
        ...(isRooms ? {} : { postLevel: f.postLevel }), sortOrder: Number(f.sortOrder), reason: f.reason?.trim() || undefined,
        ...(editing ? { version: code.updatedAt } : { code: f.code, kind: 'charge' }),
      };
    const out = editing ? await finance.updateCode(propertyId, code.id, body) : await finance.createCode(propertyId, body);
    onSaved?.(out);
  });
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={560}
      title={editing ? `${isPayment ? 'אמצעי תשלום' : 'קוד חיוב'}: ${code.name}` : 'קוד חיוב חדש'}
      subtitle={editing ? `קוד ${code.code} — קבוע, לא ניתן לשינוי` : 'הקוד נשמר לתמיד; שינוי משמעות = קוד חדש והשבתת הישן'}
      footer={(
        <>
          {why && <span className="ui-foot-note">{why}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={action.busy || !!why} onClick={submit}>{action.busy ? <Spinner /> : editing ? 'שמירה' : 'יצירה'}</button>
        </>
      )}>
      <ErrorBanner error={action.error} />
      <div className="ui-grid-2">
        {!editing && (
          <Field id="cc-code" label="קוד" required error={e.code} hint="למשל bike_rental">
            <input id="cc-code" className="input w-full" dir="ltr" maxLength={24} value={f.code || ''} onChange={(ev) => set('code')(ev.target.value.toLowerCase().replace(/\s+/g, '_'))} />
          </Field>
        )}
        <Field id="cc-name" label="שם (מופיע בחשבון האורח)" required error={e.name}>
          <input id="cc-name" className="input w-full" maxLength={80} value={f.name || ''} onChange={(ev) => set('name')(ev.target.value)} />
        </Field>
        {!isPayment && (
          <Field id="cc-group" label="קבוצת הכנסה (לדוח היומי)" required error={e.revenueGroup}>
            <select id="cc-group" className="select w-full" value={f.revenueGroup} onChange={(ev) => set('revenueGroup')(ev.target.value)}>
              {Object.entries(groups).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
        {!isPayment && (
          <Field id="cc-vat" label="מע״מ" required error={e.vatClass} hint="פטור / אפס — רק לפי החלטת רו״ח (שער G04)">
            <select id="cc-vat" className="select w-full" value={f.vatClass} onChange={(ev) => set('vatClass')(ev.target.value)}>
              {Object.entries(VAT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
        <Field id="cc-gl" label="חשבון בהנהלת חשבונות" optional error={e.glAccount} hint="ליצוא החשבונאי">
          <input id="cc-gl" className="input w-full" dir="ltr" maxLength={40} value={f.glAccount || ''} onChange={(ev) => set('glAccount')(ev.target.value)} />
        </Field>
        {!isPayment && !isRooms && (
          <Field id="cc-price" label="מחיר ברירת מחדל (כולל מע״מ)" optional error={e.defaultPrice}>
            <input id="cc-price" type="number" min="0" step="0.01" className="input w-full" value={f.defaultPrice} onChange={(ev) => set('defaultPrice')(ev.target.value)} />
          </Field>
        )}
        {!isPayment && !isRooms && (
          <Field id="cc-level" label="מי רושם ידנית" required error={e.postLevel}>
            <select id="cc-level" className="select w-full" value={f.postLevel} onChange={(ev) => set('postLevel')(ev.target.value)}>
              <option value="staff">{LEVEL.staff}</option>
              <option value="manager">{LEVEL.manager}</option>
            </select>
          </Field>
        )}
        <Field id="cc-sort" label="סדר תצוגה" optional error={e.sortOrder}>
          <input id="cc-sort" type="number" min="0" max="9999" className="input w-full" value={f.sortOrder} onChange={(ev) => set('sortOrder')(ev.target.value)} />
        </Field>
      </div>
      {!isPayment && !isRooms && (
        <label className="ui-check"><input type="checkbox" checked={f.priceEditable === false} onChange={(ev) => set('priceEditable')(!ev.target.checked)} /><span>מחיר נעול — הקבלה לא יכולה לשנות את המחיר</span></label>
      )}
      {isPayment && (
        <label className="ui-check"><input type="checkbox" disabled={REF_ALWAYS.includes(code?.code)} checked={f.requireReference || REF_ALWAYS.includes(code?.code)} onChange={(ev) => set('requireReference')(ev.target.checked)} /><span>אסמכתה חובה{REF_ALWAYS.includes(code?.code) ? ' (תמיד באמצעי זה)' : ''}</span></label>
      )}
      {!isPayment && vatChanged && (
        <Field id="cc-reason" label="בסיס לסיווג המע״מ" required error={e.reason}>
          <input id="cc-reason" className="input w-full" maxLength={300} value={f.reason || ''} onChange={(ev) => set('reason')(ev.target.value)} placeholder="למשל: אושר ע״י רו״ח בתאריך…" />
        </Field>
      )}
      {isRooms && <Banner tone="info">הלינה נרשמת רק על ידי סגירת היום והיציאה, לפי המחיר שהוסכם בהזמנה.</Banner>}
    </Modal>
  );
}

export default function ChargeCodesPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = CATALOG_ROLES.includes(role);
  const { toasts, success } = useToast();
  const us = useUrlState(URL_DEFAULTS);
  const url = { tab: us.get('tab'), show: us.get('show') };
  const setUrl = us.set;
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? finance.codes(propertyId, { all: '1' }) : null), [propertyId]);
  const [edit, setEdit] = useState(null);
  const [creating, setCreating] = useState(false);
  const toggle = useAction();
  const groups = data?.revenueGroups || {};
  const rows = useMemo(() => (data?.codes || []).filter((c) => c.kind === url.tab && (url.show === 'all' || c.active)), [data, url.tab, url.show]);
  const inactive = (data?.codes || []).filter((c) => c.kind === url.tab && !c.active).length;

  async function setActive(c, active) {
    const out = await toggle.run(() => finance.updateCode(propertyId, c.id, { active, version: c.updatedAt }));
    if (out) { invalidateChargeCodes(propertyId); success(active ? `${c.name} הופעל` : `${c.name} הושבת`); reload(); }
  }
  const saved = (out) => { setEdit(null); setCreating(false); invalidateChargeCodes(propertyId); success(`נשמר: ${out.name}`); reload(); };

  const chargeCols = [
    { key: 'code', label: 'קוד', width: 130, render: (c) => <span dir="ltr">{c.code}</span> },
    { key: 'name', label: 'שם', render: (c) => <span>{c.name}{c.builtIn && <span className="ui-sub"> · מובנה</span>}</span> },
    { key: 'group', label: 'קבוצת הכנסה', render: (c) => groups[c.revenueGroup] || c.revenueGroup },
    { key: 'vat', label: 'מע״מ', render: (c) => (c.vatClass === 'standard' ? <span className="ui-sub">רגיל</span> : <Tag tone="warn">{VAT[c.vatClass]}</Tag>) },
    { key: 'price', label: 'מחיר', align: 'end', render: (c) => (c.defaultPrice ? <span>{money(c.defaultPrice)}{c.priceEditable === false ? ' 🔒' : ''}</span> : <span className="ui-sub">חופשי</span>) },
    { key: 'level', label: 'רישום ידני', render: (c) => (c.postLevel === 'staff' ? <span className="ui-sub">צוות</span> : <Pill tone={c.postLevel === 'system' ? 'muted' : 'warn'}>{c.postLevel === 'system' ? 'מערכת בלבד' : 'מנהל'}</Pill>) },
    { key: 'gl', label: 'חשבון', render: (c) => (c.glAccount ? <span dir="ltr">{c.glAccount}</span> : <span className="ui-sub">—</span>) },
    { key: 'state', label: 'מצב', render: (c) => (c.active ? <Pill tone="ok">פעיל</Pill> : <Pill tone="muted">מושבת</Pill>) },
    ...(canEdit ? [{
      key: 'act', label: 'פעולות', srOnly: true, align: 'end', render: (c) => (
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}>עריכה</button>
          {c.code !== 'rooms' && <button type="button" className="btn btn-ghost btn-sm" disabled={toggle.busy} onClick={() => setActive(c, !c.active)}>{c.active ? 'השבתה' : 'הפעלה'}</button>}
        </div>
      ),
    }] : []),
  ];
  const payCols = [
    { key: 'code', label: 'קוד', width: 130, render: (c) => <span dir="ltr">{c.code}</span> },
    { key: 'name', label: 'שם' },
    { key: 'ref', label: 'אסמכתה', render: (c) => (c.requireReference ? 'חובה' : <span className="ui-sub">לא נדרשת</span>) },
    { key: 'gl', label: 'חשבון', render: (c) => (c.glAccount ? <span dir="ltr">{c.glAccount}</span> : <span className="ui-sub">—</span>) },
    { key: 'state', label: 'מצב', render: (c) => (c.active ? <Pill tone="ok">פעיל</Pill> : <Pill tone="muted">מושבת</Pill>) },
    ...(canEdit ? [{
      key: 'act', label: 'פעולות', srOnly: true, align: 'end', render: (c) => (
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}>עריכה</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={toggle.busy} onClick={() => setActive(c, !c.active)}>{c.active ? 'השבתה' : 'הפעלה'}</button>
        </div>
      ),
    }] : []),
  ];

  return (
    <Page title="קודי חיוב" back="/pms">
      <ToastContainer toasts={toasts} />
      <AdminNav end={canEdit && url.tab === 'charge' ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> קוד חדש</button> : null} />
      {!canEdit && <Banner tone="info">צפייה בלבד — עריכת הקטלוג מותרת להנהלה ולכספים.</Banner>}
      <ErrorBanner error={toggle.error} />
      <Card
        title={url.tab === 'charge' ? 'קודי חיוב' : 'אמצעי תשלום'}
        actions={(
          <div className="ui-row">
            <Segmented label="סוג" value={url.tab} onChange={(v) => setUrl({ tab: v })} options={[{ value: 'charge', label: 'קודי חיוב' }, { value: 'payment', label: 'אמצעי תשלום' }]} />
            <Segmented label="תצוגה" value={url.show} onChange={(v) => setUrl({ show: v })} options={[{ value: 'active', label: 'פעילים' }, { value: 'all', label: `הכול${inactive ? ` (${inactive} מושבתים)` : ''}` }]} />
          </div>
        )}
        flush
      >
        <DataTable columns={url.tab === 'charge' ? chargeCols : payCols} rows={rows} loading={loading} error={error} onRetry={reload} caption={url.tab === 'charge' ? 'קודי חיוב' : 'אמצעי תשלום'} />
      </Card>
      <div className="ui-sub">
        {url.tab === 'charge'
          ? 'כל חיוב ידני נבחר מהרשימה. קבוצת ההכנסה מזינה את דוח סגירת היום, והחשבון — את היצוא להנהלת החשבונות. עודכן לאחרונה: '
          : 'אמצעי התשלום קבועים במערכת; אפשר לשנות שם, לחייב אסמכתה, לקשר לחשבון או להשבית. עודכן לאחרונה: '}
        {(() => { const last = (data?.codes || []).filter((c) => c.updatedBy).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0]; return last ? `${last.updatedBy} · ${formatDateTime(last.updatedAt)}` : '—'; })()}
      </div>
      <CodeDialog open={!!edit || creating} onClose={() => { setEdit(null); setCreating(false); }} propertyId={propertyId} code={edit} kind={edit?.kind || 'charge'} groups={groups} onSaved={saved} />
    </Page>
  );
}
