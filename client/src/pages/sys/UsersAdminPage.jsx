// ADM-06 — users, roles and access. Invite (no password is chosen by the admin — a one-time setup
// link is handed over), change role within your own authority, set an access end date for temps
// and vendors, deactivate (ends every session and returns open work) and reactivate.
import { useEffect, useState } from 'react';
import { Plus, Copy } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { identity } from '../../utils/api';
import { roleLabel } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import {
  Page, Toolbar, Card, Tiles, SearchBox, DataTable, Tag, Pill, Empty, RowMenu, Modal, Field, ErrorBanner, Banner, Spinner, ConfirmDialog,
  useUrlState, useLoader, useAction, formatDateTime,
} from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';

const DEFAULTS = { status: 'active', q: '' };

function SetupLinkNotice({ link, onClose }) {
  const full = link ? `${window.location.origin}${link.setupPath}` : '';
  const [copied, setCopied] = useState(false);
  return (
    <Modal open={!!link} onClose={onClose} width={520} title="קישור הגדרת סיסמה" subtitle={`תקף ${link?.expiresInHours || 72} שעות ולשימוש אחד`} footer={<button type="button" className="btn btn-primary" onClick={onClose}>סיום</button>}>
      <Banner tone="warn">הקישור מוצג פעם אחת בלבד. מסרו אותו לעובד בערוץ מאובטח (לא בקבוצה משותפת). המערכת לא שולחת סיסמאות.</Banner>
      <div className="ui-row">
        <input className="input" style={{ flex: 1, direction: 'ltr' }} readOnly value={full} onFocus={(e) => e.target.select()} aria-label="קישור" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(full); setCopied(true); } catch { setCopied(false); } }}><Copy size={14} /> {copied ? 'הועתק' : 'העתקה'}</button>
      </div>
    </Modal>
  );
}

function UserDialog({ open, onClose, propertyId, user, roles, onSaved }) {
  const action = useAction();
  const editing = !!user;
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return;
    setF({ firstName: user?.firstName || '', lastName: user?.lastName || '', email: user?.email || '', role: user?.role || '', accessUntil: user?.accessUntil ? String(user.accessUntil).slice(0, 10) : '' });
    action.reset();
  }, [open, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const e = action.fields;
  const why = !f.firstName?.trim() || !f.lastName?.trim() ? 'שם מלא נדרש' : !f.email?.trim() ? 'דוא״ל נדרש' : !f.role ? 'יש לבחור תפקיד' : null;
  const submit = () => action.run(async () => {
    const body = { firstName: f.firstName, lastName: f.lastName, email: f.email, role: f.role, accessUntil: f.accessUntil || null };
    const out = editing ? await identity.update(propertyId, user.id, body) : await identity.create(propertyId, body);
    onSaved?.(out);
  });
  const roleOptions = editing && user && !roles.some((r) => r.role === user.role) ? [{ role: user.role }, ...roles] : roles;
  return (
    <Modal open={open} onClose={onClose} busy={action.busy} width={520} title={editing ? `עריכת ${user.name}` : 'הזמנת משתמש'} subtitle={editing ? user.email : 'חשבון אישי לכל עובד — לא חשבון משותף'} footer={(
      <>
        {why && <span className="ui-foot-note">{why}</span>}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>ביטול</button>
        <button type="button" className="btn btn-primary" disabled={action.busy || !!why} onClick={submit}>{action.busy ? <Spinner /> : editing ? 'שמירה' : 'הזמנה וקישור הגדרה'}</button>
      </>
    )}>
      <ErrorBanner error={action.error} />
      <div className="ui-grid-2">
        <Field id="u-f" label="שם פרטי" required error={e.firstName}><input id="u-f" className="input w-full" maxLength={60} value={f.firstName || ''} onChange={(ev) => set('firstName')(ev.target.value)} /></Field>
        <Field id="u-l" label="שם משפחה" required error={e.lastName}><input id="u-l" className="input w-full" maxLength={60} value={f.lastName || ''} onChange={(ev) => set('lastName')(ev.target.value)} /></Field>
        <Field id="u-e" label="דוא״ל אישי" required error={e.email}><input id="u-e" type="email" dir="ltr" className="input w-full" maxLength={120} value={f.email || ''} onChange={(ev) => set('email')(ev.target.value)} /></Field>
        <Field id="u-r" label="תפקיד" required error={e.role} hint="רק תפקידים מתחת לסמכות שלך">
          <select id="u-r" className="select w-full" value={f.role || ''} onChange={(ev) => set('role')(ev.target.value)}>
            <option value="">בחירה…</option>
            {roleOptions.map((r) => <option key={r.role} value={r.role}>{roleLabel(r.role)}</option>)}
          </select>
        </Field>
        <Field id="u-a" label="גישה עד" optional hint="לעובד זמני או ספק — ריק = ללא הגבלה" error={e.accessUntil}><input id="u-a" type="date" className="input w-full" value={f.accessUntil || ''} onChange={(ev) => set('accessUntil')(ev.target.value)} /></Field>
      </div>
      {!editing && <div className="ui-sub">אחרי ההזמנה יוצג קישור חד־פעמי להגדרת סיסמה. אין סיסמה ראשונית שנקבעת על ידי מנהל.</div>}
    </Modal>
  );
}

export default function UsersAdminPage() {
  const { propertyId } = useProperty();
  const me = useAuthStore((s) => s.user);
  const { toasts, success, error: toastError } = useToast();
  const url = useUrlState(DEFAULTS);
  const [dialog, setDialog] = useState(null);
  const [link, setLink] = useState(null);
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? identity.users(propertyId, { status: url.get('status'), q: url.get('q') || undefined }) : null), [propertyId, url.key]);
  const roles = useLoader(async () => (propertyId ? identity.roles(propertyId) : null), [propertyId]);
  const c = data?.counts || {};
  const isAuditor = me?.role === 'auditor';

  const columns = [
    { key: 'name', label: 'משתמש', render: (u) => <div><div className="font-medium">{u.name}{u.displayName ? ` (${u.displayName})` : ''}</div><div className="ui-sub" dir="ltr" style={{ textAlign: 'right' }}>{u.email}</div></div> },
    { key: 'role', label: 'תפקיד', nowrap: true, render: (u) => roleLabel(u.role) },
    {
      key: 'st', label: 'מצב', nowrap: true, render: (u) => (
        <div className="ui-stack" style={{ gap: 2 }}>
          {u.active ? <Pill tone="ok">פעיל</Pill> : <Pill tone="muted">מושבת</Pill>}
          {u.locked && <Tag tone="warn">נעול זמנית</Tag>}
          {u.accessUntil && <span className={`ui-sub ${new Date(u.accessUntil) < new Date() ? 'ui-error' : ''}`}>גישה עד {formatDateTime(u.accessUntil)}</span>}
          {!u.active && u.deactivatedBy && <span className="ui-sub">הושבת ע״י {u.deactivatedBy}</span>}
        </div>
      ),
    },
    { key: 'mfa', label: 'אימות דו־שלבי', nowrap: true, render: (u) => (u.twoFactorEnabled ? <Tag>מופעל</Tag> : <span className="ui-sub">לא מופעל</span>) },
    { key: 'last', label: 'כניסה אחרונה', nowrap: true, render: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="ui-sub">טרם נכנס</span>) },
    {
      key: 'act', label: 'פעולות', srOnly: true, nowrap: true, render: (u) => (
        <RowMenu
          label={`פעולות — ${u.name}`}
          items={[
            { label: 'עריכה', disabled: !u.manageable || isAuditor, why: 'מחוץ לסמכות שלך', onSelect: () => setDialog({ kind: 'edit', user: u }) },
            u.active && { label: 'קישור הגדרת סיסמה', hint: 'איפוס על ידי מנהל', disabled: !u.manageable || isAuditor, why: 'מחוץ לסמכות שלך', onSelect: async () => { try { setLink(await identity.setupLink(propertyId, u.id)); } catch (e) { toastError(e.message); } } },
            { separator: true },
            u.active && { label: 'השבתה', danger: true, disabled: !u.manageable || isAuditor, why: 'מחוץ לסמכות שלך', onSelect: () => setDialog({ kind: 'deactivate', user: u }) },
            !u.active && { label: 'הפעלה מחדש', disabled: !u.manageable || isAuditor, why: 'מחוץ לסמכות שלך', onSelect: async () => { try { await identity.reactivate(propertyId, u.id); success('המשתמש הופעל — יש להנפיק לו קישור הגדרה'); reload(); } catch (e) { toastError(e.message); } } },
          ]}
        />
      ),
    },
  ];

  return (
    <Page wide>
      <ToastContainer toasts={toasts} />
      <AdminNav end={!isAuditor && <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'new' })}><Plus size={14} /> הזמנת משתמש</button>} />
      <Toolbar start={<SearchBox value={url.get('q')} onCommit={(q) => url.set({ q })} placeholder="שם או דוא״ל" id="usr-q" />} />
      <Tiles
        label="מצב משתמש"
        selected={url.get('status')}
        onSelect={(v) => url.set({ status: v })}
        items={[{ id: 'active', label: 'פעילים', value: data ? c.active : undefined }, { id: 'inactive', label: 'מושבתים', value: data ? c.inactive : undefined }, { id: 'all', label: 'הכול' }]}
      />
      <Card flush>
        <DataTable caption="משתמשים" columns={columns} rows={data?.rows} loading={loading && !data} error={error} onRetry={reload} filtered={!!url.get('q')} rowClass={(u) => (u.active ? '' : 'is-done')} empty={<Empty title="אין משתמשים בתצוגה זו" />} />
      </Card>
      <UserDialog
        open={dialog?.kind === 'new' || dialog?.kind === 'edit'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        user={dialog?.kind === 'edit' ? dialog.user : null}
        roles={roles.data || []}
        onSaved={(out) => { setDialog(null); if (out?.setupPath) setLink(out); success(out?.setupPath ? 'המשתמש נוצר' : 'נשמר'); reload(); }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deactivate'}
        onClose={() => setDialog(null)}
        title={`השבתת ${dialog?.user?.name || ''}`}
        confirmLabel="השבתה"
        danger
        requireReason
        onConfirm={async (reason) => { const out = await identity.deactivate(propertyId, dialog.user.id, reason); setDialog(null); success(`הושבת · ${out.tasksReturned} משימות ו־${out.ticketsReturned} תקלות הוחזרו לצוות`); reload(); }}
      >
        <p className="ui-p">כל המושבים הפתוחים של המשתמש יסתיימו מיד, ומשימות חדרנות ותקלות שבטיפולו יחזרו לרשימה המשותפת.</p>
      </ConfirmDialog>
      <SetupLinkNotice link={link} onClose={() => setLink(null)} />
    </Page>
  );
}
