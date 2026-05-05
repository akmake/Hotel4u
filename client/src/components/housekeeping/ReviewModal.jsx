import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Label } from "@/components/ui/Label";
import { ClipboardCheck, CheckCircle2 } from 'lucide-react';

export default function ReviewModal({ room, onClose, onSuccess }) {
    // שליפת כל המשימות שעדיין לא בוצעו (רגילות + חוסמות)
    const [tasks, setTasks] = useState([]);
    
    useEffect(() => {
        if (room && room.tasks) {
            // מסננים משימות שכבר בוצעו, כדי להציג רק את מה שנשאר
            // או מציגים את הכל אבל מסמנים את מה שבוצע
            const pendingTasks = room.tasks.filter(t => !t.isCompleted);
            setTasks(pendingTasks);
        }
    }, [room]);

    // ניהול המשימות שסומנו *בתוך המודל* (לפני השמירה)
    const [checkedIds, setCheckedIds] = useState(new Set());

    const handleToggle = (taskId) => {
        const next = new Set(checkedIds);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        setCheckedIds(next);
    };

    // האם הכל מסומן?
    const allChecked = tasks.every(t => checkedIds.has(t._id));

    const handleConfirm = () => {
        // כאן היינו קוראים לשרת לעדכן את המשימות + סטטוס חדר
        // לצורך הפשטות, אנחנו מעבירים את האישור להורה
        onSuccess(room._id, Array.from(checkedIds));
        onClose();
    };

    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="max-w-md" dir="rtl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <ClipboardCheck className="text-purple-600"/> 
                        בדיקת איכות - חדר {room.roomNumber}
                    </DialogTitle>
                    <DialogDescription>
                        יש לוודא ביצוע של כל הסעיפים לפני סימון החדר כנקי.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {/* רשימת המשימות הפתוחות */}
                    <div className="space-y-3 bg-slate-50 p-4 rounded-lg border">
                        {tasks.length === 0 ? (
                            <p className="text-green-600 text-center font-bold">הכל בוצע! ניתן לסיים.</p>
                        ) : (
                            tasks.map((task) => (
                                <div key={task._id} className="flex items-start gap-3 p-2 hover:bg-white rounded transition-colors">
                                    <Checkbox 
                                        id={task._id}
                                        checked={checkedIds.has(task._id)}
                                        onCheckedChange={() => handleToggle(task._id)}
                                        className="mt-1"
                                    />
                                    <Label htmlFor={task._id} className="cursor-pointer text-sm leading-relaxed">
                                        {task.description}
                                        {task.isHighlight && <span className="text-red-500 font-bold block text-xs"> (חובה)</span>}
                                    </Label>
                                </div>
                            ))
                        )}
                    </div>

                    {/* דרישות מערכת קבועות (אם רוצים להוסיף הרד-קודד בנוסף לדאטה בייס) */}
                    <div className="text-xs text-gray-500 bg-yellow-50 p-2 rounded border border-yellow-100">
                        * בסימון "מאושר", את/ה מצהיר/ה כי החדר נבדק ונמצא תקין לאורח הבא.
                    </div>
                </div>

                <DialogFooter className="sm:justify-start gap-2">
                    <Button 
                        onClick={handleConfirm} 
                        disabled={!allChecked} 
                        className={`w-full ${allChecked ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400'}`}
                    >
                        <CheckCircle2 className="ml-2 h-4 w-4"/> 
                        מאושר - סמן כנקי
                    </Button>
                    <Button variant="outline" onClick={onClose} className="w-full">ביטול</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}