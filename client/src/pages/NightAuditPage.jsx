import { useState } from 'react';
import {
  Moon, CheckCircle2, AlertCircle, Play, Users, DollarSign, XCircle,
  AlertTriangle, Info, History, Calendar,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { reports as reportsApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { TODAY } from '../utils/date';

const STEPS = [
  { id:'balances',  label:'בדיקת יתרות פתוחות',  desc:'אין אורחים עם יתרה ביציאה' },
  { id:'rooms',     label:'בדיקת חדרים חסומים',   desc:'OOO / HOLD פתוחים' },
  { id:'hk',        label:'בדיקת משימות חדרנות',  desc:'כל המשימות הושלמו' },
  { id:'charges',   label:'חיובי לינה',            desc:'פוסטינג לכל האורחים בבית' },
  { id:'noshows',   label:'סימון No Show',         desc:'הזמנות שלא הגיעו היום' },
];

function StepRow({ step, status, warn }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0 ${
      status === 'ok'      ? 'bg-emerald-50/40' :
      status === 'warn'    ? 'bg-amber-50/40' :
      status === 'running' ? 'bg-brand/5' : ''
    }`}>
      <div className="flex-shrink-0">
        {status === 'ok'      && <CheckCircle2 size={18} className="text-emerald-600" />}
        {status === 'warn'    && <AlertCircle  size={18} className="text-amber-500" />}
        {status === 'running' && <Spinner size={18} />}
        {status === 'pending' && <div className="w-4.5 h-4.5 rounded-full border-2 border-surface-border" />}
      </div>
      <div className="flex-1">
        <div className={`text-sm font-semibold ${status === 'ok' ? 'text-emerald-700' : status === 'warn' ? 'text-amber-700' : 'text-ink'}`}>
          {step.label}
        </div>
        <div className="text-xs text-ink-muted">{warn || step.desc}</div>
      </div>
    </div>
  );
}

export default function NightAuditPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const [tab,         setTab]         = useState('audit'); // 'audit' | 'history'
  const [phase,       setPhase]       = useState('preview'); // preview | confirm | running | done
  const [result,      setResult]      = useState(null);
  const [markNoShows, setMarkNoShows] = useState(true);
  const [runLoading,  setRunLoading]  = useState(false);

  const { data: preview, loading, error, refetch } = useApi(
    () => reportsApi.nightAuditPreview(propertyId, TODAY),
    [propertyId], skip
  );

  const { data: historyData, loading: histLoading } = useApi(
    () => reportsApi.nightAuditHistory(propertyId),
    [propertyId], skip || tab !== 'history'
  );

  async function runAudit() {
    setPhase('running');
    setRunLoading(true);
    try {
      const res = await reportsApi.runNightAudit(propertyId, TODAY, markNoShows);
      setResult(res);
      setPhase('done');
      success('Night Audit הושלם בהצלחה!');
    } catch (e) {
      toastError(e.message || 'שגיאה ב-Night Audit');
      setPhase('confirm');
    } finally {
      setRunLoading(false);
    }
  }

  if (skip || loading) return <PageSpinner />;
  if (error)           return <ErrorState message={error} onRetry={refetch} />;

  const p = preview || {};
  const alreadyRan = p.alreadyRan;

  return (
    <div className="animate-fade-in max-w-2xl mx-auto">
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title flex items-center gap-2">
            <Moon size={22} className="text-brand" />
            Night Audit
          </div>
          <div className="page-subtitle">{TODAY} — סגירת יום עסקים</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-surface-border">
        {[
          { key:'audit',   label:'ביצוע Audit', icon: Moon },
          { key:'history', label:'היסטוריה',    icon: History },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all ${
              tab === key ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'
            }`}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      {/* ── History Tab ─────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="font-semibold text-ink text-sm">היסטוריית Night Audit</span>
          </div>
          {histLoading ? (
            <div className="flex justify-center py-8"><Spinner size={24}/></div>
          ) : (historyData || []).length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-ink-muted text-sm">
              <History size={28} className="text-ink-faint"/>
              <span>אין היסטוריה עדיין</span>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>תאריך</th><th>מי הריץ</th><th>חיובים</th><th>No Show</th><th>שגיאות</th></tr>
              </thead>
              <tbody>
                {(historyData || []).map(log => (
                  <tr key={String(log._id)}>
                    <td className="font-semibold text-num">{log.after?.date || '—'}</td>
                    <td className="text-sm">{log.actorName || '—'}</td>
                    <td className="text-num text-emerald-600 font-bold">{log.after?.chargesPosted ?? '—'}</td>
                    <td className="text-num text-amber-500">{log.after?.noShowsMarked ?? '—'}</td>
                    <td className={`text-num ${log.after?.errors > 0 ? 'text-red-500 font-bold' : 'text-ink-faint'}`}>
                      {log.after?.errors ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Audit Tab ───────────────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <>
          {/* Already-ran guard */}
          {alreadyRan && phase !== 'done' && (
            <div className="card p-4 border-amber-300 bg-amber-50/50 mb-4 flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5"/>
              <div>
                <div className="font-bold text-amber-800 text-sm">Night Audit כבר הורץ היום</div>
                <div className="text-xs text-amber-700 mt-0.5">
                  הורץ ב-{new Date(alreadyRan.at).toLocaleString('he-IL')}
                  {alreadyRan.by ? ` על ידי ${alreadyRan.by}` : ''}
                  {' · '}{alreadyRan.result?.chargesPosted ?? 0} חיובים · {alreadyRan.result?.noShowsMarked ?? 0} No Show
                </div>
              </div>
            </div>
          )}

          {/* Open balances alert */}
          {(p.openBalances || []).length > 0 && phase !== 'done' && (
            <div className="card mb-4 overflow-hidden border-red-200">
              <div className="card-header bg-red-50">
                <AlertTriangle size={14} className="text-red-500 ml-1"/>
                <span className="font-semibold text-red-700 text-sm">יתרות פתוחות ביציאה ({p.openBalances.length})</span>
              </div>
              <div className="px-4 py-3 flex flex-col gap-1.5">
                {p.openBalances.map(ob => (
                  <div key={ob.reservationId} className="flex items-center justify-between text-xs bg-red-50/60 rounded-lg px-3 py-1.5">
                    <div>
                      <span className="font-mono text-brand mr-2">{ob.confirmationNumber}</span>
                      <span className="text-ink">{ob.guest}</span>
                    </div>
                    <span className="text-num font-black text-red-600">₪{ob.balance.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OOO rooms alert */}
          {(p.oooRooms || []).length > 0 && phase !== 'done' && (
            <div className="card mb-4 overflow-hidden border-amber-200">
              <div className="card-header bg-amber-50">
                <Info size={14} className="text-amber-500 ml-1"/>
                <span className="font-semibold text-amber-700 text-sm">חדרים OOO / חסומים ({p.oooRooms.length})</span>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {p.oooRooms.map(r => (
                  <span key={r.roomId} className="badge badge-ooo text-xs">
                    {r.number} — {r.opsStatus === 'out_of_order' ? 'OOO' : 'OOS'}
                    {r.roomType ? ` (${r.roomType})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Preview stats */}
          {phase !== 'done' && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="card p-4 text-center">
                <div className="text-3xl font-black text-num text-brand">{p.inHouseCount || 0}</div>
                <div className="text-xs text-ink-muted mt-1 flex items-center justify-center gap-1">
                  <Users size={11} /> אורחים בבית
                </div>
              </div>
              <div className="card p-4 text-center">
                <div className="text-3xl font-black text-num text-emerald-600">
                  ₪{((p.totalRoomRevenue || 0)).toLocaleString()}
                </div>
                <div className="text-xs text-ink-muted mt-1 flex items-center justify-center gap-1">
                  <DollarSign size={11} /> חיובי לינה
                </div>
              </div>
              <div className="card p-4 text-center">
                <div className={`text-3xl font-black text-num ${p.noShows?.length > 0 ? 'text-amber-500' : 'text-ink-faint'}`}>
                  {p.noShows?.length || 0}
                </div>
                <div className="text-xs text-ink-muted mt-1 flex items-center justify-center gap-1">
                  <XCircle size={11} /> No Show
                </div>
              </div>
            </div>
          )}

          {/* Checklist */}
          {phase !== 'done' && (
            <div className="card mb-5 overflow-hidden">
              <div className="card-header">
                <span className="font-semibold text-ink text-sm">רשימת בדיקות טרום Audit</span>
              </div>
              {STEPS.map(step => (
                <StepRow
                  key={step.id}
                  step={step}
                  status={
                    phase === 'running' && step.id === 'charges' ? 'running' :
                    phase === 'running' ? 'ok' :
                    step.id === 'balances' && (p.openBalances || []).length > 0 ? 'warn' :
                    step.id === 'rooms'    && (p.oooRooms || []).length > 0 ? 'warn' :
                    step.id === 'noshows' && (p.noShows?.length || 0) > 0 && !markNoShows ? 'warn' :
                    'ok'
                  }
                  warn={
                    step.id === 'balances' && (p.openBalances || []).length > 0
                      ? `${p.openBalances.length} אורחים עם יתרה פתוחה` : null
                  }
                />
              ))}
            </div>
          )}

          {/* Room charges preview */}
          {phase !== 'done' && (p.roomCharges || []).length > 0 && (
            <div className="card mb-5 overflow-hidden">
              <div className="card-header">
                <span className="font-semibold text-ink text-sm">חיובי לינה לפוסטינג ({p.roomCharges.length})</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>אישור</th><th>אורח</th><th>חדר</th><th>סוג</th><th>חיוב</th></tr>
                </thead>
                <tbody>
                  {p.roomCharges.slice(0, 8).map(c => (
                    <tr key={c.reservationId}>
                      <td className="font-mono text-xs text-brand">{c.confirmationNumber}</td>
                      <td className="font-medium text-sm">{c.guest}</td>
                      <td className="text-num font-bold">{c.room}</td>
                      <td className="text-xs text-ink-muted">{c.roomType}</td>
                      <td className="text-num font-bold text-emerald-600">₪{c.amount}</td>
                    </tr>
                  ))}
                  {p.roomCharges.length > 8 && (
                    <tr><td colSpan={5} className="text-xs text-ink-faint text-center py-2">ועוד {p.roomCharges.length - 8} חיובים...</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* No-shows */}
          {phase !== 'done' && (p.noShows || []).length > 0 && (
            <div className="card mb-5 overflow-hidden">
              <div className="card-header">
                <span className="font-semibold text-ink text-sm text-amber-600">הזמנות שלא הגיעו ({p.noShows.length})</span>
              </div>
              <div className="px-4 py-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-ink-secondary mb-3">
                  <input type="checkbox" checked={markNoShows} onChange={e => setMarkNoShows(e.target.checked)} className="rounded" />
                  סמן הזמנות אלו כ-No Show אוטומטית
                </label>
                <div className="flex flex-col gap-1">
                  {p.noShows.map(ns => (
                    <div key={ns.reservationId} className="text-xs text-ink-secondary flex items-center gap-2">
                      <span className="font-mono text-brand">{ns.confirmationNumber}</span>
                      <span>{ns.guest}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {phase === 'preview' && (
            <div className="flex gap-3">
              <button
                className="btn btn-primary flex-1 justify-center gap-2 py-3 text-base"
                onClick={() => setPhase('confirm')}
                disabled={!!alreadyRan}
              >
                <Moon size={18} /> {alreadyRan ? 'כבר הורץ היום' : 'הפעל Night Audit'}
              </button>
            </div>
          )}

          {phase === 'confirm' && (
            <div className="card p-5 border-brand bg-brand/5">
              <div className="font-bold text-ink text-center mb-2">אישור סופי</div>
              <div className="text-sm text-ink-muted text-center mb-4">
                פעולה זו תפרסם {p.roomCharges?.length || 0} חיובי לינה ותסגור את יום {TODAY}.
                <br/>לא ניתן לבטל לאחר הרצה.
              </div>
              <div className="flex gap-3">
                <button className="btn btn-secondary flex-1 justify-center" onClick={() => setPhase('preview')}>חזרה</button>
                <button className="btn btn-primary flex-1 justify-center gap-2" onClick={runAudit} disabled={runLoading}>
                  {runLoading ? <><Spinner size={16} /> מריץ...</> : <><Play size={16} /> אישור והרצה</>}
                </button>
              </div>
            </div>
          )}

          {/* Done state */}
          {phase === 'done' && result && (
            <div className="card p-6 text-center border-emerald-200 bg-emerald-50/30">
              <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-3" />
              <div className="text-xl font-black text-ink mb-1">Night Audit הושלם!</div>
              <div className="text-sm text-ink-muted mb-4">{result.message}</div>
              <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto mb-4">
                <div className="bg-white rounded-xl p-3 border border-emerald-200">
                  <div className="text-2xl font-black text-num text-emerald-600">{result.chargesPosted}</div>
                  <div className="text-xs text-ink-muted">חיובים</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-emerald-200">
                  <div className="text-2xl font-black text-num text-amber-500">{result.noShowsMarked}</div>
                  <div className="text-xs text-ink-muted">No Show</div>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 text-right">
                  שגיאות: {result.errors.map(e => e.error).join(', ')}
                </div>
              )}
              <div className="flex gap-2 justify-center mt-3">
                <button className="btn btn-secondary" onClick={() => { setPhase('preview'); refetch(); }}>
                  הצג מחדש
                </button>
                <button className="btn btn-ghost" onClick={() => setTab('history')}>
                  <History size={14}/> היסטוריה
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
