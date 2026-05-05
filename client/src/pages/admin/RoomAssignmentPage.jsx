import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api.js';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button.jsx';
import { Checkbox } from '@/components/ui/Checkbox.jsx';
import { Users, Save, User, Paintbrush, ArrowRightLeft, LogIn, LogOut, BedDouble } from 'lucide-react';

const fetchHotels = async () => (await api.get('/admin/hotels')).data;

// ✨ התיקון הקריטי: הוספנו ?activeOnly=true
// זה מבטיח שהשרת יחזיר רק חדרים שצריכים יחס היום
const fetchRooms = async (hotelId) => (await api.get(`/rooms/${hotelId}?activeOnly=true`)).data;

const fetchHousekeepers = async () => (await api.get('/users?role=housekeeper')).data;

// הגדרות עיצוב לכל סטטוס
const statusConfig = {
    'Arrival': { label: 'הגעה', color: 'bg-green-100 text-green-700 border-green-200', icon: LogIn },
    'Departure': { label: 'עזיבה', color: 'bg-red-100 text-red-700 border-red-200', icon: LogOut },
    'Stayover': { label: 'שהייה', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: BedDouble },
    'BackToBack': { label: 'תחלופה', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: ArrowRightLeft },
    'None': { label: 'ללא', color: 'bg-slate-100 text-slate-500', icon: null }
};

export default function RoomAssignmentPage() {
    const [selectedHotel, setSelectedHotel] = useState(null);
    const [selectedWorker, setSelectedWorker] = useState('');
    const [selectedRooms, setSelectedRooms] = useState(new Set());
    const [filter, setFilter] = useState('all');

    const queryClient = useQueryClient();

    const { data: hotels = [] } = useQuery({ queryKey: ['hotels'], queryFn: fetchHotels });
    
    React.useEffect(() => {
        if (hotels.length > 0 && !selectedHotel) setSelectedHotel(hotels[0]._id);
    }, [hotels]);

    const { data: rooms = [], isLoading: loadingRooms } = useQuery({
        queryKey: ['rooms', selectedHotel],
        queryFn: () => fetchRooms(selectedHotel),
        enabled: !!selectedHotel
    });

    const { data: workers = [] } = useQuery({
        queryKey: ['housekeepers'],
        queryFn: fetchHousekeepers
    });

    const assignMutation = useMutation({
        mutationFn: ({ roomIds, userId }) => api.post('/bookings/assign', { roomIds, userId }),
        onSuccess: () => {
            toast.success('השיבוץ נשמר בהצלחה');
            queryClient.invalidateQueries(['rooms', selectedHotel]);
            setSelectedRooms(new Set());
        },
        onError: () => toast.error('שגיאה בשיבוץ')
    });

    const toggleRoom = (roomId) => {
        const next = new Set(selectedRooms);
        if (next.has(roomId)) next.delete(roomId);
        else next.add(roomId);
        setSelectedRooms(next);
    };

    const handleAssign = () => {
        if (!selectedWorker) return toast.error('יש לבחור עובד');
        if (selectedRooms.size === 0) return toast.error('יש לבחור חדרים');
        
        assignMutation.mutate({ 
            roomIds: Array.from(selectedRooms), 
            userId: selectedWorker === 'unassign' ? null : selectedWorker 
        });
    };

    const handleSelectAll = () => {
        if (selectedRooms.size === filteredRooms.length) {
            setSelectedRooms(new Set());
        } else {
            setSelectedRooms(new Set(filteredRooms.map(r => r._id)));
        }
    };

    const filteredRooms = useMemo(() => {
        return rooms.filter(room => {
            if (filter === 'unassigned') return !room.assignedTo;
            if (filter === 'assigned') return room.assignedTo;
            return true;
        }).sort((a,b) => a.roomNumber.localeCompare(b.roomNumber, undefined, {numeric: true}));
    }, [rooms, filter]);

    return (
        <div className="container mx-auto p-6 space-y-6 bg-slate-50 min-h-screen" dir="rtl">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Users className="text-purple-600"/> שיבוץ חדרים לעובדים
                    </h1>
                    <p className="text-slate-500 text-sm">
                        מוצגים רק {filteredRooms.length} חדרים הפעילים בתוכנית היומית
                    </p>
                </div>
                
                <div className="flex gap-4 items-end w-full md:w-auto">
                     <div className="flex flex-col gap-1 flex-1 md:flex-none">
                        <label className="text-xs font-bold text-slate-500">למי לשבץ?</label>
                        <select 
                            className="h-10 border rounded px-3 w-full md:min-w-[200px] bg-slate-50"
                            value={selectedWorker}
                            onChange={e => setSelectedWorker(e.target.value)}
                        >
                            <option value="" disabled>בחר חדרנית...</option>
                            {workers.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
                            <option value="unassign" className="text-red-600">-- הסר שיבוץ --</option>
                        </select>
                    </div>

                    <Button onClick={handleAssign} disabled={selectedRooms.size === 0 || !selectedWorker} className="bg-purple-600 hover:bg-purple-700 h-10 shadow-md">
                        <Save className="ml-2 h-4 w-4"/> שמור
                    </Button>
                </div>
            </header>

            <div className="flex gap-2 items-center overflow-x-auto pb-2">
                {hotels.map(h => (
                    <button 
                        key={h._id} 
                        onClick={() => setSelectedHotel(h._id)}
                        className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${selectedHotel === h._id ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-white text-slate-600 border border-transparent hover:bg-slate-100'}`}
                    >
                        {h.name}
                    </button>
                ))}
                <div className="border-r h-6 mx-2 border-slate-300"></div>
                <button onClick={() => setFilter('all')} className={`px-3 py-1 text-sm rounded ${filter === 'all' ? 'font-bold text-black' : 'text-slate-500'}`}>הכל</button>
                <button onClick={() => setFilter('unassigned')} className={`px-3 py-1 text-sm rounded ${filter === 'unassigned' ? 'font-bold text-red-600 bg-red-50' : 'text-slate-500'}`}>לא משובצים</button>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex justify-between mb-4">
                    <h3 className="font-bold text-lg flex gap-2 items-center">
                        <Paintbrush size={18} className="text-slate-400"/> רשימת חדרים ({filteredRooms.length})
                    </h3>
                    <Button variant="outline" size="sm" onClick={handleSelectAll}>בחר הכל</Button>
                </div>
                
                {loadingRooms ? <p className="text-center py-10">טוען נתונים...</p> : (
                    <>
                        {filteredRooms.length === 0 ? (
                            <div className="text-center py-10 text-gray-400">
                                <p>אין חדרים להצגה היום.</p>
                                <p className="text-xs mt-1">(נסה להעלות אקסל חדש אם הנתונים חסרים)</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {filteredRooms.map(room => {
                                    const isSelected = selectedRooms.has(room._id);
                                    const assignedWorker = workers.find(w => w._id === room.assignedTo || w._id === room.assignedTo?._id);
                                    
                                    const typeConfig = statusConfig[room.bookingType] || statusConfig['None'];
                                    const StatusIcon = typeConfig.icon;

                                    return (
                                        <div 
                                            key={room._id}
                                            onClick={() => toggleRoom(room._id)}
                                            className={`
                                                cursor-pointer p-3 rounded-lg border-2 transition-all relative flex flex-col justify-between min-h-[120px]
                                                ${isSelected ? 'border-purple-500 bg-purple-50' : 'border-slate-100 hover:border-purple-200 bg-slate-50'}
                                            `}
                                        >
                                            <div className="flex justify-between items-start">
                                                <span className="font-black text-2xl text-slate-700">{room.roomNumber}</span>
                                                <Checkbox checked={isSelected} className="pointer-events-none data-[state=checked]:bg-purple-600" />
                                            </div>

                                            <div className={`text-[10px] font-bold px-2 py-1 rounded-full border w-fit mt-1 flex items-center gap-1 ${typeConfig.color}`}>
                                                {StatusIcon && <StatusIcon size={10} />}
                                                {typeConfig.label}
                                            </div>
                                            
                                            <div className="mt-2 flex justify-between items-end">
                                                <div className="text-[10px] text-slate-400 truncate max-w-[50%]">{room.roomType?.name}</div>
                                                
                                                {assignedWorker ? (
                                                    <div className="flex items-center gap-1 text-[10px] text-green-700 font-bold bg-green-100 px-2 py-1 rounded">
                                                        <User size={10}/> {assignedWorker.name.split(' ')[0]}
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] text-red-400 font-medium bg-red-50 px-1 rounded">לא משובץ</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}