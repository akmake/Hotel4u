import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Bed, Baby, AlertTriangle, CheckCircle2, Lock, User } from 'lucide-react';
import ReviewModal from './ReviewModal';

export default function RoomCard({ room, onToggleTask, onFinishRoom, isManagerView }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // סינון משימות (התאמתי למבנה של taskSchema ב-DB)
  const specialTasks = room.tasks ? room.tasks.filter(t => t.type === 'daily' || t.isHighlight) : [];
  const standardTasks = room.tasks ? room.tasks.filter(t => t.type === 'standard' && !t.isHighlight) : [];

  const hasOpenBlockingTasks = specialTasks.some(t => !t.isCompleted);
  const isFinished = room.status === 'clean';

  // חישוב צבע רקע לפי סטטוס ודחיפות
  const getBgColor = () => {
    if (isFinished) return 'border-green-500 opacity-60 bg-green-50';
    if (room.bookingType === 'BackToBack') return 'border-red-500 bg-red-50 ring-1 ring-red-500';
    if (room.bookingType === 'Arrival') return 'border-orange-400 bg-orange-50';
    return 'border-gray-200 bg-white';
  };

  const handleCardClick = (e) => {
    if (isManagerView || e.target.closest('button') || e.target.closest('input')) return;
    setIsModalOpen(true);
  };

  return (
    <>
      <Card
        onClick={handleCardClick}
        className={`mb-4 border-t-4 shadow-sm transition-all ${getBgColor()} ${!isManagerView ? 'cursor-pointer hover:shadow-md' : ''}`}
      >
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">{room.roomNumber}</h2>
              <div className="text-xs font-bold text-gray-500">
                {room.bookingType === 'Arrival' && 'נכנסים היום'}
                {room.bookingType === 'Departure' && 'עוזבים היום'}
                {room.bookingType === 'BackToBack' && 'החלפה (B2B)'}
                {room.bookingType === 'Stayover' && 'נשארים'}
              </div>
            </div>

            {/* אייקונים של אורחים */}
            <div className="flex gap-2">
              {room.guestCount?.adults > 0 && (
                <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">
                  <User size={14}/> {room.guestCount.adults}
                </span>
              )}
              {room.guestCount?.babies > 0 && (
                <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 animate-pulse">
                  <Baby size={14}/> לול
                </span>
              )}
            </div>
          </div>

          {/* משימות חוסמות */}
          {specialTasks.length > 0 && (
            <div className="bg-white/60 border border-orange-200 rounded-lg p-2 mb-3">
              <h3 className="text-orange-800 font-bold text-xs mb-1 flex items-center gap-1">
                <AlertTriangle size={12}/> חובה:
              </h3>
              <div className="space-y-1">
                {specialTasks.map((task) => (
                  <div key={task._id} className="flex items-center gap-2">
                    <Checkbox
                      checked={task.isCompleted}
                      onCheckedChange={(checked) => onToggleTask(room._id, task._id, checked)}
                      disabled={isManagerView}
                    />
                    <span className={`text-sm ${task.isCompleted ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {task.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* כפתור סיום */}
          {!isManagerView && (
             <Button
               onClick={() => setIsModalOpen(true)}
               disabled={hasOpenBlockingTasks || isFinished}
               className={`w-full mt-2 ${isFinished ? 'bg-green-600' : 'bg-blue-600'}`}
             >
               {isFinished ? <><CheckCircle2 className="ml-2"/> נקי</> : 'סיום חדר'}
             </Button>
          )}
        </CardContent>
      </Card>

      {/* המודל נפתח כאן */}
      {isModalOpen && (
        <ReviewModal
          room={room}
          onClose={() => setIsModalOpen(false)}
          // ✅ תיקון: מעבירים גם roomId וגם checkedTaskIds להורה
          onSuccess={(roomId, checkedTaskIds) => onFinishRoom(roomId, checkedTaskIds)}
        />
      )}
    </>
  );
}