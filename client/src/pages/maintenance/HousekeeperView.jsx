import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api';
import RoomCard from '@/components/housekeeping/RoomCard'; 
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";

export default function HousekeeperView() {
    const { user } = useAuthStore();
    const queryClient = useQueryClient();
    
    // 1. מצב לבחירת מלון (מתחיל ריק)
    const [selectedHotelId, setSelectedHotelId] = useState("");

    // 2. שליפת רשימת המלונות (כדי שהיא תוכל לבחור)
    const { data: hotels = [] } = useQuery({
        queryKey: ['hotels-list'],
        queryFn: async () => {
            const res = await api.get('/admin/hotels'); // וודא שנתיב זה פתוח לחדרניות
            return res.data;
        }
    });

    // 3. שליפת חדרים - פועלת רק אחרי שנבחר מלון
    const { data: rooms = [], isLoading, isFetching } = useQuery({
        queryKey: ['my-rooms', selectedHotelId],
        queryFn: async () => {
            const res = await api.get(`/rooms/${selectedHotelId}?activeOnly=true`);
            return res.data;
        },
        enabled: !!selectedHotelId, // השאילתה רדומה עד שיש בחירה
        refetchInterval: 30000 
    });

    // מוטציות לעדכון חדרים
    const toggleTaskMutation = useMutation({
        mutationFn: ({ roomId, taskId, isCompleted }) => 
            api.patch(`/rooms/${roomId}/tasks/${taskId}`, { isCompleted }),
        onSuccess: () => queryClient.invalidateQueries(['my-rooms', selectedHotelId])
    });

    const finishRoomMutation = useMutation({
        mutationFn: ({ roomId }) => api.patch(`/rooms/${roomId}/status`, { status: 'clean' }),
        onSuccess: () => {
            toast.success('החדר סומן כנקי! 🧹');
            queryClient.invalidateQueries(['my-rooms', selectedHotelId]);
        }
    });

    return (
        <div className="container mx-auto p-4 max-w-3xl min-h-screen bg-slate-50" dir="rtl">
            <header className="mb-6 bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">שלום, {user?.name?.split(' ')[0]} 👋</h1>
                    <p className="text-slate-500 font-medium text-sm">בחר מלון כדי להתחיל לעבוד:</p>
                </div>

                {/* בחירת מלון */}
                <div className="max-w-xs">
                    <Select onValueChange={setSelectedHotelId} value={selectedHotelId}>
                        <SelectTrigger className="bg-white border-slate-200">
                            <SelectValue placeholder="בחר מלון..." />
                        </SelectTrigger>
                        <SelectContent>
                            {hotels.map(hotel => (
                                <SelectItem key={hotel._id} value={hotel._id}>
                                    {hotel.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </header>

            <div className="space-y-4">
                {/* מצב טעינה */}
                {isLoading && selectedHotelId && (
                    <div className="text-center py-10 text-slate-400 animate-pulse">טוען חדרים...</div>
                )}

                {/* הצגת חדרים רק אם נבחר מלון */}
                {selectedHotelId ? (
                    <>
                        {rooms.map(room => (
                            <RoomCard 
                                key={room._id} 
                                room={room}
                                onToggleTask={(roomId, taskId, val) => 
                                    toggleTaskMutation.mutate({ roomId, taskId, isCompleted: val })
                                }
                                onFinishRoom={(roomId) => finishRoomMutation.mutate({ roomId })}
                                isManagerView={false}
                            />
                        ))}
                        
                        {!isLoading && rooms.length === 0 && (
                            <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-slate-200 opacity-60">
                                <p className="text-lg">אין חדרים לניקוי במלון זה. ☕</p>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center py-20 opacity-40">
                        <img src="/select-hotel.svg" className="w-24 h-24 mx-auto mb-4 grayscale" alt="Select" />
                        <p className="text-lg font-medium">אנא בחר מלון מהרשימה למעלה</p>
                    </div>
                )}
            </div>
        </div>
    );
}