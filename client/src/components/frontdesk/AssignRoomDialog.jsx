// INV-02 — pick a room that is free for every night of the stay unit.
// Cleanliness, operational status and occupancy are shown as separate facts; the server
// re-checks the full range on save and answers with a conflict if the room was taken meanwhile.
import { useEffect, useMemo, useState } from 'react';
import { frontdesk } from '../../utils/api';
import AssignRoomStudio from './AssignRoomStudio';

const PICKERS = ['sheet', 'seatmap', 'twopane', 'quick', 'today'];

// The dialog shows in the approved Today look ('today') everywhere; the design page can still pick
// one of the other AssignRoomStudio layouts through `appearance`.
export default function AssignRoomDialog({ open, propertyId, row, onClose, onAssigned, appearance }) {
  const picker = PICKERS.includes(appearance) ? appearance : 'today';
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

  async function save(roomId = selected) {
    setSaving(true); setSaveError(null); setFieldErrors({});
    try {
      const out = await frontdesk.assignRoom(propertyId, row.reservationId, { unitId: row.unitId || undefined, roomId, reason: reason || undefined });
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
    <AssignRoomStudio key={open ? row?.key : 'closed'} variant={picker} open={open} onClose={onClose} row={row} data={data} candidates={candidates}
      loading={loading} loadError={loadError} onRetry={() => setReloadKey((k) => k + 1)} saveError={saveError} fieldErrors={fieldErrors}
      allTypes={allTypes} setAllTypes={setAllTypes} selected={selected} setSelected={setSelected} chosen={chosen}
      save={save} saving={saving} disabledReason={disabledReason} replacing={replacing} reason={reason} setReason={setReason} typeChange={typeChange} />
  );
}
