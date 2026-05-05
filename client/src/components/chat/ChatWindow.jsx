import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/utils/api.js';
import { Send, Paperclip, LoaderCircle, X, Image as ImageIcon, FileText, Video } from 'lucide-react';
import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/Dropdown-menu";
import MessageBubble from '@/components/chat/MessageBubble.jsx';
import OrderPickerDialog from '@/components/chat/OrderPickerDialog.jsx';
import { useChatStore } from '@/stores/chatStore.js';

const fetchMessages = async (otherUserId) => (await api.get(`/chat/messages/${otherUserId}`)).data;
// ✨ שינוי לקליטת FormData
const sendMessageApi = (formData) => api.post('/chat/send', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
const deleteMessageApi = (msgId) => api.delete(`/chat/${msgId}`);

export default function ChatWindow({ currentUser, selectedContact, onBack }) {
  const [inputText, setInputText] = useState('');
  const [attachedOrder, setAttachedOrder] = useState(null);
  
  // ✨ ניהול קובץ
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const [isOrderPickerOpen, setIsOrderPickerOpen] = useState(false);
  const { messages, setMessages, emitTyping, typingUsers, addMessage } = useChatStore();
  const isContactTyping = typingUsers[selectedContact._id];

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const { data: initialMessages, isLoading } = useQuery({
    queryKey: ['messages', selectedContact._id],
    queryFn: () => fetchMessages(selectedContact._id),
    staleTime: 0,
  });

  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
      scrollToBottom();
    }
  }, [initialMessages, selectedContact._id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isContactTyping]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleInputChange = (e) => {
      setInputText(e.target.value);
      if (!typingTimeoutRef.current) {
          emitTyping(selectedContact._id, true);
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
          emitTyping(selectedContact._id, false);
          typingTimeoutRef.current = null;
      }, 2000);
  };

  const handleFileSelect = (e) => {
      if (e.target.files && e.target.files[0]) {
          setSelectedFile(e.target.files[0]);
      }
  };

  const handleSend = async () => {
    if ((!inputText.trim() && !attachedOrder && !selectedFile)) return;

    if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
        emitTyping(selectedContact._id, false);
    }

    const tempId = Date.now().toString();
    
    // הכנת ה-FormData
    const formData = new FormData();
    formData.append('recipientId', selectedContact._id);
    if (inputText) formData.append('text', inputText);
    if (attachedOrder) formData.append('orderId', attachedOrder._id);
    if (selectedFile) formData.append('file', selectedFile);
    formData.append('isForwarded', false);

    // עדכון אופטימי עם תצוגה מקדימה
    const optimisticMsg = {
        _id: tempId,
        tempId: tempId,
        sender: currentUser._id,
        recipient: selectedContact._id,
        text: inputText,
        relatedOrder: attachedOrder,
        mediaUrl: selectedFile ? URL.createObjectURL(selectedFile) : null,
        mediaType: selectedFile ? (selectedFile.type.startsWith('video') ? 'video' : selectedFile.type.startsWith('image') ? 'image' : 'document') : null,
        fileName: selectedFile ? selectedFile.name : null,
        createdAt: new Date().toISOString(),
        isRead: false,
        isDeleted: false,
        status: 'sending'
    };

    addMessage(optimisticMsg);
    
    setInputText('');
    setAttachedOrder(null);
    setSelectedFile(null);
    if(fileInputRef.current) fileInputRef.current.value = '';
    scrollToBottom();

    try {
      await sendMessageApi(formData);
    } catch (error) {
      console.error("Error sending:", error);
    }
  };

  const handleDeleteMessage = (msgId) => {
      if(window.confirm('למחוק הודעה זו?')) {
          deleteMessageApi(msgId);
      }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const TypingIndicator = () => (
      <div className="flex w-full mb-2 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-white border border-gray-100 px-4 py-3 rounded-xl rounded-tl-none shadow-sm flex items-center gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
          </div>
      </div>
  );

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center gap-3 p-3 bg-white border-b border-slate-200 shadow-sm z-10">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack}>
           <span className="text-xl">➔</span>
        </Button>
        <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold">
          {selectedContact.name.charAt(0)}
        </div>
        <div>
          <h3 className="font-bold text-slate-800">{selectedContact.name}</h3>
          <span className="text-xs text-green-600">
             {isContactTyping ? 'מקליד/ה...' : 'מחובר'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="flex justify-center pt-10"><LoaderCircle className="animate-spin text-slate-400" /></div>
        ) : (
          <>
              {messages.map((msg, index) => (
                <MessageBubble
                  key={msg._id || msg.tempId || index}
                  message={msg}
                  isMe={msg.sender === currentUser._id}
                  onDelete={handleDeleteMessage}
                  onForward={(m) => setInputText(m.text)}
                />
              ))}
              {isContactTyping && <TypingIndicator />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 bg-[#f0f2f5] border-t border-slate-200">
        
        {selectedFile && (
            <div className="flex items-center justify-between bg-white p-2 rounded-lg mb-2 border border-blue-200">
                <div className="flex items-center gap-2 overflow-hidden">
                    {selectedFile.type.startsWith('image') ? <ImageIcon size={20} className="text-purple-500"/> : 
                     selectedFile.type.startsWith('video') ? <Video size={20} className="text-red-500"/> : <FileText size={20} className="text-blue-500"/>}
                    <span className="text-sm truncate max-w-[200px]">{selectedFile.name}</span>
                </div>
                <button onClick={() => {setSelectedFile(null); fileInputRef.current.value = '';}}><X size={16}/></button>
            </div>
        )}

        {attachedOrder && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-2 mb-2 mx-1">
            <div className="text-sm text-blue-800">
              <span className="font-bold">מצורפת הזמנה:</span> {attachedOrder.customerName} (#{attachedOrder.orderNumber})
            </div>
            <button onClick={() => setAttachedOrder(null)} className="text-blue-400 hover:text-blue-600">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 bg-white rounded-2xl p-1 shadow-sm border border-slate-100">
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-slate-400 hover:text-blue-600 rounded-full h-10 w-10">
                    <Paperclip size={20} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => fileInputRef.current.click()}>
                    <ImageIcon className="mr-2 h-4 w-4" /> תמונה / וידאו / קובץ
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsOrderPickerOpen(true)}>
                    <FileText className="mr-2 h-4 w-4" /> צרף הזמנה
                </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <input 
             type="file" 
             ref={fileInputRef} 
             className="hidden" 
             onChange={handleFileSelect} 
          />

          <Input
            className="border-none shadow-none focus-visible:ring-0 resize-none py-3 max-h-32 min-h-[40px] bg-transparent"
            placeholder="הקלד הודעה..."
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />

          <Button
            onClick={handleSend}
            disabled={!inputText.trim() && !attachedOrder && !selectedFile}
            className="rounded-full h-10 w-10 p-0 bg-teal-600 hover:bg-teal-700 text-white shrink-0"
          >
            <Send size={18} className="ml-0.5 mt-0.5" />
          </Button>
        </div>
      </div>

      <OrderPickerDialog
        isOpen={isOrderPickerOpen}
        onClose={() => setIsOrderPickerOpen(false)}
        onSelect={(order) => {
          setAttachedOrder(order);
          setIsOrderPickerOpen(false);
        }}
      />
    </div>
  );
}