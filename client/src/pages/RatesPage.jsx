import { useState, useCallback } from 'react';
import { DollarSign, ChevronLeft, ChevronRight, Lock, RefreshCw, Sliders, Plus, Pencil, X } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { rates as ratesApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';
import { TODAY, addDays } from '../utils/date';

const DAYS = 14;

const PLAN_TYPES = [
  { value: 'public',    label: 'Public (BAR)' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'package',   label: 'Package' },
  { value: 'ota',       label: 'OTA' },
  { value: 'promo',     label: 'Promo' },
  { value: 'group',     label: 'Group' },
];

const DOW_HE = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
function parseDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    dow: DOW_HE[d.getDay()],
    day: String(d.getDate()).padStart(2, '0'),
    mo:  String(d.getMonth() + 1).padStart(2, '0'),
    isWeekend: d.getDay() >= 5,
  };
}

// ── Rate Plan Modal ───────────────────────────────────────────────────────────
function RatePlanModal({ plan, propertyId, onClose, onSaved }) {
  const isEdit = !!plan;
  const [form, setForm] = useState({
    code:               plan?.code || '',
    name:               plan?.name || '',
    type:               plan?.type || 'public',
    isRefundable:       plan?.isRefundable ?? true,
    includesBreakfast:  plan?.includesBreakfast ?? false,
    halfBoard:          plan?.halfBoard ?? false,
    fullBoard:          plan?.fullBoard ?? false,
    allInclusive:       plan?.allInclusive ?? false,
    cancellationPolicy: plan?.cancellationPolicy || '',
    depositPolicy:      plan?.depositPolicy || '',
    sortOrder:          plan?.sortOrder ?? 0,
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.code.trim() || !form.name.trim()) {
      return setError('קוד ושם חובה');
    }
    setLoading(true);
    setError('');
    try {
      if (isEdit) {
        await ratesApi.updatePlan(plan._id, form);
      } else {
        await ratesApi.createPlan({ ...form, propertyId });
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-lg" dir="rtl">
        <div className="modal-header">
          <span className="font-bold text-ink">{isEdit ? 'עריכת תכנית מחירים' : 'תכנית מחירים חדשה'}</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">קוד <span className="text-red-500">*</span></label>
              <input className="input w-full uppercase" placeholder="BAR" value={form.code}
                onChange={e => set('code', e.target.value.toUpperCase())}
                disabled={isEdit} />
            </div>
            <div>
              <label className="form-label">סוג תכנית</label>
              <select className="input w-full" value={form.type} onChange={e => set('type', e.target.value)}>
                {PLAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">שם תכנית <span className="text-red-500">*</span></label>
            <input className="input w-full" placeholder="Best Available Rate" value={form.name}
              onChange={e => set('name', e.target.value)} />
          </div>

          <div>
            <div className="text-xs font-bold text-ink-secondary mb-2">כולל ארוחות</div>
            <div className="flex flex-wrap gap-3">
              {[
                { key: 'includesBreakfast', label: 'ארוחת בוקר' },
                { key: 'halfBoard',         label: 'חצי פנסיון' },
                { key: 'fullBoard',         label: 'פנסיון מלא' },
                { key: 'allInclusive',      label: 'הכל כלול' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                  <input type="checkbox" checked={!!form[key]}
                    onChange={e => set(key, e.target.checked)} className="rounded" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
              <input type="checkbox" checked={form.isRefundable}
                onChange={e => set('isRefundable', e.target.checked)} className="rounded" />
              ניתן לביטול (Refundable)
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">מדיניות ביטול</label>
              <input className="input w-full" placeholder="ביטול חינם עד 24 שעות לפני הגעה"
                value={form.cancellationPolicy} onChange={e => set('cancellationPolicy', e.target.value)} />
            </div>
            <div>
              <label className="form-label">מדיניות פיקדון</label>
              <input className="input w-full" placeholder="לילה ראשון מראש"
                value={form.depositPolicy} onChange={e => set('depositPolicy', e.target.value)} />
            </div>
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary gap-2" onClick={save} disabled={loading}>
            {loading && <Spinner size={14} />} שמור
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cell popover ──────────────────────────────────────────────────────────────
function CellPopover({ roomTypeId, date, cell, ratePlanId, onSave, onClose, saving }) {
  const [price,    setPrice]    = useState(String(cell?.price ?? ''));
  const [stopSell, setStopSell] = useState(cell?.stopSell ?? false);
  const [minLos,   setMinLos]   = useState(String(cell?.minLos ?? 1));
  const [maxLos,   setMaxLos]   = useState(String(cell?.maxLos ?? ''));
  const [cta,      setCta]      = useState(cell?.cta ?? false);
  const [ctd,      setCtd]      = useState(cell?.ctd ?? false);

  function handleKey(e) {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') onClose();
  }

  function doSave() {
    onSave({
      ratePlanId, roomTypeId, date,
      price: Number(price),
      stopSell,
      minLos: Number(minLos) || 1,
      maxLos: maxLos ? Number(maxLos) : null,
      cta,
      ctd,
    });
  }

  return (
    <div
      className="absolute z-50 bg-white border border-surface-border rounded-xl shadow-2xl p-4 w-56 text-right"
      style={{ top: '100%', right: 0 }}
      onKeyDown={handleKey}
    >
      <div className="text-xs font-bold text-ink mb-3 border-b border-surface-border pb-2">{date}</div>

      <label className="block text-xs text-ink-muted mb-1">מחיר (₪)</label>
      <input type="number" className="input input-sm w-full mb-2 text-left"
        value={price} onChange={e => setPrice(e.target.value)} min={0} autoFocus />

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-xs text-ink-muted mb-1">מינ׳ לינות</label>
          <input type="number" className="input input-sm w-full text-left"
            value={minLos} onChange={e => setMinLos(e.target.value)} min={1} />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">מקס׳ לינות</label>
          <input type="number" className="input input-sm w-full text-left"
            value={maxLos} onChange={e => setMaxLos(e.target.value)} min={1} placeholder="—" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-3">
        <label className="flex items-center gap-2 cursor-pointer text-xs text-ink">
          <input type="checkbox" checked={stopSell} onChange={e => setStopSell(e.target.checked)} className="rounded" />
          Stop Sell (חסום)
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-xs text-ink">
          <input type="checkbox" checked={cta} onChange={e => setCta(e.target.checked)} className="rounded" />
          CTA — סגור להגעה
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-xs text-ink">
          <input type="checkbox" checked={ctd} onChange={e => setCtd(e.target.checked)} className="rounded" />
          CTD — סגור ליציאה
        </label>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-sm btn-secondary flex-1" onClick={onClose}>ביטול</button>
        <button className="btn btn-sm btn-primary flex-1" onClick={doSave} disabled={saving || !price}>
          {saving ? <Spinner size={13} /> : 'שמור'}
        </button>
      </div>
    </div>
  );
}

// ── Bulk edit modal ───────────────────────────────────────────────────────────
function BulkModal({ ratePlanId, roomTypes, onClose, onDone, onError }) {
  const [roomTypeId, setRoomTypeId] = useState('all');
  const [from,       setFrom]       = useState(TODAY);
  const [to,         setTo]         = useState(addDays(TODAY, 13));
  const [price,      setPrice]      = useState('');
  const [stopSell,   setStopSell]   = useState(false);
  const [minLos,     setMinLos]     = useState('1');
  const [maxLos,     setMaxLos]     = useState('');
  const [cta,        setCta]        = useState(false);
  const [ctd,        setCtd]        = useState(false);
  const [loading,    setLoading]    = useState(false);

  async function apply() {
    if (!price) return;
    setLoading(true);
    try {
      const targets = roomTypeId === 'all'
        ? roomTypes.map(rt => String(rt._id))
        : [roomTypeId];
      await Promise.all(targets.map(rtId =>
        ratesApi.bulk({
          ratePlanId, roomTypeId: rtId, from, to,
          price: Number(price), stopSell, minLos: Number(minLos) || 1,
          maxLos: maxLos ? Number(maxLos) : null,
          cta, ctd,
        })
      ));
      onDone();
    } catch (e) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-md" dir="rtl">
        <div className="modal-header">
          <span className="font-bold text-ink">עדכון מחירים מרוכז</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body flex flex-col gap-4">
          <div>
            <label className="form-label">סוג חדר</label>
            <select className="input w-full" value={roomTypeId} onChange={e => setRoomTypeId(e.target.value)}>
              <option value="all">כל סוגי החדרים</option>
              {roomTypes.map(rt => (
                <option key={rt._id} value={String(rt._id)}>{rt.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">מתאריך</label>
              <input type="date" className="input w-full" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="form-label">עד תאריך</label>
              <input type="date" className="input w-full" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">מחיר (₪)</label>
              <input type="number" className="input w-full" placeholder="750"
                value={price} onChange={e => setPrice(e.target.value)} min={0} />
            </div>
            <div>
              <label className="form-label">מינ׳ לינות</label>
              <input type="number" className="input w-full"
                value={minLos} onChange={e => setMinLos(e.target.value)} min={1} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">מקס׳ לינות</label>
              <input type="number" className="input w-full" placeholder="—"
                value={maxLos} onChange={e => setMaxLos(e.target.value)} min={1} />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { state: stopSell, set: setStopSell, label: 'Stop Sell — חסום מכירה' },
              { state: cta,      set: setCta,      label: 'CTA — סגור להגעה' },
              { state: ctd,      set: setCtd,      label: 'CTD — סגור ליציאה' },
            ].map(({ state, set: setter, label }) => (
              <label key={label} className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                <input type="checkbox" checked={state} onChange={e => setter(e.target.checked)} className="rounded" />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary gap-2" onClick={apply} disabled={loading || !price}>
            {loading && <Spinner size={15} />} החל על הטווח
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-ink-muted mb-4 flex-wrap">
      <span className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded bg-brand/20 border border-brand/40" /> היום
      </span>
      <span className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> סופ״ש
      </span>
      <span className="flex items-center gap-1.5"><Lock size={11} className="text-red-500" /> Stop Sell</span>
      <span className="flex items-center gap-1.5"><span className="text-ink-faint font-mono text-[10px]">CTA</span> סגור להגעה</span>
      <span className="flex items-center gap-1.5"><span className="text-ink-faint font-mono text-[10px]">CTD</span> סגור ליציאה</span>
      <span className="flex items-center gap-1.5"><span className="text-ink-faint font-mono">2+</span> מינ׳ לינות</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RatesPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success, error: toastError } = useToast();

  const [startDate,  setStartDate]  = useState(TODAY);
  const [activePlan, setActivePlan] = useState(null);
  const [editCell,   setEditCell]   = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [showBulk,   setShowBulk]   = useState(false);
  const [planModal,  setPlanModal]  = useState(null); // null | 'new' | plan object

  const { data: plans, loading: plansLoading, refetch: refetchPlans } = useApi(
    () => ratesApi.plans(propertyId, true),
    [propertyId], skip
  );

  const activePlans = (plans || []).filter(p => p.active !== false);
  const planId = activePlan || (activePlans[0] ? String(activePlans[0]._id) : null);

  const { data: gridData, loading: gridLoading, error: gridError, refetch } = useApi(
    () => ratesApi.grid(propertyId, planId, startDate, DAYS),
    [propertyId, planId, startDate],
    skip || !planId
  );

  const rt    = gridData?.roomTypes || [];
  const dts   = gridData?.dates     || [];
  const cells = gridData?.grid      || {};

  const endDate = dts[dts.length - 1] || addDays(startDate, DAYS - 1);

  const navigate = useCallback((dir) => {
    setStartDate(prev => addDays(prev, dir * DAYS));
    setEditCell(null);
  }, []);

  async function saveCell(payload) {
    setSaving(true);
    try {
      await ratesApi.updateDate(payload);
      success('מחיר עודכן');
      setEditCell(null);
      refetch();
    } catch (e) {
      toastError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivatePlan(plan) {
    try {
      await ratesApi.updatePlan(plan._id, { active: false });
      refetchPlans();
      if (activePlan === String(plan._id)) setActivePlan(null);
      success('תכנית הושבתה');
    } catch (e) {
      toastError(e.message);
    }
  }

  if (skip || plansLoading) return <PageSpinner />;

  const currentPlanObj = activePlans.find(p => String(p._id) === planId);

  return (
    <div className="animate-fade-in" onClick={e => { if (!e.target.closest('[data-cell]')) setEditCell(null); }}>
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title flex items-center gap-2">
            <DollarSign size={22} className="text-brand" />
            ניהול מחירים
          </div>
          <div className="page-subtitle">{startDate} — {endDate}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-secondary gap-2" onClick={() => setPlanModal('new')}>
            <Plus size={14} /> תכנית חדשה
          </button>
          <button className="btn btn-secondary gap-2" onClick={() => setShowBulk(true)} disabled={!planId}>
            <Sliders size={15} /> עדכון מרוכז
          </button>
          <button className="btn btn-ghost btn-icon" onClick={refetch} title="רענן"><RefreshCw size={15} /></button>
          <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)}>
            <ChevronRight size={18} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => navigate(1)}>
            <ChevronLeft size={18} />
          </button>
        </div>
      </div>

      {/* Plan tabs */}
      {activePlans.length > 0 ? (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {activePlans.map(p => (
            <div key={p._id} className="flex items-center gap-0.5">
              <button
                onClick={() => { setActivePlan(String(p._id)); setEditCell(null); }}
                className={`btn btn-sm rounded-r-none ${planId === String(p._id) ? 'btn-primary' : 'btn-secondary'}`}
              >
                <span className="font-mono font-bold">{p.code}</span>
                <span className="text-xs opacity-70 mr-1">— {p.name}</span>
                {p.includesBreakfast && <span className="text-[10px] opacity-60 mr-0.5">🍳</span>}
                {p.halfBoard && <span className="text-[10px] opacity-60 mr-0.5">🍽</span>}
                {p.allInclusive && <span className="text-[10px] opacity-60 mr-0.5">⭐</span>}
              </button>
              <button
                className={`btn btn-sm rounded-l-none border-r-0 ${planId === String(p._id) ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPlanModal(p)}
                title="ערוך תכנית"
              >
                <Pencil size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-6 text-center text-ink-muted mb-4">
          אין תכניות מחירים פעילות.{' '}
          <button className="text-brand font-semibold hover:underline" onClick={() => setPlanModal('new')}>
            צור תכנית ראשונה
          </button>
        </div>
      )}

      <Legend />

      {/* Grid */}
      {gridLoading ? (
        <div className="flex justify-center py-16"><Spinner size={32} /></div>
      ) : gridError ? (
        <ErrorState message={gridError} onRetry={refetch} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: '700px' }}>
              <thead>
                <tr className="border-b border-surface-border bg-surface-hover/60">
                  <th className="text-right px-4 py-2.5 font-semibold text-ink-secondary text-xs sticky right-0 bg-surface-hover/60 z-20 min-w-36 border-l border-surface-border">
                    סוג חדר
                  </th>
                  {dts.map(date => {
                    const { dow, day, mo, isWeekend } = parseDateLabel(date);
                    const isToday = date === TODAY;
                    return (
                      <th
                        key={date}
                        className={`px-1 py-2 text-center font-medium min-w-[64px] text-xs select-none ${
                          isToday ? 'bg-brand/15 text-brand' :
                          isWeekend ? 'bg-amber-50/80 text-amber-700' :
                          'text-ink-muted'
                        }`}
                      >
                        <div className="text-[10px] opacity-70">{dow}׳</div>
                        <div className="font-bold text-xs">{day}/{mo}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rt.length === 0 ? (
                  <tr>
                    <td colSpan={dts.length + 1} className="text-center py-16 text-ink-faint text-sm">
                      אין נתוני מחירים לתכנית זו — לחץ על תא כדי להזין מחיר
                    </td>
                  </tr>
                ) : rt.map(roomType => {
                  const rtId = String(roomType._id);
                  const rtCells = cells[rtId] || {};
                  return (
                    <tr key={rtId} className="border-b border-surface-border/40 hover:bg-surface-hover/20 transition-colors">
                      <td className="px-4 py-2 text-right sticky right-0 bg-surface z-10 border-l border-surface-border">
                        <div className="font-semibold text-ink text-sm">{roomType.name}</div>
                        <div className="text-[10px] text-ink-faint font-mono">{roomType.code}</div>
                      </td>
                      {dts.map(date => {
                        const cell = rtCells[date];
                        const isEditing = editCell?.roomTypeId === rtId && editCell?.date === date;
                        const { isWeekend } = parseDateLabel(date);
                        const isToday = date === TODAY;
                        const hasRestriction = cell?.stopSell || cell?.cta || cell?.ctd;

                        return (
                          <td
                            key={date}
                            data-cell="true"
                            className={`px-0.5 py-0.5 text-center relative ${
                              isToday ? 'bg-brand/5' : isWeekend ? 'bg-amber-50/20' : ''
                            }`}
                          >
                            <button
                              data-cell="true"
                              className={`w-full min-w-[60px] rounded-lg px-1 py-2 text-center transition-all group ${
                                isEditing
                                  ? 'ring-2 ring-brand bg-brand/5'
                                  : cell
                                    ? 'hover:bg-brand/8 hover:ring-1 hover:ring-brand/30'
                                    : 'hover:bg-surface-hover'
                              } ${cell?.stopSell ? 'opacity-55' : ''}`}
                              onClick={e => {
                                e.stopPropagation();
                                setEditCell(isEditing ? null : { roomTypeId: rtId, date });
                              }}
                            >
                              {cell ? (
                                <>
                                  <div className={`text-xs font-bold text-num leading-tight ${
                                    cell.stopSell ? 'line-through text-ink-faint' : 'text-ink'
                                  }`}>
                                    ₪{cell.price.toLocaleString()}
                                  </div>
                                  <div className="flex items-center justify-center gap-0.5 mt-0.5 h-3">
                                    {cell.stopSell && <Lock size={9} className="text-red-500" />}
                                    {cell.cta  && <span className="text-[8px] font-mono text-orange-500 leading-none">CTA</span>}
                                    {cell.ctd  && <span className="text-[8px] font-mono text-blue-500 leading-none">CTD</span>}
                                    {cell.minLos > 1 && (
                                      <span className="text-[9px] text-ink-faint font-mono">{cell.minLos}+</span>
                                    )}
                                    {cell.maxLos && (
                                      <span className="text-[9px] text-ink-faint font-mono">/{cell.maxLos}</span>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <div className="text-ink-faint/30 text-base group-hover:text-ink-faint/60 transition-colors">+</div>
                              )}
                            </button>
                            {isEditing && (
                              <CellPopover
                                roomTypeId={rtId}
                                date={date}
                                cell={cell}
                                ratePlanId={planId}
                                onSave={saveCell}
                                onClose={() => setEditCell(null)}
                                saving={saving}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {planModal && (
        <RatePlanModal
          plan={planModal === 'new' ? null : planModal}
          propertyId={propertyId}
          onClose={() => setPlanModal(null)}
          onSaved={() => {
            setPlanModal(null);
            refetchPlans();
            success(planModal === 'new' ? 'תכנית נוצרה' : 'תכנית עודכנה');
          }}
        />
      )}

      {showBulk && planId && (
        <BulkModal
          ratePlanId={planId}
          roomTypes={rt}
          onClose={() => setShowBulk(false)}
          onDone={() => { setShowBulk(false); success('מחירים עודכנו בהצלחה'); refetch(); }}
          onError={toastError}
        />
      )}
    </div>
  );
}
