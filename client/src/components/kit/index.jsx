// Hotel4U UI kit — the one set of building blocks every screen is built from.
// Follows the common contract in docs/specification/02: every field has a visible label, errors
// sit on the field, disabled actions say why, Escape/X/Cancel behave the same, lists keep their
// filter/sort/page in the URL, and every list has loading / empty / no-results / error states.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { X, Loader2, AlertCircle, Search, ChevronLeft, ChevronRight, MoreHorizontal, ArrowUpDown } from 'lucide-react';

// ── Overlays ────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, subtitle, children, footer, width = 560, busy = false, labelledBy }) {
  const contentRef = useRef(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v && !busy) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-overlay" />
        <DialogPrimitive.Content
          ref={contentRef}
          className="ui-modal"
          style={{ maxWidth: width }}
          tabIndex={-1}
          // Start on the dialog itself (title is announced) rather than on the close button.
          onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
          dir="rtl"
          aria-describedby={undefined}
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        >
          <div className="ui-modal-head">
            <div className="min-w-0">
              <DialogPrimitive.Title className="ui-modal-title" id={labelledBy}>{title}</DialogPrimitive.Title>
              {subtitle && <div className="ui-modal-sub">{subtitle}</div>}
            </div>
            <DialogPrimitive.Close className="btn btn-ghost btn-sm btn-icon" aria-label="סגירה" disabled={busy}>
              <X size={15} />
            </DialogPrimitive.Close>
          </div>
          <div className="ui-modal-body">{children}</div>
          {footer && <div className="ui-modal-foot">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Side panel for record detail next to a list (record stays in context of the list).
export function Drawer({ open, onClose, title, subtitle, actions, children, footer, width = 560, busy = false }) {
  const contentRef = useRef(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v && !busy) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-overlay is-light" />
        <DialogPrimitive.Content
          ref={contentRef}
          className="ui-drawer"
          style={{ width: `min(${width}px, 100vw)` }}
          tabIndex={-1}
          onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
          dir="rtl"
          aria-describedby={undefined}
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        >
          <div className="ui-drawer-head">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="ui-modal-title">{title}</DialogPrimitive.Title>
              {subtitle && <div className="ui-modal-sub">{subtitle}</div>}
            </div>
            {actions}
            <DialogPrimitive.Close className="btn btn-ghost btn-sm btn-icon" aria-label="סגירה" disabled={busy}>
              <X size={15} />
            </DialogPrimitive.Close>
          </div>
          <div className="ui-drawer-body">{children}</div>
          {footer && <div className="ui-modal-foot">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Significant-action confirmation (02: record, before/after, reason when required, verb button).
export function ConfirmDialog({ open, onClose, title, subtitle, children, confirmLabel, danger = false, requireReason = false, reasonLabel = 'סיבה', onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setReason(''); setError(null); } }, [open]);
  const blocked = requireReason && reason.trim().length < 3;
  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(reason.trim()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      width={480}
      title={title}
      subtitle={subtitle}
      footer={(
        <>
          {blocked && <span className="ui-foot-note">נדרשת סיבה</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ביטול</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={go} disabled={busy || blocked}>
            {busy ? <><Spinner /> מבצע…</> : confirmLabel}
          </button>
        </>
      )}
    >
      <ErrorBanner error={error} />
      {children}
      {requireReason && (
        <Field id="confirm-reason" label={reasonLabel} required>
          <input id="confirm-reason" className="input w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

export function RowMenu({ label, items }) {
  const visible = items.filter(Boolean).filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <MenuPrimitive.Root dir="rtl">
      <MenuPrimitive.Trigger asChild>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={label || 'פעולות נוספות'}><MoreHorizontal size={15} /></button>
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content className="ui-menu" align="end" sideOffset={4}>
          {visible.map((it, i) => (it.separator
            ? <MenuPrimitive.Separator key={`sep-${i}`} className="ui-menu-sep" />
            : (
              <MenuPrimitive.Item key={it.label} className={`ui-menu-item ${it.danger ? 'is-danger' : ''}`} disabled={!!it.disabled} onSelect={it.onSelect}>
                {it.label}
                {it.disabled && it.why && <span className="ui-menu-why">{it.why}</span>}
                {!it.disabled && it.hint && <span className="ui-menu-why">{it.hint}</span>}
              </MenuPrimitive.Item>
            )))}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

// ── Form ────────────────────────────────────────────────────────────────────
export function Field({ id, label, hint, error, required, optional, children }) {
  return (
    <div className="ui-field">
      <label htmlFor={id} className="ui-label">
        {label}
        {required && <span className="ui-req"> · חובה</span>}
        {optional && <span className="ui-opt"> · רשות</span>}
      </label>
      {children}
      {hint && !error && <div className="ui-hint" id={id ? `${id}-hint` : undefined}>{hint}</div>}
      {error && <div className="ui-error" id={id ? `${id}-err` : undefined} role="alert">{error}</div>}
    </div>
  );
}

export function Spinner({ size = 13 }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden="true" />;
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="ui-banner is-error" role="alert">
      <AlertCircle size={14} aria-hidden="true" />
      <div className="flex-1 min-w-0">{typeof error === 'string' ? error : error.message}</div>
      {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>נסו שוב</button>}
    </div>
  );
}

export function Banner({ tone = 'info', children }) {
  return <div className={`ui-banner is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

// ── Page structure ──────────────────────────────────────────────────────────
export function Page({ children, wide = false }) {
  return <div className={`ui-page ${wide ? 'is-wide' : ''}`} dir="rtl">{children}</div>;
}

export function Toolbar({ start, end, children }) {
  return (
    <div className="ui-toolbar">
      <div className="ui-toolbar-start">{start}{children}</div>
      {end && <div className="ui-toolbar-end">{end}</div>}
    </div>
  );
}

export function Card({ title, actions, children, flush = false, className = '' }) {
  return (
    <section className={`ui-card ${flush ? 'is-flush' : ''} ${className}`} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className="ui-card-head">
          {title && <h2 className="ui-card-title">{title}</h2>}
          {actions && <div className="ui-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// Count tiles that double as a filter (Cloudbeds "Activity" tiles).
export function Tiles({ items, selected, onSelect, label }) {
  return (
    <div className="ui-tiles" role="tablist" aria-label={label} style={{ '--tiles': Math.min(items.length, 6) }}>
      {items.map((t) => {
        const isStatic = !onSelect || t.static;
        const Tag = isStatic ? 'div' : 'button';
        return (
          <Tag
            key={t.id}
            type={isStatic ? undefined : 'button'}
            role={isStatic ? undefined : 'tab'}
            aria-selected={isStatic ? undefined : selected === t.id}
            className={`ui-tile ${selected === t.id ? 'is-selected' : ''} ${isStatic ? 'is-static' : ''} ${t.tone ? `is-${t.tone}` : ''}`}
            onClick={isStatic ? undefined : () => onSelect(t.id)}
          >
            <span className="ui-tile-n">{t.value ?? '–'}</span>
            <span className="ui-tile-l">{t.label}</span>
          </Tag>
        );
      })}
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="ui-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && o.count !== null ? <span className="ui-seg-n"> {o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// L01/L02: Enter commits the search; X clears only the search.
export function SearchBox({ value, onCommit, placeholder, label = 'חיפוש', id = 'ui-search' }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);
  return (
    <form className="ui-search" role="search" onSubmit={(e) => { e.preventDefault(); onCommit(draft.trim()); }}>
      <Search size={14} aria-hidden="true" />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} />
      {draft && <button type="button" aria-label="ניקוי חיפוש" className="ui-search-x" onClick={() => { setDraft(''); onCommit(''); }}><X size={13} /></button>}
    </form>
  );
}

export function FilterChips({ chips, onRemove, onReset }) {
  if (!chips.length) return null;
  return (
    <div className="ui-chips">
      {chips.map((c) => (
        <span key={c.key} className="ui-chip">{c.label}<button type="button" aria-label={`הסרת ${c.label}`} onClick={() => onRemove(c.key)}><X size={11} /></button></span>
      ))}
      {onReset && <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>איפוס סינון</button>}
    </div>
  );
}

// ── Data table ──────────────────────────────────────────────────────────────
// columns: [{ key, label, render(row), sort?: 'key', width?, align?, nowrap? }]
export function DataTable({
  columns, rows, rowKey = (r) => r.id, loading, error, onRetry, sort, dir, onSort,
  empty, noResults, filtered = false, rowClass, onRowClick, caption, maxHeight,
}) {
  const ariaSort = (c) => (c.sort && sort === c.sort ? (dir === 'desc' ? 'descending' : 'ascending') : undefined);
  return (
    <>
      <ErrorBanner error={error} onRetry={onRetry} />
      <div className="ui-table-wrap" aria-busy={!!loading} style={maxHeight ? { maxHeight } : undefined}>
        <table className="ui-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={ariaSort(c)} style={{ width: c.width, textAlign: c.align }}>
                  {c.sort && onSort ? (
                    <button type="button" className="ui-th-sort" onClick={() => onSort(c.sort)}>
                      {c.label}
                      {sort === c.sort ? (dir === 'desc' ? ' ↓' : ' ↑') : <ArrowUpDown size={11} aria-hidden="true" />}
                    </button>
                  ) : (c.srOnly ? <span className="sr-only">{c.label}</span> : c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !rows?.length && (
              <tr><td colSpan={columns.length}><div className="ui-empty"><Spinner /> טוען…</div></td></tr>
            )}
            {!loading && rows && rows.length === 0 && (
              <tr><td colSpan={columns.length}>{filtered ? (noResults || <div className="ui-empty"><strong>אין תוצאות לסינון הנוכחי</strong></div>) : (empty || <div className="ui-empty"><strong>אין רשומות</strong></div>)}</td></tr>
            )}
            {(rows || []).map((r) => (
              <tr
                key={rowKey(r)}
                className={`${rowClass ? rowClass(r) : ''} ${onRowClick ? 'is-clickable' : ''}`}
                onClick={onRowClick ? (e) => { if (!e.target.closest('button,a,input,select,label,[role="menuitem"]')) onRowClick(r); } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align }} className={c.nowrap ? 'ui-nowrap' : undefined}>{c.render ? c.render(r) : r[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Pager({ page, pages, total, pageSize, onPage, onSize, unit = 'רשומות' }) {
  return (
    <div className="ui-pager">
      <span className="ui-muted">{total ?? 0} {unit}</span>
      {onSize && (
        <>
          <label className="sr-only" htmlFor="ui-page-size">שורות בעמוד</label>
          <select id="ui-page-size" className="select select-sm" value={pageSize} onChange={(e) => onSize(Number(e.target.value))}>
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} בעמוד</option>)}
          </select>
        </>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="עמוד קודם" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronRight size={14} /></button>
          <span className="tabular-nums text-[13px]">{page}/{pages}</span>
          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="עמוד הבא" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronLeft size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ── Display ─────────────────────────────────────────────────────────────────
export function Pill({ tone = 'muted', children }) {
  return <span className={`ui-state is-${tone}`}><i aria-hidden="true" />{children}</span>;
}

export function Tag({ tone, children }) {
  return <span className={`ui-tag ${tone ? `is-${tone}` : ''}`}>{children}</span>;
}

export function KeyValues({ rows }) {
  return (
    <div className="ui-summary">
      {rows.filter(Boolean).map(([k, v], i) => (
        <div key={`${k}-${i}`} className="ui-sum-row"><span>{k}</span><strong>{v ?? '—'}</strong></div>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="ui-empty">
      {title && <strong>{title}</strong>}
      {children}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Avatar({ name }) {
  return <span className="ui-avatar" aria-hidden="true">{guestInitials(name)}</span>;
}

const STATE_META = {
  ready:      { label: 'מוכן לכניסה', tone: 'ok' },
  waiting:    { label: 'ממתין לחדר',  tone: 'warn' },
  queued:     { label: 'בתור המתנה',  tone: 'warn' },
  blocked:    { label: 'חסום',        tone: 'bad' },
  checked_in: { label: 'נכנס',        tone: 'muted' },
};

export function ReadinessBadge({ state }) {
  const meta = STATE_META[state] || { label: state, tone: 'muted' };
  return <span className={`ui-state is-${meta.tone}`}><i aria-hidden="true" />{meta.label}</span>;
}

export const readinessLabel = (state) => STATE_META[state]?.label || state;

// One line per open reason, worded for the person at the desk.
export function ReasonList({ reasons, compact = false }) {
  if (!reasons?.length) return null;
  return (
    <ul className={`ui-reasons ${compact ? 'is-compact' : ''}`}>
      {reasons.map((r, i) => (
        <li key={`${r.code || i}`} className={`is-${r.severity || 'info'}`}>{r.label}</li>
      ))}
    </ul>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────
export function guestInitials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')) || '?';
}

export function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function minutesSince(value) {
  if (!value) return null;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
}

export function formatWait(mins) {
  if (mins === null || mins === undefined) return '—';
  if (mins < 60) return `${mins} ד׳`;
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')} ש׳`;
}

export function money(n, currency = 'ILS', digits = 2) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: currency || 'ILS', minimumFractionDigits: digits === 0 ? 0 : (Number.isInteger(v) ? 0 : 2), maximumFractionDigits: digits }).format(v);
}

// Client-generated id for idempotent writes (payments, charges): one per user action.
export function newOpKey() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ── URL state (filters/sort/page survive refresh and back) ──────────────────
export function useUrlState(defaults) {
  const [params, setParams] = useSearchParams();
  const get = useCallback((k) => params.get(k) ?? defaults[k] ?? '', [params, defaults]);
  const set = useCallback((patch, { resetPage = true } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '' || String(v) === String(defaults[k] ?? '')) next.delete(k);
        else next.set(k, String(v));
      });
      if (resetPage && !('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams, defaults]);
  const key = params.toString();
  return { get, set, params, key };
}

// Load data with loading/error state; `reload` keeps current data while refreshing.
export function useLoader(fn, deps, { skip = false } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState(null);
  const ref = useRef(fn);
  ref.current = fn;
  const reload = useCallback(async () => {
    if (skip) return null;
    setLoading(true); setError(null);
    try {
      const d = await ref.current();
      setData(d);
      return d;
    } catch (e) {
      setError(e.message || 'שגיאה בטעינה');
      return null;
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, loading, error, reload };
}

// Run a write with busy/error state; returns the result or undefined on failure.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null); setFields({});
    try { return await fn(); }
    catch (e) { setError(e.message); setFields(e.fields || {}); return undefined; }
    finally { setBusy(false); }
  }, []);
  const reset = useCallback(() => { setError(null); setFields({}); }, []);
  return useMemo(() => ({ busy, error, fields, run, reset }), [busy, error, fields, run, reset]);
}
