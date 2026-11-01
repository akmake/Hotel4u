// Online check-in for one reservation, from the desk: the guest's link (copy / e-mail), whether the
// guest filled it in, and the paid extras they asked for — approve or decline each. An approved
// extra is charged to the guest folio once the stay is in house (right away, or at check-in).
import { useEffect, useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { frontdesk } from '../../utils/api';
import { Modal, Spinner, ErrorBanner, Tag, money } from '../kit';

const STATUS = { sent: 'הקישור נשלח — טרם נפתח', opened: 'האורח פתח את הקישור — טרם סיים', submitted: 'האורח השלים צ׳ק-אין מקוון' };
const UP = { requested: ['ממתין להחלטה', 'warn'], approved: ['אושר — יחויב בכניסה', 'good'], posted: ['אושר וחויב', 'good'], declined: ['נדחה', undefined] };
const when = (d) => (d ? new Date(d).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function OnlineCheckInDialog({ row, propertyId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [link, setLink] = useState(null);
  const [note, setNote] = useState(null);

  const load = () => frontdesk.onlineCheckIn(propertyId, row.reservationId).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    if (!row) return;
    setData(null); setError(null); setLink(null); setNote(null);
    load();
  }, [row?.reservationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function issue(via) {
    setBusy(via); setError(null); setNote(null);
    try {
      const out = await frontdesk.onlineCheckInLink(propertyId, row.reservationId, via);
      const url = `${window.location.origin}${out.path}`;
      setLink(url);
      if (via === 'email') setNote(out.email.sent ? 'הקישור נשלח לדוא״ל של האורח' : `לא נשלח: ${out.email.reason}. אפשר להעתיק ולשלוח בווטסאפ.`);
      else {
        try { await navigator.clipboard.writeText(url); setNote('הקישור הועתק — אפשר להדביק בווטסאפ או SMS'); } catch { setNote('העתיקו את הקישור מהשדה'); }
      }
      await load();
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function decide(u, decision) {
    let reason;
    if (decision === 'decline') {
      reason = window.prompt('סיבה (תוצג לאורח בקיצור, לא חובה)', 'לא זמין בתאריכים אלה') ?? null;
      if (reason === null) return;
    }
    setBusy(u.id); setError(null);
    try {
      const out = await frontdesk.decideUpsell(propertyId, row.reservationId, u.id, decision, reason);
      setData((d) => ({ ...d, online: out }));
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  const o = data?.online;
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      width={560}
      title="צ׳ק-אין מקוון"
      subtitle={row ? `${row.guest.name} · ${row.confirmationNumber}` : ''}
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>סגירה</button>}
    >
      <ErrorBanner error={error} />
      {!data && !error && <div className="flex items-center gap-2 ui-p"><Spinner /> טוען…</div>}
      {data && (
        <div className="ui-stack">
          <div className="ui-summary">
            <div className="ui-sum-row"><span>מצב</span><strong>{o ? STATUS[o.status] : 'טרם נשלח קישור'}</strong></div>
            {o?.sentAt && <div className="ui-sum-row"><span>נשלח</span><strong>{when(o.sentAt)}</strong></div>}
            {o?.submittedAt && <div className="ui-sum-row"><span>הושלם</span><strong>{when(o.submittedAt)}</strong></div>}
            {o?.eta && <div className="ui-sum-row"><span>שעת הגעה שמסר</span><strong>{o.eta}</strong></div>}
            {o?.requests && <div className="ui-sum-row"><span>בקשות</span><strong style={{ whiteSpace: 'pre-wrap', textAlign: 'start' }}>{o.requests}</strong></div>}
          </div>
          {o?.status === 'submitted' && <p className="ui-sub">פרטי המסמך כבר נקלטו. בכניסה יש לראות את המסמך ולסמן "נבדק" באשף — זה כל מה שנשאר.</p>}

          {['confirmed', 'modified', 'pending_payment', 'partially_checked_in'].includes(data.reservationStatus) && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => issue('link')}>{busy === 'link' ? <Spinner /> : <Copy size={14} />} העתקת קישור</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => issue('email')}>{busy === 'email' ? <Spinner /> : <Mail size={14} />} שליחה בדוא״ל</button>
            </div>
          )}
          {link && <input className="input w-full" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="קישור הצ׳ק-אין" />}
          {note && <div className="ui-sub">{note}</div>}

          {o?.upsells?.length > 0 && (
            <>
              <div className="ui-section-title">תוספות שהאורח ביקש</div>
              {o.upsells.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3" style={{ padding: '8px 0', borderTop: '1px solid rgb(var(--border, 226 232 240))' }}>
                  <div>
                    <div className="font-medium">{u.label}{u.time ? ` · ${u.time}` : ''} <span className="ui-num">{money(u.price)}</span></div>
                    <Tag tone={UP[u.status]?.[1]}>{UP[u.status]?.[0] || u.status}</Tag>
                    {u.decidedByName && <span className="ui-sub"> · {u.decidedByName}</span>}
                  </div>
                  {u.status === 'requested' && (
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => decide(u, 'decline')}>דחייה</button>
                      <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => decide(u, 'approve')}>{busy === u.id ? <Spinner /> : 'אישור'}</button>
                    </div>
                  )}
                </div>
              ))}
              <p className="ui-sub">אישור כניסה מוקדמת מעדכן את שעת ההגעה הצפויה; יציאה מאוחרת — את שעת העזיבה. החיוב נרשם לחשבון האורח בכניסה.</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
