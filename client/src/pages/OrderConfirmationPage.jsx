// client/src/pages/OrderConfirmationPage.jsx

import React, { useRef, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/utils/api.js';
import { format } from 'date-fns';
import { Button } from '@/components/ui/Button.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { 
  ArrowRight, Download, Send, User, LoaderCircle, Mail, 
  Calendar, Printer, CheckCircle, CreditCard, Zap, Info 
} from 'lucide-react';
import { formatPhoneForWhatsApp } from '@/utils/phone.js';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://ziporiteem.com';
const SERVER_ROOT = API_BASE.replace(/\/api$/, '');
const LOGO_URL = `../public/company-logo.png?t=${Date.now()}`;

const printStyles = `
  @media print {
    @page { size: A4; margin: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background-color: white; }
    .no-print { display: none !important; }
    .quote-page { box-shadow: none !important; margin: 0 !important; page-break-after: always; }
  }
`;

const fetchOrder = async (orderId) => (await api.get(`/orders/public/${orderId}`)).data;

const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
};

export default function OrderConfirmationPage() {
  const { orderId } = useParams();
  const pagesContainerRef = useRef(null);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // State למיילים
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['publicOrder', orderId],
    queryFn: () => fetchOrder(orderId),
    enabled: !!orderId,
  });

  const whatsappNumber = order?.customerPhone ? formatPhoneForWhatsApp(order.customerPhone) : null;
  const hotel = order?.hotel || {};
  const brandColor = hotel?.brandColor || '#b45309'; 

  // לוגיקה להצגת מספר הזמנה: אם יש אופטימה - תציג אותו, אחרת את המספר הפנימי
  const displayOrderId = order?.optimaNumber || order?.orderNumber;

  const pages = useMemo(() => {
    if (!order) return [];

    const roomItems = (order.rooms || []).map((room, idx) => ({
        _type: 'room', serialNumber: idx + 1, name: room.roomType || 'חדר רגיל',
        description: room.price_list_names?.join(' + '), roomNote: room.notes, details: room, price: room.price
    }));

    const startExtraIndex = roomItems.length + 1;
    const extraItems = (order.extras || []).map((extra, idx) => ({
        _type: 'extra', serialNumber: startExtraIndex + idx, name: extra.extraType,
        description: 'תוספת להזמנה', details: extra, price: extra.price * extra.quantity
    }));

    let allContent = [...roomItems];
    if (extraItems.length > 0) {
        allContent.push({ _type: 'header', name: 'תוספות ושדרוגים' });
        allContent = [...allContent, ...extraItems];
    }

    const ITEMS_PER_FIRST_PAGE = 4;
    const ITEMS_PER_MIDDLE_PAGE = 7;
    const ITEMS_PER_LAST_PAGE = 7; // השארנו מקום למדיניות הביטולים

    const resultPages = [];
    
    if (allContent.length === 0) {
       resultPages.push({ items: [], isFirst: true, isLast: true, pageIndex: 0 });
    } else {
        const firstPageItems = allContent.slice(0, ITEMS_PER_FIRST_PAGE);
        let remainingItems = allContent.slice(ITEMS_PER_FIRST_PAGE);

        resultPages.push({ items: firstPageItems, isFirst: true, isLast: remainingItems.length === 0, pageIndex: 0 });

        let pIndex = 1;
        while (remainingItems.length > 0) {
            if (remainingItems.length <= ITEMS_PER_MIDDLE_PAGE) {
                if (remainingItems.length > ITEMS_PER_LAST_PAGE) {
                    const takeCount = remainingItems.length - ITEMS_PER_LAST_PAGE;
                    resultPages.push({ items: remainingItems.slice(0, takeCount), isFirst: false, isLast: false, pageIndex: pIndex });
                    remainingItems = remainingItems.slice(takeCount);
                    pIndex++;
                } else {
                    resultPages.push({ items: remainingItems, isFirst: false, isLast: true, pageIndex: pIndex });
                    remainingItems = [];
                }
            } else {
                resultPages.push({ items: remainingItems.slice(0, ITEMS_PER_MIDDLE_PAGE), isFirst: false, isLast: false, pageIndex: pIndex });
                remainingItems = remainingItems.slice(ITEMS_PER_MIDDLE_PAGE);
                pIndex++;
            }
        }
    }

    // דף תשלום בסוף
    resultPages.push({
        type: 'payment-page', 
        pageIndex: resultPages.length,
        isFirst: false,
        isLast: false 
    });

    return resultPages;
  }, [order]);

  const cleanNotes = useMemo(() => stripHtml(order?.notes), [order?.notes]);

  const generatePDF = async (action = 'download', skipPaymentPage = false) => {
    if (!pagesContainerRef.current) return;
    setIsDownloading(true);
    const toastId = toast.loading('מכין קובץ הזמנה...');
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageElements = pagesContainerRef.current.querySelectorAll('.quote-page');

      let pagesAdded = 0;

      for (let i = 0; i < pageElements.length; i++) {
        const pageEl = pageElements[i];
        
        // בדיקה האם לדלג על דף התשלום
        if (skipPaymentPage && pageEl.classList.contains('payment-page-slide')) {
            continue;
        }

        const canvas = await html2canvas(pageEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        const imgHeight = canvas.height * (pdfWidth / canvas.width);
        
        if (pagesAdded > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeight);
        pagesAdded++;
      }
      
      if (action === 'download') {
        const cleanName = (order.customerName || 'לקוח').replace(/[^a-zA-Z0-9\u0590-\u05FF]/g, '_');
        pdf.save(`אישור_הזמנה_${cleanName}_${displayOrderId}.pdf`);
        toast.success('הקובץ ירד!', { id: toastId });
      } else if (action === 'blob') {
        return pdf.output('blob');
      }
    } catch (err) {
      console.error(err);
      toast.error('שגיאה ביצירת הקובץ', { id: toastId });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!targetEmail) return toast.error('נא להזין כתובת אימייל');
    setIsSendingEmail(true);
    const toastId = toast.loading('מייצר ושולח מייל...');

    try {
      // דילוג על דף תשלום בשליחת מייל
      const pdfBlob = await generatePDF('blob', true);
      if (!pdfBlob) throw new Error('Failed to generate PDF');

      const formData = new FormData();
      formData.append('pdf', pdfBlob, 'order_confirmation.pdf');
      formData.append('email', targetEmail);
      formData.append('customerName', order.customerName);
      await api.post(`/orders/${order._id}/email`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success(`המייל נשלח בהצלחה ל-${targetEmail}`, { id: toastId });
      setIsEmailDialogOpen(false);
      setTargetEmail('');
    } catch (error) {
      console.error(error);
      toast.error('שגיאה בשליחת המייל', { id: toastId });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleQuickSend = async () => {
      if (!order.customerEmail) {
           return toast.error('לא קיים כתובת מייל בהזמנה זו. השתמש בשליחה ידנית.');
      }
      if (!window.confirm(`לשלוח את האישור כעת ל-${order.customerEmail}?`)) return;
      setIsSendingEmail(true);
      const toastId = toast.loading(`שולח ל-${order.customerEmail}...`);

      try {
           // דילוג על דף תשלום בשליחת מייל אוטומטית
           const pdfBlob = await generatePDF('blob', true);
           if (!pdfBlob) throw new Error('Failed to generate PDF');

           const formData = new FormData();
           formData.append('pdf', pdfBlob, `confirmation_${displayOrderId}.pdf`);
           formData.append('email', order.customerEmail);
           formData.append('customerName', order.customerName);

           await api.post(`/orders/${order._id}/email`, formData, {
               headers: { 'Content-Type': 'multipart/form-data' }
           });
           toast.success('המייל נשלח ללקוח בהצלחה!', { id: toastId });
      } catch (error) {
           console.error(error);
           toast.error('שגיאה בשליחת המייל', { id: toastId });
      } finally {
           setIsSendingEmail(false);
      }
  };

  if (isLoading) return <div className="h-screen flex items-center justify-center"><LoaderCircle className="animate-spin h-10 w-10 text-amber-600"/></div>;
  if (isError) return <div className="text-center p-10">שגיאה בטעינת ההזמנה.</div>;

  return (
    <div className="min-h-screen bg-gray-200 pb-10 font-sans">
      <style>{printStyles}</style>

      {/* Header עליון */}
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center sticky top-0 z-50 shadow-sm no-print">
         <div className="flex items-center gap-4">
             <Button variant="ghost" asChild>
               <Link to="/orders-history"><ArrowRight className="ml-2 h-4 w-4"/> חזור</Link>
             </Button>
           <span className="font-bold text-green-700 hidden sm:inline flex items-center gap-2">
                <CheckCircle className="h-5 w-5"/> אישור הזמנה (#{displayOrderId})
           </span>
         </div>
         <div className="flex gap-2">
            <Button onClick={() => window.print()} variant="outline" className="gap-2"><Printer className="h-4 w-4"/> הדפס</Button>
            {/* הורדה רגילה כוללת הכל */}
            <Button onClick={() => generatePDF('download', false)} disabled={isDownloading} className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-sm">
                {isDownloading ? <LoaderCircle className="animate-spin h-4 w-4"/> : <Download className="h-4 w-4"/>}
                <span className="hidden sm:inline">הורד אישור</span>
            </Button>

            {order.customerEmail && (
               <Button onClick={handleQuickSend} disabled={isSendingEmail || isDownloading} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                 {isSendingEmail ? <LoaderCircle className="animate-spin h-4 w-4"/> : <Zap className="h-4 w-4" />}
                 <span className="hidden sm:inline">שלח ללקוח</span>
               </Button>
            )}

            <Button onClick={() => setIsEmailDialogOpen(true)} variant="outline" className="gap-2 border-blue-600 text-blue-700 hover:bg-blue-50">
                <Mail className="h-4 w-4" />
                <span className="hidden sm:inline">שלח למייל אחר</span>
            </Button>

             {whatsappNumber && (
                 <Button onClick={() => { 
                   // ✨✨ התיקון כאן: העברנו true כדי לדלג על דף התשלום בהורדה לוואטסאפ ✨✨
                   generatePDF('download', true).then(() => {
                   setTimeout(() => {
                        const text = `היי ${order.customerName}, מצורף אישור ההזמנה שלך.`;
                        window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`, '_blank');
                   }, 1500);
              }) }} variant="outline" className="gap-2 border-green-600 text-green-700 hover:bg-green-50">
                    <Send className="h-4 w-4" />
                    <span className="hidden sm:inline">וואטסאפ</span>
                 </Button>
            )}
         </div>
      </header>

      {/* דיאלוג שליחת מייל */}
      <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
          <DialogHeader><DialogTitle>שליחת אישור במייל (ידני)</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
             <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">מייל</Label>
              <Input id="email" type="email" placeholder="כתובת מייל הלקוח" value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} className="col-span-3" />
            </div>
          </div>
          <DialogFooter>
              <Button type="submit" onClick={handleSendEmail} disabled={isSendingEmail}>
                {isSendingEmail && <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />} שלח
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col items-center py-8 gap-8" ref={pagesContainerRef}>
        {pages.map((pageData, index) => (
            <div
                key={index}
                className={`quote-page bg-white shadow-2xl w-[210mm] min-h-[297mm] relative text-slate-800 mx-auto flex flex-col ${pageData.type === 'payment-page' ? 'payment-page-slide' : ''}`}
                style={{ padding: '15mm' }}
           >
                {pageData.type !== 'payment-page' && (
                    <>
                        {pageData.isFirst ? (
                            <>
                                <div className="flex justify-between items-start border-b-2 border-gray-100 pb-8 mb-8">
                                   <div className="w-1/2">
                                        <h1 className="text-4xl font-extrabold text-green-800 mb-2">אישור הזמנה</h1>
                                        <div className="space-y-1 text-sm text-slate-500">
                                            <p>תאריך הפקה: {format(new Date(), 'dd/MM/yyyy')}</p>
                                            <p>מספר הזמנה: <span className="font-mono font-bold text-slate-700">#{displayOrderId}</span></p>
                                        </div>
                                    </div>
                                    <div className="w-1/2 flex flex-col items-end text-left">
                                        <img src={LOGO_URL} alt="Logo" className="h-40 object-contain mb-3" crossOrigin="anonymous" onError={(e) => e.target.style.display = 'none'} />
                                        <div className="text-sm text-gray-500 text-right" dir="ltr">
                                            {hotel.address && <p>{hotel.address}</p>}
                                            {hotel.phone && <p>{hotel.phone}</p>}
                                        </div>
                                    </div>
                                </div>

                                {/* פרטי לקוח */}
                                <div className="bg-gray-50 rounded-xl p-6 mb-10 border border-gray-100">
                                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-gray-200 pb-2">
                                        <User className="h-5 w-5 text-slate-400"/> פרטי המזמין
                                    </h3>
                                    <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                                        <div><span className="text-xs text-gray-500 uppercase tracking-wider block">שם לקוח</span><p className="text-lg font-medium">{order.customerName}</p></div>
                                        <div><span className="text-xs text-gray-500 uppercase tracking-wider block">טלפון</span><p className="text-lg font-medium text-right" dir="ltr">{order.customerPhone}</p></div>
                                        {order.eventDate && (
                                            <div><span className="text-xs text-gray-500 uppercase tracking-wider block">תאריך אירוע/הגעה</span><p className="text-lg font-medium">{format(new Date(order.eventDate), 'dd/MM/yyyy')}</p></div>
                                        )}
                                        <div><span className="text-xs text-gray-500 uppercase tracking-wider block">מלון</span><p className="text-lg font-medium">{hotel.name}</p></div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="border-b border-gray-100 pb-4 mb-6 flex justify-between items-center opacity-60">
                                <span className="text-sm font-bold">המשך הזמנה #{displayOrderId}</span>
                                <span className="text-xs">דף {index + 1} מתוך {pages.length}</span>
                            </div>
                        )}

                        <div className="flex-grow">
                            <h3 className="text-lg font-bold text-slate-800 mb-4">
                                {pageData.isFirst ? 'פירוט ההזמנה' : 'המשך פירוט'}
                            </h3>
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm text-right">
                                   <thead className="bg-gray-100 text-gray-600">
                                        <tr>
                                            <th className="py-3 px-4 border-b font-semibold w-12 text-center">#</th>
                                            <th className="py-3 px-4 border-b font-semibold">תיאור</th>
                                            <th className="py-3 px-4 border-b font-semibold w-1/3">הרכב / כמות</th>
                                            <th className="py-3 px-4 border-b font-semibold text-left w-32">מחיר</th>
                                       </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {pageData.items.map((item, idx) => {
                                            if (item._type === 'header') {
                                                return <tr key={`h-${idx}`}><td colSpan="4" className="bg-slate-50 py-2 px-4 font-bold text-slate-700 border-y">{item.name}</td></tr>;
                                            }
                                            return (
                                                <tr key={idx}>
                                                    <td className="py-4 px-4 text-center text-gray-500">{item.serialNumber}</td>
                                                    <td className="py-4 px-4 font-bold text-slate-800">
                                                        {item.name}
                                                        {item._type === 'room' && item.description && <p className="text-xs font-normal text-gray-500 mt-1">{item.description}</p>}
                                                    </td>
                                                    <td className="py-4 px-4 text-slate-600">
                                                        {item._type === 'room' ? `${item.details.adults} מבוגרים` : `כמות: ${item.details.quantity}`}
                                                    </td>
                                                    <td className="py-4 px-4 text-left font-mono font-medium">{item.price.toLocaleString()} ₪</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {pageData.isLast && (
                            <div className="mt-auto pt-6 border-t-2 border-gray-100">
                                {order.notes && (
                                    <div className="mb-4 border-t border-dashed border-gray-300 pt-3">
                                        <h4 className="font-bold text-sm text-slate-800 mb-2">הערות:</h4>
                                        <div className="bg-yellow-50/50 p-4 rounded text-sm text-slate-700 whitespace-pre-wrap border border-yellow-100">
                                            {cleanNotes}
                                        </div>
                                    </div>
                                )}

                                <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-600 leading-relaxed">
                                    <h4 className="font-bold text-gray-800 mb-2 flex items-center gap-1">
                                         <Info className="h-3 w-3" /> מדיניות ביטולים:
                                    </h4>
                                    <ul className="space-y-1 list-disc list-inside">
                                        <li>ביטול הזמנה עד 30 יום ומעלה לפני תאריך ההגעה למלון: יחוייב ב-200 ₪ ליום לחדר עבור דמי טיפול בהזמנה</li>
                                        <li>ביטול הזמנה מ-30 יום ועד 14 יום לפני תאריך ההגעה יחוייב ב-25% מערך ההזמנה</li>
                                        <li>ביטול הזמנה מ-14 יום ועד 48 שעות לפני תאריך ההגעה יחוייב ב-50% מערך ההזמנה</li>
                                        <li>ביטול הזמנה 48 שעות לפני תאריך ההגעה יחוייב ב-100% מערך ההזמנה</li>
                                    </ul>
                                </div>

                                <div className="flex justify-between items-center">
                                    <div className="text-sm text-gray-500 w-1/2">
                                        <p>* ט.ל.ח.</p>
                                        <p>* הזמנה זו אושרה.</p>
                                    </div>
                                    <div className="text-left">
                                        <p className="text-gray-500 text-sm">סה"כ לתשלום:</p>
                                        <p className="text-4xl font-extrabold" style={{ color: brandColor }}>{order.total_price.toLocaleString()} ₪</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {pageData.type === 'payment-page' && (
                    <div className="flex flex-col h-full">
                        <div className="border-b border-gray-100 pb-4 mb-8 flex justify-between items-center opacity-60">
                            <span className="text-sm font-bold">נספח תשלום וחתימה - הזמנה #{displayOrderId}</span>
                            <span className="text-xs">דף {index + 1} מתוך {pages.length}</span>
                        </div>

                        <div className="flex-grow">
                             <div className="bg-gray-50 rounded-xl p-8 border border-gray-100 mb-10">
                                <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2 border-b border-gray-200 pb-2">
                                    <CreditCard className="h-5 w-5 text-slate-400"/> פרטי אמצעי תשלום
                                </h3>
                                
                                <div className="space-y-8 max-w-xl mx-auto">
                                    <div className="grid grid-cols-2 gap-8">
                                        <div>
                                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">שם בעל הכרטיס</label>
                                            <div className="border-b-2 border-gray-300 h-8 w-full"></div>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">ת.ז. בעל הכרטיס</label>
                                            <div className="border-b-2 border-gray-300 h-8 w-full"></div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">מספר כרטיס</label>
                                        <div className="flex gap-4">
                                            <div className="border-b-2 border-gray-300 h-8 flex-1"></div>
                                            <div className="border-b-2 border-gray-300 h-8 flex-1"></div>
                                            <div className="border-b-2 border-gray-300 h-8 flex-1"></div>
                                            <div className="border-b-2 border-gray-300 h-8 flex-1"></div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-8">
                                        <div>
                                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">תוקף</label>
                                            <div className="border-b-2 border-gray-300 h-8 w-full"></div>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">CVV</label>
                                            <div className="border-b-2 border-gray-300 h-8 w-full"></div>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">תשלומים</label>
                                            <div className="border-b-2 border-gray-300 h-8 w-full"></div>
                                        </div>
                                    </div>
                                </div>
                             </div>

                             <div className="mt-12">
                                <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2 border-b border-gray-200 pb-2">
                                    <CheckCircle className="h-5 w-5 text-slate-400"/> אישור וחתימה
                                </h3>
                                <p className="text-sm text-gray-600 mb-10 leading-relaxed px-2">
                                    אני החתום מטה מאשר את פרטי ההזמנה כפי שמופיעים במסמך זה (דפים 1-{pages.length-1}), 
                                    ומאשר לחייב את כרטיס האשראי הנ"ל בסכום העסקה הכולל: <span className="font-bold">{order.total_price.toLocaleString()} ₪</span>.
                                    ידוע לי כי ביטול עסקה כרוך בדמי ביטול ע"פ מדיניות המלון והחוק.
                                </p>

                                <div className="grid grid-cols-2 gap-20 px-4">
                                     <div>
                                         <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-10 text-center">חתימת הלקוח</div>
                                         <div className="border-b-2 border-gray-400 h-2 w-full"></div>
                                     </div>
                                     <div>
                                         <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-8 text-center">חתימת נציג המלון</div>
                                         <div className="relative border-b-2 border-gray-400 h-2 w-full mt-2">
                                             <div className="absolute bottom-2 left-0 right-0 text-center font-serif italic text-2xl text-slate-600">
                                                 {order.salespersonName}
                                             </div>
                                         </div>
                                         <div className="text-center text-xs text-gray-400 mt-1">{format(new Date(), 'dd/MM/yyyy')}</div>
                                     </div>
                                </div>
                             </div>
                        </div>

                        <div className="mt-auto text-center pt-8 border-t border-gray-100">
                            <p className="text-xs text-gray-400">מסמך זה הופק באופן ממוחשב • {hotel.name}</p>
                        </div>
                    </div>
                )}
           </div>
        ))}
      </div>
    </div>
  );
}