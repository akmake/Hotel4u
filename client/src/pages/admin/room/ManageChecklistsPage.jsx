import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api.js';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/Dialog";
import { Input } from '@/components/ui/Input.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs"; // וודא שיש לך את הקומפוננטה הזו
import { ListChecks, PlusCircle, ArrowUp, ArrowDown, X, Hotel, LogIn, LogOut, BedDouble } from 'lucide-react';

const fetchHotels = async () => (await api.get('/admin/hotels')).data;

// הפונקציה המעודכנת שולחת גם את הסוג (type)
const updateChecklistApi = ({ id, type, items }) => 
    api.put(`/admin/hotels/${id}/checklist`, { type, items });

export default function ManageChecklistsPage() {
    const [selectedHotel, setSelectedHotel] = useState(null);
    const { data: hotels = [], isLoading } = useQuery({ queryKey: ['hotels'], queryFn: fetchHotels });

    if (isLoading) return <div className="p-8 text-center">טוען מלונות...</div>;

    return (
        <div className="container mx-auto p-6 space-y-6" dir="rtl">
            <header>
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                    <ListChecks className="text-blue-600"/> ניהול נהלי ניקיון
                </h1>
                <p className="text-gray-600 mt-1">כאן מגדירים את המשימות שיופיעו לחדרנית באופן אוטומטי לפי סוג החדר.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {hotels.map(hotel => (
                    <Card key={hotel._id} className="hover:shadow-md transition-shadow cursor-pointer border-t-4 border-t-blue-500" onClick={() => setSelectedHotel(hotel)}>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                {hotel.name}
                                <Hotel size={20} className="text-gray-400"/>
                            </CardTitle>
                            <CardDescription>
                                לחץ לעריכת הנהלים (כניסה / עזיבה / רענון)
                            </CardDescription>
                        </CardHeader>
                    </Card>
                ))}
            </div>

            {selectedHotel && (
                <ChecklistDialog 
                    hotel={selectedHotel} 
                    isOpen={!!selectedHotel} 
                    onClose={() => setSelectedHotel(null)} 
                />
            )}
        </div>
    );
}

function ChecklistDialog({ hotel, isOpen, onClose }) {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState('departure'); // ברירת מחדל
    
    // אנו שומרים עותק מקומי של כל הרשימות כדי לערוך
    const [lists, setLists] = useState({
        departure: hotel.checklists?.departure || [],
        stayover: hotel.checklists?.stayover || [],
        arrival: hotel.checklists?.arrival || []
    });

    const [newItemText, setNewItemText] = useState('');

    const updateMutation = useMutation({
        mutationFn: () => updateChecklistApi({ 
            id: hotel._id, 
            type: activeTab, 
            items: lists[activeTab] 
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['hotels'] });
            toast.success(`רשימת "${tabsConfig[activeTab].label}" נשמרה בהצלחה!`);
        },
        onError: () => toast.error('שגיאה בשמירה')
    });

    const currentList = lists[activeTab];

    const addItem = () => {
        if (!newItemText.trim()) return;
        const newItem = { text: newItemText.trim(), order: currentList.length };
        
        setLists(prev => ({
            ...prev,
            [activeTab]: [...prev[activeTab], newItem]
        }));
        setNewItemText('');
    };

    const removeItem = (index) => {
        setLists(prev => ({
            ...prev,
            [activeTab]: prev[activeTab].filter((_, i) => i !== index)
        }));
    };

    const tabsConfig = {
        departure: { label: 'נוהל עזיבה (יסודי)', icon: LogOut, color: 'text-red-600' },
        stayover: { label: 'נוהל רענון (שוהים)', icon: BedDouble, color: 'text-blue-600' },
        arrival: { label: 'נוהל כניסה (Check-In)', icon: LogIn, color: 'text-green-600' }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col" dir="rtl">
                <DialogHeader>
                    <DialogTitle>עריכת נהלים - {hotel.name}</DialogTitle>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                    <TabsList className="grid w-full grid-cols-3">
                        {Object.entries(tabsConfig).map(([key, config]) => (
                            <TabsTrigger key={key} value={key} className="flex gap-2">
                                <config.icon size={16}/> {config.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <div className="flex-1 overflow-hidden flex flex-col mt-4">
                        <div className="flex gap-2 mb-4">
                            <Input 
                                placeholder="הוסף משימה חדשה..." 
                                value={newItemText} 
                                onChange={e => setNewItemText(e.target.value)} 
                                onKeyDown={e => e.key === 'Enter' && addItem()} 
                            />
                            <Button onClick={addItem}><PlusCircle/></Button>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-slate-50 p-2 rounded border space-y-2">
                            {currentList.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center bg-white p-3 rounded border shadow-sm group">
                                    <span className="flex items-center gap-3">
                                        <span className="bg-slate-200 text-slate-600 text-xs w-6 h-6 flex items-center justify-center rounded-full">{idx + 1}</span>
                                        {item.text}
                                    </span>
                                    <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removeItem(idx)}>
                                        <X size={16}/>
                                    </Button>
                                </div>
                            ))}
                            {currentList.length === 0 && (
                                <div className="text-center text-gray-400 py-10 flex flex-col items-center">
                                    <ListChecks size={40} className="mb-2 opacity-20"/>
                                    אין משימות מוגדרות לנוהל זה.
                                </div>
                            )}
                        </div>
                    </div>
                </Tabs>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={onClose}>סגור</Button>
                    <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="bg-purple-600">
                        {updateMutation.isPending ? 'שומר...' : `שמור שינויים (${currentList.length})`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}