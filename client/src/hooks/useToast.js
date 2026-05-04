import { useState, useCallback } from 'react';

let _id = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'success') => {
    const id = ++_id;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const success = useCallback(msg => toast(msg, 'success'), [toast]);
  const error   = useCallback(msg => toast(msg, 'error'),   [toast]);
  const warn    = useCallback(msg => toast(msg, 'warning'), [toast]);

  return { toasts, toast, success, error, warn };
}
