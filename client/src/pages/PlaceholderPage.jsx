import { Construction } from 'lucide-react';

export default function PlaceholderPage({ title }) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center min-h-64 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center">
        <Construction size={28} className="text-brand" />
      </div>
      <div className="text-center">
        <div className="font-bold text-ink text-lg">{title}</div>
        <div className="text-ink-muted text-sm mt-1">מודול זה בפיתוח — יגיע בקרוב</div>
      </div>
    </div>
  );
}
