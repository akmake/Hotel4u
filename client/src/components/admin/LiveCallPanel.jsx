// client/src/components/admin/LiveCallPanel.jsx
// ✅ חדש: חלונית שיחות בזמן אמת מהמרכזיה
// מאזין ל-Socket.IO event 'active-calls' שמגיע מהשרת
// כשמגיעה שיחה: אם הלקוח קיים → פותח CRM. אם חדש → טופס מהיר + יצירת הזמנה.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/utils/api';
import { useChatStore } from '@/stores/chatStore';
import {
  Phone, PhoneIncoming, PhoneOff, User, Plus, ArrowRight,
  X, Loader2, Star, Clock, Hotel, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function LiveCallPanel() {
  const navigate = useNavigate();
  const socket = useChatStore(state => state.socket);

  const [activeCalls, setActiveCalls] = useState([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedCall, setSelectedCall] = useState(null);
  const [customerData, setCustomerData] = useState(null);
  const [loadingCustomer, setLoadingCustomer] = useState(false);

  // טופס לקוח חדש
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');

  // האזנה לאירועי שיחות מהשרת
  useEffect(() => {
    if (!socket) return;

    const handleActiveCalls = (calls) => {
      setActiveCalls(Array.isArray(calls) ? calls : []);
    };

    socket.on('active-calls', handleActiveCalls);

    // בקשת מצב ראשוני
    socket.emit('get-active-calls');

    return () => {
      socket.off('active-calls', handleActiveCalls);
    };
  }, [socket]);

  // שליפת נתוני לקוח כשבוחרים שיחה
  const handleCallSelect = async (call) => {
    setSelectedCall(call);
    setCustomerData(null);
    setNewCustomerName('');
    setNewCustomerEmail('');
    setLoadingCustomer(true);

    try {
      const { data } = await api.get('/customer-card', {
        params: { query: call.callerNumber }
      });

      if (data.mode === 'list' && data.results?.length > 0) {
        // לקוח קיים — שולף פרטים מלאים
        const { data: detail } = await api.get('/customer-card', {
          params: { id: data.results[0]._id }
        });
        if (detail.mode === 'detail') {
          setCustomerData(detail.result);
        }
      }
      // אם אין תוצאות — customerData נשאר null → מוצג טופס לקוח חדש
    } catch (err) {
      console.error('Error looking up caller:', err);
    } finally {
      setLoadingCustomer(false);
    }
  };

  // ניווט ל-CRM של הלקוח
  const goToCRM = (customerId) => {
    navigate(`/admin/customer-lookup`);
    // TODO: יכול להעביר state עם ה-ID כדי לפתוח ישירות
  };

  // יצירת הזמנה חדשה עם הפרטים שהוזנו
  const createNewOrder = () => {
    const params = new URLSearchParams({
      phone: selectedCall?.callerNumber || '',
      name: newCustomerName,
      email: newCustomerEmail,
    });
    navigate(`/new-order?${params.toString()}`);
  };

  // אם אין שיחות — לא מציג כלום
  if (activeCalls.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 font-assistant" dir="rtl">
      {/* Header — תמיד מוצג */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-xl px-4 py-3 flex justify-between items-center cursor-pointer shadow-lg hover:from-blue-700 hover:to-blue-800 transition-all"
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <PhoneIncoming size={18} />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          </div>
          <span className="font-bold text-sm">שיחות פעילות ({activeCalls.length})</span>
        </div>
        {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="bg-white border border-t-0 border-slate-200 rounded-b-xl shadow-2xl max-h-[70vh] overflow-y-auto">

          {/* רשימת שיחות */}
          <div className="divide-y divide-slate-100">
            {activeCalls.map((call, idx) => (
              <div
                key={call.callId || idx}
                onClick={() => handleCallSelect(call)}
                className={`px-4 py-3 cursor-pointer hover:bg-blue-50 transition-colors flex items-center justify-between ${selectedCall?.callId === call.callId ? 'bg-blue-50 border-r-2 border-blue-500' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <Phone size={14} className="text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-800 font-mono">{call.callerNumber}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock size={10} />
                      {call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}` : 'מצלצל...'}
                    </div>
                  </div>
                </div>
                <ArrowRight size={14} className="text-slate-300" />
              </div>
            ))}
          </div>

          {/* פרטי לקוח שנבחר */}
          {selectedCall && (
            <div className="border-t-2 border-blue-200 p-4 bg-slate-50">

              {loadingCustomer && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                  <span className="text-sm text-slate-400 mr-2">מחפש לקוח...</span>
                </div>
              )}

              {/* לקוח קיים */}
              {!loadingCustomer && customerData && (
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-lg">
                      {customerData.name?.[0] || '?'}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800">{customerData.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{customerData.phone}</div>
                    </div>
                    {customerData.isReturning && (
                      <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">לקוח חוזר</span>
                    )}
                  </div>

                  {/* דירוג */}
                  {customerData.rating > 0 && (
                    <div className="flex items-center gap-1 mb-2">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} size={14} className={s <= customerData.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'} />
                      ))}
                    </div>
                  )}

                  {/* תגיות */}
                  {customerData.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {customerData.tags.map((tag, i) => (
                        <span key={i} className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded-full">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* סטטיסטיקות מהירות */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-white rounded-lg p-2 text-center border">
                      <div className="text-lg font-bold text-slate-700">{customerData.totalOrders || 0}</div>
                      <div className="text-[10px] text-slate-400">הזמנות</div>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center border">
                      <div className="text-lg font-bold text-slate-700">{(customerData.totalSpent || 0).toLocaleString()}₪</div>
                      <div className="text-[10px] text-slate-400">הוצאות</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={() => goToCRM(customerData._id)} className="flex-1 h-9 text-xs bg-blue-600 hover:bg-blue-700">
                      פתח כרטיס לקוח
                    </Button>
                    <Button onClick={createNewOrder} variant="outline" className="flex-1 h-9 text-xs">
                      <Plus size={12} className="ml-1" /> הזמנה חדשה
                    </Button>
                  </div>
                </div>
              )}

              {/* לקוח חדש */}
              {!loadingCustomer && !customerData && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <User size={14} className="text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-emerald-700">לקוח חדש!</div>
                      <div className="text-xs text-slate-400">{selectedCall.callerNumber}</div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-3">
                    <Input
                      placeholder="שם הלקוח"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Input
                      placeholder="מייל (אופציונלי)"
                      type="email"
                      value={newCustomerEmail}
                      onChange={(e) => setNewCustomerEmail(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>

                  <Button onClick={createNewOrder} className="w-full h-9 text-xs bg-emerald-600 hover:bg-emerald-700">
                    <Plus size={12} className="ml-1" /> צור הזמנה חדשה
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}