// client/src/pages/admin/ManageOrdersPage.jsx

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '@/utils/api.js';
import { format, differenceInDays } from 'date-fns';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

import { Input } from '@/components/ui/Input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { Button } from '@/components/ui/Button.jsx';
import { Skeleton } from '@/components/ui/Skeleton.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/Dialog";
import { ConfirmDialog } from '@/components/ui/ConfirmDialog.jsx';
import { Search, SlidersHorizontal, Trash2, Edit, Hotel, UserCog, FileDown, Clock, AlertTriangle } from 'lucide-react';

// --- API ---
const fetchAllOrders = async () => (await api.get('/admin/orders')).data;
const fetchHotels = async () => (await api.get('/admin/hotels')).data;
const fetchUsers = async () => (await api.get('/admin/users')).data;
const updateOrderStatus = ({ orderId, newStatus }) => api.put(`/admin/orders/${orderId}`, { status: newStatus });
const updateOrderOwner = ({ orderId, newUserId }) => api.put(`/admin/orders/${orderId}`, { newUserId });
const deleteOrderById = (orderId) => api.delete(`/admin/orders/${orderId}`);
const deleteOrdersByStatus = (status) => api.delete('/admin/orders/by-status', { data: { status } });

const STATUS_STYLES = {
  'בהמתנה': 'bg-yellow-100 text-yellow-800',
  'בוצע': 'bg-green-100 text-green-800',
  'לא רלוונטי': 'bg-red-100 text-red-800',
};

// --- Skeleton ---
function OrdersSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white border rounded-lg p-4 flex gap-4 items-center">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-28 ml-auto" />
        </div>
      ))}
    </div>
  );
}

// --- דיאלוג שיוך ---
const ReassignDialog = ({ order, isOpen, onClose, onConfirm, allUsers }) => {
  const [selectedUser, setSelectedUser] = useState(order?.user?._id || '');
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>שינוי שיוך הזמנה</DialogTitle>
          <DialogDescription>בחר את הנציג החדש עבור {order?.customerName}.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <label className="text-sm font-medium mb-2 block">בחר נציג:</label>
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger><SelectValue placeholder="בחר משתמש..." /></SelectTrigger>
            <SelectContent className="max-h-[200px]">
              {allUsers?.map(u => <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => { if (selectedUser && selectedUser !== order?.user?._id) onConfirm(order._id, selectedUser); onClose(); }}>
            שמור שינויים
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// --- כרטיסיית הזמנה ---
const OrderCard = ({ order, onStatusChange, onDelete, onReassignClick }) => {
  const daysPending = order.status === 'בהמתנה'
    ? differenceInDays(new Date(), new Date(order.createdAt))
    : null;
  const isStale = daysPending !== null && daysPending >= 3;

  return (
    <div className={`bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow ${isStale ? 'border-r-4 border-r-orange-400' : ''}`}>
      <div className="flex flex-col md:grid md:grid-cols-12 md:gap-4 md:items-center">

        <div className="md:col-span-2 mb-2 md:mb-0">
          <div className="font-bold text-slate-900 truncate">{order.customerName}</div>
          <div className="text-slate-500 text-sm">{order.customerPhone}</div>
        </div>

        <div className="md:col-span-2 mb-1 md:mb-0 text-slate-700 font-medium truncate">
          {order.hotel?.name || '-'}
        </div>

        <div className="md:col-span-2 mb-1 md:mb-0 flex items-center gap-1 group/user">
          <span className="text-slate-700 truncate">{order.salespersonName}</span>
          <button
            onClick={() => onReassignClick(order)}
            className="opacity-0 group-hover/user:opacity-100 p-1 hover:bg-slate-100 rounded text-blue-600 transition-opacity"
            title="שנה שיוך"
          >
            <UserCog size={14} />
          </button>
        </div>

        <div className="md:col-span-2 mb-1 md:mb-0 text-slate-600 text-sm">
          <div>{format(new Date(order.createdAt), 'dd/MM/yy HH:mm')}</div>
          {isStale && (
            <div className="flex items-center gap-1 text-orange-600 text-[11px] font-semibold mt-0.5">
              <Clock size={11} /> המתנה {daysPending} ימים
            </div>
          )}
        </div>

        <div className="md:col-span-1 mb-2 md:mb-0 font-bold text-slate-900">
          {order.total_price.toLocaleString('he-IL')} ₪
        </div>

        <div className="md:col-span-2 mb-3 md:mb-0">
          <Select value={order.status} onValueChange={(s) => onStatusChange(order._id, s)}>
            <SelectTrigger className={`h-8 text-xs border-0 ${STATUS_STYLES[order.status] || ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="בהמתנה">בהמתנה</SelectItem>
              <SelectItem value="בוצע">בוצע</SelectItem>
              <SelectItem value="לא רלוונטי">לא רלוונטי</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="md:col-span-1 flex justify-end gap-2 border-t md:border-0 pt-2 md:pt-0 mt-2 md:mt-0">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 hover:bg-slate-100">
            <Link to={`/edit-order/${order._id}`}><Edit className="h-4 w-4 text-slate-600" /></Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(order._id)} className="h-8 w-8 hover:bg-red-50">
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>
    </div>
  );
};

// --- דף ראשי ---
export default function ManageOrdersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [hotelFilter, setHotelFilter] = useState('all');
  const [reassignOrder, setReassignOrder] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const queryClient = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({ queryKey: ['adminAllOrders'], queryFn: fetchAllOrders });
  const { data: hotels = [] } = useQuery({ queryKey: ['hotels'], queryFn: fetchHotels });
  const { data: users = [] } = useQuery({ queryKey: ['usersList'], queryFn: fetchUsers });

  const invalidate = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminAllOrders'] }),
    onError: (e) => toast.error(e.response?.data?.message || 'אירעה שגיאה'),
  };

  const updateStatusMutation = useMutation({ ...invalidate, mutationFn: updateOrderStatus });
  const reassignMutation = useMutation({
    ...invalidate,
    mutationFn: updateOrderOwner,
    onSuccess: () => { toast.success('שיוך עודכן'); queryClient.invalidateQueries({ queryKey: ['adminAllOrders'] }); },
  });
  const deleteOrderMutation = useMutation({ ...invalidate, mutationFn: deleteOrderById, onSuccess: () => toast.success('נמחק') });
  const bulkDeleteMutation = useMutation({ ...invalidate, mutationFn: deleteOrdersByStatus, onSuccess: () => toast.success('כל ההזמנות הלא רלוונטיות נמחקו') });

  const filteredOrders = useMemo(() => {
    return [...orders]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .filter(o => {
        const q = searchTerm.toLowerCase();
        const nameMatch = o.customerName.toLowerCase().includes(q) || (o.customerPhone || '').includes(searchTerm);
        const statusMatch = statusFilter === 'all' || o.status === statusFilter;
        const hotelMatch = hotelFilter === 'all' || o.hotel?._id === hotelFilter;
        return nameMatch && statusMatch && hotelMatch;
      });
  }, [orders, searchTerm, statusFilter, hotelFilter]);

  const staleCount = useMemo(() =>
    orders.filter(o => o.status === 'בהמתנה' && differenceInDays(new Date(), new Date(o.createdAt)) >= 3).length,
    [orders]
  );

  const exportExcel = () => {
    const rows = filteredOrders.map(o => ({
      לקוח: o.customerName,
      טלפון: o.customerPhone || '',
      מלון: o.hotel?.name || '',
      נציג: o.salespersonName || '',
      תאריך: format(new Date(o.createdAt), 'dd/MM/yyyy HH:mm'),
      מחיר: o.total_price,
      סטטוס: o.status,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'הזמנות');
    XLSX.writeFile(wb, `orders_${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
    toast.success('הקובץ הורד');
  };

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-7xl">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ניהול הזמנות</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            סה"כ {filteredOrders.length} הזמנות
            {staleCount > 0 && (
              <span className="mr-2 inline-flex items-center gap-1 bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                <Clock size={11} /> {staleCount} ממתינות +3 ימים
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportExcel} className="gap-2">
          <FileDown size={15} /> ייצוא Excel
        </Button>
      </header>

      {/* פילטרים */}
      <div className="bg-white p-4 rounded-lg border shadow-sm grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="relative md:col-span-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="חפש לפי שם לקוח או טלפון..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="md:col-span-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SlidersHorizontal className="ml-2 h-4 w-4" /><SelectValue placeholder="סטטוס" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              <SelectItem value="בהמתנה">בהמתנה</SelectItem>
              <SelectItem value="בוצע">בוצע</SelectItem>
              <SelectItem value="לא רלוונטי">לא רלוונטי</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-3">
          <Select value={hotelFilter} onValueChange={setHotelFilter}>
            <SelectTrigger><Hotel className="ml-2 h-4 w-4" /><SelectValue placeholder="מלון" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המלונות</SelectItem>
              {hotels.map(h => <SelectItem key={h._id} value={h._id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* מחיקה מרוכזת */}
      {statusFilter === 'לא רלוונטי' && filteredOrders.length > 0 && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <p className="text-red-800 font-medium">נמצאו {filteredOrders.length} הזמנות לא רלוונטיות.</p>
          </div>
          <Button variant="destructive" className="w-full sm:w-auto" onClick={() => setBulkDeleteConfirm(true)}>
            <Trash2 className="ml-2 h-4 w-4" /> מחק הכל
          </Button>
        </div>
      )}

      {/* כותרות עמודות */}
      <div className="hidden md:grid grid-cols-12 gap-4 px-4 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">
        <div className="col-span-2">לקוח</div>
        <div className="col-span-2">מלון</div>
        <div className="col-span-2">נציג</div>
        <div className="col-span-2">תאריך</div>
        <div className="col-span-1">מחיר</div>
        <div className="col-span-2">סטטוס</div>
        <div className="col-span-1"></div>
      </div>

      {/* רשימה */}
      {isLoading ? (
        <OrdersSkeleton />
      ) : filteredOrders.length > 0 ? (
        <div className="space-y-2">
          {filteredOrders.map(o => (
            <OrderCard
              key={o._id}
              order={o}
              onStatusChange={(id, s) => updateStatusMutation.mutate({ orderId: id, newStatus: s })}
              onDelete={(id) => setDeleteConfirm(id)}
              onReassignClick={setReassignOrder}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-10 text-slate-500 bg-white rounded-lg border border-dashed">
          לא נמצאו הזמנות תואמות.
        </div>
      )}

      {/* דיאלוג מחיקה בודדת */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(o) => !o && setDeleteConfirm(null)}
        title="מחיקת הזמנה"
        description="האם למחוק את ההזמנה? פעולה זו אינה הפיכה."
        confirmText="כן, מחק"
        onConfirm={() => deleteOrderMutation.mutate(deleteConfirm)}
      />

      {/* דיאלוג מחיקה מרוכזת */}
      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={setBulkDeleteConfirm}
        title={`מחיקת ${filteredOrders.length} הזמנות`}
        description="האם למחוק את כל ההזמנות הלא רלוונטיות? פעולה זו אינה הפיכה."
        confirmText="כן, מחק הכל"
        onConfirm={() => bulkDeleteMutation.mutate('לא רלוונטי')}
      />

      {/* דיאלוג שיוך */}
      {reassignOrder && (
        <ReassignDialog
          isOpen={!!reassignOrder}
          order={reassignOrder}
          allUsers={users}
          onClose={() => setReassignOrder(null)}
          onConfirm={(id, uid) => reassignMutation.mutate({ orderId: id, newUserId: uid })}
        />
      )}
    </div>
  );
}
