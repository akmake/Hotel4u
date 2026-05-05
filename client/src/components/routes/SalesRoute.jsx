import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

const SalesRoute = () => {
  const { user, isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // רק מנהל או איש מכירות מורשים
  if (user?.role === 'admin' || user?.role === 'sales') {
    return <Outlet />;
  }

  // ✅ תיקון: הפניה ל-/ (דף הבית) במקום ל-/maintenance
  // כל תפקיד יקבל את ה-redirect המתאים לו מהנתיבים המוגנים שלו
  return <Navigate to="/" replace />;
};

export default SalesRoute;