import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isSameMonth } from 'date-fns';
import { he } from 'date-fns/locale';
import { HDate, HebrewCalendar, gematriya } from '@hebcal/core';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const getHebrewDetails = (date) => {
    const hdate = new HDate(date);
    const hebrewDay = gematriya(hdate.getDate());
    
    let parashaName = null;
    let holidayName = null;

    // פרשת שבוע (בשבת)
    if (date.getDay() === 6) {
        const options = { start: date, end: date, isHebrewYear: false, il: true, sedrot: true };
        const events = HebrewCalendar.calendar(options);
        const parashaEvent = events.find(e => e.getFlags() & 1024);
        
        if (parashaEvent) {
            const rawName = parashaEvent.render('he');
            // ✨ התיקון: הסרת "פרשת" גם עם ניקוד וגם בלי
            parashaName = rawName
                .replace(/^פָּרָשַׁת\s+/, '') // מסיר גרסה מנוקדת
                .replace(/^פרשת\s+/, '')     // מסיר גרסה לא מנוקדת
                .trim();
        }
    }

    // חגים וראש חודש
    if (hdate.getDate() === 1) holidayName = 'ר״ח ' + hdate.getMonthName('he');
    const holidays = HebrewCalendar.getHolidaysOnDate(hdate, true);
    if (holidays && holidays.length > 0) {
        const relevantHoliday = holidays.find(h => !(h.getFlags() & 1024) && hdate.getDate() !== 1 && hdate.getDate() !== 30);
        if (relevantHoliday) holidayName = relevantHoliday.render('he');
    }

    return { hebrewDay, parashaName, holidayName };
};

export function HebrewDatePicker({ value, onChange, className }) {
    const [currentMonth, setCurrentMonth] = useState(value ? new Date(value) : new Date());
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (date) => {
        // מתקן את ה-Timezone ל-ISO String נקי (YYYY-MM-DD)
        const offsetDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
        onChange({ target: { name: 'eventDate', value: offsetDate.toISOString().split('T')[0] } });
        setIsOpen(false);
    };

    const days = eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth)
    });

    const startDayOfWeek = startOfMonth(currentMonth).getDay();
    const paddingDays = Array(startDayOfWeek).fill(null);

    const displayDate = value ? format(new Date(value), 'dd/MM/yyyy') : 'בחר תאריך';

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        "w-full justify-start text-right font-normal h-10 border-slate-300 shadow-sm",
                        !value && "text-muted-foreground",
                        className
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                    {displayDate}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="bg-white p-4 rounded-xl shadow-xl border border-slate-200 w-[340px] md:w-[400px]" dir="rtl">
                    {/* כותרת וניווט */}
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 hover:bg-slate-100 rounded-full"><ChevronRight /></button>
                        <div className="text-center">
                            <div className="font-bold text-lg text-slate-800">{format(currentMonth, 'MMMM yyyy', { locale: he })}</div>
                        </div>
                        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 hover:bg-slate-100 rounded-full"><ChevronLeft /></button>
                    </div>

                    {/* ימי השבוע */}
                    <div className="grid grid-cols-7 text-center mb-2">
                        {['א','ב','ג','ד','ה','ו','ש'].map(d => (
                            <div key={d} className="text-xs font-bold text-slate-400">{d}</div>
                        ))}
                    </div>

                    {/* גריד ימים */}
                    <div className="grid grid-cols-7 gap-1">
                        {paddingDays.map((_, i) => <div key={`pad-${i}`} />)}
                        
                        {days.map((day) => {
                            const { hebrewDay, parashaName, holidayName } = getHebrewDetails(day);
                            const isSelected = value && isSameDay(new Date(value), day);
                            const isToday = isSameDay(new Date(), day);

                            return (
                                <button
                                    key={day.toString()}
                                    onClick={() => handleSelect(day)}
                                    className={cn(
                                        "h-14 flex flex-col items-start justify-between p-1 rounded-lg border transition-all text-right relative overflow-hidden",
                                        isSelected 
                                            ? "bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-200" 
                                            : "bg-white border-slate-100 hover:border-amber-300 hover:shadow-sm text-slate-700",
                                        isToday && !isSelected && "bg-amber-50 border-amber-200"
                                    )}
                                >
                                    <div className="flex justify-between w-full">
                                        <span className={cn("text-sm font-bold", isSelected ? "text-white" : "text-slate-800")}>{format(day, 'd')}</span>
                                        <span className={cn("text-[10px]", isSelected ? "text-slate-300" : "text-slate-400")}>{hebrewDay}</span>
                                    </div>

                                    <div className="mt-auto w-full">
                                        {parashaName && (
                                            <span className="block text-[9px] font-bold truncate text-slate-500 w-full">{parashaName}</span>
                                        )}
                                        {holidayName && !parashaName && (
                                            <span className="block text-[9px] font-bold truncate text-amber-600 w-full">{holidayName}</span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}