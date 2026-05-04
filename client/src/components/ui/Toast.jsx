import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';

const CONFIG = {
  success: { icon: CheckCircle2, bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' },
  error:   { icon: AlertCircle,  bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
  warning: { icon: AlertTriangle,bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
};

export function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', zIndex:9999, display:'flex', flexDirection:'column', gap:8, alignItems:'center', pointerEvents:'none' }}>
      {toasts.map(t => {
        const { icon: Icon, bg, border, color } = CONFIG[t.type] || CONFIG.success;
        return (
          <div
            key={t.id}
            className="animate-slide-in"
            style={{ background: bg, border: `1px solid ${border}`, color, borderRadius:10, padding:'10px 16px', display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600, boxShadow:'0 4px 16px rgba(0,0,0,0.12)', minWidth:220, maxWidth:380, pointerEvents:'auto' }}
          >
            <Icon size={15} style={{ flexShrink:0 }} />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
