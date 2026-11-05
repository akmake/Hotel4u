// Profile extras (gap-map item 16): relations, restriction rule, files, stays from a previous system, revenue by
// department, turned-away requests and the change log — one panel inside the guest record.
import { useState } from 'react';
import { profiles, guests as guestApi, api } from '../../utils/api';
import { useAuthStore } from '../../stores/authStore';

const KIND = { family: 'משפחה', company: 'חברה', assistant: 'עוזר/ת', colleague: 'עמית/ה', other: 'אחר' };
const RULE = { alert: 'התראה בלבד', manager_approval: 'הזמנה באישור מנהל', prepay_only: 'רק בתשלום מראש' };
const DEPT = { rooms: 'לינה', board: 'אירוח', f_and_b: 'מזון ומשקאות', minibar: 'מיני־בר', spa: 'ספא', parking: 'חניה', laundry: 'כביסה', other: 'שונות' };
const MANAGERS = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const money = (n) => `${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪`;
const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });

export default function ProfileExtras({ g, propertyId }) {
  const pid = propertyId || g.property;
  const role = useAuthStore((s) => s.user?.role);
  const manager = MANAGERS.includes(role);
  const [x, setX] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rel, setRel] = useState({ kind: 'family', q: '', hits: [], target: null, note: '' });
  const [rule, setRule] = useState({ rule: '', note: '' });
  const [past, setPast] = useState({ arrival: '', departure: '', amount: '', roomType: '' });
  const load = async () => { try { const d = await profiles.guest(pid, g._id); setX(d); setRule({ rule: d.restriction?.rule || '', note: d.restriction?.note || '' }); } catch (e) { setErr(e.message); } };
  if (x === null && !err) { setX(undefined); load(); }
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const findGuest = async () => { if (rel.q.trim().length < 2) return; try { const r = await guestApi.list(pid, { q: rel.q.trim(), limit: 6 }); setRel((p) => ({ ...p, hits: (r.guests || r.rows || r || []).filter((h) => String(h._id || h.id) !== String(g._id)).slice(0, 6) })); } catch { /* no hits */ } };
  const saveRelations = (list) => run(() => profiles.saveRelations(pid, g._id, list));
  const current = (x?.relations || []).map((r) => ({ kind: r.kind, guest: r.guest?.id, company: r.company?.id, note: r.note }));
  if (!x) return <p className="gr-empty">{err || 'טוען…'}</p>;
  return (
    <div className="gr-prefs" style={{ display: 'grid', gap: 14 }}>
      {err && <p className="gr-pref-text is-alert">{err}</p>}

      <section><b>קשרים</b>
        {x.relations.length ? <ul>{x.relations.map((r, i) => <li key={r.id}>{KIND[r.kind]}: {r.guest?.name || r.company?.name}{r.note ? ` · ${r.note}` : ''} <button type="button" className="gx-link" disabled={busy} onClick={() => saveRelations(current.filter((_, j) => j !== i))}>הסרה</button></li>)}</ul> : <p className="gr-empty">אין קשרים.</p>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label="סוג קשר" value={rel.kind} onChange={(e) => setRel((p) => ({ ...p, kind: e.target.value }))}>{Object.entries(KIND).filter(([k]) => k !== 'company').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input aria-label="חיפוש אורח לקישור" placeholder="שם / טלפון" value={rel.q} onChange={(e) => setRel((p) => ({ ...p, q: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') findGuest(); }} />
          <button type="button" className="gx-btn" onClick={findGuest}>חיפוש</button>
        </div>
        {rel.hits.map((h) => <button key={h._id || h.id} type="button" className="gx-link" disabled={busy} onClick={() => { saveRelations([...current, { kind: rel.kind, guest: String(h._id || h.id) }]); setRel((p) => ({ ...p, hits: [], q: '' })); }}>+ {h.firstName} {h.lastName}</button>)}
      </section>

      <section><label className="gx-check"><input type="checkbox" checked={!!x.isContact} disabled={busy} onChange={(e) => run(() => guestApi.update(g._id, { isContact: e.target.checked }))} /> איש קשר / מארגן (לא לן במלון) — אפשר לבחור אותו בהזמנה ובקבוצה</label></section>

      <section><b>הגבלת לקוח</b>
        {x.restriction ? <p className="gr-pref-text is-alert">{RULE[x.restriction.rule]} — {x.restriction.note} ({x.restriction.byName})</p> : <p className="gr-empty">ללא הגבלה.</p>}
        {manager && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select aria-label="כלל" value={rule.rule} onChange={(e) => setRule((p) => ({ ...p, rule: e.target.value }))}><option value="">ללא</option>{Object.entries(RULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input aria-label="הסבר" placeholder="הסבר" value={rule.note} onChange={(e) => setRule((p) => ({ ...p, note: e.target.value }))} />
          <button type="button" className="gx-btn" disabled={busy} onClick={() => run(() => profiles.setRestriction(pid, g._id, { rule: rule.rule || null, note: rule.note }))}>שמירה</button>
        </div>}
      </section>

      <section><b>קבצים</b>
        {x.files.length ? <ul>{x.files.map((f) => <li key={f.id}><button type="button" className="gx-link" onClick={async () => { const blob = await api.blob(`/profiles/files/${f.id}?propertyId=${pid}`); window.open(URL.createObjectURL(blob), '_blank'); }}>{f.name}</button> <span className="gx-dash">{Math.round(f.size / 1024)}KB · {f.by}</span> <button type="button" className="gx-link" disabled={busy} onClick={() => run(() => profiles.removeFile(pid, f.id))}>הסרה</button></li>)}</ul> : <p className="gr-empty">אין קבצים.</p>}
        <input type="file" aria-label="צירוף קובץ" accept="application/pdf,image/*,text/plain" disabled={busy} onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; e.target.value = ''; run(async () => profiles.addFile(pid, g._id, { name: file.name, mime: file.type, data: await toB64(file) })); }} />
      </section>

      <section><b>הכנסה לפי מחלקות</b>
        {x.revenueByDepartment.length ? <dl>{x.revenueByDepartment.map((d) => <div key={d.department}><dt>{DEPT[d.department] || d.department}</dt><dd>{money(d.amount)}</dd></div>)}</dl> : <p className="gr-empty">אין חיובים.</p>}
      </section>

      <section><b>שהיות ממערכת קודמת</b>
        {x.pastStays.length ? <ul>{x.pastStays.map((s) => <li key={s.id}>{s.arrival} – {s.departure} · {s.nights} לילות{s.roomType ? ` · ${s.roomType}` : ''} · {money(s.amount)}</li>)}</ul> : <p className="gr-empty">אין.</p>}
        {manager && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input aria-label="הגעה" type="date" value={past.arrival} onChange={(e) => setPast((p) => ({ ...p, arrival: e.target.value }))} />
          <input aria-label="עזיבה" type="date" value={past.departure} onChange={(e) => setPast((p) => ({ ...p, departure: e.target.value }))} />
          <input aria-label="סכום" type="number" placeholder="סכום" value={past.amount} onChange={(e) => setPast((p) => ({ ...p, amount: e.target.value }))} />
          <input aria-label="סוג חדר" placeholder="סוג חדר" value={past.roomType} onChange={(e) => setPast((p) => ({ ...p, roomType: e.target.value }))} />
          <button type="button" className="gx-btn" disabled={busy} onClick={() => run(async () => { await profiles.addPastStay(pid, g._id, { ...past, amount: Number(past.amount || 0) }); setPast({ arrival: '', departure: '', amount: '', roomType: '' }); })}>הוספה</button>
        </div>}
      </section>

      {x.turnaways.length > 0 && <section><b>פניות שנדחו</b><ul>{x.turnaways.map((t, i) => <li key={i}>{t.date} · {t.nights} לילות · {t.reason}</li>)}</ul></section>}

      <section><b>יומן שינויים</b>
        {x.history.length ? <ul>{x.history.slice(0, 15).map((h, i) => <li key={i}><span className="gx-dash">{new Date(h.at).toLocaleString('he-IL')}</span> · {h.by} · {h.action}{h.reason ? ` — ${h.reason}` : ''}</li>)}</ul> : <p className="gr-empty">אין שינויים רשומים.</p>}
      </section>
    </div>
  );
}
