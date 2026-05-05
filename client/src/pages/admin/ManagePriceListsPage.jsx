import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api.js';
import toast from 'react-hot-toast';

// UI Components
import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { GripVertical, Lock, Edit, Trash2, Plus, ChevronDown, AlertCircle } from 'lucide-react';

// --- קומפוננטת יצירה (עם תוויות בעברית) ---
const GlobalPriceListForm = ({ hotels, onSubmit, isSaving }) => {
    const [formData, setFormData] = useState({
        name: '', hotelId: '', couple: '', teen: '', child: '', baby: '', single_room: '', fixedNights: ''
    });

    const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.hotelId) return toast.error('אנא בחר מלון');
        if (!formData.name) return toast.error('אנא בחר שם למחירון');

        onSubmit({
            ...formData,
            couple: Number(formData.couple || 0),
            teen: Number(formData.teen || 0),
            child: Number(formData.child || 0),
            baby: Number(formData.baby || 0),
            single_room: Number(formData.single_room || 0),
            fixedNights: Number(formData.fixedNights || 0),
            hotel: formData.hotelId
        }, () => setFormData(prev => ({ ...prev, name: '', couple: '', teen: '', child: '', baby: '', single_room: '', fixedNights: '' })));
    };

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">יצירת מחירון חדש</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-1">
                        <label className="text-xs font-bold text-gray-500 mb-1">בחר מלון</label>
                        <div className="relative">
                            <select 
                                name="hotelId" 
                                value={formData.hotelId} 
                                onChange={handleChange} 
                                className="w-full h-10 bg-gray-50 border-none rounded-xl px-2 text-sm appearance-none cursor-pointer"
                            >
                                <option value="" disabled>בחר מלון...</option>
                                {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                            </select>
                            <ChevronDown className="absolute left-3 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
                        </div>
                    </div>
                    <div className="md:col-span-3">
                        <label className="text-xs font-bold text-gray-500 mb-1">שם המחירון</label>
                        <Input name="name" value={formData.name} onChange={handleChange} className="h-10 bg-gray-50 border-none rounded-xl" placeholder="למשל: סופש" />
                    </div>
                </div>
                
                {/* שורת מחירים עם כותרות בעברית */}
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
                    <div><label className="text-[10px] text-gray-500 font-bold block mb-1">זוג</label><Input type="number" name="couple" value={formData.couple} onChange={handleChange} className="h-9 text-center bg-white border-gray-100" placeholder="0" /></div>
                    <div><label className="text-[10px] text-gray-500 font-bold block mb-1">ילד</label><Input type="number" name="child" value={formData.child} onChange={handleChange} className="h-9 text-center bg-white border-gray-100" placeholder="0" /></div>
                    <div><label className="text-[10px] text-gray-500 font-bold block mb-1">נער</label><Input type="number" name="teen" value={formData.teen} onChange={handleChange} className="h-9 text-center bg-white border-gray-100" placeholder="0" /></div>
                    <div><label className="text-[10px] text-gray-500 font-bold block mb-1">תינוק</label><Input type="number" name="baby" value={formData.baby} onChange={handleChange} className="h-9 text-center bg-white border-gray-100" placeholder="0" /></div>
                    <div><label className="text-[10px] text-gray-500 font-bold block mb-1">יחיד</label><Input type="number" name="single_room" value={formData.single_room} onChange={handleChange} className="h-9 text-center bg-white border-gray-100" placeholder="0" /></div>
                    
                    <div>
                        <label className="text-[10px] text-gray-500 font-bold block mb-1 flex gap-1"><Lock size={8}/> לילות</label>
                        <Input type="number" name="fixedNights" value={formData.fixedNights} onChange={handleChange} className="h-9 text-center bg-gray-100 font-bold" placeholder="-" />
                    </div>
                    
                    <Button type="submit" disabled={isSaving} className="h-9 bg-black text-white hover:bg-gray-800 rounded-lg shadow-sm">
                        {isSaving ? '...' : <><Plus size={14} className="ml-1"/> הוסף</>}
                    </Button>
                </div>
            </form>
        </div>
    );
};

// --- קומפוננטת עריכה (עם כותרות בעברית) ---
const EditPriceListForm = ({ data, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ ...data });
    const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    return (
        <div className="space-y-4">
            <div><label className="text-xs font-bold text-gray-500">שם המחירון</label><Input name="name" value={formData.name} onChange={handleChange} className="bg-gray-50 border-none" /></div>
            <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs font-bold text-gray-400">זוג</label><Input type="number" name="couple" value={formData.couple} onChange={handleChange} /></div>
                <div><label className="text-xs font-bold text-gray-400">ילד</label><Input type="number" name="child" value={formData.child} onChange={handleChange} /></div>
                <div><label className="text-xs font-bold text-gray-400">נער</label><Input type="number" name="teen" value={formData.teen} onChange={handleChange} /></div>
                <div><label className="text-xs font-bold text-gray-400">תינוק</label><Input type="number" name="baby" value={formData.baby} onChange={handleChange} /></div>
                <div><label className="text-xs font-bold text-gray-400">יחיד</label><Input type="number" name="single_room" value={formData.single_room} onChange={handleChange} /></div>
                <div>
                     <label className="text-xs font-bold text-gray-400">לילות קבועים</label>
                     <Input type="number" name="fixedNights" value={formData.fixedNights} onChange={handleChange} className="bg-gray-100 font-bold" />
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onCancel}>ביטול</Button>
                <Button onClick={() => onSave({ ...formData, fixedNights: Number(formData.fixedNights) })} className="bg-black text-white">שמור שינויים</Button>
            </div>
        </div>
    );
};

// --- עמוד ראשי ---
export default function ManagePriceListsPage() {
    const queryClient = useQueryClient();
    const [editingItem, setEditingItem] = useState(null);

    // גרירה
    const dragItem = useRef(null);
    const dragOverItem = useRef(null);
    const dragHotelId = useRef(null);

    // שליפות נתונים
    const { data: rawPriceLists = [] } = useQuery({ 
        queryKey: ['allPriceLists'], 
        queryFn: async () => (await api.get('/pricelists')).data,
        retry: 1 
    });
    
    // ניסיון לשלוף מלונות - גם אם נכשל, נסתדר עם מה שיש במחירונים
    const { data: fetchedHotels = [] } = useQuery({ 
        queryKey: ['hotelsForSelect'], 
        queryFn: async () => (await api.get('/hotels')).data,
        retry: 1
    });

    // חישוב חכם: מאחד את המלונות שהגיעו מהשרת + מלונות שקיימים בתוך המחירונים (לגיבוי)
    const { groupedLists, uniqueHotels } = useMemo(() => {
        const groups = {};
        const hotelsMap = new Map();

        // --- התיקון לקריסה: המרת הנתונים למערך בטוח לפני הלולאה ---
        const safeHotels = Array.isArray(fetchedHotels) ? fetchedHotels : Object.values(fetchedHotels || {});
        const safeLists = Array.isArray(rawPriceLists) ? rawPriceLists : Object.values(rawPriceLists || {});
        // ---------------------------------------------------------

        // 1. הוספת מלונות מהשליפה הרשמית (אם הצליחה)
        safeHotels.forEach(h => {
            if (h && h._id) {
                hotelsMap.set(h._id, { id: h._id, name: h.name });
                groups[h._id] = { name: h.name, id: h._id, lists: [] };
            }
        });
        
        // 2. מילוי מחירונים + השלמת מלונות חסרים (אם השליפה נכשלה)
        safeLists.forEach(pl => {
            const hId = pl.hotel?._id || pl.hotel;
            const hName = pl.hotel?.name || 'מלון לא ידוע';

            // אם המלון הזה לא קיים ברשימה, נוסיף אותו ידנית
            if (!groups[hId] && hId) {
                groups[hId] = { name: hName, id: hId, lists: [] };
                hotelsMap.set(hId, { id: hId, name: hName });
            }

            if (groups[hId]) {
                groups[hId].lists.push(pl);
            }
        });

        // 3. מיון
        Object.values(groups).forEach(g => {
            g.lists.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
        });

        return { 
            groupedLists: groups, 
            uniqueHotels: Array.from(hotelsMap.values()) // רשימה נקייה ל-Select
        };
    }, [rawPriceLists, fetchedHotels]);

    // מוטציות
    const createMutation = useMutation({ mutationFn: (d) => api.post('/pricelists', d), onSuccess: () => { toast.success('נוסף בהצלחה'); queryClient.invalidateQueries(['allPriceLists']); } });
    const updateMutation = useMutation({ mutationFn: ({id, ...d}) => api.put(`/pricelists/${id}`, d), onSuccess: () => { toast.success('עודכן'); setEditingItem(null); queryClient.invalidateQueries(['allPriceLists']); } });
    const deleteMutation = useMutation({ mutationFn: (id) => api.delete(`/pricelists/${id}`), onSuccess: () => { toast.success('נמחק'); queryClient.invalidateQueries(['allPriceLists']); } });
    
    const saveOrderMutation = useMutation({
        mutationFn: async ({ hotelId, newOrderList }) => {
            await Promise.all(newOrderList.map((item, index) => api.put(`/pricelists/${item._id}`, { ...item, displayOrder: index })));
        },
        onSuccess: () => queryClient.invalidateQueries(['allPriceLists'])
    });

    // גרירה
    // לוגיקת גרירה - תיקון לעדכון מיידי
    const handleDragEnd = (hotelId) => {
        if (dragItem.current === null || dragOverItem.current === null || dragHotelId.current !== hotelId) return;

        // שליפה של הרשימה הנוכחית מהקבוצה
        const group = groupedLists[hotelId];
        if (!group) return;

        // ביצוע השינוי על העתק של הרשימה
        const list = [...group.lists];
        const item = list.splice(dragItem.current, 1)[0];
        list.splice(dragOverItem.current, 0, item);

        // עדכון אופטימי (Optimistic Update) - מעדכן את התצוגה מיד לפני שהשרת עונה
        queryClient.setQueryData(['allPriceLists'], (oldData) => {
            if (!oldData) return oldData;
            
            // אנחנו צריכים ליצור מערך חדש שבו ה-displayOrder מעודכן
            // אבל מכיוון שהמידע השטוח (raw) לא מסודר, הכי קל זה לעדכן את השדות
            // הערה: כאן משתמשים ב-oldData כמו שהוא. אם הוא אובייקט, הלוגיקה הזו עלולה לדרוש התאמה נוספת,
            // אבל מכיוון שזה רק אופטימיזציה, החשיבות העליונה היא ש-useMemo לא יקרוס.
            
            // בטיחות עבור האופטימיזציה:
            let newData = Array.isArray(oldData) ? [...oldData] : Object.values(oldData);
            
            // עדכון ה-displayOrder עבור כל הפריטים ברשימה ששונו
            list.forEach((pl, index) => {
                const found = newData.find(p => p._id === pl._id);
                if (found) {
                    found.displayOrder = index; // עדכון המיקום בזיכרון
                }
            });
            
            return newData;
        });
        
        // שליחה לשרת לשמירה קבועה
        saveOrderMutation.mutate({ hotelId, newOrderList: list });
        
        // איפוס
        dragItem.current = null;
        dragOverItem.current = null;
        dragHotelId.current = null;
    };

    return (
        <div className="p-8 max-w-6xl mx-auto pb-32 bg-gray-50/30 min-h-screen font-sans">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">ניהול מחירונים</h1>
                <p className="text-gray-500 text-sm mt-1">גרור לשנוי סדר, לחץ לעריכה.</p>
            </div>
            
            {/* משתמשים ב-uniqueHotels המחושב, כך שהרשימה תהיה מלאה גם אם השרת מגמגם */}
            <GlobalPriceListForm hotels={uniqueHotels} onSubmit={(d, cb) => createMutation.mutate(d, { onSuccess: cb })} isSaving={createMutation.isPending} />

            <div className="space-y-6">
                {Object.values(groupedLists).map(group => (
                    <div key={group.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="bg-gray-50 px-6 py-3 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-gray-800">{group.name}</h3>
                            <span className="text-xs bg-white border px-2 py-0.5 rounded-full text-gray-400">{group.lists.length}</span>
                        </div>
                        <div className="p-2 space-y-1">
                            {group.lists.map((pl, index) => (
                                <div key={pl._id} 
                                     draggable 
                                     onDragStart={() => { dragItem.current = index; dragHotelId.current = group.id; }}
                                     onDragEnter={() => { if (dragHotelId.current === group.id) dragOverItem.current = index; }}
                                     onDragEnd={() => handleDragEnd(group.id)}
                                     onDragOver={e => e.preventDefault()}
                                     className="group flex justify-between items-center p-3 hover:bg-gray-50 rounded-xl cursor-move border border-transparent hover:border-gray-200 transition-all"
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        <GripVertical size={16} className="text-gray-300 group-hover:text-gray-500" />
                                        
                                        {/* שם המחירון */}
                                        <div className="w-32 font-bold text-sm text-gray-800 truncate" title={pl.name}>{pl.name}</div>
                                        
                                        {/* תגית לילות */}
                                        <div className="w-20 flex justify-center">
                                            {pl.fixedNights > 0 ? (
                                                <span className="bg-amber-50 text-[10px] px-2 py-0.5 rounded font-bold text-amber-700 flex items-center gap-1 border border-amber-100">
                                                    <Lock size={8}/> {pl.fixedNights} לילות
                                                </span>
                                            ) : <span className="text-gray-300 text-[10px]">-</span>}
                                        </div>

                                        {/* פירוט מלא של כל המחירים בעברית */}
                                        <div className="hidden md:flex flex-1 justify-end gap-4 text-xs text-gray-500">
                                            <div className="flex flex-col items-center w-12"><span className="text-[9px] text-gray-300">זוג</span><span className="font-bold">{pl.couple}</span></div>
                                            <div className="flex flex-col items-center w-12"><span className="text-[9px] text-gray-300">ילד</span><span className="font-bold">{pl.child}</span></div>
                                            <div className="flex flex-col items-center w-12"><span className="text-[9px] text-gray-300">נער</span><span className="font-bold">{pl.teen}</span></div>
                                            <div className="flex flex-col items-center w-12"><span className="text-[9px] text-gray-300">תינוק</span><span className="font-bold">{pl.baby}</span></div>
                                            <div className="flex flex-col items-center w-12"><span className="text-[9px] text-gray-300">יחיד</span><span className="font-bold">{pl.single_room}</span></div>
                                        </div>
                                    </div>

                                    {/* כפתורים */}
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-white hover:shadow-sm" onClick={() => setEditingItem(pl)}><Edit size={14} className="text-gray-500"/></Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-white hover:shadow-sm hover:text-red-500" onClick={() => { if(window.confirm('למחוק?')) deleteMutation.mutate(pl._id) }}><Trash2 size={14} className="text-gray-400 hover:text-red-500"/></Button>
                                    </div>
                                </div>
                            ))}
                            {group.lists.length === 0 && <div className="text-center text-xs text-gray-300 py-6">אין מחירונים ברשימה זו</div>}
                        </div>
                    </div>
                ))}
            </div>

            <Dialog open={!!editingItem} onOpenChange={o => !o && setEditingItem(null)}>
                <DialogContent className="max-w-xl rounded-2xl p-6">
                    <DialogHeader><DialogTitle className="font-bold">עריכת מחירון</DialogTitle></DialogHeader>
                    {editingItem && <EditPriceListForm data={editingItem} onSave={(d) => updateMutation.mutate({id: editingItem._id, ...d})} onCancel={() => setEditingItem(null)} />}
                </DialogContent>
            </Dialog>
        </div>
    );
}