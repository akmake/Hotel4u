import { useEffect, useRef, useState } from 'react';
import { Modal, Field, Banner, ErrorBanner, Spinner, KeyValues } from '../kit';
import { frontdesk } from '../../utils/api';
import { useAuthStore } from '../../stores/authStore';

const MANAGERS = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'housekeeping_manager'];
export default function CribDialog({ propertyId, reservationId, unitId, onClose, onChanged }) {
  const role = useAuthStore((s) => s.user?.role), canManage = MANAGERS.includes(role), canRequest = !['housekeeper', 'housekeeping_manager'].includes(role);
  const storageKey = `hotel4u.crib.pending:${propertyId}`;
  const [pending, setPending] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; } });
  const [selected, setSelected] = useState(pending?.selected || (unitId ? { reservationId, unitId } : null));
  const [desk, setDesk] = useState(null), [context, setContext] = useState(pending?.context || null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [generation, setGeneration] = useState(0);
  const [quantity, setQuantity] = useState('1'), [total, setTotal] = useState(''), [reason, setReason] = useState(''), [physical, setPhysical] = useState(false), [counted, setCounted] = useState(false);
  const alive = useRef(false), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (pending) return;
    let current = true; setLoading(true); setContext(null);
    Promise.all([frontdesk.cribDesk(propertyId, query), selected ? frontdesk.cribContext(propertyId, selected.reservationId, selected.unitId) : null]).then(([list, c]) => {
      if (!current) return; setDesk(list); setContext(c);
    }).catch((e) => { if (current) setError(e); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [propertyId, selected, query, generation, pending]);
  function remember(value) {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey);
    setPending(value);
  }
  async function submit(action) {
    if (running.current) return;
    const inventory = desk?.stock || context?.stock;
    if (!pending && (reason.trim().length < 3 || (action === 'stock' ? !counted || total === '' : !context || quantity === '') || (['deliver', 'collect'].includes(action) && !physical))) return;
    running.current = true; setBusy(true); setError(null); setNotice('');
    try {
      const request = pending || { action, selected, context, body: { action, requestKey: crypto.randomUUID(), reason: reason.trim(), expectedRevision: action === 'stock' ? inventory.revision : context.revision,
        ...(action === 'stock' ? { totalCount: Number(total), physicalCountConfirmed: true } : { quantity: Number(quantity), roomId: action === 'collect' ? context.deliveryRoom?.id : context.room?.id, physicalConfirmed: physical }) } };
      remember(request);
      const result = request.action === 'stock' ? await frontdesk.cribStock(propertyId, request.body) : await frontdesk.cribAction(propertyId, request.selected.reservationId, request.selected.unitId, request.body);
      remember(null);
      if (!alive.current) return;
      setNotice(result.duplicate ? 'הפעולה כבר נרשמה קודם; לא בוצעה שוב' : 'הפעולה נרשמה');
      setPhysical(false); setCounted(false); setReason(''); setGeneration((v) => v + 1); onChanged?.();
    } catch (e) {
      if (!alive.current) return; setError(e);
      // Busy/transport/auth failures can occur after an earlier attempt committed: retain its key.
      if (e.status === 422 || e.status === 404 || (e.status === 409 && !['busy', 'lock_expired'].includes(e.code))) {
        remember(null); setGeneration((v) => v + 1); setPhysical(false); setCounted(false);
      }
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  const inventory = pending?.context?.stock || desk?.stock || context?.stock;
  const locked = busy || loading || !!pending;
  const validQty = quantity !== '' && Number.isInteger(Number(quantity)) && Number(quantity) >= 0 && Number(quantity) <= 100;
  const ready = !locked && reason.trim().length >= 3 && validQty;
  return <Modal open onClose={onClose} title="לולים — בקשות, מסירה והחזרה" subtitle="מלאי פיזי זמין כעת; בקשה אינה שומרת מלאי לתאריך עתידי" busy={busy} width={760}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>סגירה</button>{pending && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit(pending.action)}>{busy && <Spinner />} בדיקת מצב הפעולה</button>}</>}>
    <div className="ui-stack">
      <ErrorBanner error={error} />
      {notice && <Banner tone="good">{notice}</Banner>}
      {pending && <Banner tone="warn">טרם התקבלה תשובה ודאית. הבקשה נשמרה בלשונית זו. בדקו את מצב הפעולה; ניסיון חוזר משתמש באותה בקשה ואינו מוסר או מחזיר לול פעמיים.</Banner>}
      {loading && <div role="status"><Spinner /> טוען נתוני לולים…</div>}
      {inventory && !pending && <KeyValues rows={[
        ['מלאי שנספר במלון', inventory.configured ? inventory.total : 'לא הוזן'],
        ['טרם הוחזרו', inventory.outstanding], ['זמינים כעת', inventory.availableNow ?? 'לא ידוע'],
      ]} />}
      <Banner>מסירה והחזרה הן הצהרת עובד על פעולה פיזית. ביטול הזמנה, יציאה או מעבר חדר אינם מחזירים ציוד למלאי. אין חיוב אוטומטי.</Banner>
      {!pending && <>
        <form className="ui-row" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setGeneration((v) => v + 1); }}>
          <div style={{ flex: '1 1 240px' }}><Field id="crib-search" label="חיפוש בקשות או לולים שטרם הוחזרו" hint="חדר נוכחי או קודם, שם היחידה או מספר אישור">
            <input id="crib-search" className="input" disabled={locked} value={search} onChange={(e) => setSearch(e.target.value)} aria-describedby="crib-search-hint" />
          </Field></div><button type="submit" className="btn btn-secondary" disabled={locked}>חיפוש</button>
        </form>
        <div className="ui-stack" style={{ gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {desk?.rows.map((row) => row.orphaned ? <Banner tone="warn" key={row.requestId}>{row.message} · {row.outstanding} לולים</Banner> : <button type="button" className="btn btn-secondary" style={{ whiteSpace: 'normal', textAlign: 'right', justifyContent: 'flex-start' }} disabled={locked} key={row.unitId}
            onClick={() => { setSelected({ reservationId: row.reservationId, unitId: row.unitId }); setPhysical(false); setNotice(''); setError(null); }}>
            {row.guest} · חדר {row.room?.number || 'לא משובץ'} · התבקשו {row.cribs.requested} · נמסרו וטרם הוחזרו {row.cribs.delivered}{row.deliveryRoom ? ` · נמסרו בחדר ${row.deliveryRoom.number}` : ''}{!row.active ? ' · השהייה הסתיימה' : ''}
          </button>)}
          {desk && !desk.rows.length && <div className="ui-sub">אין בקשות פעילות או לולים שטרם הוחזרו בחיפוש זה. בקשה חדשה נפתחת מתוך שורת הגעה עם יחידה מתועדת.</div>}
          {desk?.hasMore && <Banner tone="warn">מוצגות עד 200 רשומות. צמצמו בחיפוש כדי למצוא רשומה נוספת.</Banner>}
        </div>
      </>}
      {context && <section className="ui-stack" aria-label="טיפול בלולים ליחידה">
        {pending && <div className="ui-sub">פרטי הבקשה השמורה לפני הפעולה; הכמות הנוכחית תיטען לאחר בדיקת המצב.</div>}
        <KeyValues rows={[
          ['יחידה', `${context.guest} · ${context.confirmationNumber}`], ['חדר נוכחי', context.room?.number || 'לא משובץ'],
          ['בקשה', context.cribs.requested ?? 'לא מתועד'], ['נמסרו וטרם הוחזרו', context.cribs.delivered ?? 0], ['חדר המסירה', context.deliveryRoom?.number || 'לא נמסר'],
        ]} />
        {context.cribs.status === 'collection_required' && <Banner tone="warn">נדרשת בדיקת איסוף מהחדר שבו הלולים נמסרו. הם עדיין תפוסים במלאי.</Banner>}
        {!pending && <>
          <Field id="crib-quantity" label="כמות לפעולה" hint="בעדכון בקשה: הכמות המבוקשת הכוללת. במסירה או בהחזרה: הכמות שמוסרים או מחזירים כעת.">
            <input id="crib-quantity" className="input" type="number" min={0} max={100} step={1} value={quantity} disabled={locked} onChange={(e) => setQuantity(e.target.value)} aria-describedby="crib-quantity-hint" />
          </Field>
          <label className="ui-row"><input type="checkbox" checked={physical} disabled={locked} onChange={(e) => setPhysical(e.target.checked)} /> אני מאשר/ת שהמסירה לחדר הנוכחי או האיסוף מחדר המסירה בוצעו בפועל</label>
        </>}
      </section>}
      {!pending && <>
        <Field id="crib-reason" label="סיבה לתיעוד הפעולה" required hint="3–300 תווים; ללא פרטים רפואיים או מידע רגיש מיותר">
          <input id="crib-reason" className="input" maxLength={300} value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} aria-describedby="crib-reason-hint" />
        </Field>
        {context && <div className="ui-row">
          {canRequest && <button type="button" className="btn btn-secondary" disabled={!ready || !context.active} onClick={() => submit('request')}>עדכון כמות מבוקשת</button>}
          <button type="button" className="btn btn-primary" disabled={!ready || !physical || Number(quantity) < 1 || !context.active || !context.room} onClick={() => submit('deliver')}>רישום מסירה בפועל</button>
          <button type="button" className="btn btn-secondary" disabled={!ready || !physical || Number(quantity) < 1 || !context.deliveryRoom} onClick={() => submit('collect')}>רישום החזרה למלאי</button>
        </div>}
        {canManage && <details><summary className="ui-link">עדכון מלאי המלון לאחר ספירה פיזית</summary><div className="ui-stack" style={{ marginTop: 10 }}>
          <Field id="crib-total" label="מספר הלולים הכולל במלון" required hint="כולל לולים שבחדרים; אי אפשר להפחית מתחת לכמות שטרם הוחזרה.">
            <input id="crib-total" className="input" type="number" min={0} max={10000} step={1} value={total} disabled={locked} onChange={(e) => setTotal(e.target.value)} aria-describedby="crib-total-hint" />
          </Field>
          <label className="ui-row"><input type="checkbox" checked={counted} disabled={locked} onChange={(e) => setCounted(e.target.checked)} /> הכמות אומתה בספירה פיזית</label>
          <button type="button" className="btn btn-secondary" disabled={locked || !counted || !inventory || reason.trim().length < 3 || total === '' || !Number.isInteger(Number(total)) || Number(total) < 0 || Number(total) > 10000} onClick={() => submit('stock')}>שמירת ספירת מלאי</button>
        </div></details>}
      </>}
    </div>
  </Modal>;
}
