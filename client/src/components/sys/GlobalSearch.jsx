// SYS-05 — global search: bookings, guests, companies, rooms and faults in one box, limited to
// what the role may open; contact details come back masked. Arrow keys move, Enter opens.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { platform } from '../../utils/api';
import { Modal, Spinner, Empty } from '../kit';
import { RES_STATUS_LABELS } from '../../lib/labels';

export default function GlobalSearch({ open, onClose, propertyId }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => { if (open) { setQ(''); setRes(null); setErr(null); setCursor(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (!open || !propertyId) return undefined;
    const term = q.trim();
    if (term.length < 2) { setRes(null); return undefined; }
    const my = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try { const out = await platform.search(propertyId, term); if (my === seq.current) { setRes(out); setErr(null); setCursor(0); } }
      catch (e) { if (my === seq.current) setErr(e.message); }
      finally { if (my === seq.current) setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, propertyId]);

  const flat = useMemo(() => (res?.groups || []).flatMap((g) => g.items.map((it) => ({ ...it, group: g.label }))), [res]);
  const go = (it) => { onClose(); nav(it.link); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    if (e.key === 'Enter' && flat[cursor]) { e.preventDefault(); go(flat[cursor]); }
  };
  let idx = -1;
  return (
    <Modal open={open} onClose={onClose} width={620} title="חיפוש">
      <div className="ui-search" style={{ maxWidth: 'none' }}>
        <Search size={14} aria-hidden="true" />
        <label htmlFor="gs-q" className="sr-only">חיפוש</label>
        <input id="gs-q" ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="שם אורח, מספר אישור, חברה, מספר חדר או תקלה" autoComplete="off" role="combobox" aria-expanded={flat.length > 0} aria-controls="gs-results" aria-activedescendant={flat[cursor] ? `gs-${cursor}` : undefined} />
        {busy && <Spinner />}
      </div>
      {err && <div className="ui-error">{err}</div>}
      {q.trim().length < 2 && <div className="ui-sub">לפחות 2 תווים. פרטי קשר מוצגים מוסתרים.</div>}
      {res && flat.length === 0 && !busy && <Empty title="לא נמצאו תוצאות">נסו מספר אישור מלא, שם משפחה או מספר חדר.</Empty>}
      <div id="gs-results" role="listbox" aria-label="תוצאות" className="ui-stack" style={{ gap: 8 }}>
        {(res?.groups || []).map((g) => (
          <div key={g.type}>
            <div className="ui-section-title">{g.label}</div>
            <ul className="ui-results" style={{ marginTop: 0 }}>
              {g.items.map((it) => {
                idx += 1;
                const i = idx;
                return (
                  <li key={`${g.type}-${it.id}`}>
                    <button type="button" id={`gs-${i}`} role="option" aria-selected={cursor === i} style={cursor === i ? { background: 'rgb(var(--bg-hover))' } : undefined} onMouseEnter={() => setCursor(i)} onClick={() => go(it)}>
                      <span>{it.title}</span>
                      <span className="ui-sub">{[it.subtitle, it.status ? RES_STATUS_LABELS[it.status] || it.status : null].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
