import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api.js';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useAuthStore } from '@/stores/authStore.js';
import * as XLSX from 'xlsx';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/Dialog.jsx";
import { Button } from '@/components/ui/Button.jsx';
import { Input } from "@/components/ui/Input.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton.jsx";
import { ConfirmDialog } from '@/components/ui/ConfirmDialog.jsx';
import { LoaderCircle, Trash2, Phone, User, ArrowUp, Search, FileDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

const GOLD = '#bfa15f';
const PAGE_SIZE = 20;

const fetchLeads = async () => {
  const response = await api.get('/leads');
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  return [];
};
const deleteLeadApi = async (leadId) => await api.delete(`/leads/${leadId}`);
const updateLeadStatusApi = async ({ leadId, status, rejectionReason }) => {
  const { data } = await api.patch(`/leads/${leadId}/status`, { status, rejectionReason });
  return data;
};

const STATUS_LABELS = {
  new: 'טרם נענה',
  in_progress: 'בטיפול',
  handled: 'טופל',
  contact_saved: 'איש קשר נשמר',
  not_relevant: 'לא רלוונטי',
};

const STATUS_STYLES = {
  new: 'bg-blue-100 text-blue-800 border-blue-200 font-bold',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
  handled: 'bg-green-50 text-green-700 border-green-200',
  contact_saved: 'bg-purple-50 text-purple-700 border-purple-200',
  not_relevant: 'bg-gray-100 text-gray-400 border-gray-200',
};

function LeadsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-3 bg-white border rounded-lg">
          <Skeleton className="h-4 w-32 shrink-0" />
          <Skeleton className="h-4 w-28 shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-8 w-32 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [hotelFilter, setHotelFilter] = useState('all');
  const [sortNew, setSortNew] = useState(false);
  const [page, setPage] = useState(1);

  const [selectedLead, setSelectedLead] = useState(null);
  const [noteToView, setNoteToView] = useState(null);
  const [handlingDialogLeadId, setHandlingDialogLeadId] = useState(null);
  const [handlingReason, setHandlingReason] = useState('');
  const [targetStatus, setTargetStatus] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
    refetchInterval: 15000,
    initialData: [],
  });

  const updateStatusMutation = useMutation({
    mutationFn: updateLeadStatusApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setHandlingDialogLeadId(null);
      setHandlingReason('');
      setTargetStatus('');
    },
    onError: () => toast.error('שגיאה בעדכון'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLeadApi,
    onMutate: async (leadId) => {
      await queryClient.cancelQueries({ queryKey: ['leads'] });
      const prev = queryClient.getQueryData(['leads']);
      queryClient.setQueryData(['leads'], (old) =>
        Array.isArray(old) ? old.filter((l) => l._id !== leadId) : []
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['leads'], ctx.prev);
      toast.error('שגיאה במחיקה');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
    onSuccess: () => toast.success('נמחק'),
  });

  const hotelOptions = useMemo(() => {
    if (!Array.isArray(leads)) return [];
    return [...new Set(leads.map((l) => l.hotel).filter(Boolean))].sort();
  }, [leads]);

  const displayedLeads = useMemo(() => {
    if (!Array.isArray(leads)) return [];
    let list = leads.filter((l) => l.status !== 'bot');

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (l) =>
          l.parsedName?.toLowerCase().includes(q) ||
          l.parsedPhone?.includes(q) ||
          l.hotel?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') list = list.filter((l) => l.status === statusFilter);
    if (hotelFilter !== 'all') list = list.filter((l) => l.hotel === hotelFilter);

    if (sortNew) {
      list = [...list].sort((a, b) => {
        if (a.status === 'new' && b.status !== 'new') return -1;
        if (a.status !== 'new' && b.status === 'new') return 1;
        return 0;
      });
    }
    return list;
  }, [leads, search, statusFilter, hotelFilter, sortNew]);

  const totalPages = Math.max(1, Math.ceil(displayedLeads.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = displayedLeads.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const resetPage = () => setPage(1);

  const handleStatusChange = (leadId, newStatus) => {
    if (newStatus === 'handled' || newStatus === 'not_relevant') {
      setTargetStatus(newStatus);
      setHandlingDialogLeadId(leadId);
      setHandlingReason('');
    } else {
      updateStatusMutation.mutate({ leadId, status: newStatus });
      toast.success('סטטוס עודכן');
    }
  };

  const handleWhatsappClick = (lead) => {
    if (lead.status === 'new') {
      updateStatusMutation.mutate({ leadId: lead._id, status: 'in_progress' });
    }
  };

  const submitHandling = () => {
    if (!handlingReason.trim()) return toast.error('חובה לבחור או לכתוב פירוט');
    updateStatusMutation.mutate({ leadId: handlingDialogLeadId, status: targetStatus, rejectionReason: handlingReason });
    toast.success('סטטוס עודכן');
  };

  const exportExcel = () => {
    const rows = displayedLeads.map((l) => ({
      שם: l.parsedName || '',
      טלפון: l.parsedPhone || '',
      מלון: l.hotel || '',
      סטטוס: STATUS_LABELS[l.status] || l.status,
      הערות: l.parsedNote || '',
      תאריך: l.receivedAt ? format(new Date(l.receivedAt), 'dd/MM/yyyy HH:mm') : '',
      סיבת_דחייה: l.rejectionReason || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'לידים');
    XLSX.writeFile(wb, `leads_${format(new Date(), 'dd-MM-yyyy')}.xlsx`);
    toast.success('הקובץ הורד');
  };

  const newCount = Array.isArray(leads) ? leads.filter((l) => l.status === 'new').length : 0;

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-6xl" dir="rtl">
      {/* כותרת */}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ניהול פניות</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {displayedLeads.length} פניות
            {newCount > 0 && (
              <span className="mr-2 inline-flex items-center bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded-full">
                {newCount} חדשות
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportExcel} className="gap-2">
          <FileDown size={15} /> ייצוא Excel
        </Button>
      </header>

      {/* פילטרים */}
      <div className="bg-white border rounded-lg p-3 grid grid-cols-1 md:grid-cols-12 gap-3 shadow-sm">
        <div className="relative md:col-span-5">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="חפש שם, טלפון, מלון..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pr-9"
          />
          {search && (
            <button className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => { setSearch(''); resetPage(); }}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="md:col-span-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
            <SelectTrigger><SelectValue placeholder="כל הסטטוסים" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="md:col-span-3">
          <Select value={hotelFilter} onValueChange={(v) => { setHotelFilter(v); resetPage(); }}>
            <SelectTrigger><SelectValue placeholder="כל המלונות" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המלונות</SelectItem>
              {hotelOptions.map((h) => (
                <SelectItem key={h} value={h}>{h}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="md:col-span-1 flex items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSortNew((p) => !p); resetPage(); }}
            className={`w-full gap-1 text-xs ${sortNew ? 'bg-blue-50 border-blue-300 text-blue-700' : ''}`}
          >
            <ArrowUp size={13} /> {sortNew ? 'חדשים' : 'מיון'}
          </Button>
        </div>
      </div>

      {/* רשימה */}
      {isLoading ? (
        <LeadsSkeleton />
      ) : (
        <>
          <div className="space-y-1.5">
            {paginated.length === 0 ? (
              <div className="text-center text-gray-400 py-12 bg-white border rounded-lg border-dashed">
                {search || statusFilter !== 'all' || hotelFilter !== 'all'
                  ? 'לא נמצאו פניות תואמות לחיפוש'
                  : 'אין פניות להצגה'}
              </div>
            ) : (
              paginated.map((lead) => (
                <LeadStrip
                  key={lead._id}
                  lead={lead}
                  onStatusChange={handleStatusChange}
                  onWhatsappClick={() => handleWhatsappClick(lead)}
                  onViewRaw={() => setSelectedLead(lead)}
                  onViewNote={() => setNoteToView(lead)}
                  onDelete={user?.role === 'admin' ? (id) => setDeleteConfirm(id) : undefined}
                />
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 py-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronRight size={16} />
              </Button>
              <span className="text-sm text-gray-600">{currentPage} / {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                <ChevronLeft size={16} />
              </Button>
            </div>
          )}
        </>
      )}

      {/* דיאלוג אישור מחיקה */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(o) => !o && setDeleteConfirm(null)}
        title="מחיקת פנייה"
        description="האם למחוק את הפנייה? פעולה זו אינה הפיכה."
        confirmText="כן, מחק"
        onConfirm={() => deleteMutation.mutate(deleteConfirm)}
      />

      {/* דיאלוג טיפול */}
      <Dialog open={!!handlingDialogLeadId} onOpenChange={(o) => !o && setHandlingDialogLeadId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{targetStatus === 'not_relevant' ? 'סיבת ביטול' : 'סיכום טיפול'}</DialogTitle>
            <DialogDescription>
              {targetStatus === 'not_relevant' ? 'מדוע הפנייה לא רלוונטית?' : 'מה בוצע מול הלקוח?'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {(targetStatus === 'handled'
                ? ['נשלחה הצעת מחיר', 'ההזמנה נסגרה', 'קיבל את הפרטים שביקש']
                : ['יקר מדי', 'תאריך תפוס', 'לא עונה', 'רצה משהו אחר']
              ).map((opt) => (
                <span
                  key={opt}
                  onClick={() => setHandlingReason(opt)}
                  className={`cursor-pointer px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    handlingReason === opt
                      ? targetStatus === 'not_relevant'
                        ? 'bg-red-100 text-red-800 border-red-300 font-semibold'
                        : 'bg-blue-100 text-blue-800 border-blue-300 font-semibold'
                      : targetStatus === 'not_relevant'
                      ? 'bg-red-50 hover:bg-red-100 text-red-800 border-red-200'
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200'
                  }`}
                >
                  {opt}
                </span>
              ))}
            </div>
            <Input
              placeholder="או הקלד פירוט חופשי..."
              value={handlingReason}
              onChange={(e) => setHandlingReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHandlingDialogLeadId(null)}>ביטול</Button>
            <Button
              onClick={submitHandling}
              className={targetStatus === 'not_relevant' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
            >
              אישור ועדכון
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedLead} onOpenChange={(o) => !o && setSelectedLead(null)}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-auto">
          <pre className="text-xs whitespace-pre-wrap" dir="ltr">{selectedLead?.body}</pre>
        </DialogContent>
      </Dialog>

      <Dialog open={!!noteToView} onOpenChange={(o) => !o && setNoteToView(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>פרטים מלאים</DialogTitle></DialogHeader>
          <div className="py-4 text-right whitespace-pre-wrap">
            <p className="font-bold mb-2">{noteToView?.hotel}</p>
            <p>{noteToView?.parsedNote}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const LeadStrip = ({ lead, onStatusChange, onWhatsappClick, onViewRaw, onViewNote, onDelete }) => {
  const isNew = lead.status === 'new';

  return (
    <div
      className={`flex flex-col md:flex-row items-center gap-3 p-3 border border-transparent hover:border-gray-200 hover:bg-gray-50/80 transition-all rounded-lg ${
        isNew ? 'bg-blue-50/40' : 'bg-white'
      }`}
      style={{ borderRight: `4px solid ${isNew ? '#3b82f6' : GOLD}` }}
    >
      <div className="w-full md:w-44 shrink-0">
        <div
          className="font-bold text-sm truncate cursor-pointer hover:text-blue-600 flex items-center gap-1.5"
          onClick={onViewRaw}
        >
          <User size={13} className="text-gray-400 shrink-0" />
          {lead.parsedName || 'ללא שם'}
        </div>
        <div className="text-[11px] text-gray-400 mt-0.5 pr-5">
          {format(new Date(lead.receivedAt), 'dd/MM HH:mm')}
        </div>
      </div>

      <div className="w-full md:w-32 shrink-0">
        {lead.parsedPhone ? (
          <a
            href={`https://wa.me/${lead.parsedPhone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium hover:text-blue-600 flex items-center gap-1.5"
            dir="ltr"
            onClick={onWhatsappClick}
          >
            <Phone size={13} className={isNew ? 'text-blue-400' : 'text-gray-300'} />
            {lead.parsedPhone}
          </a>
        ) : (
          <span className="text-gray-300 text-xs">-</span>
        )}
      </div>

      <div className="w-full flex-1 min-w-0 cursor-pointer" onClick={onViewNote}>
        {lead.hotel && (
          <span className="text-[10px] font-bold text-gray-500 bg-white border px-1.5 py-0.5 rounded ml-1">
            {lead.hotel}
          </span>
        )}
        <span className="text-sm text-gray-600 truncate block mt-0.5" title={lead.parsedNote}>
          {lead.parsedNote || <span className="text-gray-300 text-xs">אין הערות</span>}
        </span>
      </div>

      <div className="w-full md:w-52 shrink-0 flex items-center gap-2">
        <div className="flex-1">
          <Select value={lead.status} onValueChange={(val) => onStatusChange(lead._id, val)}>
            <SelectTrigger className={`h-8 text-xs shadow-sm ${STATUS_STYLES[lead.status] || 'bg-white border-gray-200'}`}>
              <SelectValue>{STATUS_LABELS[lead.status] || lead.status}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {lead.rejectionReason && (
            <p className="text-[10px] text-gray-400 truncate mt-0.5" title={lead.rejectionReason}>
              {lead.rejectionReason}
            </p>
          )}
        </div>
        {onDelete && (
          <button
            className="text-gray-300 hover:text-red-500 p-1 transition-colors shrink-0"
            onClick={(e) => { e.stopPropagation(); onDelete(lead._id); }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
};
