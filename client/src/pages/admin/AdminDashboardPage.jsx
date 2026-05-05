import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '@/utils/api.js';
import { useAuthStore } from '@/stores/authStore.js';
// גרפים
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card.jsx';
import { Skeleton } from '@/components/ui/Skeleton.jsx';
import {
  Shield, ListOrdered, Users, Hotel, Mail, FileText, Tag,
  Megaphone, Network, TrendingUp, CheckCircle, Trophy, // ✨ הוספתי Trophy
} from 'lucide-react';
import LogoUploader from '@/components/admin/LogoUploader.jsx';
import { MessageSquarePlus } from 'lucide-react';

const fetchDashboardStats = async () => (await api.get('/admin/dashboard/stats')).data;
// צבע הזהב המותגי
const BRAND_GOLD = '#bfa15f';
const PIE_COLORS = ['#bfa15f', '#d4c085', '#a2884f', '#e8debd', '#8f763b'];

export default function AdminDashboardPage() {
  const { user } = useAuthStore();
  const { data, isLoading } = useQuery({
    queryKey: ['adminDashboardStats'],
    queryFn: fetchDashboardStats,
  });

  const leadsTrendData = useMemo(() => {
    if (!data?.leadsPerDay) return [];
    return data.leadsPerDay.map(item => ({
      date: item._id,
      count: item.count
    }));
  }, [data]);

  const rejectionData = useMemo(() => {
    return data?.rejectionReasons?.map(r => ({ name: r._id || 'אחר', value: r.count })) || [];
  }, [data]);

  const { completedOrdersCount, completedRevenue } = useMemo(() => {
    if (!data?.salesByPerson) return { completedOrdersCount: 0, completedRevenue: 0 };
    return data.salesByPerson.reduce((acc, curr) => ({
        completedOrdersCount: acc.completedOrdersCount + curr.dealsCount,
        completedRevenue: acc.completedRevenue + curr.totalRevenue
    }), { completedOrdersCount: 0, completedRevenue: 0 });
  }, [data]);

  const closedLeadsCount = useMemo(() => {
      if (!data?.leadStats) return 0;
      return data.leadStats
        .filter(s => ['closed', 'converted', 'placed', 'בוצע'].includes(s._id))
        .reduce((acc, curr) => acc + curr.count, 0);
  }, [data]);

  const stats = [
    {
        title: 'הכנסות (30 יום)',
        value: completedRevenue.toLocaleString() + ' ₪',
        icon: '💰'
    },
    {
        title: 'הזמנות שבוצעו',
        value: completedOrdersCount,
        icon: <FileText size={22} style={{ color: BRAND_GOLD }} />
    },
    {
        title: 'לידים חדשים',
        value: data?.totalLeads || 0,
        icon: <Mail size={22} style={{ color: BRAND_GOLD }} />
    },
    {
        title: 'לידים שנסגרו',
        value: closedLeadsCount,
        icon: <CheckCircle size={22} style={{ color: BRAND_GOLD }} />
    },
  ];

  // רשימת הקישורים המעודכנת
  const adminLinks = [
    // ניהול הזמנות ולידים
    { to: '/admin/orders', title: 'ניהול הזמנות', description: 'צפייה ועדכון כל ההזמנות.', icon: Shield },
    { to: '/admin/performance', title: 'ביצועי נציגים', description: 'לוח מדדים, סגירות ויעדים.', icon: Trophy }, // ✨ הקישור החדש
    { to: '/leads', title: 'ניהול לידים', description: 'טיפול בפניות ושינוי סטטוסים.', icon: Mail },
    { to: '/admin/triggers', title: 'מילות מפתח ללידים', description: 'הגדרת ביטויים שפותחים ליד אוטומטית בוואטסאפ.', icon: MessageSquarePlus},
    { to: '/admin/auto-replies', title: 'בוט מענה חכם', description: 'הגדרת זרימות תשובה אוטומטיות (Flows).', icon: MessageSquarePlus},
    // הגדרות מערכת
    { to: '/manage-pricelists', title: 'מחירונים', description: 'ניהול מחירונים.', icon: ListOrdered },
    { to: '/admin/users', title: 'משתמשים', description: 'ניהול משתמשים.', icon: Users },
    { to: '/admin/hotels', title: 'מלונות', description: 'ניהול בתי מלון.', icon: Hotel },
    { to: '/admin/extras', title: 'תוספות', description: 'ניהול סוגי תוספות.', icon: Tag },

    // שיווק וניהול
    { to: '/admin/announcements', title: 'הודעות', description: 'הודעות מערכת.', icon: Megaphone },
    { to: '/admin/referrers', title: 'ניהול אושיות', description: 'ניהול שמות מפנים ונרמול נתונים.', icon: Network },
  ];

  if (isLoading) return (
    <div className="container mx-auto p-6 space-y-8 min-h-screen bg-slate-50">
      <div>
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border rounded-xl p-5 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );

  return (
    <div className="container mx-auto p-6 space-y-8 min-h-screen bg-slate-50">

      <header>
        <h1 className="text-2xl font-bold text-gray-800">דשבורד מנהלים</h1>
        <p className="text-gray-500 text-sm mt-1">סקירה כללית ופעולות מהירות</p>
      </header>

      {/* כרטיסי סטטיסטיקה */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <Card key={i} className="bg-white border border-slate-200 shadow-sm hover:shadow-md transition-all">
            <CardContent className="p-5">
              <div className="flex justify-between items-start">
                <div>
                    <p className="text-sm font-medium text-gray-500">{stat.title}</p>
                    <h3 className="text-2xl font-bold text-gray-800 mt-1">{stat.value}</h3>
                </div>
                <div className="p-2 bg-slate-50 rounded-full border border-slate-100">
                    {stat.icon}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* אזור הגרפים */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* גרף לידים */}
          <Card className="lg:col-span-2 bg-white border border-slate-200 shadow-sm">
              <CardHeader className="pb-2 border-b border-slate-50">
                <div className="flex items-center gap-2">
                  <TrendingUp size={18} style={{ color: BRAND_GOLD }}/>
                  <CardTitle className="text-base text-gray-800">מגמת לידים (30 יום)</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="h-[300px] pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={leadsTrendData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                              <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor={BRAND_GOLD} stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor={BRAND_GOLD} stopOpacity={0}/>
                              </linearGradient>
                          </defs>
                          <XAxis
                            dataKey="date"
                            tick={{fontSize: 11, fill: '#9ca3af'}}
                            tickFormatter={(str) => str.substring(5)}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            allowDecimals={false}
                            tick={{fontSize: 11, fill: '#9ca3af'}}
                            axisLine={false}
                            tickLine={false}
                          />
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                            labelStyle={{ color: '#6b7280', fontSize: '12px' }}
                          />
                          <Area
                            type="monotone"
                            dataKey="count"
                            name="לידים"
                            stroke={BRAND_GOLD}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorLeads)"
                          />
                      </AreaChart>
                  </ResponsiveContainer>
              </CardContent>
          </Card>

          {/* גרף סיבות דחייה */}
          <Card className="bg-white border border-slate-200 shadow-sm">
              <CardHeader className="pb-2 border-b border-slate-50">
                  <CardTitle className="text-base text-gray-800">סיבות לסטטוס "לא רלוונטי"</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px] pt-4">
                  {rejectionData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                              <Pie
                                  data={rejectionData}
                                  cx="50%" cy="50%"
                                  innerRadius={55}
                                  outerRadius={80}
                                  paddingAngle={2}
                                  dataKey="value"
                              >
                                  {rejectionData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                                  ))}
                              </Pie>
                              <Tooltip contentStyle={{borderRadius: '6px', border: '1px solid #e5e7eb', fontSize: '12px'}} />
                              <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}/>
                          </PieChart>
                      </ResponsiveContainer>
                  ) : (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400">
                          <Shield size={32} className="mb-2 opacity-20"/>
                          <p className="text-xs">אין נתונים החודש</p>
                      </div>
                  )}
              </CardContent>
          </Card>
      </div>

      <h2 className="text-lg font-semibold text-gray-700 pt-4">פעולות ניהול</h2>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {adminLinks.map(link => (
              <Link key={link.to} to={link.to} className="group">
                  <Card className="h-full hover:border-[#bfa15f] transition-colors cursor-pointer border border-slate-200 shadow-sm bg-white">
                      <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-3">
                          <div
                              className="p-3 rounded-full transition-colors group-hover:bg-[#f9f7f0]"
                              style={{ backgroundColor: '#fdfcf8', color: BRAND_GOLD }}
                          >
                              <link.icon size={24} />
                          </div>
                          <h3 className="font-bold text-gray-800">{link.title}</h3>
                          <p className="text-xs text-gray-500">{link.description}</p>
                      </CardContent>
                  </Card>
              </Link>
          ))}
      </div>

      <div className="flex justify-center opacity-40 mt-8"><LogoUploader /></div>
    </div>
  );
}