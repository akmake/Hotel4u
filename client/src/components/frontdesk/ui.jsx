// Small building blocks shared by the front-desk screens (FD-02/03/04, INV-02).
// They follow the common contract in docs/specification/02: every field has a visible label,
// errors are attached to the field, disabled actions say why, Escape/X/Cancel behave the same.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, Loader2, AlertCircle } from 'lucide-react';
import './frontdesk.css';

export function Modal({ open, onClose, title, subtitle, children, footer, width = 560, busy = false, labelledBy }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v && !busy) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fd-overlay" />
        <DialogPrimitive.Content
          className="fd-modal"
          style={{ maxWidth: width }}
          dir="rtl"
          aria-describedby={undefined}
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        >
          <div className="fd-modal-head">
            <div className="min-w-0">
              <DialogPrimitive.Title className="fd-modal-title" id={labelledBy}>{title}</DialogPrimitive.Title>
              {subtitle && <div className="fd-modal-sub">{subtitle}</div>}
            </div>
            <DialogPrimitive.Close className="btn btn-ghost btn-sm btn-icon" aria-label="סגירה" disabled={busy}>
              <X size={15} />
            </DialogPrimitive.Close>
          </div>
          <div className="fd-modal-body">{children}</div>
          {footer && <div className="fd-modal-foot">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Field({ id, label, hint, error, required, optional, children }) {
  return (
    <div className="fd-field">
      <label htmlFor={id} className="fd-label">
        {label}
        {required && <span className="fd-req"> · חובה</span>}
        {optional && <span className="fd-opt"> · רשות</span>}
      </label>
      {children}
      {hint && !error && <div className="fd-hint" id={id ? `${id}-hint` : undefined}>{hint}</div>}
      {error && <div className="fd-error" id={id ? `${id}-err` : undefined} role="alert">{error}</div>}
    </div>
  );
}

export function Spinner({ size = 13 }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden="true" />;
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="fd-banner is-error" role="alert">
      <AlertCircle size={14} aria-hidden="true" />
      <div className="flex-1 min-w-0">{typeof error === 'string' ? error : error.message}</div>
      {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>נסו שוב</button>}
    </div>
  );
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
  return <span className={`fd-state is-${meta.tone}`}><i aria-hidden="true" />{meta.label}</span>;
}

export const readinessLabel = (state) => STATE_META[state]?.label || state;

// One line per open reason, worded for the person at the desk.
export function ReasonList({ reasons, compact = false }) {
  if (!reasons?.length) return null;
  return (
    <ul className={`fd-reasons ${compact ? 'is-compact' : ''}`}>
      {reasons.map((r) => (
        <li key={r.code} className={`is-${r.severity}`}>{r.label}</li>
      ))}
    </ul>
  );
}

export function guestInitials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')) || '?';
}

export function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
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
