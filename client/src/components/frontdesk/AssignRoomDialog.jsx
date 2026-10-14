// INV-02 — pick a room that is free for every night of the stay unit.
// Cleanliness, operational status and occupancy are shown as separate facts; the server
// re-checks the full range on save and answers with a conflict if the room was taken meanwhile.
import { useEffect, useMemo, useState } from 'react';
import { frontdesk } from '../../utils/api';
import { cleanLabel, opsLabel } from '../../lib/labels';
import { formatShort } from '../../utils/date';
import { Modal, Field, Spinner, ErrorBanner } from '../kit';

export default function AssignRoomDialog({ open, propertyId, row, onClose, onAssigned }) {
  const [allTypes, setAllTypes] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !row) return;
    let alive = true;
    setLoading(true); setLoadError(null);
    frontdesk.roomCandidates(propertyId, row.reservationId, { unitId: row.unitId || undefined, allTypes: allTypes ? '1' : undefined })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setLoadError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, row, propertyId, allTypes, reloadKey]);

  useEffect(() => {
    if (open) { setSelected(null); setReason(''); setSaveError(null); setFieldErrors({}); setAllTypes(false); }
  }, [open, row?.key]);

  const candidates = useMemo(() => {
    const list = data?.candidates || [];
    // Ready now first, then assignable, then the rest; stable by floor/number.
    const rank = (c) => (c.current ? 0 : c.readyNow ? 1 : c.assignable ? 2 : 3);
    return [...list].sort((a, b) => rank(a) - rank(b) || a.floor - b.floor || String(a.number).localeCompare(String(b.number), 'he', { numeric: true }));
  }, [data]);

  const replacing = !!(data?.currentRoomId && selected && selected !== data.currentRoomId);
  const chosen = candidates.find((c) => c.id === selected);
  const typeChange = chosen && !chosen.sameType;

  async function save() {
    setSaving(true); setSaveError(null); setFieldErrors({});
    try {
      const out = await frontdesk.assignRoom(propertyId, row.reservationId, { unitId: row.unitId || undefined, roomId: selected, reason: reason || undefined });
      onAssigned?.(out);
    } catch (e) {
      setFieldErrors(e.fields || {});
      setSaveError(e.message);
      if (e.status === 409) setReloadKey((k) => k + 1); // show the current picture after a conflict
    } finally {
      setSaving(false);
    }
  }

  const disabledReason = !selected ? 'יש לבחור חדר'
    : selected === data?.currentRoomId ? 'זה החדר המשובץ כעת'
      : replacing && reason.trim().length < 3 ? 'החלפת שיבוץ מחייבת סיבה' : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      width={720}
      title={`שיבוץ חדר — ${row?.guest?.name || ''}`}
      subtitle={data ? `${row?.confirmationNumber} · ${formatShort(data.range.from)}–${formatShort(data.range.to)} · ${data.range.nights} לילות · ${data.roomType?.name || ''}` : row?.confirmationNumber}
      footer={(
        <>
          {disabledReason && selected !== null && <span className="ui-foot-note">{disabledReason}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!!disabledReason || saving} title={disabledReason || undefined}>
            {saving ? <><Spinner /> שומר…</> : replacing ? 'החלפת שיבוץ' : 'אישור שיבוץ'}
          </button>
        </>
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[13px] text-[rgb(var(--fg-muted))]">מוצגים חדרים פנויים לכל הלילות. ניקיון ותפעול מוצגים בנפרד — חדר נקי עם חסימה אינו ניתן לשיבוץ.</p>
        <label className="flex items-center gap-2 text-[13px] whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={allTypes} onChange={(e) => setAllTypes(e.target.checked)} />
          כל סוגי החדרים
        </label>
      </div>

      <ErrorBanner error={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      {saveError && <ErrorBanner error={saveError} />}

      {loading && !data ? (
        <div className="ui-empty"><Spinner /> טוען חדרים…</div>
      ) : candidates.length === 0 && !loadError ? (
        <div className="ui-empty">
          <strong>אין חדרים מסוג זה בנכס</strong>
          אפשר להציג את כל סוגי החדרים.
        </div>
      ) : (
        <div className="ui-table-wrap" style={{ maxHeight: 360 }}>
          <table className="ui-table" aria-label="חדרים לשיבוץ">
            <thead>
              <tr>
                <th scope="col" style={{ width: 36 }}><span className="sr-only">בחירה</span></th>
                <th scope="col">חדר</th>
                <th scope="col">סוג</th>
                <th scope="col">ניקיון</th>
                <th scope="col">תפעול</th>
                <th scope="col">זמינות לטווח</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const disabled = !c.assignable && !c.current;
                return (
                  <tr key={c.id} className={`${selected === c.id ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`} onClick={() => !disabled && setSelected(c.id)}>
                    <td>
                      <input
                        type="radio"
                        name="room"
                        aria-label={`חדר ${c.number}`}
                        checked={selected === c.id}
                        disabled={disabled}
                        onChange={() => setSelected(c.id)}
                      />
                    </td>
                    <td className="font-medium tabular-nums">{c.number}<span className="text-[rgb(var(--fg-muted))] font-normal"> · קומה {c.floor}</span></td>
                    <td>{c.roomType?.name || '—'}{!c.sameType && <span className="ui-tag is-warn">סוג אחר</span>}</td>
                    <td><span className={`ui-dot-label ${['clean', 'inspected'].includes(c.cleanStatus) ? 'is-ok' : 'is-warn'}`}>{cleanLabel(c.cleanStatus)}</span></td>
                    <td><span className={`ui-dot-label ${c.opsStatus === 'available' ? 'is-ok' : 'is-bad'}`}>{opsLabel(c.opsStatus)}</span></td>
                    <td>
                      {c.current ? <span className="ui-tag">משובץ כעת</span>
                        : c.conflict ? <span className="text-[rgb(var(--danger))]">תפוס ({c.conflict})</span>
                          : c.opsStatus !== 'available' ? <span className="text-[rgb(var(--danger))]">חסום</span>
                            : c.occupiedBy ? <span className="text-[rgb(180_83_9)]">פנוי לטווח · אורח קודם טרם יצא</span>
                              : c.readyNow ? <span className="text-[rgb(21_128_61)]">פנוי ומוכן</span>
                                : <span>פנוי לטווח</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {typeChange && (
        <div className="ui-banner is-warn mt-3">שיבוץ לסוג חדר אחר אינו משנה את המחיר. שינוי תעריף מתבצע בשינוי הזמנה.</div>
      )}

      {replacing && (
        <div className="mt-3">
          <Field id="assign-reason" label="סיבת החלפת השיבוץ" required error={fieldErrors.reason}>
            <input id="assign-reason" className="input w-full" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={!!fieldErrors.reason} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
