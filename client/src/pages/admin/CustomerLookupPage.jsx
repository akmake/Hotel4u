// client/src/pages/admin/CustomerLookupPage.jsx
// ✅ תיקונים: goToOrder URL תוקן, לוח שנה חדש, טאב calendar

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/utils/api';
import {
  Loader2, Search, Phone, Mail, Calendar, ArrowRight, User,
  Eye, History, Activity, Plus, FileText, Hotel, ArrowUpDown, Clock
} from 'lucide-react';
import { FaWhatsapp, FaFileInvoiceDollar, FaExchangeAlt, FaUserCheck } from 'react-icons/fa';

import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

// ✅ ייבוא רכיב הלוח שנה
import CRMCalendar from '@/components/admin/CRMCalendar';

// --- קונפיגורציה ויזואלית ---
const EVENT_CONFIG = {
  'order_created': { label: 'הזמנה חדשה', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-200 bg-emerald-500', icon: <FaFileInvoiceDollar size={16} /> },
  'message_in': { label: 'הודעת וואטסאפ', color: 'bg-green-50 text-green-700 border-green-200', ring: 'ring-green-200 bg-green-500', icon: <FaWhatsapp size={16} /> },
  'status_change': { label: 'שינוי סטטוס', color: 'bg-orange-50 text-orange-700 border-orange-200', ring: 'ring-orange-200 bg-orange-500', icon: <FaExchangeAlt size={16} /> },
  'call_out': { label: 'שיחה יוצאת', color: 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm', ring: 'ring-blue-300 bg-blue-600', icon: <Phone size={16} /> },
  'meeting': { label: 'פגישה פרונטלית', color: 'bg-purple-50 text-purple-700 border-purple-200 shadow-sm', ring: 'ring-purple-300 bg-purple-600', icon: <User size={16} /> },
  'note': { label: 'הערה / פתק', color: 'bg-yellow-50 text-yellow-800 border-yellow-200', ring: 'ring-yellow-200 bg-yellow-400', icon: <FileText size={16} /> },
  'default': { label: 'פעולה במערכת', color: 'bg-slate-50 text-slate-600 border-slate-200', ring: 'ring-slate-200 bg-slate-400', icon: <Activity size={16} /> }
};


export default function CustomerLookupPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail' | 'calendar'
  const [currentTab, setCurrentTab] = useState('active');
  const [sortMode, setSortMode] = useState('recent_activity');

  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1 });
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteType, setNewNoteType] = useState('call_out');

  useEffect(() => {
    if (viewMode === 'list') fetchCustomers(1, '', currentTab);
  }, [currentTab]);

  const fetchCustomers = async (page, searchQuery, tab) => {
    setLoading(true);
    try {
      const { data } = await api.get('/customer-card', {
        params: { page, query: searchQuery, tab }
      });
      if (data && data.mode === 'list') {
        setCustomers(Array.isArray(data.results) ? data.results : []);
        setPagination(data.pagination || { currentPage: 1, totalPages: 1 });
        setViewMode('list');
      }
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomerDetails = async (id) => {
    setLoading(true);
    try {
      const { data } = await api.get('/customer-card', { params: { id } });
      if (data && data.mode === 'detail') {
        setSelectedCustomer(data.result);
        setViewMode('detail');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddInteraction = async () => {
    if (!newNoteText.trim() || !selectedCustomer) return;
    try {
      await api.post(`/customer-card/${selectedCustomer._id}/timeline`, {
        type: newNoteType,
        description: newNoteText
      });
      await fetchCustomerDetails(selectedCustomer._id);
      setIsModalOpen(false);
      setNewNoteText('');
    } catch (error) {
      alert('שגיאה בשמירת התיעוד');
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchCustomers(1, query, currentTab);
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > pagination.totalPages) return;
    fetchCustomers(newPage, query, currentTab);
    window.scrollTo(0, 0);
  };

  // ✅ תיקון קריטי: הנתיב הנכון הוא /edit-order/ ולא /orders/edit/
  const goToOrder = (orderId) => {
    if (!orderId) return;
    navigate(`/edit-order/${orderId}`);
  };

  const getHebrewDate = (dateString) => {
    if (!dateString) return '';
    try {
      return new Intl.DateTimeFormat('he-IL', {
        calendar: 'hebrew', day: 'numeric', month: 'long', year: 'numeric'
      }).format(new Date(dateString));
    } catch (e) { return ''; }
  };

  const getSafeDate = (event) => {
    if (event.date) return new Date(event.date);
    if (event.timestamp) return new Date(event.timestamp);
    if (event._id) {
      try {
        const ts = parseInt(event._id.toString().substring(0, 8), 16) * 1000;
        return new Date(ts);
      } catch (e) {}
    }
    return null;
  };

  const getActiveOrders = (customer) => {
    if (!customer?.timeline) return [];
    const ordersMap = new Map();
    customer.timeline.forEach(event => {
      if (event.metadata?.orderId && event.metadata?.orderId?._id) {
        const order = event.metadata.orderId;
        if (order.eventDate) ordersMap.set(order._id, order);
      }
    });
    const today = new Date();
    today.setHours(0,0,0,0);
    return Array.from(ordersMap.values())
      .filter(order => new Date(order.eventDate) >= today && order.status !== 'cancelled' && order.status !== 'not_relevant')
      .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
  };

  const getSortedCustomers = () => {
    const safeList = Array.isArray(customers) ? [...customers] : [];
    return safeList.sort((a, b) => new Date(b.lastEventDate || 0) - new Date(a.lastEventDate || 0));
  };

  const safeCustomers = getSortedCustomers();
  const activeOrdersList = selectedCustomer ? getActiveOrders(selectedCustomer) : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 dir-rtl font-assistant min-h-screen bg-slate-50">

      {/* --- Header: חיפוש + טאבים --- */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {viewMode === 'detail' && (
              <Button variant="ghost" size="icon" onClick={() => setViewMode('list')} className="rounded-full h-10 w-10 hover:bg-slate-100">
                <ArrowRight className="h-6 w-6 text-slate-700" />
              </Button>
            )}
            <h1 className="text-2xl font-bold text-slate-900">CRM לקוחות</h1>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2 w-full md:w-auto">
            <div className="relative w-full md:w-80">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input placeholder="שם, טלפון או מייל..." value={query} onChange={(e) => setQuery(e.target.value)}
                className="pr-9 rounded-xl border-slate-200 bg-slate-50 focus:bg-white transition-all" />
            </div>
            <Button type="submit" disabled={loading} className="rounded-xl px-6 bg-slate-900 text-white hover:bg-black">
              {loading ? <Loader2 className="animate-spin" /> : 'חפש'}
            </Button>
          </form>
        </div>

        {/* טאבים: פעילים / ארכיון / לוח שנה */}
        {viewMode !== 'detail' && (
          <div className="flex flex-col sm:flex-row justify-between items-center border-t border-slate-100 pt-2 gap-4">
            <div className="flex gap-1">
              <button onClick={() => { setViewMode('list'); setCurrentTab('active'); }}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${viewMode === 'list' && currentTab === 'active' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                פעילים
              </button>
              <button onClick={() => { setViewMode('list'); setCurrentTab('archive'); }}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${viewMode === 'list' && currentTab === 'archive' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:bg-slate-50'}`}>
                ארכיון
              </button>
              <button onClick={() => setViewMode('calendar')}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition-all flex items-center gap-1.5 ${viewMode === 'calendar' ? 'bg-purple-50 text-purple-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                <Calendar size={14} /> לוח שנה
              </button>
            </div>

            {viewMode === 'list' && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">מיון לפי:</span>
                <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}
                  className="bg-transparent font-bold text-slate-700 border-none outline-none cursor-pointer hover:text-blue-600">
                  <option value="recent_activity">אינטראקציה אחרונה</option>
                  <option value="next_order">קרבה של הזמנה</option>
                </select>
                <ArrowUpDown size={14} className="text-slate-400"/>
              </div>
            )}
          </div>
        )}
      </div>

      {/* === לוח שנה === */}
      {viewMode === 'calendar' && <CRMCalendar />}

      {/* === רשימה === */}
      {viewMode === 'list' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {safeCustomers.map((cust) => (
              <div key={cust._id} onClick={() => fetchCustomerDetails(cust._id)}
                className="group relative bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden">
                <div className={`absolute right-0 top-0 bottom-0 w-1.5 ${cust.lifecycleStage === 'active_order' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                <div className="flex items-start justify-between mb-4 pr-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 line-clamp-1" title={cust.name}>{cust.name || 'ללא שם'}</h3>
                    <div className="text-sm font-mono text-slate-500 mt-0.5">{cust.phone}</div>
                  </div>
                  <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-700 font-bold text-lg shadow-inner">
                    {cust.name?.[0]}
                  </div>
                </div>
                <div className="flex flex-col gap-2 pr-3">
                  <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
                    <span className="text-xs text-slate-400">עדכון אחרון</span>
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Clock size={12}/>
                      {cust.lastEventDate ? new Date(cust.lastEventDate).toLocaleDateString('he-IL') : '-'}
                    </span>
                  </div>
                  {cust.lifecycleStage === 'active_order' && (
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                      <Hotel size={12}/> יש הזמנה פעילה
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={() => handlePageChange(pagination.currentPage + 1)}>טען עוד...</Button>
            </div>
          )}
        </div>
      )}

      {/* === פירוט לקוח === */}
      {viewMode === 'detail' && selectedCustomer && (
        <div className="animate-in zoom-in-95 duration-300">

          {/* כותרת + הזמנות קרובות */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6 flex flex-col lg:flex-row justify-between items-start gap-8">
            <div className="flex items-start gap-5">
              <div className="w-20 h-20 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-3xl font-bold shadow-lg transform rotate-3">
                {selectedCustomer.name?.[0] || '?'}
              </div>
              <div>
                <h2 className="text-3xl font-bold text-slate-900">{selectedCustomer.name}</h2>
                <div className="flex items-center gap-4 text-slate-500 mt-2 text-lg">
                  <span className="font-mono bg-slate-100 px-2 py-0.5 rounded-md">{selectedCustomer.phone}</span>
                </div>
                <Button onClick={() => setIsModalOpen(true)}
                  className="mt-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-200">
                  <Plus size={18} className="ml-2"/> תיעוד פעולה חדשה
                </Button>
              </div>
            </div>

            <div className="w-full lg:w-96 bg-slate-50 rounded-xl p-4 border border-slate-100">
              <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">הזמנות קרובות</h4>
              <div className="flex flex-col gap-3 max-h-48 overflow-y-auto">
                {activeOrdersList.length > 0 ? (
                  activeOrdersList.map((order) => (
                    <div key={order._id}
                      onClick={() => goToOrder(order._id)}
                      className="cursor-pointer bg-white border border-slate-200 hover:border-blue-400 p-3 rounded-xl shadow-sm hover:shadow-md transition-all flex justify-between items-center group">
                      <div>
                        <div className="text-xs font-bold text-blue-600 flex items-center gap-1">
                          <Hotel size={12} />
                          {order.hotel?.name || 'מלון כללי'}
                        </div>
                        <div className="text-lg font-bold text-slate-800 mt-1">
                          {getHebrewDate(order.eventDate)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {new Date(order.eventDate).toLocaleDateString('he-IL')}
                          {order.numberOfNights > 1 && ` • ${order.numberOfNights} לילות`}
                        </div>
                      </div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                  ))
                ) : (
                  <div className="text-center text-slate-400 text-sm py-4 italic">אין הזמנות עתידיות</div>
                )}
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="grid grid-cols-1 gap-6">
            <div className="bg-white/50 rounded-2xl p-2">
              <Card className="min-h-[500px] border-none shadow-none bg-transparent">
                <div className="space-y-6">
                  <div className="relative border-r-2 border-slate-200 mr-4 space-y-8 pb-4 pt-4">
                    {(() => {
                      const rawEvents = selectedCustomer.interactions || selectedCustomer.timeline || [];
                      const sortedEvents = [...rawEvents].sort((a, b) => {
                        const dateA = getSafeDate(a) || new Date(0);
                        const dateB = getSafeDate(b) || new Date(0);
                        return dateB - dateA;
                      });

                      if (sortedEvents.length === 0) return <div className="p-8 text-center text-slate-400 bg-white rounded-xl mx-4">התיק נפתח. אין פעילות קודמת.</div>;

                      return sortedEvents.map((event, index) => {
                        const config = EVENT_CONFIG[event.type] || EVENT_CONFIG['default'];
                        const safeDate = getSafeDate(event);
                        const dateStr = safeDate ? safeDate.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '-';

                        return (
                          <div key={index} className="relative pr-10 group">
                            <div className={`absolute -right-[7px] top-6 w-3.5 h-3.5 rounded-full border-2 border-slate-50 z-10 ${config.ring}`}></div>
                            <div className={`bg-white p-5 rounded-2xl border shadow-sm ${config.color.replace('bg-', 'hover:bg-opacity-30 ')} border-slate-100 transition-all`}>
                              <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-2">
                                  <div className={`p-2 rounded-xl ${config.color} bg-opacity-20`}>{config.icon}</div>
                                  <span className={`font-bold text-sm ${config.color.split(' ')[1]}`}>{config.label}</span>
                                </div>
                                <span className="text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded-md">{dateStr}</span>
                              </div>
                              <p className="text-slate-700 whitespace-pre-wrap text-sm leading-relaxed">{event.description}</p>

                              {(event.user || event.metadata?.changedBy || event.metadata?.isManual) && (
                                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400 border-t border-dashed border-slate-100 pt-2">
                                  <FaUserCheck size={10} />
                                  <span>{event.user?.name || event.metadata?.changedBy?.name || 'מערכת'}</span>
                                  {event.metadata?.isManual && <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold">ידני</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* מודל הוספת תיעוד */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-100">
            <div className="bg-white p-5 border-b border-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-xl text-slate-800">תיעוד פעולה</h3>
              <button onClick={() => setIsModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="p-6 bg-slate-50/50">
              <div className="grid grid-cols-3 gap-3 mb-4">
                {['call_out', 'meeting', 'note'].map(type => (
                  <button key={type} onClick={() => setNewNoteType(type)}
                    className={`py-4 rounded-2xl border text-sm font-bold flex flex-col items-center gap-2 transition-all shadow-sm ${newNoteType === type ? 'bg-slate-900 border-slate-900 text-white shadow-lg scale-105' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {EVENT_CONFIG[type].icon} {EVENT_CONFIG[type].label}
                  </button>
                ))}
              </div>
              <textarea
                className="w-full border border-slate-200 rounded-2xl p-4 h-36 focus:ring-2 focus:ring-blue-500 outline-none resize-none text-base bg-white shadow-inner"
                placeholder="כתוב כאן את פרטי השיחה או הפגישה..."
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                autoFocus
              />
              <Button onClick={handleAddInteraction} className="w-full mt-5 bg-blue-600 hover:bg-blue-700 h-14 text-lg rounded-2xl shadow-blue-200 shadow-lg">
                שמור תיעוד
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}