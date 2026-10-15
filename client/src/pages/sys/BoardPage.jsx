// G2 — how the hotel sells: by rates or by board (the manager decides). By board, every board is a
// rate plan with its own price calendar — here each plan is marked with the board it represents,
// and the booking form shows one choice called "פנסיון".
import { useEffect, useState } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { useAuthStore } from '../../stores/authStore';
import { booking } from '../../utils/api';
import { BOARD_LABELS } from '../../lib/labels';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/ui/Toast';
import { Page, Card, Field, ErrorBanner, Spinner, useLoader, useAction } from '../../components/kit';
import AdminNav from '../../components/sys/AdminNav';

const ADMIN = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'revenue_manager', 'finance_manager'];

export default function BoardPage() {
  const { propertyId } = useProperty();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = ADMIN.includes(role);
  const { toasts, success } = useToast();
  const { data, loading, error, reload } = useLoader(async () => (propertyId ? booking.boardConfig(propertyId) : null), [propertyId]);
  const [f, setF] = useState(null);
  const [reason, setReason] = useState('');
  const save = useAction();
  useEffect(() => { if (data) { setF(JSON.parse(JSON.stringify(data))); setReason(''); } }, [data]);
  if (loading && !data) return <Page><div className="ui-empty"><Spinner /> טוען…</div></Page>;
  if (error) return <Page><ErrorBanner error={error} onRetry={reload} /></Page>;
  if (!f) return null;
  const setPlan = (id, board) => setF((p) => ({ ...p, plans: p.plans.map((x) => (x.id === id ? { ...x, board } : x)) }));
  const changed = JSON.stringify(f) !== JSON.stringify(data);
  const boardPlans = f.plans.filter((p) => p.board !== 'room_only').length;
  const why = !changed ? 'לא שונה דבר' : f.pricingMode === 'board' && !boardPlans ? 'סמנו לפחות תעריף אחד כפנסיון' : reason.trim().length < 3 ? 'סיבת השינוי' : null;
  async function submit() {
    const out = await save.run(() => booking.setBoardConfig(propertyId, { version: data.version, reason: reason.trim(), pricingMode: f.pricingMode, plans: f.plans.map((p) => ({ id: p.id, board: p.board })) }));
    if (out) { success('נשמר'); reload(); }
  }
  const dis = !canEdit;
  return (
    <Page>
      <ToastContainer toasts={toasts} />
      <AdminNav end={<span className="ui-muted">גרסה {data.version}{data.updatedBy ? ` · ${data.updatedBy}` : ''}</span>} />
      <ErrorBanner error={save.error} />
      <Card title="שיטת התמחור של המלון">
        <label className="ui-radio"><input type="radio" name="mode" disabled={dis} checked={f.pricingMode === 'rates'} onChange={() => setF((p) => ({ ...p, pricingMode: 'rates' }))} /><span>לפי תעריפים<span className="ui-sub" style={{ display: 'block' }}>בהזמנה בוחרים תעריף (למשל BAR, חברות, OTA). תעריף יכול לכלול ארוחת בוקר — כמסומן בטבלה.</span></span></label>
        <label className="ui-radio"><input type="radio" name="mode" disabled={dis} checked={f.pricingMode === 'board'} onChange={() => setF((p) => ({ ...p, pricingMode: 'board' }))} /><span>לפי פנסיון<span className="ui-sub" style={{ display: 'block' }}>בהזמנה בוחרים פנסיון (לינה וארוחת בוקר / חצי פנסיון / פנסיון מלא). כל פנסיון הוא תעריף עם מחירון משלו בלוח המחירים.</span></span></label>
      </Card>
      <Card title={f.pricingMode === 'board' ? 'איזה פנסיון כל תעריף מייצג' : 'אירוח שכלול בכל תעריף'}>
        <div className="ui-sub">{f.pricingMode === 'board' ? 'המחיר של כל פנסיון נקבע בלוח המחירים של התעריף שלו. תעריף שלא מסומן כפנסיון יוצג כ"לינה בלבד".' : 'תעריף שכולל אירוח: המחיר בלוח המחירים כבר כולל את הארוחות.'}</div>
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead><tr><th>תעריף</th><th>קוד</th><th>{f.pricingMode === 'board' ? 'פנסיון' : 'אירוח כלול'}</th></tr></thead>
            <tbody>
              {f.plans.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td dir="ltr">{p.code}</td>
                  <td>
                    <select className="select" disabled={dis} value={p.board} onChange={(e) => setPlan(p.id, e.target.value)} aria-label={`אירוח בתעריף ${p.name}`}>
                      {Object.entries(BOARD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {canEdit && (
        <Card>
          <div className="ui-row" style={{ alignItems: 'flex-end' }}>
            <Field id="bd-why" label="סיבת השינוי" required><input id="bd-why" className="input" style={{ minWidth: 320 }} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {why && <span className="ui-foot-note">{why}</span>}
            <button type="button" className="btn btn-primary" disabled={!!why || save.busy} onClick={submit}>{save.busy ? <Spinner /> : 'שמירה'}</button>
          </div>
          <div className="ui-sub">הזמנות קיימות שומרות את המחיר שהוסכם. השינוי חל על הזמנות חדשות.</div>
        </Card>
      )}
    </Page>
  );
}
