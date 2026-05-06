import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BedDouble,
  Calendar,
  CheckCircle2,
  Copy,
  LogIn,
  LogOut,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react';
import { reservations as resApi, properties as propApi } from '../../utils/api';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../hooks/useToast';
import { Spinner } from '../ui/Spinner';
import { ToastContainer } from '../ui/Toast';
import { addDays } from '../../utils/date';

function toNum(v) {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function ReservationAdvancedTab({ res, propertyId, onRefresh }) {
  const resId = String(res?._id || '');
  const { success, error: toastErr, toasts } = useToast();
  const [loading, setLoading] = useState('');

  const [extendDeparture, setExtendDeparture] = useState(addDays(res.departureDate, 1));
  const [extendRate, setExtendRate] = useState('');
  const [earlyDeparture, setEarlyDeparture] = useState(res.departureDate);

  const [dupArrival, setDupArrival] = useState(res.arrivalDate);
  const [dupDeparture, setDupDeparture] = useState(res.departureDate);

  const [serviceDesc, setServiceDesc] = useState('');
  const [serviceAmount, setServiceAmount] = useState('');
  const [serviceQty, setServiceQty] = useState('1');
  const [serviceDepartment, setServiceDepartment] = useState('service');
  const [serviceDate, setServiceDate] = useState(res.arrivalDate);

  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [overridePartialClean, setOverridePartialClean] = useState(false);
  const [splitRoomIds, setSplitRoomIds] = useState([]);
  const [splitNotes, setSplitNotes] = useState('');
  const [splitGuestId, setSplitGuestId] = useState('');

  const [upgradeRoomId, setUpgradeRoomId] = useState('');
  const [upgradeRoomTypeId, setUpgradeRoomTypeId] = useState('');
  const [upgradeRate, setUpgradeRate] = useState('');
  const [upgradeReason, setUpgradeReason] = useState('');
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeTransferCharges, setMergeTransferCharges] = useState(true);
  const [groupId, setGroupId] = useState(res.group ? String(res.group) : '');
  const [groupCode, setGroupCode] = useState(res.groupCode || '');
  const [groupName, setGroupName] = useState(res.groupName || '');

  const { data: reservationRoomsData, loading: reservationRoomsLoading } = useApi(
    () => resApi.rooms(resId),
    [resId]
  );
  const { data: roomTypesData } = useApi(
    () => propApi.roomTypes(propertyId),
    [propertyId],
    !propertyId
  );
  const { data: mergeCandidatesData, loading: mergeCandidatesLoading } = useApi(
    () => resApi.list(propertyId, { search: mergeSearch, limit: 15 }),
    [propertyId, mergeSearch],
    !propertyId || mergeSearch.trim().length < 2
  );

  const reservationRooms = useMemo(
    () => (Array.isArray(reservationRoomsData) ? reservationRoomsData : []),
    [reservationRoomsData]
  );
  const roomTypes = useMemo(
    () => (Array.isArray(roomTypesData) ? roomTypesData : []),
    [roomTypesData]
  );
  const mergeCandidates = useMemo(() => {
    if (!Array.isArray(mergeCandidatesData)) return [];
    return mergeCandidatesData.filter((row) => {
      const rowId = String(row?._id || '');
      return (
        rowId &&
        rowId !== resId &&
        !['cancelled', 'checked_out', 'no_show'].includes(String(row?.status || ''))
      );
    });
  }, [mergeCandidatesData, resId]);

  useEffect(() => {
    setExtendDeparture(addDays(res.departureDate, 1));
    setExtendRate('');
    setEarlyDeparture(res.departureDate);
    setDupArrival(res.arrivalDate);
    setDupDeparture(res.departureDate);
    setServiceDate(res.arrivalDate);
    setSelectedRoomIds([]);
    setOverridePartialClean(false);
    setSplitRoomIds([]);
    setSplitNotes('');
    setSplitGuestId('');
    setUpgradeRoomId('');
    setUpgradeRoomTypeId('');
    setUpgradeRate('');
    setUpgradeReason('');
    setMergeSearch('');
    setMergeTargetId('');
    setMergeTransferCharges(true);
    setGroupId(res.group ? String(res.group) : '');
    setGroupCode(res.groupCode || '');
    setGroupName(res.groupName || '');
  }, [res._id, res.arrivalDate, res.departureDate, res.group, res.groupCode, res.groupName]);

  async function runAction(actionKey, fn, okMessage) {
    setLoading(actionKey);
    try {
      await fn();
      success(okMessage);
      onRefresh?.();
    } catch (e) {
      toastErr(e.message || 'פעולה נכשלה');
    } finally {
      setLoading('');
    }
  }

  function toggleRoom(roomId) {
    setSelectedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  }

  function isSelected(roomId) {
    return selectedRoomIds.includes(roomId);
  }
  function toggleSplitRoom(roomId) {
    setSplitRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  }
  function isSplitSelected(roomId) {
    return splitRoomIds.includes(roomId);
  }

  const selectedCount = selectedRoomIds.length;
  const splitCount = splitRoomIds.length;

  return (
    <div className="flex flex-col gap-5 p-5">
      <ToastContainer toasts={toasts} />

      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <Calendar size={11} /> התאמות תאריכים
        </div>
        <div className="card p-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">הארכת שהייה עד</label>
              <input
                type="date"
                className="input w-full text-sm"
                value={extendDeparture}
                min={addDays(res.departureDate, 1)}
                onChange={(e) => setExtendDeparture(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מחיר לילה חדש (אופציונלי)</label>
              <input
                type="number"
                className="input w-full text-sm"
                value={extendRate}
                min={0}
                onChange={(e) => setExtendRate(e.target.value)}
                placeholder="ללא שינוי מחיר"
              />
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm gap-1.5 self-start"
            disabled={!extendDeparture || loading === 'extend'}
            onClick={() =>
              runAction(
                'extend',
                () => resApi.extend(resId, { newDepartureDate: extendDeparture, nightlyRate: toNum(extendRate) }),
                'ההזמנה הוארכה'
              )
            }
          >
            {loading === 'extend' ? <Spinner size={12} /> : <Calendar size={12} />}
            הארכת שהייה
          </button>

          <div className="h-px bg-surface-border" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">קיצור שהייה עד</label>
              <input
                type="date"
                className="input w-full text-sm"
                value={earlyDeparture}
                min={addDays(res.arrivalDate, 1)}
                max={addDays(res.departureDate, -1)}
                onChange={(e) => setEarlyDeparture(e.target.value)}
              />
            </div>
            <div className="text-xs text-ink-muted flex items-end">
              תאריך הקיצור חייב להיות בין תאריך ההגעה לעזיבה הנוכחית.
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm gap-1.5 self-start"
            disabled={!earlyDeparture || loading === 'early'}
            onClick={() =>
              runAction(
                'early',
                () => resApi.earlyDeparture(resId, { newDepartureDate: earlyDeparture }),
                'הקיצור נשמר'
              )
            }
          >
            {loading === 'early' ? <Spinner size={12} /> : <AlertTriangle size={12} />}
            קיצור שהייה
          </button>
        </div>
      </section>

      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <BedDouble size={11} /> פעולות חדרים (Partial / Upgrade)
        </div>
        <div className="card p-4 flex flex-col gap-4">
          {reservationRoomsLoading ? (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Spinner size={12} /> טוען חדרים...
            </div>
          ) : reservationRooms.length === 0 ? (
            <div className="text-xs text-ink-faint">לא נמצאו חדרים להזמנה זו.</div>
          ) : (
            <>
              <div className="space-y-2">
                {reservationRooms.map((rr) => (
                  <label
                    key={String(rr._id)}
                    className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 cursor-pointer hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded"
                      checked={isSelected(String(rr._id))}
                      onChange={() => toggleRoom(String(rr._id))}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">
                        חדר {rr.assignedRoom?.number || 'לא שובץ'} · {rr.roomTypeBooked?.name || 'סוג לא ידוע'}
                      </div>
                      <div className="text-xs text-ink-muted">
                        סטטוס: {rr.status || 'reserved'} · {rr.arrivalDate} → {rr.departureDate}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 rounded"
                    checked={overridePartialClean}
                    onChange={(e) => setOverridePartialClean(e.target.checked)}
                  />
                  Override ניקיון (Partial Check-In)
                </label>
                <button
                  className="btn btn-primary btn-sm gap-1.5"
                  disabled={selectedCount === 0 || loading === 'partialIn'}
                  onClick={() =>
                    runAction(
                      'partialIn',
                      () => resApi.partialCheckIn(resId, selectedRoomIds, overridePartialClean),
                      `בוצע Partial Check-In ל-${selectedCount} חדרים`
                    )
                  }
                >
                  {loading === 'partialIn' ? <Spinner size={12} /> : <LogIn size={12} />}
                  Partial Check-In
                </button>
                <button
                  className="btn btn-secondary btn-sm gap-1.5"
                  disabled={selectedCount === 0 || loading === 'partialOut'}
                  onClick={() =>
                    runAction(
                      'partialOut',
                      () => resApi.partialCheckOut(resId, selectedRoomIds),
                      `בוצע Partial Check-Out ל-${selectedCount} חדרים`
                    )
                  }
                >
                  {loading === 'partialOut' ? <Spinner size={12} /> : <LogOut size={12} />}
                  Partial Check-Out
                </button>
              </div>

              <div className="h-px bg-surface-border" />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">חדר להזמנה לשדרוג</label>
                  <select
                    className="select w-full text-sm"
                    value={upgradeRoomId}
                    onChange={(e) => setUpgradeRoomId(e.target.value)}
                  >
                    <option value="">בחר חדר-שהייה...</option>
                    {reservationRooms.map((rr) => (
                      <option key={String(rr._id)} value={String(rr._id)}>
                        חדר {rr.assignedRoom?.number || 'לא שובץ'} · {rr.roomTypeBooked?.name || 'Unknown'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">סוג חדר חדש</label>
                  <select
                    className="select w-full text-sm"
                    value={upgradeRoomTypeId}
                    onChange={(e) => setUpgradeRoomTypeId(e.target.value)}
                  >
                    <option value="">ללא שינוי</option>
                    {roomTypes.map((rt) => (
                      <option key={String(rt._id)} value={String(rt._id)}>
                        {rt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">מחיר לילה חדש (אופציונלי)</label>
                  <input
                    type="number"
                    className="input w-full text-sm"
                    value={upgradeRate}
                    min={0}
                    onChange={(e) => setUpgradeRate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">סיבת שינוי</label>
                  <input
                    className="input w-full text-sm"
                    value={upgradeReason}
                    onChange={(e) => setUpgradeReason(e.target.value)}
                    placeholder="לדוגמה: שדרוג כפיצוי"
                  />
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm gap-1.5 self-start"
                disabled={!upgradeRoomId || loading === 'upgrade'}
                onClick={() =>
                  runAction(
                    'upgrade',
                    () =>
                      resApi.upgrade(resId, {
                        reservationRoomId: upgradeRoomId,
                        newRoomTypeId: upgradeRoomTypeId || undefined,
                        nightlyRate: toNum(upgradeRate),
                        reason: upgradeReason || undefined,
                      }),
                    'בוצע שדרוג בהצלחה'
                  )
                }
              >
                {loading === 'upgrade' ? <Spinner size={12} /> : <Sparkles size={12} />}
                שדרוג חדר/תעריף
              </button>
            </>
          )}
        </div>
      </section>

      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <Copy size={11} /> פעולות מסחריות
        </div>
        <div className="card p-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">תאריך הגעה לשכפול</label>
              <input
                type="date"
                className="input w-full text-sm"
                value={dupArrival}
                onChange={(e) => setDupArrival(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">תאריך עזיבה לשכפול</label>
              <input
                type="date"
                className="input w-full text-sm"
                value={dupDeparture}
                min={addDays(dupArrival, 1)}
                onChange={(e) => setDupDeparture(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm gap-1.5 self-start"
            disabled={!dupArrival || !dupDeparture || loading === 'duplicate'}
            onClick={() =>
              runAction(
                'duplicate',
                () => resApi.duplicate(resId, { arrivalDate: dupArrival, departureDate: dupDeparture }),
                'נוצרה הזמנה משוכפלת'
              )
            }
          >
            {loading === 'duplicate' ? <Spinner size={12} /> : <Copy size={12} />}
            שכפול הזמנה
          </button>

          <div className="h-px bg-surface-border" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-ink-secondary block mb-1">תיאור שירות</label>
              <input
                className="input w-full text-sm"
                value={serviceDesc}
                onChange={(e) => setServiceDesc(e.target.value)}
                placeholder="לדוגמה: SPA / ארוחת ערב / שובר"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">סכום יחידה</label>
              <input
                type="number"
                className="input w-full text-sm"
                value={serviceAmount}
                min={0}
                onChange={(e) => setServiceAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">כמות</label>
              <input
                type="number"
                className="input w-full text-sm"
                value={serviceQty}
                min={1}
                onChange={(e) => setServiceQty(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מחלקה</label>
              <input
                className="input w-full text-sm"
                value={serviceDepartment}
                onChange={(e) => setServiceDepartment(e.target.value)}
                placeholder="service"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">תאריך שירות</label>
              <input
                type="date"
                className="input w-full text-sm"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm gap-1.5 self-start"
            disabled={!serviceDesc.trim() || !toNum(serviceAmount) || loading === 'service'}
            onClick={() =>
              runAction(
                'service',
                () =>
                  resApi.addService(resId, {
                    description: serviceDesc.trim(),
                    amount: toNum(serviceAmount),
                    quantity: Math.max(1, toNum(serviceQty) || 1),
                    department: serviceDepartment || 'service',
                    serviceDate: serviceDate || undefined,
                  }),
                'חיוב שירות נוסף לפוליו'
              )
            }
          >
            {loading === 'service' ? <Spinner size={12} /> : <Plus size={12} />}
            הוסף חיוב שירות
          </button>
        </div>
      </section>

      <section>
        <div className="text-xs font-bold text-ink-secondary mb-2 flex items-center gap-1.5">
          <Users size={11} /> Split / Merge / Group
        </div>
        <div className="card p-4 flex flex-col gap-4">
          <div className="text-xs font-semibold text-ink-secondary">Split Reservation</div>
          {reservationRooms.length === 0 ? (
            <div className="text-xs text-ink-faint">No reservation rooms found for split.</div>
          ) : (
            <>
              <div className="space-y-2">
                {reservationRooms.map((rr) => (
                  <label
                    key={`split-${String(rr._id)}`}
                    className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 cursor-pointer hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded"
                      checked={isSplitSelected(String(rr._id))}
                      onChange={() => toggleSplitRoom(String(rr._id))}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">
                        Room {rr.assignedRoom?.number || 'Unassigned'} · {rr.roomTypeBooked?.name || 'Unknown'}
                      </div>
                      <div className="text-xs text-ink-muted">
                        {rr.arrivalDate} → {rr.departureDate}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">New primary guest ID (optional)</label>
                  <input
                    className="input w-full text-sm"
                    value={splitGuestId}
                    onChange={(e) => setSplitGuestId(e.target.value)}
                    placeholder="Guest ObjectId"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-secondary block mb-1">Split notes (optional)</label>
                  <input
                    className="input w-full text-sm"
                    value={splitNotes}
                    onChange={(e) => setSplitNotes(e.target.value)}
                    placeholder="Reason / internal note"
                  />
                </div>
              </div>
              <button
                className="btn btn-secondary btn-sm gap-1.5 self-start"
                disabled={splitCount === 0 || loading === 'split'}
                onClick={() =>
                  runAction(
                    'split',
                    () =>
                      resApi.split(resId, {
                        reservationRoomIds: splitRoomIds,
                        newPrimaryGuestId: splitGuestId || undefined,
                        notes: splitNotes || undefined,
                      }),
                    `Split created from ${splitCount} selected rooms`
                  )
                }
              >
                {loading === 'split' ? <Spinner size={12} /> : <Copy size={12} />}
                Split Reservation
              </button>
            </>
          )}

          <div className="h-px bg-surface-border" />

          <div className="text-xs font-semibold text-ink-secondary">Merge Reservation</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">Search target reservation</label>
              <input
                className="input w-full text-sm"
                value={mergeSearch}
                onChange={(e) => setMergeSearch(e.target.value)}
                placeholder="Confirmation / guest / phone"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">Target reservation ID</label>
              <input
                className="input w-full text-sm"
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                placeholder="Target Reservation ObjectId"
              />
            </div>
          </div>
          {mergeSearch.trim().length >= 2 && (
            <div className="rounded-lg border border-surface-border overflow-hidden">
              {mergeCandidatesLoading ? (
                <div className="px-3 py-2 text-xs text-ink-muted flex items-center gap-2">
                  <Spinner size={12} /> Searching...
                </div>
              ) : mergeCandidates.length === 0 ? (
                <div className="px-3 py-2 text-xs text-ink-faint">No matching reservations</div>
              ) : (
                <div className="max-h-40 overflow-y-auto divide-y divide-surface-border">
                  {mergeCandidates.map((candidate) => (
                    <button
                      type="button"
                      key={String(candidate._id)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-surface-hover"
                      onClick={() => setMergeTargetId(String(candidate._id))}
                    >
                      <div className="font-semibold text-ink">
                        {candidate.confirmationNumber} · {candidate.primaryGuest?.firstName || ''} {candidate.primaryGuest?.lastName || ''}
                      </div>
                      <div className="text-ink-muted">{candidate.arrivalDate} → {candidate.departureDate} · {candidate.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 rounded"
              checked={mergeTransferCharges}
              onChange={(e) => setMergeTransferCharges(e.target.checked)}
            />
            Transfer folio charges from source to target
          </label>
          <button
            className="btn btn-primary btn-sm gap-1.5 self-start"
            disabled={!mergeTargetId.trim() || loading === 'merge'}
            onClick={() =>
              runAction(
                'merge',
                () => resApi.merge(mergeTargetId.trim(), resId, mergeTransferCharges),
                'Merge completed'
              )
            }
          >
            {loading === 'merge' ? <Spinner size={12} /> : <Sparkles size={12} />}
            Merge Into Target
          </button>

          <div className="h-px bg-surface-border" />

          <div className="text-xs font-semibold text-ink-secondary">Group Link</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">Group ID</label>
              <input
                className="input w-full text-sm"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="Group ObjectId (optional)"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">Group Code</label>
              <input
                className="input w-full text-sm"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                placeholder="e.g. CORP-APR26"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">Group Name</label>
              <input
                className="input w-full text-sm"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Corporate Group Name"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary btn-sm gap-1.5"
              disabled={loading === 'groupLink'}
              onClick={() =>
                runAction(
                  'groupLink',
                  () =>
                    resApi.linkGroup(resId, {
                      groupId: groupId || undefined,
                      groupCode: groupCode || undefined,
                      groupName: groupName || undefined,
                    }),
                  'Group link updated'
                )
              }
            >
              {loading === 'groupLink' ? <Spinner size={12} /> : <CheckCircle2 size={12} />}
              Save Group Link
            </button>
            <button
              className="btn btn-secondary btn-sm gap-1.5"
              disabled={loading === 'groupUnlink'}
              onClick={() =>
                runAction(
                  'groupUnlink',
                  () => resApi.linkGroup(resId, { groupId: null, groupCode: null, groupName: null }),
                  'Group link removed'
                )
              }
            >
              {loading === 'groupUnlink' ? <Spinner size={12} /> : <AlertTriangle size={12} />}
              Unlink Group
            </button>
          </div>
        </div>
      </section>

      <div className="text-xs text-ink-muted bg-surface-hover rounded-lg px-3 py-2 flex items-center gap-1.5">
        <CheckCircle2 size={11} className="text-brand" />
        פעולות כאן פועלות מול אותם endpoints שעברו QA ב-Stage 4.6.
      </div>
    </div>
  );
}
