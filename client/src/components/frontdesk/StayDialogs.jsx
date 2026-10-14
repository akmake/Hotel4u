// Dialogs used on in-house stays: service charge (FD-06-A06 → FIN-02), guest request
// (FD-06-A05 → GST-05) and expected departure time (FD-07-F06).
import { useEffect, useMemo, useState } from 'react';
import { frontdesk, guestRequests } from '../../utils/api';
import { CHARGE_DEPARTMENT_LABELS, REQUEST_CATEGORY_LABELS } from '../../lib/labels';
import { Modal, Field, Spinner, ErrorBanner, newOpKey, money } from '../kit';

export function ChargeDialog({ open, propertyId, stay, onClose, onDone }) {
  const [form, setForm] = useState({ description: '', amount: '', department: 'minibar' });
  const [opKey, setOpKey] = useState(newOpKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  useEffect(() => {
    if (open) { setForm({ description: '', amount: '', department: 'minibar' }); setOpKey(newOpKey()); setError(null); setFields({}); }
  }, [open, stay?.reservationId]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit() {
    setSaving(true); setError(null); setFields({});
    try {
      const out = await frontdesk.postCharge(propertyId, stay.reservationId, { ...form, amount: Number(form.amount), idempotencyKey: opKey });
      onDone?.(out);
    } catch (e) {
      setError(e.message); setFields(e.fields || {});
    } finally { setSaving(false); }
  }
  const missing = !form.description.trim() ? 'יש לתאר את החיוב' : !(Number(form.amount) > 0) ? 'יש להזין סכום' : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      width={480}
      title={`חיוב שירות — ${stay?.guest?.name || ''}`}
      subtitle={`${stay?.confirmationNumber || ''}${stay?.rooms?.length ? ` · חדר ${stay.rooms.map((r) => r.number).join(', ')}` : ''}`}
      footer={(
        <>
          {missing && <span className="ui-foot-note">{missing}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!!missing || saving}>{saving ? <><Spinner /> רושם…</> : 'רישום חיוב'}</button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <Field id="ch-desc" label="תיאור" required error={fields.description}>
        <input id="ch-desc" className="input w-full" maxLength={200} value={form.description} onChange={set('description')} />
      </Field>
      <div className="ui-grid-2">
        <Field id="ch-dept" label="מחלקה" required error={fields.department}>
          <select id="ch-dept" className="select w-full" value={form.department} onChange={set('department')}>
            {Object.entries(CHARGE_DEPARTMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field id="ch-amount" label="סכום לאורח (כולל מע״מ)" required error={fields.amount} hint={Number(form.amount) > 0 ? `יירשם ${money(form.amount)} — המע״מ מחולץ מהסכום` : undefined}>
          <input id="ch-amount" type="number" min={0.01} step={0.01} className="input w-full" value={form.amount} onChange={set('amount')} />
        </Field>
      </div>
      <p className="ui-p">החיוב נרשם לחשבון האורח של השהייה ואינו משנה את מחיר הלינה. תיקון חיוב מתבצע בפעולה נגדית, לא במחיקה.</p>
    </Modal>
  );
}

export function GuestRequestDialog({ open, propertyId, stay, onClose, onDone }) {
  const [form, setForm] = useState({ category: 'general', description: '', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setForm({ category: 'general', description: '', priority: 'medium' }); setError(null); } }, [open, stay?.reservationId]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit() {
    setSaving(true); setError(null);
    try {
      await guestRequests.create({
        propertyId,
        reservationId: stay.reservationId,
        roomId: stay.rooms?.[0]?.id,
        category: form.category,
        description: form.description,
        priority: form.priority,
      });
      onDone?.();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      width={480}
      title={`בקשת אורח — ${stay?.guest?.name || ''}`}
      subtitle={stay?.rooms?.length ? `חדר ${stay.rooms.map((r) => r.number).join(', ')}` : stay?.confirmationNumber}
      footer={(
        <>
          {!form.description.trim() && <span className="ui-foot-note">יש לתאר את הבקשה</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!form.description.trim() || saving}>{saving ? <><Spinner /> שומר…</> : 'פתיחת בקשה'}</button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <div className="ui-grid-2">
        <Field id="gr-cat" label="סוג" required>
          <select id="gr-cat" className="select w-full" value={form.category} onChange={set('category')}>
            {Object.entries(REQUEST_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field id="gr-pri" label="עדיפות">
          <select id="gr-pri" className="select w-full" value={form.priority} onChange={set('priority')}>
            <option value="low">נמוכה</option>
            <option value="medium">רגילה</option>
            <option value="high">גבוהה</option>
            <option value="urgent">דחופה</option>
          </select>
        </Field>
      </div>
      <Field id="gr-desc" label="תיאור" required>
        <textarea id="gr-desc" className="input w-full" rows={3} maxLength={2000} value={form.description} onChange={set('description')} style={{ height: 'auto', paddingBlock: 8 }} />
      </Field>
    </Modal>
  );
}

export function TimeDialog({ open, title, subtitle, label, hint, value, onSave, onClose }) {
  const [v, setV] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setV(value || ''); setError(null); } }, [open, value]);
  const id = useMemo(() => `time-${Math.random().toString(36).slice(2, 7)}`, []);
  async function save() {
    setSaving(true); setError(null);
    try { await onSave(v || null); } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      width={420}
      title={title}
      subtitle={subtitle}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <><Spinner /> שומר…</> : 'שמירה'}</button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      <Field id={id} label={label} optional hint={hint}>
        <input id={id} type="time" className="input" style={{ width: 160 }} value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
    </Modal>
  );
}
