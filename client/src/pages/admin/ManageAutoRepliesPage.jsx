// client/src/pages/admin/ManageAutoRepliesPage.jsx

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api.js';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import { Label } from '@/components/ui/Label.jsx';
// ✨ הוספנו את Edit ו-X (לביטול)
import { Trash2, Plus, PlayCircle, MessageSquare, Image as ImageIcon, Link as LinkIcon, Clock, Save, Info, UploadCloud, LoaderCircle, RefreshCw, CheckCircle, XCircle, FileText, TrendingUp, Edit, X } from 'lucide-react';

const fetchFlows = async () => (await api.get('/admin/auto-replies')).data;
const fetchLogs = async () => (await api.get('/admin/auto-replies/logs')).data;

export default function ManageAutoRepliesPage() {
    const [triggerText, setTriggerText] = useState('');
    const [minDelay, setMinDelay] = useState(3);
    const [maxDelay, setMaxDelay] = useState(10);
    const [steps, setSteps] = useState([]);
    const [uploadingIndex, setUploadingIndex] = useState(null);
    
    // ✨ סטייט לניהול מצב עריכה
    const [editingId, setEditingId] = useState(null);

    const queryClient = useQueryClient();

    const { data: flows = [], isLoading } = useQuery({
        queryKey: ['autoReplies'],
        queryFn: fetchFlows
    });

    const { data: logs = [], refetch: refetchLogs } = useQuery({
        queryKey: ['autoReplyLogs'],
        queryFn: fetchLogs,
        refetchInterval: 5000
    });

    const createMutation = useMutation({
        mutationFn: (data) => api.post('/admin/auto-replies', data),
        onSuccess: () => {
            toast.success('הזרימה נוצרה והופעלה!');
            queryClient.invalidateQueries(['autoReplies']);
            resetForm();
        },
        onError: () => toast.error('שגיאה ביצירה')
    });

    // ✨ מוטציה לעדכון
    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => api.put(`/admin/auto-replies/${id}`, data),
        onSuccess: () => {
            toast.success('הזרימה עודכנה בהצלחה!');
            queryClient.invalidateQueries(['autoReplies']);
            resetForm();
        },
        onError: () => toast.error('שגיאה בעדכון')
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => api.delete(`/admin/auto-replies/${id}`),
        onSuccess: () => {
            toast.success('נמחק בהצלחה');
            queryClient.invalidateQueries(['autoReplies']);
        }
    });

    const scanMutation = useMutation({
        mutationFn: () => api.post('/admin/auto-replies/scan'),
        onSuccess: (res) => toast.success(res.data.message),
        onError: (err) => toast.error(err.response?.data?.message || 'שגיאה בסריקה')
    });

    const addStep = (type) => {
        setSteps([...steps, { type, content: '', caption: '' }]);
    };

    const updateStep = (index, field, value) => {
        const newSteps = [...steps];
        newSteps[index][field] = value;
        setSteps(newSteps);
    };

    const removeStep = (index) => {
        setSteps(steps.filter((_, i) => i !== index));
    };

    const handleFileUpload = async (e, index) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploadingIndex(index);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const { data } = await api.post('/upload/general', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            updateStep(index, 'content', data.path);
            toast.success('הקובץ עלה בהצלחה!');
        } catch (error) {
            console.error(error);
            toast.error('שגיאה בהעלאה');
        } finally {
            setUploadingIndex(null);
        }
    };

    const handleSave = () => {
        if (!triggerText) return toast.error('חובה להזין טריגר (מילת מפתח)');
        if (steps.length === 0) return toast.error('חובה להוסיף לפחות שלב אחד לתגובה');
        if (Number(minDelay) > Number(maxDelay)) return toast.error('זמן מינימלי לא יכול להיות גדול מהמקסימלי');

        for (let step of steps) {
            if (!step.content) return toast.error('אחד השלבים ריק מתוכן. נא למלא או למחוק.');
        }

        const payload = {
            triggerText,
            steps,
            minDelayMinutes: Number(minDelay),
            maxDelayMinutes: Number(maxDelay)
        };

        // ✨ בדיקה האם אנחנו בעריכה או יצירה
        if (editingId) {
            updateMutation.mutate({ id: editingId, data: payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    // ✨ פונקציה לטעינת נתונים לעריכה
    const handleEdit = (flow) => {
        setEditingId(flow._id);
        setTriggerText(flow.triggerText);
        setMinDelay(flow.minDelayMinutes);
        setMaxDelay(flow.maxDelayMinutes);
        setSteps(flow.steps);
        window.scrollTo({ top: 0, behavior: 'smooth' }); // גלילה למעלה לטופס
    };

    const resetForm = () => {
        setEditingId(null); // ✨ איפוס מזהה העריכה
        setTriggerText('');
        setSteps([]);
        setMinDelay(3);
        setMaxDelay(10);
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 space-y-8 max-w-6xl" dir="rtl">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                        🤖 מענה אוטומטי חכם (Flows)
                    </h1>
                    <p className="text-gray-500 mt-1">הגדרת רצף תגובות אנושיות לוואטסאפ לפי מילות מפתח.</p>
                </div>
                <Button
                    variant="outline"
                    className="gap-2 border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 shadow-sm"
                    onClick={() => {
                        if(window.confirm('פעולה זו תסרוק את כל הצ\'אטים הפתוחים...')) {
                            scanMutation.mutate();
                        }
                    }}
                    disabled={scanMutation.isPending}
                >
                    <PlayCircle size={20} className={scanMutation.isPending ? 'animate-spin' : ''}/>
                    {scanMutation.isPending ? 'סורק היסטוריה...' : 'סרוק היסטוריה ושלח בדיעבד'}
                </Button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

                <div className="lg:col-span-2 space-y-6">
                    <Card className={`border-t-4 ${editingId ? 'border-t-orange-500' : 'border-t-purple-600'} shadow-md`}>
                        <CardHeader className="flex flex-row justify-between items-center">
                            <CardTitle className="text-xl">
                                {editingId ? `עריכת תבנית: "${triggerText}"` : 'יצירת תבנית חדשה'}
                            </CardTitle>
                            {/* ✨ כפתור ביטול עריכה */}
                            {editingId && (
                                <Button variant="ghost" size="sm" onClick={resetForm} className="text-red-500 hover:bg-red-50">
                                    <X className="h-4 w-4 ml-1"/> ביטול עריכה
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-6">

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <Label className="text-base font-bold text-gray-800 mb-2 block">1. כשהלקוח שולח את הטקסט:</Label>
                                    <Input
                                        placeholder='לדוגמה: "פעילות חנוכה" או "הצעה"'
                                        value={triggerText}
                                        onChange={e => setTriggerText(e.target.value)}
                                        className="text-lg"
                                    />
                                </div>
                                <div>
                                    <Label className="text-base font-bold text-gray-800 mb-2 flex items-center gap-2"><Clock size={18}/> 2. טווח המתנה לתגובה (דקות):</Label>
                                    <div className="flex items-center gap-2">
                                        <Input type="number" min="0" value={minDelay} onChange={e => setMinDelay(e.target.value)} className="w-20 text-center" />
                                        <span className="text-gray-500 font-bold">-</span>
                                        <Input type="number" min="0" value={maxDelay} onChange={e => setMaxDelay(e.target.value)} className="w-20 text-center" />
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">המערכת תמתין ותציג "מקליד..." לפני השליחה.</p>
                                </div>
                            </div>

                            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                                <Label className="text-base font-bold text-gray-800 mb-3 block">3. רצף התגובות שישלח:</Label>

                                <div className="space-y-3 mb-4">
                                    {steps.map((step, idx) => (
                                        <div key={idx} className="flex gap-3 items-start bg-white p-4 rounded-lg border shadow-sm relative group animate-in slide-in-from-right-2">
                                            <div className="mt-2 bg-purple-50 text-purple-600 p-2 rounded-full">
                                                {step.type === 'text' && <MessageSquare size={18}/>}
                                                {step.type === 'image' && <ImageIcon size={18}/>}
                                                {step.type === 'video' && <PlayCircle size={18}/>}
                                                {step.type === 'document' && <FileText size={18}/>}
                                                {step.type === 'link' && <LinkIcon size={18}/>}
                                            </div>
                                            <div className="flex-1 space-y-2">
                                                <div className="font-bold text-xs text-slate-400 uppercase tracking-wider">שלב {idx + 1}: {step.type}</div>

                                                {step.type === 'text' && (
                                                    <textarea
                                                        className="w-full border rounded-md p-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none"
                                                        rows="2"
                                                        placeholder="הקלד את תוכן ההודעה..."
                                                        value={step.content}
                                                        onChange={e => updateStep(idx, 'content', e.target.value)}
                                                    />
                                                )}

                                                {step.type === 'link' && (
                                                    <Input
                                                        placeholder="https://example.com"
                                                        value={step.content}
                                                        onChange={e => updateStep(idx, 'content', e.target.value)}
                                                        dir="ltr"
                                                        className="font-mono text-sm"
                                                    />
                                                )}

                                                {['image', 'video', 'document'].includes(step.type) && (
                                                    <div className="space-y-2">
                                                        <div className="flex gap-2 items-center">
                                                            <Input
                                                                type="text"
                                                                placeholder="נתיב הקובץ (ימולא אוטומטית)"
                                                                value={step.content}
                                                                readOnly
                                                                className="bg-gray-50 text-gray-500 text-xs"
                                                                dir="ltr"
                                                            />
                                                            <div className="relative">
                                                                <Button type="button" variant="secondary" size="sm" className="whitespace-nowrap gap-2">
                                                                    {uploadingIndex === idx ? <LoaderCircle className="animate-spin h-4 w-4"/> : <UploadCloud className="h-4 w-4"/>}
                                                                    בחר
                                                                </Button>
                                                                <input
                                                                    type="file"
                                                                    accept={step.type === 'image' ? "image/*" : step.type === 'video' ? "video/*" : ".pdf,.doc,.docx,.xls,.xlsx,.txt"}
                                                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                                                    onChange={(e) => handleFileUpload(e, idx)}
                                                                />
                                                            </div>
                                                        </div>

                                                        {step.content && (
                                                            <div className="text-xs text-green-600 font-bold flex items-center gap-1">
                                                                <CheckCircle size={10}/> קובץ נטען: {step.content.split('/').pop()}
                                                            </div>
                                                        )}

                                                        <Input
                                                            placeholder={step.type === 'document' ? "שם הקובץ לתצוגה" : "כיתוב (Caption)..."}
                                                            value={step.caption}
                                                            onChange={e => updateStep(idx, 'caption', e.target.value)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => removeStep(idx)} className="text-slate-300 hover:text-red-500 p-1 transition-colors">
                                                <Trash2 size={18}/>
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex gap-2 justify-center flex-wrap">
                                    <Button variant="outline" size="sm" onClick={() => addStep('text')} className="gap-2 bg-white hover:bg-purple-50 hover:text-purple-700"><MessageSquare size={16}/> טקסט</Button>
                                    <Button variant="outline" size="sm" onClick={() => addStep('image')} className="gap-2 bg-white hover:bg-purple-50 hover:text-purple-700"><ImageIcon size={16}/> תמונה</Button>
                                    <Button variant="outline" size="sm" onClick={() => addStep('video')} className="gap-2 bg-white hover:bg-purple-50 hover:text-purple-700"><PlayCircle size={16}/> סרטון</Button>
                                    <Button variant="outline" size="sm" onClick={() => addStep('document')} className="gap-2 bg-white hover:bg-purple-50 hover:text-purple-700"><FileText size={16}/> מסמך</Button>
                                    <Button variant="outline" size="sm" onClick={() => addStep('link')} className="gap-2 bg-white hover:bg-purple-50 hover:text-purple-700"><LinkIcon size={16}/> קישור</Button>
                                </div>
                            </div>

                            {/* ✨ כפתור שמירה חכם */}
                            <Button
                                onClick={handleSave}
                                className={`w-full text-lg py-6 shadow-md ${editingId ? 'bg-orange-600 hover:bg-orange-700' : 'bg-slate-900 hover:bg-slate-800'}`}
                                disabled={createMutation.isPending || updateMutation.isPending}
                            >
                                <Save className="ml-2 h-5 w-5"/>
                                {(createMutation.isPending || updateMutation.isPending) ? 'שומר...' : editingId ? 'עדכן זרימה' : 'שמור והפעל אוטומטית'}
                            </Button>

                        </CardContent>
                    </Card>

                    <div className="bg-blue-50 p-4 rounded-lg flex gap-3 text-blue-800 text-sm">
                        <Info className="shrink-0 mt-0.5" size={18} />
                        <p>טיפ: בין שלב לשלב תהיה המתנה קבועה של 3 שניות, והמערכת תציג "מקליד..." כדי ליצור תחושה טבעית.</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="font-bold text-gray-700 text-lg">זרימות פעילות ({flows.length})</h3>
                    {isLoading ? <p className="text-gray-500">טוען...</p> : (
                        <div className="space-y-3">
                            {flows.map(flow => (
                                <Card key={flow._id} className="hover:shadow-md transition-shadow group">
                                    <CardContent className="p-4">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="font-bold text-lg text-slate-800 bg-yellow-100 px-2 rounded inline-block">"{flow.triggerText}"</div>
                                            
                                            <div className="flex gap-1">
                                                {/* ✨ כפתור עריכה */}
                                                <button
                                                    className="text-slate-300 hover:text-blue-500 transition-colors p-1"
                                                    onClick={() => handleEdit(flow)}
                                                    title="ערוך"
                                                >
                                                    <Edit size={18}/>
                                                </button>
                                                
                                                <button
                                                    className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                                    onClick={() => {if(window.confirm('למחוק את הזרימה?')) deleteMutation.mutate(flow._id)}}
                                                    title="מחק"
                                                >
                                                    <Trash2 size={18}/>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-sm text-gray-600 space-y-1">
                                            <div className="flex items-center gap-2">
                                                <Clock size={14} className="text-gray-400"/>
                                                <span>השהייה: <strong>{flow.minDelayMinutes}-{flow.maxDelayMinutes}</strong> דקות</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <MessageSquare size={14} className="text-gray-400"/>
                                                <span>{flow.steps.length} שלבים בתהליך</span>
                                            </div>

                                            <div className="flex items-center gap-2 font-bold text-green-700 bg-green-50 px-2 py-1 rounded w-fit mt-1">
                                                <TrendingUp size={14}/>
                                                <span>{flow.usageCount || 0} שימושים</span>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex gap-1">
                                            {flow.steps.map((s, i) => (
                                                <div key={i} className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-500 text-[10px]" title={s.type}>
                                                    {s.type === 'text' ? 'T' : s.type === 'image' ? 'IM' : s.type === 'video' ? 'VI' : s.type === 'document' ? 'DC' : 'LN'}
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-12">
               {/* ... (טבלת הלוגים נשארת ללא שינוי) ... */}
               {/* כדי לחסוך מקום בתשובה לא העתקתי את טבלת הלוגים שוב, היא תקינה ולא הושפעה */}
               {/* העתק את כל הקוד מהחלק של הלוגים למטה כפי שהיה */}
               <div className="flex justify-between items-center mb-4">
                  <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                      📊 לוג ביצועים חי (50 אחרונים)
                  </h2>
                  <Button variant="ghost" size="sm" onClick={() => refetchLogs()} className="gap-2">
                      <RefreshCw size={16}/> רענן רשימה
                  </Button>
               </div>
               
               <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-slate-100 text-slate-600 font-bold border-b border-gray-200">
                                <tr>
                                    <th className="p-3">תאריך זיהוי</th>
                                    <th className="p-3">שם השולח</th>
                                    <th className="p-3">טלפון</th>
                                    <th className="p-3">הטריגר שנתפס</th>
                                    <th className="p-3">סטטוס</th>
                                    <th className="p-3">פרטים</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {logs.map(log => (
                                    <tr key={log._id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-3 text-gray-500 whitespace-nowrap" dir="ltr">
                                            {new Date(log.createdAt).toLocaleString('he-IL')}
                                        </td>
                                        <td className="p-3 font-medium">{log.senderName}</td>
                                        <td className="p-3 text-gray-500" dir="ltr">{log.senderPhone}</td>
                                        <td className="p-3">
                                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold border border-purple-200">
                                                {log.triggerText}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            {log.status === 'pending' && (
                                                <span className="flex items-center gap-1 text-orange-600 bg-orange-50 px-2 py-1 rounded-full text-xs font-bold border border-orange-100">
                                                    <Clock size={14}/> ממתין
                                                </span>
                                            )}
                                            {log.status === 'sent' && (
                                                <span className="flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded-full text-xs font-bold border border-green-100">
                                                    <CheckCircle size={14}/> נשלח
                                                </span>
                                            )}
                                            {log.status === 'failed' && (
                                                <span className="flex items-center gap-1 text-red-600 bg-red-50 px-2 py-1 rounded-full text-xs font-bold border border-red-100">
                                                    <XCircle size={14}/> נכשל
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-xs text-gray-400 max-w-xs truncate" title={log.status === 'failed' ? log.errorMessage : ''}>
                                            {log.status === 'pending' && log.scheduledFor && `מתוזמן ל: ${new Date(log.scheduledFor).toLocaleTimeString()}`}
                                            {log.status === 'failed' && <span className="text-red-400">{log.errorMessage}</span>}
                                            {log.status === 'sent' && `נשלח ב: ${new Date(log.sentAt).toLocaleTimeString()}`}
                                        </td>
                                    </tr>
                                ))}
                                {logs.length === 0 && (
                                    <tr>
                                        <td colSpan="6" className="p-12 text-center text-gray-400">
                                            <div className="flex flex-col items-center gap-2">
                                                <Info size={32} className="opacity-20"/>
                                                <span>עדיין לא זוהו פניות מתאימות לטריגרים.</span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}