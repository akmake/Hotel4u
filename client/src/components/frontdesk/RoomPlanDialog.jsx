// Automatic room assignment for the day's arrivals without a room. The server proposes a room per
// stay unit and says why; the desk keeps or swaps each pick and applies the checked rows in one go.
// Every applied row is a normal assignment — the server re-checks it, so a row that lost its room
// meanwhile comes back as a failure and the rest still go through.
import { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import { frontdesk } from '../../utils/api';
import { Modal, Spinner, ErrorBanner } from '../kit';

const CLEAN = { clean: 'נקי', inspected: 'נבדק', dirty: 'מלוכלך', cleaning: 'בניקיון' };

export default function RoomPlanDialog({ open, propertyId, date, onClose, onApplied }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState({}); // row key → room id ('' = skip)
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !propertyId) return;
    let alive = true;
    setLoading(true); setError(null);
    frontdesk.roomPlan(propertyId, date)
      .then((d) => {
        if (!alive) return;
        setPlan(d);
        setChoice(Object.fromEntries(d.rows.map((r) => [r.key, r.proposal?.id || ''])));
      })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, propertyId, date, reloadKey]);

  useEffect(() => { if (open) setFailed([]); }, [open]);

  const rows = plan?.rows || [];
  // A room picked for two rows by hand would fail on the second; flag it before saving.
  const picked = Object.values(choice).filter(Boolean);
  const dup = new Set(picked.filter((id, i) => picked.indexOf(id) !== i));
  const items = rows.filter((r) => choice[r.key]).map((r) => ({ key: r.key, reservationId: r.reservationId, unitId: r.unitId, unitIndex: r.unitIndex, roomId: choice[r.key] }));
  const failedByKey = new Map(failed.map((f) => [f.key, f.error]));

  async function apply() {
    setSaving(true); setError(null);
    try {
      const out = await frontdesk.applyRoomPlan(propertyId, items);
      if (out.failed.length) {
        setFailed(out.failed);
        setReloadKey((k) => k + 1); // show the current picture for what is left
      }
      onApplied?.(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const options = (r) => [r.proposal, ...r.alternatives].filter(Boolean);
  const chosenOf = (r) => options(r).find((o) => o.id === choice[r.key]) || null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      width={880}
      title="שיבוץ חדרים אוטומטי"
      subtitle={plan ? `${plan.counts.unassigned} הגעות ללא חדר · ${plan.counts.proposed} הצעות · ${plan.counts.readyNow} חדרים מוכנים עכשיו` : 'הגעות היום ללא חדר'}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>סגירה</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={saving || loading || !items.length || dup.size > 0}>
            {saving ? <><Spinner /> משבץ…</> : `שיבוץ ${items.length} חדרים`}
          </button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      {loading && !plan ? <div className="flex items-center gap-2 ui-p"><Spinner /> מחשב הצעה…</div>
        : !rows.length ? <p className="ui-p">לכל ההגעות של היום כבר יש חדר.</p>
          : (
            <>
              <p className="ui-p mb-3">
                המערכת מעדיפה חדר נקי ופנוי, נותנת עדיפות ל-VIP ולמי שמגיע מוקדם, מכבדת העדפות קומה, עישון ונגישות,
                ומשבצת חדרי הזמנה מרובת חדרים באותה קומה. אפשר להחליף חדר או לבטל סימון לפני השיבוץ.
              </p>
              {dup.size > 0 && <div className="ui-tag is-warn mb-2">אותו חדר נבחר ליותר מהזמנה אחת</div>}
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">לשבץ</span></th>
                      <th scope="col">אורח</th>
                      <th scope="col">סוג</th>
                      <th scope="col">הגעה</th>
                      <th scope="col">חדר</th>
                      <th scope="col">למה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const c = chosenOf(r);
                      const err = failedByKey.get(r.key);
                      return (
                        <tr key={r.key}>
                          <td>
                            <input type="checkbox" aria-label={`לשבץ את ${r.guest.name}`} disabled={!r.proposal}
                              checked={!!choice[r.key]} onChange={(e) => setChoice((p) => ({ ...p, [r.key]: e.target.checked ? (r.proposal?.id || '') : '' }))} />
                          </td>
                          <td>
                            <div className="font-medium flex items-center gap-1">{r.guest.vip && <Crown size={13} aria-label="VIP" />}{r.guest.name}</div>
                            <div className="ui-muted text-xs">{r.confirmationNumber}{r.unitsTotal > 1 ? ` · חדר ${r.unitIndex} מתוך ${r.unitsTotal}` : ''} · {r.nights} לילות</div>
                          </td>
                          <td>{r.roomType?.name || '—'}</td>
                          <td className="tabular-nums">{r.eta || '—'}</td>
                          <td>
                            {r.proposal ? (
                              <select className="input" aria-label={`חדר עבור ${r.guest.name}`} value={choice[r.key] || r.proposal.id}
                                onChange={(e) => setChoice((p) => ({ ...p, [r.key]: e.target.value }))} style={{ minWidth: 150 }}>
                                {options(r).map((o) => (
                                  <option key={o.id} value={o.id}>{o.number} · קומה {o.floor} · {CLEAN[o.cleanStatus] || o.cleanStatus}{o.id === r.proposal.id ? ' (מומלץ)' : ''}</option>
                                ))}
                              </select>
                            ) : <span className="ui-tag is-warn">{r.noRoomReason}</span>}
                          </td>
                          <td className="text-xs">
                            {err ? <span className="ui-tag is-danger">{err}</span>
                              : c ? c.reasons.join(' · ') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
    </Modal>
  );
}
