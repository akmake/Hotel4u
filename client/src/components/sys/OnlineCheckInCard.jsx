// Online check-in settings (hotel setup → "צ׳ק-אין מקוון"): on/off, the link inside the day-before
// reminder e-mail, and the paid extras offered to the guest (price, charge code, time).
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { setup } from '../../utils/api';
import { Card, ErrorBanner, Banner, Spinner, useLoader, useAction } from '../kit';

const ADMIN = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager'];
const KINDS = [{ v: 'early_checkin', l: 'כניסה מוקדמת' }, { v: 'late_checkout', l: 'יציאה מאוחרת' }, { v: 'extra', l: 'תוספת' }];

export default function OnlineCheckInCard({ propertyId, role, onSaved }) {
  const canEdit = ADMIN.includes(role);
  const { data, loading, error, reload } = useLoader(async () => (propertyId && canEdit ? setup.checkin(propertyId) : null), [propertyId, canEdit]);
  const [f, setF] = useState(null);
  const save = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!canEdit) return <Card title="צ׳ק-אין מקוון"><Banner tone="info">ההגדרות פתוחות להנהלה ולמנהל ההכנסות.</Banner></Card>;
  if (loading && !f) return <Card title="צ׳ק-אין מקוון"><div className="ui-empty"><Spinner /> טוען…</div></Card>;
  if (!f) return <Card title="צ׳ק-אין מקוון"><ErrorBanner error={error} onRetry={reload} /></Card>;

  const e = save.fields || {};
  const setOffer = (i, k, v) => setF((x) => ({ ...x, offers: x.offers.map((o, j) => (j === i ? { ...o, [k]: v } : o)) }));
  const add = () => setF((x) => ({ ...x, offers: [...x.offers, { key: `x${Date.now().toString(36)}`, kind: 'extra', label: '', description: '', price: 0, chargeCode: x.chargeCodes.find((c) => c.code === 'other')?.code || x.chargeCodes[0]?.code || '', time: '', active: true }] }));
  const remove = (i) => setF((x) => ({ ...x, offers: x.offers.filter((_, j) => j !== i) }));
  const submit = () => save.run(async () => {
    const out = await setup.saveCheckin(propertyId, { enabled: f.enabled, autoSend: f.autoSend, offers: f.offers.map((o) => ({ ...o, price: Number(o.price) })) });
    setF(out);
    onSaved(out.enabled ? 'הגדרות הצ׳ק-אין המקוון נשמרו' : 'נשמר — הצ׳ק-אין המקוון כבוי');
  });

  return (
    <Card title="צ׳ק-אין מקוון" actions={<button type="button" className="btn btn-primary btn-sm" disabled={save.busy} onClick={submit}>{save.busy ? <><Spinner /> שומר…</> : 'שמירה'}</button>}>
      <div className="ui-stack">
        <ErrorBanner error={save.error} />
        <label className="ui-check"><input type="checkbox" checked={f.enabled} onChange={(ev) => setF((x) => ({ ...x, enabled: ev.target.checked }))} /><span><b>צ׳ק-אין מקוון פעיל</b> — האורח ממלא פרטים, מסמך וחתימה מראש; בקבלה רק מאמתים את המסמך</span></label>
        <label className="ui-check"><input type="checkbox" checked={f.autoSend} disabled={!f.enabled} onChange={(ev) => setF((x) => ({ ...x, autoSend: ev.target.checked }))} /><span>לצרף את הקישור למייל התזכורת שנשלח יום לפני ההגעה</span></label>
        <div className="ui-sub">אפשר גם לשלוח קישור ידנית מכל שורה במסך ההגעות (העתקה לווטסאפ או שליחה בדוא״ל).</div>

        <div className="ui-section-title">תוספות בתשלום שמוצעות לאורח</div>
        {!f.configured && <Banner tone="warn">אלו הצעות פתיחה וכבויות. קבעו מחיר, סמנו "פעיל" ושמרו — רק אז הן יוצגו לאורחים.</Banner>}
        <div className="ui-sub">האורח רק מבקש; הקבלה מאשרת לפי זמינות, והחיוב נרשם לחשבון בכניסה. דבר לא נגבה באינטרנט.</div>
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead><tr><th scope="col">פעיל</th><th scope="col">סוג</th><th scope="col">שם לאורח</th><th scope="col">שעה</th><th scope="col">מחיר ₪</th><th scope="col">קוד חיוב</th><th scope="col"><span className="sr-only">הסרה</span></th></tr></thead>
            <tbody>
              {f.offers.map((o, i) => (
                <tr key={o.key}>
                  <td><input type="checkbox" checked={o.active} aria-label="פעיל" onChange={(ev) => setOffer(i, 'active', ev.target.checked)} /></td>
                  <td><select className="input" value={o.kind} onChange={(ev) => setOffer(i, 'kind', ev.target.value)}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}</select></td>
                  <td>
                    <input className="input w-full" maxLength={80} value={o.label} aria-invalid={!!e[`offers.${i}.label`]} onChange={(ev) => setOffer(i, 'label', ev.target.value)} placeholder="למשל: בקבוק יין בחדר" />
                    <input className="input w-full mt-1" maxLength={300} value={o.description} onChange={(ev) => setOffer(i, 'description', ev.target.value)} placeholder="תיאור קצר (לא חובה)" />
                    {e[`offers.${i}.label`] && <div className="ui-error">{e[`offers.${i}.label`]}</div>}
                  </td>
                  <td>{o.kind !== 'extra' ? <><input type="time" className="input" value={o.time} onChange={(ev) => setOffer(i, 'time', ev.target.value)} />{e[`offers.${i}.time`] && <div className="ui-error">{e[`offers.${i}.time`]}</div>}</> : '—'}</td>
                  <td><input className="input" style={{ width: 90 }} inputMode="decimal" value={o.price} onChange={(ev) => setOffer(i, 'price', ev.target.value)} />{e[`offers.${i}.price`] && <div className="ui-error">{e[`offers.${i}.price`]}</div>}</td>
                  <td><select className="input" value={o.chargeCode} onChange={(ev) => setOffer(i, 'chargeCode', ev.target.value)}>{f.chargeCodes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>{e[`offers.${i}.chargeCode`] && <div className="ui-error">{e[`offers.${i}.chargeCode`]}</div>}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`הסרת ${o.label || 'תוספת'}`} onClick={() => remove(i)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" style={{ width: 'fit-content' }} onClick={add}><Plus size={14} /> הוספת תוספת</button>
        {f.updatedByName && <div className="ui-sub">עודכן לאחרונה על ידי {f.updatedByName}</div>}
      </div>
    </Card>
  );
}
