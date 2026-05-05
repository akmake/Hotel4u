import React, { useRef, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '@/utils/api.js';
import { useToast } from "@/hooks/use-toast.js";
import { Bell } from 'lucide-react';

// --- הגדרת צליל ---
const notificationSound = new Audio('/notification.mp3');

// --- פונקציית שליפה מתוקנת ובטוחה ---
const fetchLeads = async () => {
  const response = await api.get('/leads');

  // בדיקה כפולה: האם זה מערך ישיר או אובייקט שמכיל מערך
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;

  return []; // החזרת מערך ריק למניעת קריסה
};

export function LeadsBell() {
  const { toast } = useToast();
  // Ref שיזכור את מזהי הפניות שראינו (Set לביצועים מהירים)
  const previousProcessedLeadIds = useRef(new Set());
  // ✅ Ref שמונע הקפצות בטעינה הראשונית
  const isFirstLoad = useRef(true);

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-bell'],
    queryFn: fetchLeads,
    refetchInterval: 10000,
    // ✅ תיקון: הסרת onSuccess (deprecated ב-React Query v5)
  });

  // ✅ תיקון: לוגיקת ההתראות עברה ל-useEffect שמאזין לשינויים ב-leads
  useEffect(() => {
    if (!Array.isArray(leads) || leads.length === 0) return;

    const currentNewLeads = leads.filter(lead => lead.status === 'new');

    // בטעינה ראשונה - רק מאכלסים את ה-Ref ולא מקפיצים התראות
    if (isFirstLoad.current) {
      currentNewLeads.forEach(lead => previousProcessedLeadIds.current.add(lead._id));
      isFirstLoad.current = false;
      return;
    }

    let hasNewNotification = false;

    currentNewLeads.forEach(lead => {
      if (!previousProcessedLeadIds.current.has(lead._id)) {
        // מצאנו ליד חדש באמת!
        previousProcessedLeadIds.current.add(lead._id);
        hasNewNotification = true;

        const leadName = lead.parsedName || 'פנייה חדשה';

        toast({
          title: "🔥 פנייה חדשה התקבלה!",
          description: `הגיעה הודעה חדשה מ${leadName}.`,
          duration: 5000,
        });
      }
    });

    // ניגון צליל רק אם הייתה התראה חדשה
    if (hasNewNotification) {
      notificationSound.play().catch(e => console.warn("Audio blocked:", e));
    }
  }, [leads, toast]);

  const openLeadsCount = useMemo(() => {
    if (!Array.isArray(leads)) return 0;
    return leads.filter(lead => lead.status === 'new').length;
  }, [leads]);

  return (
    <Link to="/leads" className="relative text-2xl text-gray-600 hover:text-amber-600" aria-label="פתח תיבת פניות">
      <Bell size={24} />
      {openLeadsCount > 0 && (
        <span className="absolute -top-2 -right-3 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
          {openLeadsCount}
        </span>
      )}
    </Link>
  );
}