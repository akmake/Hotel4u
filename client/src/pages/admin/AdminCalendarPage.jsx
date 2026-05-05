// client/src/pages/admin/AdminCalendarPage.jsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    format, startOfMonth, endOfMonth, eachDayOfInterval, 
    isWithinInterval, startOfDay, addMonths, subMonths, isSameDay, addDays
} from 'date-fns';
import { he } from 'date-fns/locale';
import { HDate, HebrewCalendar, gematriya } from '@hebcal/core'; 
import { 
    ChevronRight, ChevronLeft, Bed, CheckCircle2, 
    MapPin, Search, ArrowRight, Star,
    Users, LogIn, LogOut, Moon, Sun, Upload, Phone, Trash2, Save, X, Calendar as CalendarIcon
} from 'lucide-react';
import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { Label } from "@/components/ui/Label";
import { socket } from '@/utils/socketService'; 
import toast from 'react-hot-toast';

// --- פונקציית עזר לחישוב נתונים עבריים ---
const getHebrewDetails = (date) => {
    const hdate = new HDate(date);
    const hebrewDay = gematriya(hdate.getDate()); 
    
    let parashaName = null;
    let holidayName = null;

    if (date.getDay() === 6) {
        const options = { start: date, end: date, isHebrewYear: false, il: true, sedrot: true };
        const events = HebrewCalendar.calendar(options);
        const parashaEvent = events.find(e => e.getFlags() & 1024);
        if (parashaEvent) {
            parashaName = parashaEvent.render('he').replace('פרשת ', ''); 
        }
    }

    if (hdate.getDate() === 1) {
        holidayName = 'ר״ח ' + hdate.getMonthName('he');
    }
    const holidays = HebrewCalendar.getHolidaysOnDate(hdate, true);
    if (holidays && holidays.length > 0) {
        const relevantHoliday = holidays.find(h => !(h.getFlags() & 1024) && hdate.getDate() !== 1 && hdate.getDate() !== 30);
        if (relevantHoliday) holidayName = relevantHoliday.render('he');
    }

    return { hebrewDay, parashaName, holidayName };
};

const getHebrewMonthHeader = (currentDate) => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const startH = new HDate(start);
    const endH = new HDate(end);
    
    const yearH = gematriya(startH.getFullYear());
    const month1 = startH.getMonthName('he');
    const month2 = endH.getMonthName('he');

    if (month1 === month2) return `${month1} ${yearH}`;
    return `${month1} - ${month2}, ${yearH}`;
};

export default function AdminCalendarPage() {
    const [selectedHotelId, setSelectedHotelId] = useState("");
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedRoom, setSelectedRoom] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const fileInputRef = useRef(null);
    const queryClient = useQueryClient();

    // האזנה לעדכונים בזמן אמת
    useEffect(() => {
        if (selectedHotelId) {
            socket.emit('join_hotel', selectedHotelId);
            socket.on('calendar_updated', () => {
                queryClient.invalidateQueries(['calendar-data']);
                toast.success('הלוח התעדכן בזמן אמת');
            });
            return () => socket.off('calendar_updated');
        }
    }, [selectedHotelId, queryClient]);

    const { data: hotels = [] } = useQuery({
        queryKey: ['hotels'],
        queryFn: async () => (await api.get('/admin/hotels')).data
    });

    const { data, isLoading } = useQuery({
        queryKey: ['calendar-data', selectedHotelId, format(currentDate, 'yyyy-MM')],
        queryFn: async () => {
            const res = await api.get('/admin/calendar', {
                params: { 
                    hotelId: selectedHotelId, 
                    startDate: startOfMonth(currentDate), 
                    endDate: endOfMonth(currentDate) 
                }
            });
            return res.data;
        },
        enabled: !!selectedHotelId
    });

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('hotelId', selectedHotelId);

        try {
            await api.post('/bookings/upload', formData);
            toast.success('סידור העבודה הועלה בהצלחה');
            queryClient.invalidateQueries(['calendar-data']);
        } catch (err) {
            toast.error('שגיאה בהעלאת הקובץ');
        }
        e.target.value = null;
    };

    const filteredRooms = useMemo(() => {
        return data?.rooms?.filter(r => r.name.toString().includes(searchTerm)) || [];
    }, [data, searchTerm]);

    const getActiveEvent = (roomId) => {
        const today = startOfDay(new Date());
        return data?.events?.find(e => 
            isWithinInterval(today, {
                start: startOfDay(new Date(e.start)),
                end: startOfDay(new Date(e.end))
            })
        );
    };

    return (
        <div className="min-h-screen bg-[#FDFCFB] p-6 lg:p-10 font-sans" dir="rtl">
            <header className="max-w-[1600px] mx-auto mb-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight">
                        Zipori <span className="text-amber-600 font-serif italic">Status</span>
                    </h1>
                    <p className="text-slate-400 font-medium mt-1">ניהול חדרים ותפוסה בסטנדרט פרימיום</p>
                </div>

                <div className="flex flex-wrap gap-3 bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
                    <Select onValueChange={setSelectedHotelId} value={selectedHotelId}>
                        <SelectTrigger className="w-56 border-none shadow-none focus:ring-0 font-bold bg-transparent">
                            <MapPin className="ml-2 h-4 w-4 text-amber-600" />
                            <SelectValue placeholder="בחר מלון..." />
                        </SelectTrigger>
                        <SelectContent>
                            {hotels.map(h => <SelectItem key={h._id} value={h._id}>{h.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    
                    {selectedHotelId && (
                        <>
                            <div className="h-6 w-px bg-slate-100 mx-2" />
                            <Button variant="ghost" className="text-slate-500 hover:text-amber-600 h-10 px-4" onClick={() => fileInputRef.current.click()}>
                                <Upload size={18} className="ml-2" /> ייבוא אופטימה
                            </Button>
                            <input type="file" hidden ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" />
                        </>
                    )}

                    <div className="relative border-r border-slate-100 pr-3">
                        <Search className="absolute right-6 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" />
                        <Input 
                            placeholder="חפש חדר..." 
                            className="pr-10 w-40 bg-slate-50 border-none rounded-xl focus:bg-white transition-all shadow-none focus:ring-0"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </header>

            {!selectedHotelId ? (
                <div className="flex flex-col items-center justify-center h-[50vh] text-slate-300">
                    <Star size={80} className="mb-4 opacity-10" />
                    <p className="text-xl font-bold italic">אנא בחר מלון להצגת תמונת המצב</p>
                </div>
            ) : (
                <div className="max-w-[1600px] mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
                    {filteredRooms.map((room, index) => (
                        <RoomLuxuryCard 
                            key={room.id} 
                            room={room} 
                            activeEvent={getActiveEvent(room.id)}
                            index={index} 
                            onClick={() => setSelectedRoom(room)} 
                        />
                    ))}
                </div>
            )}

            <AnimatePresence>
                {selectedRoom && (
                    <RoomVaultTimeline 
                        room={selectedRoom}
                        hotelId={selectedHotelId}
                        events={data?.events?.filter(e => e.roomId === selectedRoom.id) || []}
                        onClose={() => setSelectedRoom(null)}
                        currentDate={currentDate}
                        onNextMonth={() => setCurrentDate(addMonths(currentDate, 1))}
                        onPrevMonth={() => setCurrentDate(subMonths(currentDate, 1))}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function RoomLuxuryCard({ room, activeEvent, onClick, index }) {
    let currentStatusLabel = null;
    let statusIcon = null;
    let statusColor = 'text-slate-400';

    if (activeEvent) {
        const today = startOfDay(new Date());
        const start = startOfDay(new Date(activeEvent.start));
        const end = startOfDay(new Date(activeEvent.end));

        if (isSameDay(today, start)) {
            currentStatusLabel = 'הגעה היום';
            statusIcon = <LogIn size={14} />;
            statusColor = 'text-emerald-600 bg-emerald-50';
        } else if (isSameDay(today, end)) {
            currentStatusLabel = 'עזיבה היום';
            statusIcon = <LogOut size={14} />;
            statusColor = 'text-rose-600 bg-rose-50';
        } else {
            currentStatusLabel = 'תפוס';
            statusIcon = <Moon size={14} />;
            statusColor = 'text-amber-600 bg-amber-50';
        }
    }

    const cleanStatusMap = {
        'clean': { color: 'bg-emerald-400', label: 'נקי' },
        'dirty': { color: 'bg-rose-400', label: 'מלוכלך' },
        'inspection': { color: 'bg-blue-400', label: 'בבדיקה' },
        'maintenance': { color: 'bg-amber-400', label: 'תקלה' }
    };
    const cleanInfo = cleanStatusMap[room.status] || cleanStatusMap['dirty'];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
            whileHover={{ y: -8, scale: 1.02 }} onClick={onClick}
            className="cursor-pointer bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm hover:shadow-2xl transition-all group relative overflow-hidden h-64 flex flex-col justify-between"
        >
            <div className="flex justify-between items-start relative z-10">
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center bg-slate-50 text-slate-700 shadow-inner group-hover:bg-slate-900 group-hover:text-white transition-colors duration-300">
                    <Bed size={22} />
                </div>
                <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
                    <div className={`w-2 h-2 rounded-full ${cleanInfo.color} animate-pulse`} />
                    <span className="text-[10px] font-bold text-slate-400">{cleanInfo.label}</span>
                </div>
            </div>

            <div className="relative z-10 mt-2">
                <h3 className="text-4xl font-black text-slate-800 mb-1">{room.name}</h3>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">{room.type}</p>
            </div>

            <div className="relative z-10 mt-auto pt-4 border-t border-dashed border-slate-100">
                {activeEvent ? (
                    <div className={`flex items-center justify-between p-2 rounded-xl ${statusColor}`}>
                        <div className="flex items-center gap-2">
                            {statusIcon}
                            <span className="text-xs font-bold">{currentStatusLabel}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-black opacity-80">
                            <Users size={10} />
                            <span>{activeEvent.pax}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-between items-center text-slate-300">
                        <span className="text-xs font-bold">פנוי היום</span>
                        <ChevronLeft size={14} className="opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                    </div>
                )}
            </div>
            <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-slate-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700" />
        </motion.div>
    );
}

function RoomVaultTimeline({ room, hotelId, events, onClose, currentDate, onNextMonth, onPrevMonth }) {
    const queryClient = useQueryClient();
    const [bookingDialog, setBookingDialog] = useState({ open: false, data: null, isNew: false });

    const startM = startOfMonth(currentDate);
    const endM = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start: startM, end: endM });
    const startDayOfWeek = startM.getDay(); 
    const paddingDays = Array(startDayOfWeek).fill(null);

    const today = startOfDay(new Date());
    const activeToday = events.find(e => 
        isWithinInterval(today, { 
            start: startOfDay(new Date(e.start)), 
            end: startOfDay(new Date(e.end)) 
        })
    );

    // ✨ תיקון לוגיקת לחיצה: המרת תאריכים לאובייקטים של JS כדי למנוע קריסה
    const handleDayClick = (day, existingBooking) => {
        if (existingBooking) {
            setBookingDialog({ 
                open: true, 
                isNew: false, 
                data: { 
                    ...existingBooking, 
                    id: existingBooking.id,
                    // וידוא שהתאריכים הם אובייקטי Date תקינים
                    arrivalDate: new Date(existingBooking.start),
                    departureDate: new Date(existingBooking.end)
                } 
            });
        } else {
            setBookingDialog({ 
                open: true, 
                isNew: true, 
                data: { 
                    room: room.id, 
                    arrivalDate: day, 
                    departureDate: addDays(day, 1),
                    guestName: '',
                    pax: 2,
                    optimaNumber: '',
                    guestPhone: ''
                } 
            });
        }
    };

    const handleSaveBooking = async () => {
        try {
            if (bookingDialog.isNew) {
                await api.post('/bookings/manual', { ...bookingDialog.data, hotel: hotelId });
                toast.success('הזמנה נוצרה');
            } else {
                await api.put(`/bookings/${bookingDialog.data.id}`, bookingDialog.data);
                toast.success('הזמנה עודכנה');
            }
            setBookingDialog({ open: false, data: null });
            queryClient.invalidateQueries(['calendar-data']);
        } catch (err) {
            toast.error('שגיאה בשמירת הנתונים');
        }
    };

    let todayStatusTitle = "החדר פנוי";
    let todayStatusSubtitle = "אין פעילות רשומה להיום";
    let todayIcon = <Sun size={40} className="text-amber-400" />;

    if (activeToday) {
        const isStart = isSameDay(today, new Date(activeToday.start));
        const isEnd = isSameDay(today, new Date(activeToday.end));

        if (isStart) {
            todayStatusTitle = "צ'ק-אין היום";
            todayStatusSubtitle = `אורח: ${activeToday.guestName || activeToday.title}`;
            todayIcon = <LogIn size={40} className="text-emerald-500" />;
        } else if (isEnd) {
            todayStatusTitle = "צ'ק-אאוט היום";
            todayStatusSubtitle = `אורח: ${activeToday.guestName || activeToday.title}`;
            todayIcon = <LogOut size={40} className="text-rose-500" />;
        } else {
            todayStatusTitle = "חדר תפוס";
            todayStatusSubtitle = `אורח: ${activeToday.guestName || activeToday.title}`;
            todayIcon = <Moon size={40} className="text-amber-500" />;
        }
    }

    const hebrewHeader = getHebrewMonthHeader(currentDate);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ y: 50, scale: 0.98 }} animate={{ y: 0, scale: 1 }} className="bg-white w-full max-w-[95vw] h-[92vh] rounded-[2rem] shadow-2xl flex flex-col md:flex-row overflow-hidden border border-slate-200">
                
                <div className="w-full md:w-[22rem] bg-white border-l border-slate-200 text-slate-800 p-8 flex flex-col relative shrink-0 z-20 shadow-xl">
                    <button onClick={onClose} className="absolute top-6 left-6 w-10 h-10 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center hover:bg-slate-100 transition-all z-20 shadow-sm text-slate-500">
                        <ArrowRight size={20} />
                    </button>
                    
                    <div className="mt-12 flex flex-col h-full relative z-10">
                        <span className="text-amber-600 font-black text-[10px] tracking-[0.3em] uppercase mb-2 block">Room Overview</span>
                        <h2 className="text-7xl font-black mb-1 tracking-tighter leading-none text-slate-900">{room.name}</h2>
                        <p className="text-slate-400 text-base font-bold mb-10">{room.type}</p>

                        <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 shadow-sm mb-6">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">סטטוס להיום</span>
                                <div className={`w-2 h-2 rounded-full animate-pulse ${activeToday ? 'bg-amber-500' : 'bg-emerald-400'} `} />
                            </div>
                            <div className="flex items-center gap-4 mb-4">
                                <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
                                    {todayIcon}
                                </div>
                                <div>
                                    <h3 className="text-xl font-black leading-none mb-1 text-slate-800">{todayStatusTitle}</h3>
                                    <p className="text-xs text-slate-500 font-medium truncate w-32">{todayStatusSubtitle}</p>
                                </div>
                            </div>
                            {activeToday && (
                                <div className="flex gap-4 pt-4 border-t border-slate-200/60">
                                    <div className="text-center">
                                        <div className="text-[10px] text-slate-400 uppercase font-bold">נפשות</div>
                                        <div className="text-lg font-bold text-slate-700">{activeToday.pax}</div>
                                    </div>
                                    <div className="text-center ml-auto">
                                        <div className="text-[10px] text-slate-400 uppercase font-bold">יציאה</div>
                                        <div className="text-lg font-bold text-amber-600">{format(new Date(activeToday.end), 'dd/MM')}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <div className="mt-auto bg-slate-50 rounded-2xl p-4 flex justify-between items-center border border-slate-100">
                             <span className="text-xs font-bold text-slate-500">תפוסה החודש</span>
                             <span className="text-xl font-black text-slate-800">{events?.length || 0} <span className="text-xs text-slate-400 font-medium">לילות</span></span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex flex-col bg-slate-100/50 h-full relative">
                    <div className="flex items-center justify-between p-8 pb-4 bg-white border-b border-slate-200">
                        <div>
                            <h3 className="text-4xl font-black text-slate-900 tracking-tight leading-none">
                                {format(currentDate, 'MMMM yyyy', { locale: he })}
                            </h3>
                            <p className="text-amber-600/80 text-lg font-bold mt-1">
                                {hebrewHeader}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={onPrevMonth} className="w-12 h-12 flex items-center justify-center hover:bg-slate-50 rounded-2xl transition-all border border-slate-100 text-slate-600 shadow-sm"><ChevronRight size={24}/></button>
                            <button onClick={onNextMonth} className="w-12 h-12 flex items-center justify-center hover:bg-slate-50 rounded-2xl transition-all border border-slate-100 text-slate-600 shadow-sm"><ChevronLeft size={24}/></button>
                        </div>
                    </div>

                    <div className="grid grid-cols-7 gap-0 px-8 py-3 bg-slate-200/50 border-b border-slate-200">
                        {['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(d => (
                            <div key={d} className="text-center text-[11px] font-black text-slate-500 uppercase tracking-widest">{d}</div>
                        ))}
                    </div>

                    <div className="flex-1 grid grid-cols-7 grid-rows-6 p-6 gap-3 h-full overflow-hidden">
                        {paddingDays.map((_, i) => <div key={`pad-${i}`} />)}

                        {days.map((day, i) => {
                            const booking = events?.find(e => isWithinInterval(startOfDay(day), { 
                                start: startOfDay(new Date(e.start)), 
                                end: startOfDay(new Date(e.end)) 
                            }));

                            const { hebrewDay, parashaName, holidayName } = getHebrewDetails(day);

                            let containerClass = "bg-white shadow-sm border border-slate-200/60 hover:border-amber-300 hover:shadow-md hover:-translate-y-1 cursor-pointer pointer-events-auto";
                            let dayNumClass = "text-slate-400";
                            let hebDayClass = "text-slate-300";
                            let statusLabel = null;
                            let statusColorClass = "";

                            if (booking) {
                                const isStart = isSameDay(day, new Date(booking.start));
                                const isEnd = isSameDay(day, new Date(booking.end));
                                
                                if (isStart && isEnd) {
                                    containerClass += " bg-amber-50 border-2 border-amber-400 shadow-lg relative z-10";
                                    dayNumClass = "text-amber-700";
                                    statusLabel = "B2B";
                                    statusColorClass = "text-amber-600";
                                } else if (isStart) {
                                    containerClass += " bg-emerald-50 border border-emerald-200 shadow-md";
                                    dayNumClass = "text-emerald-700";
                                    statusLabel = "כניסה";
                                    statusColorClass = "text-emerald-600";
                                } else if (isEnd) {
                                    containerClass += " bg-rose-50 border border-rose-200 shadow-md";
                                    dayNumClass = "text-rose-700";
                                    statusLabel = "יציאה";
                                    statusColorClass = "text-rose-600";
                                } else {
                                    containerClass += " bg-[#FFFBF2] border border-amber-100 shadow-sm"; 
                                    dayNumClass = "text-slate-500"; 
                                    statusLabel = "תפוס"; 
                                    statusColorClass = "text-amber-600/60";
                                }
                                hebDayClass = "text-slate-400";
                            }

                            return (
                                <div key={i} onClick={() => handleDayClick(day, booking)} className={`relative rounded-xl transition-all duration-300 flex flex-col p-3 z-30 ${containerClass}`}>
                                    <div className="flex justify-between items-start w-full mb-1">
                                        <span className={`text-2xl font-black ${dayNumClass}`}>{format(day, 'd')}</span>
                                        <span className={`text-xs font-bold ${hebDayClass}`}>{hebrewDay}</span>
                                    </div>

                                    {booking ? (
                                        <div className="mt-1 flex flex-col">
                                            <div className={`text-[11px] font-black truncate ${statusColorClass}`}>
                                                {booking.guestName || booking.title}
                                            </div>
                                            {booking.optimaNumber && (
                                                <div className="text-[9px] font-bold text-slate-400/80">
                                                    #{booking.optimaNumber}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            {parashaName && (
                                                <div className="mt-auto self-center text-center w-full">
                                                    <div className="h-px w-8 bg-slate-100 mx-auto mb-1"></div>
                                                    <span className="text-[11px] font-bold text-slate-600 block leading-tight">{parashaName}</span>
                                                </div>
                                            )}
                                            {holidayName && !parashaName && (
                                                <div className="mt-auto self-center text-center">
                                                    <span className="text-[10px] font-bold text-amber-500 block leading-tight">{holidayName}</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </motion.div>

            {/* חלון ניהול הזמנה - הוספת ולידציית תאריכים למניעת קריסה */}
            <Dialog open={bookingDialog.open} onOpenChange={(val) => !val && setBookingDialog({ open: false, data: null })}>
                <DialogContent className="sm:max-w-[425px] rounded-[2rem] border-none shadow-2xl z-[110]" dir="rtl">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-slate-900">
                            {bookingDialog.isNew ? 'הזמנה חדשה' : 'פרטי הזמנה'}
                        </DialogTitle>
                    </DialogHeader>
                    {bookingDialog.data && (
                        <div className="grid gap-6 py-4">
                            <div className="space-y-2">
                                <Label className="font-bold text-slate-500 mr-1">שם האורח</Label>
                                <Input className="rounded-xl bg-slate-50 border-none shadow-none focus:ring-2 focus:ring-amber-500" value={bookingDialog.data.guestName} onChange={(e) => setBookingDialog({ ...bookingDialog, data: { ...bookingDialog.data, guestName: e.target.value } })} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="font-bold text-slate-500 mr-1">אופטימה #</Label>
                                    <Input className="rounded-xl bg-slate-50 border-none shadow-none" value={bookingDialog.data.optimaNumber} onChange={(e) => setBookingDialog({ ...bookingDialog, data: { ...bookingDialog.data, optimaNumber: e.target.value } })} />
                                </div>
                                <div className="space-y-2">
                                    <Label className="font-bold text-slate-500 mr-1">טלפון</Label>
                                    <Input className="rounded-xl bg-slate-50 border-none shadow-none" type="tel" value={bookingDialog.data.guestPhone} onChange={(e) => setBookingDialog({ ...bookingDialog, data: { ...bookingDialog.data, guestPhone: e.target.value } })} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="font-bold text-slate-500 mr-1">נפשות (סה"כ)</Label>
                                    <Input type="number" className="rounded-xl bg-slate-50 border-none shadow-none" value={bookingDialog.data.pax} onChange={(e) => setBookingDialog({ ...bookingDialog, data: { ...bookingDialog.data, pax: parseInt(e.target.value) } })} />
                                </div>
                                <div className="space-y-2">
                                    <Label className="font-bold text-slate-500 mr-1">תאריך יציאה</Label>
                                    <Input 
                                        type="date" 
                                        className="rounded-xl bg-slate-50 border-none shadow-none" 
                                        value={bookingDialog.data.departureDate instanceof Date ? format(bookingDialog.data.departureDate, 'yyyy-MM-dd') : ''} 
                                        onChange={(e) => setBookingDialog({ ...bookingDialog, data: { ...bookingDialog.data, departureDate: new Date(e.target.value), end: new Date(e.target.value) } })} 
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="flex flex-row-reverse justify-between items-center sm:justify-between w-full gap-4 mt-4">
                        <Button onClick={handleSaveBooking} className="flex-1 bg-slate-900 hover:bg-black text-white rounded-xl h-12 font-bold transition-all">
                            <Save size={18} className="ml-2" /> שמור שינויים
                        </Button>
                        {!bookingDialog.isNew && (
                            <Button variant="ghost" className="text-rose-500 hover:bg-rose-50 rounded-xl h-12 px-4" onClick={async () => {
                                if(window.confirm('האם אתה בטוח שברצונך לבטל הזמנה זו?')) {
                                    try {
                                        await api.delete(`/bookings/${bookingDialog.data.id}`);
                                        toast.success('הזמנה בוטלה');
                                        setBookingDialog({ open: false, data: null });
                                        queryClient.invalidateQueries(['calendar-data']);
                                    } catch (e) { toast.error('שגיאה בביטול'); }
                                }
                            }}>
                                <Trash2 size={20} />
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </motion.div>
    );
}