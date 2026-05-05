import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/utils/api.js';
import { Send, Search, Phone, MoreVertical, Paperclip, Check, CheckCheck } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

// --- Components ---

const ChatSidebar = ({ chats, activeChat, onSelectChat }) => {
  const [search, setSearch] = useState("");

  const filteredChats = chats.filter(c => 
    (c.pushName || c._id).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-1/3 border-l border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="h-16 bg-gray-100 flex items-center justify-between px-4 border-b">
        <div className="font-bold text-gray-700">צ'אטים</div>
        <div className="flex gap-2 text-gray-500">
           <MoreVertical size={20} />
        </div>
      </div>
      
      {/* Search */}
      <div className="p-2 bg-white border-b">
        <div className="relative bg-gray-100 rounded-lg flex items-center px-2">
            <Search size={18} className="text-gray-400 ml-2" />
            <input 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש או התחלת צ'אט חדש"
                className="bg-transparent border-none focus:ring-0 w-full py-2 text-sm"
            />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.map((chat) => (
            <div 
                key={chat._id} 
                onClick={() => onSelectChat(chat)}
                className={`flex items-center p-3 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100 ${activeChat?._id === chat._id ? 'bg-gray-100' : ''}`}
            >
                {/* Avatar Placeholder */}
                <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-white font-bold text-lg ml-3">
                    {(chat.pushName || "U")[0].toUpperCase()}
                </div>
                
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                        <span className="font-medium text-gray-900 truncate">{chat.pushName || chat._id.split('@')[0]}</span>
                        <span className="text-xs text-gray-400">{format(new Date(chat.timestamp), 'HH:mm')}</span>
                    </div>
                    <div className="text-sm text-gray-500 truncate flex items-center gap-1">
                        {chat.lastMessage}
                    </div>
                </div>
            </div>
        ))}
      </div>
    </div>
  );
};

const ChatWindow = ({ activeChat, messages, onSendMessage }) => {
    const [text, setText] = useState("");
    const bottomRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    if (!activeChat) {
        return (
            <div className="flex-1 bg-gray-100 border-b-8 border-green-500 flex flex-col items-center justify-center text-gray-500">
                <h1 className="text-3xl font-light mb-4">WhatsApp Web Clone</h1>
                <p>בחר שיחה כדי להתחיל לשלוח הודעות</p>
            </div>
        );
    }

    const handleSend = () => {
        if (!text.trim()) return;
        onSendMessage({ to: activeChat._id, text });
        setText("");
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-[#efeae2]">
            {/* Header */}
            <div className="h-16 bg-gray-100 flex items-center justify-between px-4 border-b shadow-sm z-10">
                <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-white ml-3">
                        {(activeChat.pushName || "U")[0].toUpperCase()}
                    </div>
                    <div>
                        <div className="font-medium text-gray-900">{activeChat.pushName || activeChat._id.split('@')[0]}</div>
                        <div className="text-xs text-gray-500">מחובר</div>
                    </div>
                </div>
                <div className="flex gap-4 text-gray-500">
                    <Search size={20} />
                    <MoreVertical size={20} />
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 relative" 
                 style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", opacity: 0.95 }}>
                
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.fromMe ? 'justify-start' : 'justify-end'}`}>
                        <div className={`relative max-w-[60%] p-2 rounded-lg text-sm shadow-sm 
                            ${msg.fromMe ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}
                        `}>
                            <div className="text-gray-800 break-words pr-1 pl-6 pb-2">
                                {msg.text}
                            </div>
                            <div className="absolute left-1 bottom-1 text-[10px] text-gray-500 flex items-center gap-1">
                                {format(new Date(msg.timestamp), 'HH:mm')}
                                {msg.fromMe && <CheckCheck size={14} className="text-blue-500" />}
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>

            {/* Input Area */}
            <div className="bg-gray-100 p-3 flex items-center gap-2">
                <button className="p-2 text-gray-500 hover:bg-gray-200 rounded-full"><Paperclip size={24} /></button>
                <input 
                    className="flex-1 p-3 rounded-lg border-none focus:ring-0 text-sm bg-white"
                    placeholder="הקלד/י הודעה"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />
                <button 
                    onClick={handleSend}
                    className="p-3 bg-teal-600 text-white rounded-full hover:bg-teal-700 transition-colors"
                >
                    <Send size={20} className="ml-1" /> {/* זז קצת בגלל RTL */}
                </button>
            </div>
        </div>
    );
};

// --- Main Page ---

export default function WhatsAppPage() {
    const [activeChat, setActiveChat] = useState(null);
    const queryClient = useQueryClient();

    // 1. Fetch Chats List
    const { data: chats = [], isLoading } = useQuery({
        queryKey: ['whatsapp-chats'],
        queryFn: async () => {
            const { data } = await api.get('/whatsapp/chats');
            return data;
        },
        refetchInterval: 5000 // רענון כל 5 שניות להודעות חדשות
    });

    // 2. Fetch Messages for Active Chat
    const { data: messages = [] } = useQuery({
        queryKey: ['whatsapp-messages', activeChat?._id],
        queryFn: async () => {
            if (!activeChat) return [];
            // מקודד את ה-JID (כמו 97250...@s.whatsapp.net) כדי שיעבור ב-URL
            const encodedId = encodeURIComponent(activeChat._id);
            const { data } = await api.get(`/whatsapp/messages/${encodedId}`);
            return data;
        },
        enabled: !!activeChat,
        refetchInterval: 2000 // רענון מהיר כשהצ'אט פתוח
    });

    // 3. Send Message Mutation
    const sendMessageMutation = useMutation({
        mutationFn: async ({ to, text }) => {
            return api.post('/whatsapp/send', { to, text });
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['whatsapp-messages', activeChat?._id]);
            queryClient.invalidateQueries(['whatsapp-chats']); // כדי לעדכן את ההודעה האחרונה בצד
        },
        onError: () => toast.error("שגיאה בשליחת ההודעה")
    });

    return (
        <div className="flex h-[calc(100vh-80px)] overflow-hidden bg-gray-200 border border-gray-300 rounded-xl shadow-xl m-4">
            <ChatSidebar 
                chats={chats} 
                activeChat={activeChat} 
                onSelectChat={setActiveChat} 
            />
            <ChatWindow 
                activeChat={activeChat} 
                messages={messages} 
                onSendMessage={sendMessageMutation.mutate} 
            />
        </div>
    );
}