import { Suspense, lazy } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';

const DashboardPage    = lazy(() => import('./pages/DashboardPage'));
const RoomRackPage     = lazy(() => import('./pages/RoomRackPage'));
const ReservationsPage = lazy(() => import('./pages/ReservationsPage'));
const CheckInPage      = lazy(() => import('./pages/CheckInPage'));
const CheckOutPage     = lazy(() => import('./pages/CheckOutPage'));
const RoomsPage        = lazy(() => import('./pages/RoomsPage'));
const HousekeepingPage = lazy(() => import('./pages/HousekeepingPage'));
const MaintenancePage  = lazy(() => import('./pages/MaintenancePage'));
const GuestsPage       = lazy(() => import('./pages/GuestsPage'));
const FolioPage        = lazy(() => import('./pages/FolioPage'));
const ReportsPage      = lazy(() => import('./pages/ReportsPage'));
const NightAuditPage   = lazy(() => import('./pages/NightAuditPage'));
const RatesPage        = lazy(() => import('./pages/RatesPage'));
const SettingsPage     = lazy(() => import('./pages/SettingsPage'));
const CompaniesPage    = lazy(() => import('./pages/CompaniesPage'));
const PlaceholderPage  = lazy(() => import('./pages/PlaceholderPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index                 element={<DashboardPage />} />
          <Route path="room-rack"      element={<RoomRackPage />} />
          <Route path="reservations"   element={<ReservationsPage />} />
          <Route path="check-in"       element={<CheckInPage />} />
          <Route path="check-out"      element={<CheckOutPage />} />
          <Route path="rooms"          element={<RoomsPage />} />
          <Route path="housekeeping"   element={<HousekeepingPage />} />
          <Route path="maintenance"    element={<MaintenancePage />} />
          <Route path="guests"         element={<GuestsPage />} />
          <Route path="folio"          element={<FolioPage />} />
          <Route path="companies"      element={<CompaniesPage />} />
          <Route path="reports"        element={<ReportsPage />} />
          <Route path="night-audit"    element={<NightAuditPage />} />
          <Route path="rates"          element={<RatesPage />} />
          <Route path="settings"       element={<SettingsPage />} />
          <Route path="*"              element={<DashboardPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
