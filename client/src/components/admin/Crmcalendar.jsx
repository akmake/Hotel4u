// client/src/components/admin/CRMCalendar.jsx
// ✅ שודרג: סינון לפי מלון, סטטיסטיקות, תאריך עברי-לועזי

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/utils/api';
import { Loader2, Calendar, ChevronLeft, ChevronRight, Hotel, ArrowRight, Filter } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';

const GREG_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const DAY_NAMES = ['א\'','ב\'','ג\'','ד\'','ה\'','ו\'','ש\''];

function getHebrewDayStr(date) {
  try { return new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric' }).format(date); }
  catch { return ''; }
}

function getHebrewMonthYear(date) {
  try { return new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { month: 'long', year: 'numeric' }).format(date); }
  catch { return ''; }
}

function DayOrderCard({ order }) {
  const navigate = useNavigate();
  const statusColors = {
    'בוצע': 'bg-emerald-100 text-emerald-700', 'placed': 'bg-emerald-100 text-emerald-700',
    'בטיפול': 'bg-amber-100 text-amber-700', 'in_progress': 'bg-amber-100 text-amber-700',
    'בהמתנה': 'bg-blue-100 text-blue-700', 'sent': 'bg-blue-100 text-blue-700',
  };
  const statusLabel = { 'placed': 'בוצע', 'in_progress': 'בטיפול', 'sent': 'נשלחה הצעה', 'cancelled': 'בוטל', 'not_relevant': 'לא רלוונטי' };
  const statusClass = statusColors[order.status] || 'bg-slate-100 text-slate-600';

  return (
    <div onClick={() => navigate(`/edit-order/${order._id}`)}
      className="bg-white border border-slate-200 rounded-xl p-3 hover:border-blue-400 hover:shadow-md cursor-pointer transition-all flex justify-between items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">#{order.orderNumber}</span>
          <span className="text-sm text-slate-600 truncate">{order.customerName}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
          <Hotel size={11} /><span>{order.hotel?.name || 'מלון'}</span>
          <span>•</span><span>{order.numberOfNights} {order.numberOfNights === 1 ? 'לילה' : 'לילות'}</span>
          <span>•</span><span>{order.total_price?.toLocaleString()}₪</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mr-2 flex-shrink-0">
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${statusClass}`}>
          {statusLabel[order.status] || order.status}
        </span>
        <ArrowRight size={14} className="text-slate-300" />
      </div>
    </div>
  );
}

export default function CRMCalendar() {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1);
  const [calendarOrders, setCalendarOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedHotel, setSelectedHotel] = useState('all'); // ✅ חדש: סינון מלון

  // ✅ שליפת רשימת מלונות
  const { data: hotels = [] } = useQuery({
    queryKey: ['hotels-for-calendar'],
    queryFn: async () => {
      const { data } = await api.get('/admin/hotels');
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const fetchCalendar = async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/customer-card/calendar', {
          params: { year: currentYear, month: currentMonth }
        });
        setCalendarOrders(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching calendar:', err);
        setCalendarOrders([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCalendar();
    setSelectedDay(null);
  }, [currentYear, currentMonth]);

  // ✅ סינון לפי מלון
  const filteredOrders = useMemo(() => {
    if (selectedHotel === 'all') return calendarOrders;
    return calendarOrders.filter(o => o.hotel?._id === selectedHotel || o.hotel?.name === selectedHotel);
  }, [calendarOrders, selectedHotel]);

  // מפת ימים → הזמנות
  const dayOrdersMap = useMemo(() => {
    const map = {};
    filteredOrders.forEach(order => {
      const start = new Date(order.eventDate);
      const nights = order.numberOfNights || 1;
      for (let i = 0; i < nights; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        if (!map[key]) map[key] = [];
        if (!map[key].some(o => o._id === order._id)) map[key].push(order);
      }
    });
    return map;
  }, [filteredOrders]);

  const prevMonth = () => {
    if (currentMonth === 1) { setCurrentMonth(12); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 12) { setCurrentMonth(1); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const lastDay = new Date(currentYear, currentMonth, 0);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const cells = [];
  for (let i = 0; i < startDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const hebrewTitle = getHebrewMonthYear(firstDay);

  // סטטיסטיקות
  const monthStats = useMemo(() => {
    const total = filteredOrders.length;
    const confirmed = filteredOrders.filter(o => o.status === 'בוצע' || o.status === 'placed').length;
    const pending = filteredOrders.filter(o => ['בטיפול','in_progress','בהמתנה','sent'].includes(o.status)).length;
    const totalNights = filteredOrders.reduce((sum, o) => sum + (o.numberOfNights || 1), 0);
    const totalRevenue = filteredOrders.filter(o => o.status === 'בוצע' || o.status === 'placed').reduce((sum, o) => sum + (o.total_price || 0), 0);
    return { total, confirmed, pending, totalNights, totalRevenue };
  }, [filteredOrders]);

  return (
    <div className="space-y-4">
      {/* ✅ סינון מלון + סטטיסטיקות */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="bg-white rounded-xl p-3 border border-slate-200 flex items-center gap-2 md:w-64">
          <Filter size={16} className="text-slate-400" />
          <Select value={selectedHotel} onValueChange={setSelectedHotel}>
            <SelectTrigger className="border-0 shadow-none h-8 text-sm"><SelectValue placeholder="כל המלונות" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המלונות</SelectItem>
              {hotels.map(h => <SelectItem key={h._id} value={h._id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl p-3 border border-slate-200 text-center">
            <div className="text-2xl font-bold text-slate-800">{monthStats.total}</div>
            <div className="text-xs text-slate-400">סה״כ</div>
          </div>
          <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 text-center">
            <div className="text-2xl font-bold text-emerald-700">{monthStats.confirmed}</div>
            <div className="text-xs text-emerald-500">מאושרות</div>
          </div>
          <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 text-center">
            <div className="text-2xl font-bold text-amber-700">{monthStats.pending}</div>
            <div className="text-xs text-amber-500">בטיפול</div>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 border border-blue-200 text-center">
            <div className="text-2xl font-bold text-blue-700">{monthStats.totalNights}</div>
            <div className="text-xs text-blue-500">לילות</div>
          </div>
          <div className="bg-purple-50 rounded-xl p-3 border border-purple-200 text-center">
            <div className="text-2xl font-bold text-purple-700">{monthStats.totalRevenue.toLocaleString()}₪</div>
            <div className="text-xs text-purple-500">הכנסות</div>
          </div>
        </div>
      </div>

      {/* לוח שנה */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={prevMonth} className="text-white hover:bg-white/10 rounded-full"><ChevronRight size={20} /></Button>
          <div className="text-center">
            <div className="text-lg font-bold">{GREG_MONTHS[currentMonth - 1]} {currentYear}</div>
            <div className="text-xs text-slate-300">{hebrewTitle}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={nextMonth} className="text-white hover:bg-white/10 rounded-full"><ChevronLeft size={20} /></Button>
        </div>

        <div className="grid grid-cols-7 bg-slate-50 border-b">
          {DAY_NAMES.map(d => <div key={d} className="text-center text-xs font-bold text-slate-400 py-2">{d}</div>)}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (!day) return <div key={`e-${idx}`} className="h-20 border-b border-r border-slate-50" />;

            const key = `${currentYear}-${currentMonth}-${day}`;
            const orders = dayOrdersMap[key] || [];
            const hasOrders = orders.length > 0;
            const isToday = key === todayKey;
            const isSelected = selectedDay?.day === day;
            const dateObj = new Date(currentYear, currentMonth - 1, day);
            const hebrewDay = getHebrewDayStr(dateObj);
            const isFriSat = dateObj.getDay() === 5 || dateObj.getDay() === 6;

            const hasConfirmed = orders.some(o => o.status === 'בוצע' || o.status === 'placed');
            const hasPending = orders.some(o => ['בטיפול','in_progress','בהמתנה','sent'].includes(o.status));

            return (
              <div key={key} onClick={() => setSelectedDay({ day, orders })}
                className={`h-20 border-b border-r border-slate-50 p-1.5 cursor-pointer transition-all hover:bg-blue-50/50 relative
                  ${isToday ? 'bg-blue-50/70 ring-1 ring-blue-300 ring-inset' : ''}
                  ${isSelected ? 'bg-blue-100 ring-2 ring-blue-500 ring-inset z-10' : ''}
                  ${isFriSat ? 'bg-slate-50/50' : ''}
                `}>
                <div className="flex justify-between items-start">
                  <span className={`text-sm font-bold leading-none ${isToday ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center' : 'text-slate-700'}`}>{day}</span>
                  <span className="text-[9px] text-slate-400 leading-none">{hebrewDay}</span>
                </div>
                {hasOrders && (
                  <div className="mt-1.5 flex items-center gap-1">
                    {hasConfirmed && <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />}
                    {hasPending && <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />}
                    <span className="text-[10px] font-bold text-slate-500">{orders.length}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedDay && (
          <div className="border-t-2 border-blue-200 p-4 bg-gradient-to-b from-blue-50/50 to-white max-h-80 overflow-y-auto">
            <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <Calendar size={14} className="text-blue-500" />
              <span>{selectedDay.day} {GREG_MONTHS[currentMonth - 1]} {currentYear}</span>
              <span className="text-slate-400">— {selectedDay.orders.length} הזמנות</span>
            </h4>
            {selectedDay.orders.length === 0
              ? <p className="text-sm text-slate-400 italic py-4 text-center">אין הזמנות ביום זה</p>
              : <div className="space-y-2">{selectedDay.orders.map(o => <DayOrderCard key={o._id} order={o} />)}</div>
            }
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-20">
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        )}
      </div>
    </div>
  );
}