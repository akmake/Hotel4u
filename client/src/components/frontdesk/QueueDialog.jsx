// FD-04 entry: record that the guest is physically here and why the unit can't enter yet.
// Arrival time is set by the server. Queueing does not change the reservation or the room.
import { useEffect, useMemo, useState } from 'react';
import { frontdesk } from '../../utils/api';
import { QUEUE_REASON_LABELS } from '../../lib/labels';
import { roleLabel } from '../../lib/labels';
import { Modal, Field, Spinner, ErrorBanner } from '../kit';

// Suggest the delay reason from the server's readiness reasons.
function suggestReason(row) {
  const codes = (row?.readiness?.reasons || []).map((r) => r.code);
  if (codes.includes('no_room')) return 'assignment';
  if (codes.includes('room_blocked')) return 'maintenance';
  if (codes.includes('room_occupied')) return 'occupied';
  if (codes.includes('not_inspected')) return 'inspection';
  if (codes.includes('room_dirty')) return 'cleaning';
  return '';
}

export default function QueueDialog({ open, propertyId, row, currentUser, isManager, onClose, onQueued }) {
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm({ reason: suggestReason(row), ownerId: currentUser?._id || '', priority: 'normal', guestContact: 'desk', readyEta: '', notes: '' });
    setError(null); setFields({});
    frontdesk.staff(propertyId).then(setStaff).catch(() => setStaff([]));
  }, [open, row?.key, propertyId, currentUser?._id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // datetime-local gives local wall time; send an ISO instant.
  const etaIso = useMemo(() => (form.readyEta ? new Date(form.readyEta).toISOString() : undefined), [form.readyEta]);

  async function submit() {
    setSaving(true); setError(null); setFields({});
    try {
      await frontdesk.addToQueue(propertyId, {
        reservationId: row.reservationId,
        unitId: row.unitId || undefined,
        reason: form.reason,
        ownerId: form.ownerId || undefined,
        priority: form.priority,
        guestContact: form.guestContact || undefined,
        readyEta: etaIso,
        notes: form.notes || undefined,
      });
      onQueued?.();
    } catch (e) {
      setFields(e.fields || {});
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const missing = !form.reason ? 'יש לבחור סיבת עיכוב' : !form.ownerId ? 'יש לבחור אחראי' : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title={`הוספה לתור המתנה — ${row?.guest?.name || ''}`}
      subtitle={`${row?.confirmationNumber || ''}${row?.room ? ` · חדר ${row.room.number}` : ' · ללא שיבוץ'} · שעת ההגעה תירשם עכשיו`}
      footer={(
        <>
          {missing && <span className="ui-foot-note">{missing}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!!missing || saving}>
            {saving ? <><Spinner /> שומר…</> : 'הוספה לתור'}
          </button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <div className="ui-grid-2">
        <Field id="q-reason" label="סיבת עיכוב" required error={fields.reason}>
          <select id="q-reason" className="select w-full" value={form.reason || ''} onChange={set('reason')}>
            <option value="">בחירה…</option>
            {Object.entries(QUEUE_REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field id="q-owner" label="אחראי לטיפול" required error={fields.ownerId}>
          <select id="q-owner" className="select w-full" value={form.ownerId || ''} onChange={set('ownerId')}>
            <option value="">בחירה…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {roleLabel(s.role)}</option>)}
          </select>
        </Field>
        <Field id="q-priority" label="עדיפות" error={fields.priority} hint={!isManager ? 'עדיפות דחופה מאושרת על ידי מנהל משמרת' : undefined}>
          <select id="q-priority" className="select w-full" value={form.priority} onChange={set('priority')}>
            <option value="normal">רגילה</option>
            <option value="urgent" disabled={!isManager}>דחופה</option>
          </select>
        </Field>
        <Field id="q-contact" label="עדכון האורח" optional error={fields.guestContact} hint="הודעת שירות בלבד, לא שיווק">
          <select id="q-contact" className="select w-full" value={form.guestContact || ''} onChange={set('guestContact')}>
            <option value="desk">בדלפק</option>
            <option value="message">בהודעה</option>
          </select>
        </Field>
        <Field id="q-eta" label="הערכת מוכנות" optional error={fields.readyEta} hint="הערכה בלבד — לא התחייבות לאורח">
          <input id="q-eta" type="datetime-local" className="input w-full" value={form.readyEta || ''} onChange={set('readyEta')} />
        </Field>
      </div>
      <Field id="q-notes" label="הערה" optional>
        <textarea id="q-notes" className="input w-full" rows={2} maxLength={2000} value={form.notes || ''} onChange={set('notes')} style={{ height: 'auto', paddingBlock: 8 }} />
      </Field>
    </Modal>
  );
}
