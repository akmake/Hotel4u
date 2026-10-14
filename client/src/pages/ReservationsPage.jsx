import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Crown, ChevronLeft, ChevronRight,
  LogIn, LogOut, Users, X, SlidersHorizontal,
  ArrowUpDown, Building2, Globe, Phone, Footprints,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { reservations as resApi } from '../utils/api';
import { todayYmd } from '../utils/date';
import { PageSpinner, ErrorState } from '../components/ui/Spinner';
import ReservationDrawer from '../components/reservations/ReservationDrawer';

const PAGE_SIZE = 30;

/* ─── helpers ──────────────────────────────────────────────────────────────── */
function todayStr() { return todayYmd(); }

function fmtDate(d) {
  if (!d) return '—';
  return new Date(`${d}T00:00:00`).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function nightsBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

function initials(g) {
  if (!g) return '?';
  return ((g.firstName?.[0] || '') + (g.lastName?.[0] || '')).toUpperCase();
}

function useDebounce(value, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/* ─── status / payment config ──────────────────────────────────────────────── */
const STATUS = {
  confirmed:        { label: 'מאושר',     cls: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20'   },
  modified:         { label: 'שונה',      cls: 'bg-yellow-50 text-yellow-700 ring-yellow-600/20'   },
  in_house:         { label: 'בפנים',     cls: 'bg-green-50 text-green-700 ring-green-600/20'      },
  partially_checked_in: { label: 'כניסה חלקית', cls: 'bg-teal-50 text-teal-700 ring-teal-600/20'  },
  checked_out:      { label: 'יצא',       cls: 'bg-gray-100 text-gray-600 ring-gray-500/20'        },
  partially_checked_out: { label: 'יציאה חלקית', cls: 'bg-orange-50 text-orange-700 ring-orange-600/20' },
  cancelled:        { label: 'בוטל',      cls: 'bg-red-50 text-red-600 ring-red-600/20'            },
  no_show:          { label: 'No Show',   cls: 'bg-orange-50 text-orange-700 ring-orange-600/20'   },
  pending_payment:  { label: 'ממתין לתשלום', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20'  },
  hold:             { label: 'Hold',      cls: 'bg-sky-50 text-sky-700 ring-sky-600/20'            },
  waitlisted:       { label: 'רשימת המתנה', cls: 'bg-purple-50 text-purple-700 ring-purple-600/20' },
};

const PAY = {
  paid:        { label: 'שולם',       cls: 'bg-emerald-50 text-emerald-700' },
  partial:     { label: 'חלקי',       cls: 'bg-amber-50 text-amber-700'    },
  balance_due: { label: 'יתרה',       cls: 'bg-red-50 text-red-600'        },
  unpaid:      { label: 'לא שולם',    cls: 'bg-red-50 text-red-600'        },
  pending:     { label: 'ממתין',      cls: 'bg-gray-100 text-gray-600'     },
  refunded:    { label: 'הוחזר',      cls: 'bg-gray-100 text-gray-500'     },
};

const SOURCE_ICON = {
  booking: <Globe size={13} />,
  expedia: <Globe size={13} />,
  agoda:   <Globe size={13} />,
  airbnb:  <Globe size={13} />,
  direct:  <Building2 size={13} />,
  phone:   <Phone size={13} />,
  walk_in: <Footprints size={13} />,
  other:   <Globe size={13} />,
};

const SOURCE_LABEL = {
  direct: 'ישיר', booking: 'Booking', expedia: 'Expedia',
  agoda: 'Agoda', airbnb: 'Airbnb', phone: 'טלפון', walk_in: 'Walk-in', other: 'אחר',
};

/* ─── tab config ────────────────────────────────────────────────────────────── */
const STATUS_TABS = [
  { id: 'all',         label: 'הכל'           },
  { id: 'in_house',    label: 'בפנים'         },
  { id: 'confirmed',   label: 'מאושר'         },
  { id: 'checked_out', label: 'יצא'           },
  { id: 'cancelled',   label: 'בוטל'          },
  { id: 'no_show',     label: 'No Show'       },
];

/* ─── sub-components ────────────────────────────────────────────────────────── */
function StatusChip({ status }) {
  const cfg = STATUS[status] || { label: status, cls: 'bg-gray-100 text-gray-600 ring-gray-500/20' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function PayChip({ status }) {
  const cfg = PAY[status] || { label: status, cls: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function SourceBadge({ source }) {
  const icon = SOURCE_ICON[source] || <Globe size={13} />;
  const label = SOURCE_LABEL[source] || source;
  return (
    <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
      {icon} {label}
    </span>
  );
}

function Avatar({ guest, isVip }) {
  const letters = initials(guest);
  const isVvip = isVip || (guest?.vipLevel >= 3);
  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0
      ${isVvip ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
      {letters}
    </span>
  );
}

function FilterPill({ label, value, options, onChange }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 py-0 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{label ? `${label}: ` : ''}{o.label}</option>
      ))}
    </select>
  );
}

/* ─── main page ─────────────────────────────────────────────────────────────── */
export default function ReservationsPage() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const skip = !propertyId;

  /* filter state */
  const [statusTab,    setStatusTab]    = useState('all');
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const [search,       setSearch]       = useState(urlQuery);
  // global search in the top bar navigates here with ?q=
  useEffect(() => { if (urlQuery) setSearch(urlQuery); }, [urlQuery]);
  const [payFilter,    setPayFilter]    = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [showFilters,  setShowFilters]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [drawer,       setDrawer]       = useState(null);

  const debouncedSearch = useDebounce(search);

  /* reset page when filters change */
  useEffect(() => setPage(1), [statusTab, debouncedSearch, payFilter, sourceFilter, dateFrom, dateTo]);

  const params = {
    status:         statusTab !== 'all' ? statusTab : undefined,
    search:         debouncedSearch || undefined,
    paymentStatus:  payFilter !== 'all' ? payFilter : undefined,
    source:         sourceFilter !== 'all' ? sourceFilter : undefined,
    dateFrom:       dateFrom || undefined,
    dateTo:         dateTo || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data: raw, loading, error, refetch } = useApi(
    () => resApi.list(propertyId, params),
    [propertyId, statusTab, debouncedSearch, payFilter, sourceFilter, dateFrom, dateTo, page],
    skip,
  );

  if (skip) return <PageSpinner />;
  if (error && !raw) return <ErrorState message={error} onRetry={refetch} />;

  const list       = Array.isArray(raw) ? raw : (raw?.reservations || raw?.data || []);
  const totalCount = raw?.total ?? list.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const today      = todayStr();

  const arriving = list.filter(r => r.arrivalDate === today && r.status === 'confirmed').length;
  const departing = list.filter(r => r.departureDate === today && r.status === 'in_house').length;

  function handleRowClick(res) { setDrawer(res); }

  function clearFilters() {
    setSearch('');
    setPayFilter('all');
    setSourceFilter('all');
    setDateFrom('');
    setDateTo('');
    setStatusTab('all');
  }

  const hasActiveFilters = statusTab !== 'all' || search || payFilter !== 'all' || sourceFilter !== 'all' || dateFrom || dateTo;

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* ── Page header ───────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900">הזמנות</h1>
            {!loading && (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-medium text-gray-600">
                {totalCount.toLocaleString()}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {arriving > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                <LogIn size={12} /> {arriving} הגעות היום
              </span>
            )}
            {departing > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                <LogOut size={12} /> {departing} יציאות היום
              </span>
            )}
            <button
              onClick={() => navigate('/pms/reservations/new')}
              className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
            >
              <Plus size={15} />
              הזמנה חדשה
            </button>
          </div>
        </div>

        {/* ── Status tabs ─────────────────────────────────────────── */}
        <div className="mt-4 flex items-center gap-0 border-b border-gray-100 -mb-px">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${statusTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="חיפוש לפי שם, מספר אישור, טלפון..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pr-8 pl-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Toggle extra filters */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors
              ${showFilters ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
          >
            <SlidersHorizontal size={14} />
            סינון
            {hasActiveFilters && !showFilters && (
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                !
              </span>
            )}
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
            >
              <X size={13} /> נקה סינון
            </button>
          )}

          {/* Extra filter row */}
          {showFilters && (
            <>
              <FilterPill
                label="תשלום"
                value={payFilter}
                onChange={setPayFilter}
                options={[
                  { value: 'all',        label: 'כל תשלומים'   },
                  { value: 'paid',       label: 'שולם'          },
                  { value: 'balance_due',label: 'יתרה לתשלום'  },
                  { value: 'pending',    label: 'ממתין'         },
                  { value: 'partial',    label: 'חלקי'          },
                  { value: 'unpaid',     label: 'לא שולם'      },
                ]}
              />
              <FilterPill
                label="מקור"
                value={sourceFilter}
                onChange={setSourceFilter}
                options={[
                  { value: 'all',     label: 'כל המקורות' },
                  { value: 'direct',  label: 'ישיר'       },
                  { value: 'booking', label: 'Booking'    },
                  { value: 'expedia', label: 'Expedia'    },
                  { value: 'agoda',   label: 'Agoda'      },
                  { value: 'airbnb',  label: 'Airbnb'     },
                  { value: 'phone',   label: 'טלפון'      },
                  { value: 'walk_in', label: 'Walk-in'    },
                ]}
              />
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <span>מ-</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                />
                <span>עד</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Table area ────────────────────────────────────────────── */}
      <div className="px-6 py-4">
        {loading && !list.length ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">טוען...</div>
        ) : !list.length ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Users size={32} className="text-gray-300 mb-2" />
            <p className="text-gray-500 font-medium">אין הזמנות</p>
            <p className="text-gray-400 text-sm mt-0.5">נסה לשנות את הסינון</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">אישור</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">אורח</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">חדר / סוג</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">הגעה</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">יציאה</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">לילות</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">סטטוס</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">תשלום</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">מקור</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {list.map(res => {
                    const g = res.primaryGuest;
                    const nights = nightsBetween(res.arrivalDate, res.departureDate);
                    const isToday = res.arrivalDate === today;
                    const isDep   = res.departureDate === today;

                    return (
                      <tr
                        key={res._id}
                        onClick={() => handleRowClick(res)}
                        className="cursor-pointer hover:bg-blue-50/30 transition-colors group"
                      >
                        {/* Confirmation # */}
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-gray-500 group-hover:text-gray-700">
                            {res.confirmationNumber || res._id?.slice(-6).toUpperCase()}
                          </span>
                        </td>

                        {/* Guest */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar guest={g} isVip={res.isVip} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-gray-900 truncate">
                                  {g ? `${g.firstName} ${g.lastName}` : 'אורח לא ידוע'}
                                </span>
                                {res.isVip && <Crown size={11} className="text-amber-500 flex-shrink-0" />}
                              </div>
                              {g?.phone && (
                                <span className="text-xs text-gray-400">{g.phone}</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Room */}
                        <td className="px-4 py-3">
                          <div>
                            {res.assignedRoom ? (
                              <span className="font-semibold text-gray-900">{res.assignedRoom.number}</span>
                            ) : (
                              <span className="text-gray-400 text-xs">לא שויך</span>
                            )}
                            {res.roomType && (
                              <div className="text-xs text-gray-400 truncate max-w-[110px]">{res.roomType.name}</div>
                            )}
                          </div>
                        </td>

                        {/* Arrival */}
                        <td className="px-4 py-3">
                          <span className={`font-medium ${isToday ? 'text-indigo-700' : 'text-gray-700'}`}>
                            {fmtDate(res.arrivalDate)}
                          </span>
                          {isToday && (
                            <div className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">היום</div>
                          )}
                        </td>

                        {/* Departure */}
                        <td className="px-4 py-3">
                          <span className={`font-medium ${isDep ? 'text-amber-700' : 'text-gray-700'}`}>
                            {fmtDate(res.departureDate)}
                          </span>
                          {isDep && (
                            <div className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">היום</div>
                          )}
                        </td>

                        {/* Nights */}
                        <td className="px-4 py-3 text-center">
                          <span className="text-gray-600 font-medium">{nights || '—'}</span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusChip status={res.status} />
                        </td>

                        {/* Payment */}
                        <td className="px-4 py-3">
                          <PayChip status={res.paymentStatus} />
                        </td>

                        {/* Source */}
                        <td className="px-4 py-3">
                          <SourceBadge source={res.source} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ───────────────────────────────────────── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 bg-white px-4 py-3">
                <p className="text-sm text-gray-500">
                  מציג <span className="font-medium text-gray-700">{(page - 1) * PAGE_SIZE + 1}</span>–
                  <span className="font-medium text-gray-700">{Math.min(page * PAGE_SIZE, totalCount)}</span>
                  {' '}מתוך{' '}
                  <span className="font-medium text-gray-700">{totalCount.toLocaleString()}</span>
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={15} />
                  </button>
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors
                          ${page === p
                            ? 'bg-gray-900 text-white'
                            : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Reservation drawer ────────────────────────────────────── */}
      {drawer && (
        <ReservationDrawer
          reservationId={drawer._id}
          onClose={() => setDrawer(null)}
          onUpdated={() => { refetch(); setDrawer(null); }}
        />
      )}
    </div>
  );
}
