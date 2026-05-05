import React, { useState } from 'react';
import api from '@/utils/api.js';
import { Button } from '@/components/ui/Button.jsx';
import { UploadCloud, Loader2, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ImageUploader({ onUploadSuccess, label = "העלה תמונה" }) {
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState(null);

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // תצוגה מקדימה מיידית (לפני שליחה)
        const objectUrl = URL.createObjectURL(file);
        setPreview(objectUrl);

        const formData = new FormData();
        formData.append('file', file);

        setUploading(true);
        try {
            const { data } = await api.post('/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            
            toast.success('התמונה עלתה בהצלחה!');
            
            // החזרת הנתיב להורה (למשל כדי לשמור ב-DB בטופס אחר)
            if (onUploadSuccess) {
                onUploadSuccess(data.path);
            }
        } catch (error) {
            console.error(error);
            toast.error('שגיאה בהעלאת התמונה');
            setPreview(null); // ביטול תצוגה אם נכשל
        } finally {
            setUploading(false);
        }
    };

    const clearSelection = () => {
        setPreview(null);
        if (onUploadSuccess) onUploadSuccess(''); // ניקוי אצל ההורה
    };

    return (
        <div className="flex items-center gap-4">
            {preview ? (
                <div className="relative group">
                    <img 
                        src={preview} 
                        alt="Preview" 
                        className="h-16 w-16 object-cover rounded-lg border border-slate-200 shadow-sm"
                    />
                    <button 
                        onClick={clearSelection}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow-md hover:bg-red-600 transition-colors"
                        type="button"
                    >
                        <X size={12} />
                    </button>
                    {uploading && (
                        <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                            <Loader2 className="animate-spin text-white h-6 w-6" />
                        </div>
                    )}
                </div>
            ) : (
                <div className="relative">
                    <Button 
                        type="button" 
                        variant="outline" 
                        className="gap-2 border-dashed border-2 hover:border-blue-400 hover:bg-blue-50"
                        disabled={uploading}
                    >
                        {uploading ? <Loader2 className="animate-spin h-4 w-4"/> : <UploadCloud className="h-4 w-4"/>}
                        {label}
                    </Button>
                    <input 
                        type="file" 
                        accept="image/*" 
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={handleFileSelect}
                        disabled={uploading}
                    />
                </div>
            )}
        </div>
    );
}