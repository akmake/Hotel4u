import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { CheckCheck, Trash2, Reply, Ban, FileText } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export default function MessageBubble({ message, isMe, onDelete, onForward }) {
  const isOrderAttached = !!message.relatedOrder;
  const isDeleted = message.isDeleted;

  const renderStatus = () => {
    if (!isMe || isDeleted) return null;
    if (message.status === 'sending') return <span className="text-gray-400 text-[10px]">🕒</span>;
    if (message.isRead) return <CheckCheck size={14} className="text-blue-500" />;
    return <CheckCheck size={14} className="text-gray-400" />;
  };

  // ✨ לוגיקת רינדור מדיה
  const renderMedia = () => {
    if (!message.mediaUrl) return null;

    // ✨ התיקון: הוספת ברירת מחדל למקרה שמשתנה הסביבה חסר
    const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://ziporiteem.com';

    // תמיכה ב-Blob (תצוגה מקדימה לפני שליחה) ובנתיב שרת
    const fullUrl = message.mediaUrl.startsWith('blob:') 
        ? message.mediaUrl 
        : `${API_BASE.replace('/api', '')}${message.mediaUrl}`;

    if (message.mediaType === 'image') {
        return (
            <div className="mb-1 rounded-lg overflow-hidden border border-gray-100">
                <img src={fullUrl} alt="attachment" className="max-w-[250px] max-h-[250px] object-cover" />
            </div>
        );
    }
    if (message.mediaType === 'video') {
        return (
            <div className="mb-1 rounded-lg overflow-hidden border border-gray-100 max-w-[250px]">
                <video src={fullUrl} controls className="w-full" />
            </div>
        );
    }
    if (message.mediaType === 'document') {
        return (
            <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200 mb-1 hover:bg-gray-100 transition-colors no-underline">
                <div className="bg-red-100 p-2 rounded text-red-600"><FileText size={24}/></div>
                <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-bold text-gray-800 truncate max-w-[150px]">{message.fileName || 'מסמך מצורף'}</p>
                    <p className="text-[10px] text-gray-500">לחץ להורדה</p>
                </div>
            </a>
        );
    }
    return null;
  };

  return (
    <div className={`flex w-full mb-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
        <ContextMenu>
            <ContextMenuTrigger className={`relative max-w-[80%] min-w-[120px] rounded-xl shadow-sm text-sm mb-1 group px-3 py-2 flex flex-col
                ${isMe
                    ? 'bg-[#d9fdd3] text-gray-900 rounded-tl-xl rounded-tr-none'
                    : 'bg-white text-gray-900 rounded-tr-xl rounded-tl-none border border-gray-100'}
                `}>

                {message.isForwarded && !isDeleted && (
                    <div className="text-[10px] text-gray-500 italic mb-1 flex items-center gap-1 bg-black/5 p-1 rounded w-fit">
                        <Reply size={10} className="scale-x-[-1]"/> הועבר
                    </div>
                )}

                {isDeleted ? (
                    <div className="flex items-center gap-2 text-gray-500 italic py-1 px-1">
                        <Ban size={14}/> <span>הודעה זו נמחקה</span>
                    </div>
                ) : (
                    <>
                        {/* ✨ תצוגת מדיה */}
                        {renderMedia()}

                        {/* כרטיסיית הזמנה מצורפת */}
                        {isOrderAttached && message.relatedOrder && (
                            <div className="mb-2 bg-white/80 p-2 rounded border border-blue-100 shadow-sm cursor-pointer hover:bg-blue-50 transition-colors">
                                <p className="font-bold text-xs text-blue-700">הזמנה #{message.relatedOrder.orderNumber}</p>
                                <p className="font-medium">{message.relatedOrder.customerName}</p>
                                <div className="flex justify-between items-center mt-1">
                                    <span className="text-xs text-gray-500">{message.relatedOrder.status}</span>
                                    <Link to={`/edit-order/${message.relatedOrder._id}`} className="text-xs underline text-blue-600 font-bold">צפה</Link>
                                </div>
                            </div>
                        )}

                        {/* טקסט ההודעה */}
                        {message.text && (
                            <div className="whitespace-pre-wrap leading-relaxed text-base pl-1 pr-1 pb-1">
                                {message.text}
                            </div>
                        )}
                    </>
                )}

                <div className="flex justify-end items-center gap-1 mt-1 select-none">
                    <span className="text-[10px] text-gray-500">
                        {message.createdAt ? format(new Date(message.createdAt), 'HH:mm') : ''}
                    </span>
                    {renderStatus()}
                </div>

            </ContextMenuTrigger>

            <ContextMenuContent className="w-40 bg-white border shadow-md rounded z-50">
               {!isDeleted && (
                    <ContextMenuItem onClick={() => onForward(message)} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-slate-100">
                        <Reply size={14} className="scale-x-[-1]"/> העבר
                    </ContextMenuItem>
                )}
                {isMe && !isDeleted && (
                    <ContextMenuItem onClick={() => onDelete(message._id)} className="flex items-center gap-2 text-red-600 cursor-pointer p-2 hover:bg-red-50">
                        <Trash2 size={14}/> מחק אצלי ואצל כולם
                    </ContextMenuItem>
                )}
            </ContextMenuContent>
        </ContextMenu>
    </div>
  );
}