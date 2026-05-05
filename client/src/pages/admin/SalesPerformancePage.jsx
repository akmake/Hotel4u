import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/utils/api.js';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card.jsx';
import { Trophy, Clock, Activity, DollarSign, TrendingUp, User } from 'lucide-react';

export default function SalesPerformancePage() {
    const { data, isLoading } = useQuery({
        queryKey: ['adminDashboardStats'],
        queryFn: async () => (await api.get('/admin/dashboard/stats')).data,
    });

    if (isLoading) return <div className="p-10 text-center text-gray-500">טוען נתונים...</div>;

    const agents = data?.salesByPerson || [];
    // פונקציית עזר למניעת NaN
    const safeSum = (arr, key) => arr.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);

    return (
        <div className="container mx-auto p-6 space-y-8 bg-slate-50 min-h-screen text-right" dir="rtl">
            <header>
                <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                    <Trophy className="text-amber-500" size={32} />
                    לוח ביצועי נציגים
                </h1>
                <p className="text-slate-500 mt-2 text-lg">מעקב בזמן אמת אחר סגירות, הזמנות בהמתנה ותהליכים פתוחים.</p>
            </header>

            <div className="grid gap-6">
                {/* טבלת ביצועים ראשית */}
                <Card className="border-t-4 border-t-blue-600 shadow-lg bg-white">
                    <CardHeader>
                        <CardTitle>סיכום פעילות לפי משתמש</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-right">
                                <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wide border-b border-slate-200">
                                    <tr>
                                        <th className="p-4 rounded-tr-lg text-right">שם הנציג</th>
                                        <th className="p-4 text-center bg-amber-50 text-amber-900 border-l border-amber-100/50">פוטנציאל פתוח (₪)</th>
                                        <th className="p-4 text-center text-slate-600">הזמנות בטיפול</th>
                                        <th className="p-4 text-center text-green-700">נסגרו (כמות)</th>
                                        <th className="p-4 text-left rounded-tl-lg bg-green-50/50 text-green-900">הכנסות בפועל</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {agents.length > 0 ? (
                                        agents.map((agent, idx) => (
                                            <tr key={agent._id || idx} className="hover:bg-slate-50 transition-colors group">
                                                <td className="p-4 font-bold text-slate-800 flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600">
                                                        <User size={16}/>
                                                    </div>
                                                    {agent._id || 'לא משויך'}
                                                </td>
                                                
                                                {/* עמודת הכסף בהמתנה */}
                                                <td className="p-4 text-center bg-amber-50/30 border-l border-amber-100/50">
                                                    <div className="flex flex-col items-center">
                                                        <span className="font-bold text-amber-600 text-base">
                                                            ₪{(agent.waitingRevenue || 0).toLocaleString()}
                                                        </span>
                                                        <span className="text-[10px] text-amber-400 font-medium">
                                                            {agent.waitingCount || 0} הזמנות
                                                        </span>
                                                    </div>
                                                </td>
                                                
                                                <td className="p-4 text-center">
                                                    <div className="inline-flex items-center gap-1 font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                                                        <Activity size={14} /> {agent.inProgressCount || 0}
                                                    </div>
                                                </td>

                                                <td className="p-4 text-center">
                                                    <div className="inline-flex items-center gap-1 font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full text-lg">
                                                        <TrendingUp size={16} /> {agent.closedCount || 0}
                                                    </div>
                                                </td>

                                                <td className="p-4 text-left font-mono font-black text-green-800 text-lg bg-green-50/30" dir="ltr">
                                                    ₪{(agent.totalRevenue || 0).toLocaleString()}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan="5" className="p-8 text-center text-gray-400">
                                                לא נמצאו נתונים להצגה
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {/* כרטיסי סיכום תחתונים - נקיים ולבנים */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* כרטיס פוטנציאל */}
                    <Card className="bg-white border border-amber-200 shadow-sm">
                        <CardContent className="p-6 flex items-center justify-between">
                            <div>
                                <p className="text-amber-600 font-bold uppercase text-xs tracking-wider">שווי עסקאות פתוחות</p>
                                <p className="text-3xl font-black text-slate-800 mt-1">
                                    ₪{safeSum(agents, 'waitingRevenue').toLocaleString()}
                                </p>
                            </div>
                            <div className="p-3 bg-amber-50 rounded-full">
                                <Clock className="text-amber-500 h-8 w-8" />
                            </div>
                        </CardContent>
                    </Card>
                    
                    {/* כרטיס סגירות כמותי */}
                    <Card className="bg-white border border-green-200 shadow-sm">
                        <CardContent className="p-6 flex items-center justify-between">
                            <div>
                                <p className="text-green-600 font-bold uppercase text-xs tracking-wider">עסקאות שנסגרו</p>
                                <p className="text-3xl font-black text-slate-800 mt-1">
                                    {safeSum(agents, 'closedCount')}
                                </p>
                            </div>
                            <div className="p-3 bg-green-50 rounded-full">
                                <Trophy className="text-green-500 h-8 w-8" />
                            </div>
                        </CardContent>
                    </Card>

                    {/* כרטיס מחזור כולל - נקי */}
                    <Card className="bg-white border border-blue-200 shadow-sm">
                        <CardContent className="p-6 flex items-center justify-between">
                            <div>
                                <p className="text-blue-600 font-bold uppercase text-xs tracking-wider">סה"כ הכנסות בפועל</p>
                                <p className="text-3xl font-black text-slate-800 mt-1">
                                    ₪{safeSum(agents, 'totalRevenue').toLocaleString()}
                                </p>
                            </div>
                            <div className="p-3 bg-blue-50 rounded-full">
                                <DollarSign className="text-blue-500 h-8 w-8" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}