export function Spinner({ size = 20, className = '' }) {
  return (
    <div
      className={className}
      style={{ width: size, height: size, border: '2px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }}
    />
  );
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64 gap-3 text-ink-muted">
      <Spinner size={24} />
      <span className="text-sm">טוען...</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-ink-muted">
      <div className="text-2xl">⚠️</div>
      <div className="text-sm font-medium text-ink-secondary text-center max-w-xs">{message}</div>
      {onRetry && <button className="btn btn-secondary btn-sm" onClick={onRetry}>נסה שוב</button>}
    </div>
  );
}

// Add spin keyframe globally once
if (typeof document !== 'undefined' && !document.getElementById('spin-kf')) {
  const s = document.createElement('style');
  s.id = 'spin-kf';
  s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}
