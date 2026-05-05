import { create } from 'zustand';
import api from '@/utils/api.js';

// ✅ תיקון: שומרים רק מידע מינימלי ב-localStorage (בלי role/email מלאים)
const getSavedUser = () => {
  try {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
};

export const useAuthStore = create((set, get) => ({
  user: getSavedUser(),
  isAuthenticated: !!getSavedUser(),
  isLoading: false,
  error: null,

  login: async (credentials) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/auth/login', credentials);
      const data = response.data || response;

      // בדיקה שחזרו פרטי משתמש (הטוקן ב-Cookie)
      if (!data || !data.user) {
        throw new Error('התחברות נכשלה: לא התקבלו פרטי משתמש מהשרת');
      }

      // ✅ תיקון: שמירת מינימום הכרחי בלבד ב-localStorage
      // ה-user המלא נשמר רק ב-memory (Zustand state)
      localStorage.setItem('user', JSON.stringify({
        _id: data.user._id,
        name: data.user.name,
        role: data.user.role,
      }));

      set({
        isAuthenticated: true,
        user: data.user,
        isLoading: false,
        error: null
      });

      return data.user;
    } catch (error) {
      console.error('Login error:', error);
      const message = error.response?.data?.message || error.message || 'שגיאה בהתחברות';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      set({ isAuthenticated: false, user: null, error: null });
      window.location.href = '/login';
    }
  },

  // checkAuth — מרענן את פרטי המשתמש מהשרת (Cookie-based)
  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const response = await api.get('/auth/me');
      const data = response.data || response;
      const user = data.data || data;

      if (user && user._id) {
          set({ isAuthenticated: true, user: user, isLoading: false });
          // ✅ תיקון: שמירה מינימלית
          localStorage.setItem('user', JSON.stringify({
            _id: user._id,
            name: user.name,
            role: user.role,
          }));
      } else {
          throw new Error('No user data');
      }
    } catch (error) {
      set({ isAuthenticated: false, user: null, isLoading: false });
      localStorage.removeItem('user');
      localStorage.removeItem('token');
    }
  }
}));