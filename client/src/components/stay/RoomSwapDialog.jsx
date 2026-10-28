import { useEffect, useRef, useState } from 'react';
import { Modal, Field, ErrorBanner, Banner, Spinner, KeyValues } from '../kit';
import { stay } from '../../utils/api';

const label = (u) => `${u.guest} · חדר ${u.roomNumber} · ${u.confirmationNumber || ''}`;
const selection = (u) => ({ reservationId: u.reservationId, unitId: u.unitId, roomId: u.roomId });

export default function RoomSwapDialog({ open, onClose, propertyId, reservationId, onDone }) {
  const storageKey = `hotel4u.swap.pending:${propertyId}:${reservationId}`;
  const [pending, setPending] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; }
  });
  const [options, setOptions] = useState(null), [firstId, setFirstId] = useState(''), [second, setSecond] = useState(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0);
  const [plan, setPlan] = useState(pending?.plan || null), [reason, setReason] = useState('');
  const [consent, setConsent] = useState(false), [turnover, setTurnover] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const alive = useRef(false), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open || pending) return;
    let current = true;
    setLoading(true); setError(null);
    stay.swapOptions(propertyId, reservationId, query).then((data) => {
      if (!current) return;
      setOptions(data);
      setFirstId((old) => data.source.some((u) => u.unitId === old) ? old : data.source[0]?.unitId || '');
    }).catch((e) => { if (current) setError(e); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, propertyId, reservationId, query, refresh, pending]);
  const first = options?.source.find((u) => u.unitId === firstId);
  const candidates = options?.candidates.filter((u) => u.unitId !== firstId && u.roomId !== first?.roomId) || [];
  const resetPlan = () => { setPlan(null); setError(null); setConsent(false); setTurnover(false); };

  async function preview() {
    if (!first || !second || running.current) return;
    running.current = true; setBusy(true); setError(null); setPlan(null);
    try {
      const next = await stay.swapPreview(propertyId, { first: selection(first), second: selection(second) });
      if (alive.current) { setPlan(next); setConsent(false); setTurnover(false); }
    } catch (e) { if (alive.current) setError(e); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  function remember(value) {
    // Retain the exact request across closing/reopening after a lost response.
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
    setPending(value);
  }
  async function commit() {
    if (running.current || (!pending && (!plan?.ready || !consent || !turnover || reason.trim().length < 3))) return;
    running.current = true; setBusy(true); setError(null);
    try {
      const request = pending || { plan, input: { first: selection(plan.first), second: selection(plan.second), previewHash: plan.previewHash,
        requestKey: crypto.randomUUID(), reason: reason.trim(), guestConsentConfirmed: true, turnoverConfirmed: true } };
      // If session storage is unavailable, stop before sending an unrecoverable request.
      remember(request);
      const out = await stay.swap(propertyId, request.input);
      remember(null);
      if (alive.current) onDone(out);
    } catch (e) {
      if (!alive.current) return;
      setError(e);
      if (e.status >= 400 && e.status < 500) {
        remember(null); setPlan(null); setConsent(false); setTurnover(false); setRefresh((v) => v + 1);
      }
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  const locked = busy || !!pending;
  return <Modal open={open} onClose={onClose} title="החלפת חדרים בין אורחים" subtitle="שני החדרים מתחלפים יחד, להמשך השהייה" busy={busy} width={620}
    footer={<>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>סגירה</button>
      {pending
        ? <button type="button" className="btn btn-primary" disabled={busy} onClick={commit}>{busy && <Spinner />} בדיקת מצב ההחלפה</button>
        : plan?.ready
          ? <button type="button" className="btn btn-primary" disabled={busy || !consent || !turnover || reason.trim().length < 3} onClick={commit}>{busy && <Spinner />} אישור החלפת שני החדרים</button>
          : <button type="button" className="btn btn-primary" disabled={busy || loading || !first || !second} onClick={preview}>{busy && <Spinner />} בדיקת ההחלפה</button>}
    </>}>
    <div className="ui-stack">
      <ErrorBanner error={error} onRetry={!pending && !busy ? () => setRefresh((n) => n + 1) : undefined} />
      {pending && <Banner tone="warn">טרם התקבלה תשובה ודאית. בדקו את מצב ההחלפה לפני פעולה נוספת. הבקשה נשמרה בלשונית זו, וגם ניסיון חוזר יבצע אותה פעם אחת בלבד.</Banner>}
      {!pending && <>
        {loading && <div role="status"><Spinner /> טוען שוהים…</div>}
        <Field id="swap-source" label="האורח והחדר הנוכחי" required>
          <select id="swap-source" className="input" value={firstId} disabled={locked || loading} onChange={(e) => { setFirstId(e.target.value); setSecond(null); resetPlan(); }}>
            <option value="">בחרו יחידה שוהה</option>
            {options?.source.map((u) => <option key={u.unitId} value={u.unitId}>{label(u)}</option>)}
          </select>
        </Field>
        {options && !options.source.length && <Banner tone="warn">אין יחידה שוהה עם לילות שנותרו. יש לבדוק את תאריכי השהייה והשיבוץ.</Banner>}
        {options?.sourceTruncated && <Banner tone="warn">מוצגות 200 היחידות הראשונות בהזמנה זו.</Banner>}
        <form className="ui-row" onSubmit={(e) => { e.preventDefault(); if (!locked) { setQuery(search.trim()); setRefresh((n) => n + 1); } }}>
          <div style={{ flex: '1 1 220px' }}><Field id="swap-search" label="חיפוש האורח השני" hint="שם, מספר חדר או מספר אישור">
            <input id="swap-search" className="input" value={search} disabled={locked} onChange={(e) => setSearch(e.target.value)} aria-describedby="swap-search-hint" />
          </Field></div>
          <button type="submit" className="btn btn-secondary" disabled={locked || loading}>חיפוש</button>
        </form>
        <Field id="swap-target" label="החלפה עם" required>
          <select id="swap-target" className="input" value={second?.unitId || ''} disabled={locked || loading || !first} onChange={(e) => { setSecond(candidates.find((u) => u.unitId === e.target.value) || null); resetPlan(); }}>
            <option value="">בחרו אורח וחדר</option>
            {second && !candidates.some((u) => u.unitId === second.unitId) && <option value={second.unitId}>{label(second)}</option>}
            {candidates.map((u) => <option key={u.unitId} value={u.unitId}>{label(u)}</option>)}
          </select>
        </Field>
        {options && !loading && !candidates.length && <div className="ui-sub">לא נמצאו שוהים מתאימים בחיפוש זה.</div>}
        {options?.hasMore && <div className="ui-sub">מוצגות עד 100 יחידות. לחיפוש אורח נוסף צמצמו לפי שם, חדר או אישור.</div>}
      </>}
      {plan && <>
        <KeyValues rows={[
          [plan.first.guest, `מחדר ${plan.first.roomNumber} לחדר ${plan.second.roomNumber} · עד ${plan.first.departure}`],
          [plan.second.guest, `מחדר ${plan.second.roomNumber} לחדר ${plan.first.roomNumber} · עד ${plan.second.departure}`],
          ['תחילת ההחלפה', plan.businessDate],
        ]} />
        <Banner>{plan.note}</Banner>
        {plan.blockers.map((b, i) => <Banner tone="warn" key={`${b.code}:${i}`}>{b.message}</Banner>)}
        <Banner tone="warn">{plan.keys.message}. אישור ההחלפה אינו מפעיל את מערכת המנעולים.</Banner>
        {plan.ready && !pending && <>
          <Field id="swap-reason" label="סיבת ההחלפה" required hint="לפחות 3 תווים, לתיעוד בשתי ההזמנות">
            <textarea id="swap-reason" className="input" rows={2} maxLength={300} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} aria-describedby="swap-reason-hint" />
          </Field>
          <label className="ui-row"><input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} /> ההחלפה תואמה עם שני האורחים</label>
          <label className="ui-row"><input type="checkbox" checked={turnover} disabled={busy} onChange={(e) => setTurnover(e.target.checked)} /> תואמו פינוי החפצים והכנת שני החדרים למסירה</label>
          <div className="ui-sub">הפעולה אינה מבצעת ניקיון. שני החדרים חייבים להיות מוכנים וללא משימת משק בית פתוחה.</div>
        </>}
      </>}
    </div>
  </Modal>;
}
