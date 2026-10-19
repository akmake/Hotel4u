// ADM-01/02/03 — hotel setup: property details, room types and rooms, with what is still missing.
// The server validates and audits every change; nothing is deleted — types and rooms are deactivated.
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Plus, Pencil } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { setup } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Card, Field, ErrorBanner, Banner, Spinner, Modal, Segmented, Tag, DataTable, Empty, useLoader, useAction, useUrlState, money } from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';
import OnlineBookingCard from '../../components/sys/OnlineBookingCard';

const SETUP_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager'];
const BED_LABELS = { king: 'קינג', queen: 'קווין', twin: 'שתי מיטות נפרדות', double: 'זוגית', single: 'יחיד', bunk: 'קומתיים', mixed: 'משולב', other: 'אחר' };

export default function HotelSetupPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = SETUP_ROLES.includes(role);
  const { toasts, success } = useToast();
  const url = useUrlState({ tab: 'property' });
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? setup.get(propertyId) : null), [propertyId]);
  const tab = url.get('tab');
  const missing = data?.readiness.filter((r) => !r.ok) || [];

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <AdminNav />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <div className="ui-empty"><Spinner /> טוען…</div>}
      {data && (
        <>
          <Card title={missing.length ? `הקמת המלון — חסרים ${missing.length} דברים` : 'הקמת המלון — הכל מוכן'}>
            <ul className="setup-check">
              {data.readiness.map((r) => (
                <li key={r.label} className={r.ok ? 'is-ok' : ''}>
                  <button type="button" className="setup-check-btn" onClick={() => url.set({ tab: r.where })}>
                    {r.ok ? <CheckCircle2 size={15} /> : <Circle size={15} />}<span>{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="ui-toolbar">
            <Segmented label="אזור" value={tab} onChange={(v) => url.set({ tab: v })} options={[
              { value: 'property', label: 'פרטי המלון' },
              { value: 'types', label: `סוגי חדרים (${data.roomTypes.filter((t) => t.active).length})` },
              { value: 'rooms', label: `חדרים (${data.rooms.filter((r) => r.active).length})` },
              { value: 'web', label: 'אתר ההזמנות' },
            ]} />
          </div>
          {tab === 'property' && <PropertyForm data={data} canEdit={canEdit} propertyId={propertyId} onSaved={() => { success('פרטי המלון נשמרו'); reload(); }} />}
          {tab === 'types' && <RoomTypes data={data} canEdit={canEdit} propertyId={propertyId} onSaved={(m) => { success(m); reload(); }} />}
          {tab === 'web' && <OnlineBookingCard propertyId={propertyId} role={role} onSaved={(m) => success(m)} />}
          {tab === 'rooms' && <Rooms data={data} canEdit={canEdit} propertyId={propertyId} onSaved={(m) => { success(m); reload(); }} />}
        </>
      )}
    </Page>
  );
}

function PropertyForm({ data, canEdit, propertyId, onSaved }) {
  const save = useAction();
  const [f, setF] = useState(data.property);
  useEffect(() => setF(data.property), [data.property]);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const changed = JSON.stringify(f) !== JSON.stringify(data.property);
  const e = save.fields;
  const input = (k, label, props = {}) => (
    <Field id={`pp-${k}`} label={label} error={e[k]} required={props.required} hint={props.hint}>
      <input id={`pp-${k}`} className="input w-full" value={f[k] ?? ''} onChange={set(k)} disabled={!canEdit} dir={props.ltr ? 'ltr' : undefined} type={props.type || 'text'} inputMode={props.inputMode} maxLength={props.max} />
    </Field>
  );
  const submit = () => save.run(async () => {
    const body = Object.fromEntries(Object.keys(f).filter((k) => k !== 'id' && String(f[k] ?? '') !== String(data.property[k] ?? '')).map((k) => [k, f[k]]));
    await setup.updateProperty(propertyId, body);
    onSaved();
  });
  return (
    <Card title="פרטי המלון" actions={canEdit && <button type="button" className="btn btn-primary btn-sm" disabled={!changed || save.busy} onClick={submit}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>}>
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        {!canEdit && <Banner tone="info">צפייה בלבד — שינוי פרטי המלון מותר להנהלה.</Banner>}
        <div className="ui-grid-2">
          {input('name', 'שם המלון', { required: true, max: 120 })}
          {input('legalName', 'שם משפטי (לחשבוניות)', { max: 200 })}
          {input('taxNumber', 'מספר עוסק / ח.פ.', { ltr: true, inputMode: 'numeric', max: 9, hint: '9 ספרות' })}
          {input('phone', 'טלפון', { ltr: true, max: 30 })}
          {input('address', 'כתובת', { max: 200 })}
          {input('city', 'עיר', { max: 80 })}
          {input('postalCode', 'מיקוד', { ltr: true, max: 10 })}
          {input('email', 'דוא״ל', { ltr: true, type: 'email', max: 120 })}
          {input('website', 'אתר', { ltr: true, max: 200 })}
          {input('totalRooms', 'מספר חדרים במלון (לפי רישיון)', { inputMode: 'numeric', hint: `מוגדרים כרגע: ${data.rooms.filter((r) => r.active).length}` })}
        </div>
        <div className="ui-grid-2">
          {input('checkInTime', 'שעת כניסה', { type: 'time' })}
          {input('checkOutTime', 'שעת יציאה', { type: 'time' })}
          {input('vatRate', 'שיעור מע״מ %', { inputMode: 'decimal', hint: Number(f.vatRate) !== 18 ? 'השיעור בישראל מ־1.1.2025 הוא 18%' : undefined })}
          {input('reservationPrefix', 'קידומת מספר הזמנה', { ltr: true, max: 8 })}
        </div>
      </div>
    </Card>
  );
}

const TYPE_EMPTY = { code: '', name: '', shortDesc: '', baseRate: '', capacityBase: 2, capacityMax: 2, adultsMax: 2, childrenMax: 0, bedType: 'double', roomSizeSqm: '', sortOrder: 0, extraBedAllowed: false, cribAllowed: true, fullDesc: '', view: '', amenities: [], images: [], showInEngine: true };
const VIEW_LABELS = { sea: 'ים / אגם', garden: 'גן', city: 'עיר', mountain: 'הרים', pool: 'בריכה', interior: 'חצר פנימית', courtyard: 'חצר', other: 'אחר' };

function RoomTypes({ data, canEdit, propertyId, onSaved }) {
  const [edit, setEdit] = useState(null);
  const columns = [
    { key: 'name', label: 'סוג', render: (t) => <div><b>{t.name}</b> <span className="ui-sub ui-num">{t.code}</span>{t.shortDesc && <div className="ui-sub">{t.shortDesc}</div>}</div> },
    { key: 'rate', label: 'מחיר בסיס ללילה', nowrap: true, render: (t) => (t.baseRate > 0 ? money(t.baseRate) : <Tag tone="warn">חסר</Tag>) },
    { key: 'cap', label: 'תפוסה', nowrap: true, render: (t) => `${t.capacityBase} רגיל · עד ${t.capacityMax} (${t.adultsMax} מבוגרים${t.childrenMax ? `, ${t.childrenMax} ילדים` : ''})` },
    { key: 'bed', label: 'מיטה', nowrap: true, render: (t) => BED_LABELS[t.bedType] || t.bedType },
    { key: 'rooms', label: 'חדרים', nowrap: true, render: (t) => (t.rooms ? t.rooms : <Tag tone="warn">0</Tag>) },
    { key: 'st', label: 'מצב', nowrap: true, render: (t) => (t.active ? <span className="ui-sub">פעיל</span> : <Tag>מושבת</Tag>) },
    { key: 'act', label: 'פעולות', srOnly: true, render: (t) => canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(t)}><Pencil size={13} />עריכה</button> },
  ];
  return (
    <Card flush title="סוגי חדרים" actions={canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdit({ ...TYPE_EMPTY, id: null })}><Plus size={14} />סוג חדר</button>}>
      {data.roomTypes.length ? <DataTable columns={columns} rows={data.roomTypes} rowKey={(t) => t.id} /> : <Empty title="אין סוגי חדרים">מתחילים ממה שמוכרים: סטנדרט, דלקס, סוויטה…</Empty>}
      <TypeDialog value={edit} onClose={() => setEdit(null)} propertyId={propertyId} bedTypes={data.bedTypes} onSaved={(m) => { setEdit(null); onSaved(m); }} />
    </Card>
  );
}

function TypeDialog({ value, onClose, propertyId, bedTypes, onSaved }) {
  const save = useAction();
  const [f, setF] = useState(TYPE_EMPTY);
  useEffect(() => { if (value) { setF(value); save.reset(); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const creating = !value?.id;
  const e = save.fields;
  const num = (k, label, hint) => <Field id={`rt-${k}`} label={label} error={e[k]} hint={hint}><input id={`rt-${k}`} className="input w-full" inputMode="numeric" value={f[k] ?? ''} onChange={set(k)} /></Field>;
  const submit = (extra = {}) => save.run(async () => {
    const amenities = Array.isArray(f.amenities) ? f.amenities : String(f.amenities || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const body = { code: f.code, name: f.name, shortDesc: f.shortDesc, baseRate: f.baseRate, capacityBase: f.capacityBase, capacityMax: f.capacityMax, adultsMax: f.adultsMax, childrenMax: f.childrenMax, bedType: f.bedType, roomSizeSqm: f.roomSizeSqm, sortOrder: f.sortOrder, extraBedAllowed: f.extraBedAllowed, cribAllowed: f.cribAllowed, fullDesc: f.fullDesc, view: f.view || '', amenities, showInEngine: f.showInEngine !== false, ...extra };
    if (creating) await setup.createType(propertyId, body); else await setup.updateType(propertyId, value.id, body);
    onSaved(creating ? `סוג החדר ${f.name} נוסף` : extra.active === false ? `${f.name} הושבת` : extra.active ? `${f.name} הופעל` : 'סוג החדר נשמר');
  });
  return (
    <Modal open={!!value} onClose={onClose} busy={save.busy} width={640} title={creating ? 'סוג חדר חדש' : `עריכת ${value?.name || ''}`}
      footer={(
        <>
          {!creating && (value.active
            ? <button type="button" className="btn btn-danger" disabled={save.busy} onClick={() => submit({ active: false })}>השבתה</button>
            : <button type="button" className="btn btn-secondary" disabled={save.busy} onClick={() => submit({ active: true })}>הפעלה מחדש</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={save.busy}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={save.busy || !f.code || !f.name} onClick={() => submit()}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}>
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        <div className="ui-grid-2">
          <Field id="rt-name" label="שם" required error={e.name}><input id="rt-name" className="input w-full" maxLength={80} value={f.name} onChange={set('name')} /></Field>
          <Field id="rt-code" label="קוד" required error={e.code} hint="למשל STD, DLX"><input id="rt-code" className="input w-full" dir="ltr" maxLength={10} value={f.code} onChange={(ev) => setF((p) => ({ ...p, code: ev.target.value.toUpperCase() }))} /></Field>
          <Field id="rt-rate" label="מחיר בסיס ללילה (כולל מע״מ)" required error={e.baseRate} hint="ברירת מחדל כשאין מחיר בלוח התעריפים"><input id="rt-rate" className="input w-full" inputMode="decimal" value={f.baseRate} onChange={set('baseRate')} /></Field>
          <Field id="rt-bed" label="סוג מיטה" error={e.bedType}><select id="rt-bed" className="input w-full" value={f.bedType} onChange={set('bedType')}>{bedTypes.map((b) => <option key={b} value={b}>{BED_LABELS[b] || b}</option>)}</select></Field>
          {num('capacityBase', 'תפוסה רגילה')}
          {num('capacityMax', 'תפוסה מרבית')}
          {num('adultsMax', 'מבוגרים לכל היותר')}
          {num('childrenMax', 'ילדים לכל היותר', '0 = בלי הגבלה נפרדת')}
          {num('roomSizeSqm', 'גודל במ״ר')}
          {num('sortOrder', 'סדר תצוגה')}
        </div>
        <Field id="rt-desc" label="תיאור קצר" optional><input id="rt-desc" className="input w-full" maxLength={300} value={f.shortDesc || ''} onChange={set('shortDesc')} /></Field>
        <div className="ui-row" style={{ gap: 16 }}>
          <label className="ui-check"><input type="checkbox" checked={!!f.extraBedAllowed} onChange={set('extraBedAllowed')} /><span>אפשר מיטה נוספת</span></label>
          <label className="ui-check"><input type="checkbox" checked={!!f.cribAllowed} onChange={set('cribAllowed')} /><span>אפשר עריסה</span></label>
          <label className="ui-check"><input type="checkbox" checked={f.showInEngine !== false} onChange={set('showInEngine')} /><span>מוצג ונמכר באתר ההזמנות</span></label>
        </div>
        <div className="ui-section-title">באתר ההזמנות</div>
        <Field id="rt-view" label="נוף" optional><select id="rt-view" className="input w-full" value={f.view || ''} onChange={set('view')}><option value="">—</option>{Object.entries(VIEW_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="rt-full" label="תיאור מלא" optional hint="מוצג בחלון פרטי החדר"><textarea id="rt-full" className="input w-full" rows={3} maxLength={2000} value={f.fullDesc || ''} onChange={set('fullDesc')} /></Field>
        <Field id="rt-amen" label="מה יש בחדר" optional error={e.amenities} hint="פריט בכל שורה או מופרד בפסיק — עד 20"><textarea id="rt-amen" className="input w-full" rows={3} value={Array.isArray(f.amenities) ? f.amenities.join('\n') : f.amenities || ''} onChange={(ev) => setF((p) => ({ ...p, amenities: ev.target.value }))} /></Field>
        {!creating && <TypePhotos propertyId={propertyId} type={value} />}
      </div>
    </Modal>
  );
}

// Photos for the booking site: upload one at a time (re-encoded on the server), first = cover.
function TypePhotos({ propertyId, type }) {
  const [images, setImages] = useState(type.images || []);
  const act = useAction();
  useEffect(() => setImages(type.images || []), [type]);
  const upload = (file) => file && act.run(async () => { const out = await setup.typePhoto(propertyId, type.id, file); setImages(out.images); });
  const save = (next) => act.run(async () => { const out = await setup.typePhotos(propertyId, type.id, next); setImages(out.images); });
  return (
    <Field id="rt-photos" label={`תמונות (${images.length}/8)`} optional hint="JPG / PNG / WEBP. התמונה הראשונה היא תמונת השער באתר.">
      <div className="ui-stack">
        <ErrorBanner error={act.error} />
        {images.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
            {images.map((src, i) => (
              <figure key={src} style={{ margin: 0, display: 'grid', gap: 4 }}>
                <img src={src} alt={`תמונה ${i + 1}`} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 6, outline: i === 0 ? '2px solid currentColor' : 'none' }} />
                <div className="ui-row" style={{ gap: 4 }}>
                  {i > 0 && <button type="button" className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => save([src, ...images.filter((x) => x !== src)])}>לשער</button>}
                  <button type="button" className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => save(images.filter((x) => x !== src))}>הסרה</button>
                </div>
              </figure>
            ))}
          </div>
        )}
        {images.length < 8 && (
          <label className="btn btn-secondary btn-sm" style={{ width: 'fit-content' }}>
            {act.busy ? <><Spinner /> מעלה…</> : <><Plus size={14} /> הוספת תמונה</>}
            <input id="rt-photos" type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={act.busy} onChange={(ev) => { upload(ev.target.files?.[0]); ev.target.value = ''; }} />
          </label>
        )}
      </div>
    </Field>
  );
}

function Rooms({ data, canEdit, propertyId, onSaved }) {
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const rows = useMemo(() => data.rooms.filter((r) => !typeFilter || r.roomTypeId === typeFilter), [data.rooms, typeFilter]);
  const activeTypes = data.roomTypes.filter((t) => t.active);
  const columns = [
    { key: 'n', label: 'חדר', nowrap: true, render: (r) => <b className="ui-num">{r.number}</b> },
    { key: 'f', label: 'קומה', nowrap: true, render: (r) => r.floor },
    { key: 't', label: 'סוג', render: (r) => r.roomType || '—' },
    { key: 'x', label: 'מאפיינים', render: (r) => [r.isAccessible && 'נגיש', r.isSmoking && 'מעשנים', r.isVip && 'VIP'].filter(Boolean).join(' · ') || <span className="ui-sub">—</span> },
    { key: 's', label: 'מצב', nowrap: true, render: (r) => (r.active ? <span className="ui-sub">פעיל</span> : <Tag>מושבת</Tag>) },
    { key: 'a', label: 'פעולות', srOnly: true, render: (r) => canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(r)}><Pencil size={13} />עריכה</button> },
  ];
  return (
    <Card flush title="חדרים" actions={(
      <>
        <select className="select select-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="סינון לפי סוג">
          <option value="">כל הסוגים</option>
          {data.roomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {canEdit && <button type="button" className="btn btn-primary btn-sm" disabled={!activeTypes.length} title={activeTypes.length ? undefined : 'מגדירים קודם סוג חדר'} onClick={() => setAdding(true)}><Plus size={14} />הוספת חדרים</button>}
      </>
    )}>
      {rows.length ? <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} /> : <Empty title="אין חדרים">מוסיפים חדרים לפי קומה וסוג, גם כטווח (101-120).</Empty>}
      <AddRoomsDialog open={adding} onClose={() => setAdding(false)} propertyId={propertyId} types={activeTypes} onSaved={(n) => { setAdding(false); onSaved(`נוספו ${n} חדרים`); }} />
      <RoomDialog value={edit} onClose={() => setEdit(null)} propertyId={propertyId} types={activeTypes} onSaved={(m) => { setEdit(null); onSaved(m); }} />
    </Card>
  );
}

function AddRoomsDialog({ open, onClose, propertyId, types, onSaved }) {
  const save = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setF({ roomTypeId: types[0]?.id || '', floor: '1', numbers: '', isAccessible: false, isSmoking: false }); save.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const count = useMemo(() => {
    let n = 0;
    for (const part of String(f.numbers || '').split(/[,\s]+/).filter(Boolean)) {
      const m = part.match(/^([A-Za-z]*)(\d+)(?:-\1?(\d+))?$/);
      if (!m) return null;
      n += m[3] ? Math.max(0, Number(m[3]) - Number(m[2]) + 1) : 1;
    }
    return n;
  }, [f.numbers]);
  const submit = () => save.run(async () => { const out = await setup.addRooms(propertyId, f); onSaved(out.added); });
  return (
    <Modal open={open} onClose={onClose} busy={save.busy} title="הוספת חדרים" subtitle="חדרים חדשים נכנסים מיד לזמינות"
      footer={(
        <>
          {count === null && <span className="ui-foot-note">פורמט: 101-110, 115</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={save.busy}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={save.busy || !count || !f.roomTypeId} onClick={submit}>{save.busy ? <><Spinner /> מוסיף…</> : `הוספת ${count || ''} חדרים`}</button>
        </>
      )}>
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        <div className="ui-grid-2">
          <Field id="ar-type" label="סוג חדר" required error={save.fields.roomTypeId}><select id="ar-type" className="input w-full" value={f.roomTypeId || ''} onChange={set('roomTypeId')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field id="ar-floor" label="קומה" required error={save.fields.floor}><input id="ar-floor" className="input w-full" inputMode="numeric" value={f.floor || ''} onChange={set('floor')} /></Field>
        </div>
        <Field id="ar-n" label="מספרי חדרים" required error={save.fields.numbers} hint="מספר בודד, רשימה או טווח: 101-110, 115"><input id="ar-n" className="input w-full" dir="ltr" value={f.numbers || ''} onChange={set('numbers')} /></Field>
        <div className="ui-row" style={{ gap: 16 }}>
          <label className="ui-check"><input type="checkbox" checked={!!f.isAccessible} onChange={set('isAccessible')} /><span>נגישים</span></label>
          <label className="ui-check"><input type="checkbox" checked={!!f.isSmoking} onChange={set('isSmoking')} /><span>למעשנים</span></label>
        </div>
      </div>
    </Modal>
  );
}

function RoomDialog({ value, onClose, propertyId, types, onSaved }) {
  const save = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (value) { setF(value); save.reset(); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = (extra = {}) => save.run(async () => {
    await setup.updateRoom(propertyId, value.id, { number: f.number, floor: f.floor, roomTypeId: f.roomTypeId, isAccessible: f.isAccessible, isSmoking: f.isSmoking, isVip: f.isVip, internalNotes: f.internalNotes, ...extra });
    onSaved(extra.active === false ? `חדר ${f.number} הושבת` : extra.active ? `חדר ${f.number} הופעל` : `חדר ${f.number} נשמר`);
  });
  return (
    <Modal open={!!value} onClose={onClose} busy={save.busy} title={`חדר ${value?.number || ''}`}
      footer={(
        <>
          {value && (value.active
            ? <button type="button" className="btn btn-danger" disabled={save.busy} onClick={() => submit({ active: false })}>השבתת החדר</button>
            : <button type="button" className="btn btn-secondary" disabled={save.busy} onClick={() => submit({ active: true })}>הפעלה מחדש</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={save.busy}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={save.busy} onClick={() => submit()}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}>
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        <div className="ui-grid-2">
          <Field id="rm-n" label="מספר" required error={save.fields.number}><input id="rm-n" className="input w-full" dir="ltr" maxLength={10} value={f.number || ''} onChange={set('number')} /></Field>
          <Field id="rm-f" label="קומה" required error={save.fields.floor}><input id="rm-f" className="input w-full" inputMode="numeric" value={f.floor ?? ''} onChange={set('floor')} /></Field>
        </div>
        <Field id="rm-t" label="סוג חדר" error={save.fields.roomTypeId} hint="שינוי סוג משנה את הזמינות; לא אפשרי כשמשובצות בחדר הזמנות פתוחות">
          <select id="rm-t" className="input w-full" value={f.roomTypeId || ''} onChange={set('roomTypeId')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </Field>
        <div className="ui-row" style={{ gap: 16 }}>
          <label className="ui-check"><input type="checkbox" checked={!!f.isAccessible} onChange={set('isAccessible')} /><span>נגיש</span></label>
          <label className="ui-check"><input type="checkbox" checked={!!f.isSmoking} onChange={set('isSmoking')} /><span>מעשנים</span></label>
          <label className="ui-check"><input type="checkbox" checked={!!f.isVip} onChange={set('isVip')} /><span>VIP</span></label>
        </div>
        <Field id="rm-notes" label="הערה פנימית" optional><input id="rm-notes" className="input w-full" maxLength={500} value={f.internalNotes || ''} onChange={set('internalNotes')} /></Field>
      </div>
    </Modal>
  );
}
