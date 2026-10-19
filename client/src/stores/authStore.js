import { create } from 'zustand';
import api from '@/utils/api.js';

const getSavedUser = () => {
  try {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
};

function saveUser(user) {
  localStorage.setItem('user', JSON.stringify({
    _id: user._id,
    name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    role: user.role,
    propertyId: user.propertyId || null,
  }));
}

export const useAuthStore = create((set, get) => ({
  user: getSavedUser(),
  isAuthenticated: !!getSavedUser(),
  isLoading: false,
  error: null,

  login: async (credentials) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/auth/login', credentials);
      const outer = response.data || response;
      // Support { data: { token, user } } (new) and { user } (old fallback)
      const payload = outer.data || outer;
      if (payload.mfaRequired) { set({ isLoading: false }); return { mfaRequired: true, ticket: payload.mfaTicket }; }
      const user    = payload.user || outer.user;
      const token   = payload.token;

      if (!user) throw new Error('התחברות נכשלה: לא התקבלו פרטי משתמש מהשרת');

      if (token) localStorage.setItem('hotel4u_token', token);
      saveUser(user);

      set({ isAuthenticated: true, user, isLoading: false, error: null });
      return user;
    } catch (error) {
      const message = error.response?.data?.error || error.response?.data?.message || error.message || 'שגיאה בהתחברות';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  verifyMfa: async (ticket, code) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/auth/mfa', { ticket, code });
      const outer = response.data || response;
      const payload = outer.data || outer;
      if (!payload.user) throw new Error('התחברות נכשלה');
      if (payload.token) localStorage.setItem('hotel4u_token', payload.token);
      saveUser(payload.user);
      set({ isAuthenticated: true, user: payload.user, isLoading: false, error: null });
      return payload.user;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      localStorage.removeItem('hotel4u_token');
      set({ isAuthenticated: false, user: null, error: null });
      window.location.href = '/login';
    }
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      // Try cookie-based auth first (works for Ziporiclass + PMS if cookies are fresh)
      const response = await api.get('/auth/me');
      const data = response.data || response;
      const user = data.data || data;

      if (user && user._id) {
        if (data.token) localStorage.setItem('hotel4u_token', data.token);
        saveUser(user);
        set({ isAuthenticated: true, user, isLoading: false });
        return;
      }
      throw new Error('No user data');
    } catch {
      // Cookie auth failed — try Bearer token from localStorage
      const token = localStorage.getItem('hotel4u_token');
      if (token) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const user = await res.json();
            if (user?._id) {
              saveUser(user);
              set({ isAuthenticated: true, user, isLoading: false });
              return;
            }
          }
        } catch {}
      }
      // Both auth methods failed
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      localStorage.removeItem('hotel4u_token');
      set({ isAuthenticated: false, user: null, isLoading: false });
    }
  },
}));
