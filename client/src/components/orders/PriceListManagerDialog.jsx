import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/utils/api.js';

// UI Components
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { Edit, Trash2, Lock, Plus } from 'lucide-react';

// API Functions
const fetchPriceListsForHotel = async (hotelId) => {
    const res = await api.get(`/pricelists?hotelId=${hotelId}`);
    // מיון בצד לקוח לפי הסדר, כדי שהרשימה תהיה מסודרת
    return res.data.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
};

const createPriceList = (data) => api.post('/pricelists', data);
const updatePriceList = ({ id, ...data }) => api.put(`/pricelists/${id}`, data);
const deletePriceList = (id) => api.delete(`/pricelists/${id}`);

// --- טופס יצירה/עריכה ---
const PriceListForm = ({ hotelId, priceList, onSave, onCancel, isSaving }) => {
    // שינינו ל-fixedNights כדי להתאים לשרת
    const [formData, setFormData] = useState({
        name: '', couple: '', teen: '', child: '', baby: '', single_room: '', fixedNights: ''
    });

    useEffect(() => {
        if (priceList) {
            setFormData({ 
                ...priceList,
                // המרה למחרוזת כדי שלא יופיע 0 בשדות ריקים אם לא רוצים
                couple: priceList.couple || '',
                fixedNights: priceList.fixedNights || '' 
            });
        } else {
            setFormData({ name: '', hotel: hotelId, couple: '', teen: '', child: '', baby: '', single_room: '', fixedNights: '' });
        }
    }, [priceList, hotelId]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        // המרת נתונים למספרים לפני שליחה
        const dataToSave = {
            name: formData.name,
            hotel: hotelId,
            couple: Number(formData.couple || 0),
            teen: Number(formData.teen || 0),
            child: Number(formData.child || 0),
            baby: Number(formData.baby || 0),
            single_room: Number(formData.single_room || 0),
            fixedNights: Number(formData.fixedNights || 0),
        };
        onSave(dataToSave);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t bg-gray-50/50 p-4 rounded-xl mt-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
                {priceList ? <Edit size={16}/> : <Plus size={16}/>}
                {priceList ? 'עריכת מחירון' : 'הוספת מחירון חדש'}
            </h3>
            
            <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-500">שם המחירון</label>
                    <Input name="name" placeholder="למשל: סופש, אמצע שבוע" value={formData.name || ''} onChange={handleChange} required className="bg-white" />
                </div>
                
                <div><label className="text-xs text-gray-400">מחיר לזוג</label><Input type="number" name="couple" value={formData.couple} onChange={handleChange} className="bg-white" /></div>
                <div><label className="text-xs text-gray-400">מחיר ליחיד</label><Input type="number" name="single_room" value={formData.single_room} onChange={handleChange} className="bg-white" /></div>
                <div><label className="text-xs text-gray-400">מחיר לנער</label><Input type="number" name="teen" value={formData.teen} onChange={handleChange} className="bg-white" /></div>
                <div><label className="text-xs text-gray-400">מחיר לילד</label><Input type="number" name="child" value={formData.child} onChange={handleChange} className="bg-white" /></div>
                <div><label className="text-xs text-gray-400">מחיר לתינוק</label><Input type="number" name="baby" value={formData.baby} onChange={handleChange} className="bg-white" /></div>

                {/* שדה fixedNights מתוקן */}
                <div className="relative">
                    <label className="text-xs font-bold text-gray-500 flex items-center gap-1 mb-1">
                        <Lock size={10} /> לילות קבועים (אוטומטי)
                    </label>
                    <Input 
                        name="fixedNights" 
                        type="number" 
                        placeholder="0" 
                        value={formData.fixedNights} 
                        onChange={handleChange} 
                        className="bg-gray-100 border-gray-200 font-bold text-center"
                    />
                </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
                <Button type="button" variant="ghost" onClick={onCancel}>ביטול</Button>
                <Button type="submit" disabled={isSaving} className="bg-gray-900 text-white hover:bg-black">
                    {isSaving ? 'שומר...' : 'שמור'}
                </Button>
            </div>
        </form>
    );
};

// --- הקומפוננטה הראשית ---
export default function PriceListManagerDialog({ isOpen, onClose, hotelId }) {
    const queryClient = useQueryClient();
    const [editingPriceList, setEditingPriceList] = useState(null);

    const { data: priceLists = [] } = useQuery({
        queryKey: ['priceListsMap', hotelId],
        queryFn: () => fetchPriceListsForHotel(hotelId),
        enabled: !!hotelId,
    });

    const commonMutationOptions = {
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['priceListsMap', hotelId] });
            setEditingPriceList(null);
        },
        onError: (err) => toast.error(err.response?.data?.message || 'אירעה שגיאה'),
    };

    const createMutation = useMutation({ ...commonMutationOptions, mutationFn: createPriceList, onSuccess: () => { toast.success('נוצר בהצלחה'); commonMutationOptions.onSuccess(); } });
    const updateMutation = useMutation({ ...commonMutationOptions, mutationFn: updatePriceList, onSuccess: () => { toast.success('עודכן בהצלחה'); commonMutationOptions.onSuccess(); } });
    const deleteMutation = useMutation({ ...commonMutationOptions, mutationFn: deletePriceList, onSuccess: () => { toast.success('נמחק בהצלחה'); commonMutationOptions.onSuccess(); } });

    const handleSave = (data) => {
        if (editingPriceList && editingPriceList._id) {
            updateMutation.mutate({ id: editingPriceList._id, ...data });
        } else {
            // הוספה לסוף הרשימה
            const nextOrder = priceLists.length;
            createMutation.mutate({ ...data, displayOrder: nextOrder });
        }
    };

    const handleDelete = (id) => {
        if (window.confirm('האם למחוק את המחירון?')) {
            deleteMutation.mutate(id);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>ניהול מחירונים</DialogTitle>
                    <DialogDescription>רשימת המחירונים למלון הנבחר.</DialogDescription>
                </DialogHeader>

                <div className="space-y-2 mt-2">
                    {priceLists.length === 0 && !editingPriceList && (
                        <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-xl">
                            אין מחירונים. לחץ על הוספה למטה.
                        </div>
                    )}

                    {priceLists.map(pl => (
                        <div key={pl._id} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-all">
                            <div>
                                <div className="font-bold text-gray-800 flex items-center gap-2">
                                    {pl.name}
                                    {pl.fixedNights > 0 && (
                                        <span className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md border border-gray-200 flex items-center gap-1">
                                            <Lock size={8} /> {pl.fixedNights}
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500 mt-1 flex gap-3">
                                    <span>זוג: {pl.couple}</span>
                                    <span className="text-gray-300">|</span>
                                    <span>ילד: {pl.child}</span>
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-blue-600" onClick={() => setEditingPriceList(pl)}>
                                    <Edit size={14} />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-300 hover:text-red-500" onClick={() => handleDelete(pl._id)}>
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* כפתור הוספה (מוסתר אם עורכים) */}
                {!editingPriceList && (
                    <Button 
                        onClick={() => setEditingPriceList({})} 
                        variant="outline" 
                        className="w-full mt-4 border-dashed h-12 text-gray-500 hover:text-gray-900 hover:border-gray-400"
                    >
                        + הוסף מחירון חדש
                    </Button>
                )}

                {/* טופס עריכה/יצירה */}
                {editingPriceList && (
                    <PriceListForm
                        hotelId={hotelId}
                        priceList={editingPriceList._id ? editingPriceList : null}
                        onSave={handleSave}
                        onCancel={() => setEditingPriceList(null)}
                        isSaving={createMutation.isPending || updateMutation.isPending}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}