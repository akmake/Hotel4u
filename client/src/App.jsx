import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, Navigate, Outlet, useLocation } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { useAuthStore } from './stores/authStore';
import { useChatStore } from './stores/chatStore';
import AutoLogout from './components/AutoLogout';
import PushNotificationManager from './components/PushNotificationManager';

// ── Public pages ──────────────────────────────────────────────────────────────
import LoginPage from './pages/LoginPage';
const QuotePage = lazy(() => import('./pages/QuotePage'));
const OrderConfirmationPage = lazy(() => import('./pages/OrderConfirmationPage'));

// ── ziporiclass — Sales ───────────────────────────────────────────────────────
const HomePage          = lazy(() => import('./pages/HomePage'));
const OrdersPage        = lazy(() => import('./pages/OrdersPage'));
const OrderPage         = lazy(() => import('./pages/OrderPage'));
const EditOrderPage     = lazy(() => import('./pages/EditOrderPage'));
const LeadsPage         = lazy(() => import('./pages/LeadsPage'));
const PricingLogicPage  = lazy(() => import('./pages/PricingLogicPage'));
const WhatsAppPage      = lazy(() => import('./pages/WhatsAppPage'));
const ExcelImportPage   = lazy(() => import('./pages/ExcelImportPage'));

// ── ziporiclass — Operations ──────────────────────────────────────────────────
const ChatPage               = lazy(() => import('./pages/ChatPage'));
const HousekeepingManager    = lazy(() => import('./pages/HousekeepingManager'));
const HousekeeperView        = lazy(() => import('./pages/maintenance/HousekeeperView'));

// ── ziporiclass — Admin ───────────────────────────────────────────────────────
const AdminDashboardPage       = lazy(() => import('./pages/admin/AdminDashboardPage'));
const AdminDailyDashboard      = lazy(() => import('./pages/admin/AdminDailyDashboard'));
const AdminCalendarPage        = lazy(() => import('./pages/admin/AdminCalendarPage'));
const AdminMaintenanceDashboard= lazy(() => import('./pages/admin/AdminMaintenanceDashboard'));
const ManageOrdersPage         = lazy(() => import('./pages/admin/ManageOrdersPage'));
const ManageUsersPage          = lazy(() => import('./pages/admin/ManageUsersPage'));
const ManageHotelsPage         = lazy(() => import('./pages/admin/ManageHotelsPage'));
const ManagePhysicalRoomsPage  = lazy(() => import('./pages/admin/ManagePhysicalRoomsPage'));
const RoomStatusPage           = lazy(() => import('./pages/admin/RoomStatusPage'));
const RoomAssignmentPage       = lazy(() => import('./pages/admin/RoomAssignmentPage'));
const ManagePriceListsPage     = lazy(() => import('./pages/admin/ManagePriceListsPage'));
const ManageAnnouncementsPage  = lazy(() => import('./pages/admin/ManageAnnouncementsPage'));
const ManageReferrersPage      = lazy(() => import('./pages/admin/ManageReferrersPage'));
const ManageExtrasPage         = lazy(() => import('./pages/admin/ManageExtrasPage'));
const ManageTriggersPage       = lazy(() => import('./pages/admin/ManageTriggersPage'));
const ManageAutoRepliesPage    = lazy(() => import('./pages/admin/ManageAutoRepliesPage'));
const AuditLogsPage            = lazy(() => import('./pages/admin/AuditLogsPage'));
const CommissionsPage          = lazy(() => import('./pages/admin/CommissionsPage'));
const AffiliateReportsPage     = lazy(() => import('./pages/admin/AffiliateReportsPage'));
const BookingManagementPage    = lazy(() => import('./pages/admin/BookingManagementPage'));
const CustomerLookupPage       = lazy(() => import('./pages/admin/CustomerLookupPage'));
const SalesPerformancePage     = lazy(() => import('./pages/admin/SalesPerformancePage'));

// ── hotel4u PMS (future) ──────────────────────────────────────────────────────
const DashboardPage        = lazy(() => import('./pages/DashboardPage'));
const TapeChartPage        = lazy(() => import('./pages/TapeChartPage'));
const RoomRackPage         = lazy(() => import('./pages/RoomRackPage'));
const ReservationsPage     = lazy(() => import('./pages/ReservationsPage'));
const NewReservationPage   = lazy(() => import('./pages/NewReservationPage'));
const CheckInPage          = lazy(() => import('./pages/CheckInPage'));
const CheckOutPage         = lazy(() => import('./pages/CheckOutPage'));
const RoomsPage            = lazy(() => import('./pages/RoomsPage'));
const HousekeepingPage     = lazy(() => import('./pages/HousekeepingPage'));
const MaintenancePage      = lazy(() => import('./pages/MaintenancePage'));
const GuestsPage           = lazy(() => import('./pages/GuestsPage'));
const FolioPage            = lazy(() => import('./pages/FolioPage'));
const CompaniesPage        = lazy(() => import('./pages/CompaniesPage'));
const LeadInboxPage        = lazy(() => import('./pages/LeadInboxPage'));
const OpportunityBoardPage = lazy(() => import('./pages/OpportunityBoardPage'));
const ReportsPage          = lazy(() => import('./pages/ReportsPage'));
const InvoicesPage         = lazy(() => import('./pages/InvoicesPage'));
const NightAuditPage       = lazy(() => import('./pages/NightAuditPage'));
const BulkJobsPage              = lazy(() => import('./pages/BulkJobsPage'));
const RatesPage                 = lazy(() => import('./pages/RatesPage'));
const AutomationRulesPage       = lazy(() => import('./pages/AutomationRulesPage'));
const SettingsPage              = lazy(() => import('./pages/SettingsPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthGate({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

// Roles that can only access specific PMS pages
const PMS_ROLE_REDIRECT = {
  maintenance: '/pms/maintenance',
  housekeeper: '/pms/housekeeping',
};

function PmsRoleGuard() {
  const { user } = useAuthStore();
  const { pathname } = useLocation();
  const redirectTo = user?.role ? PMS_ROLE_REDIRECT[user.role] : undefined;
  if (redirectTo && !pathname.startsWith(redirectTo)) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
}

export default function App() {
  const { user, checkAuth } = useAuthStore();
  const { initializeSocket, disconnectSocket, fetchContacts } = useChatStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (user?._id) {
      fetchContacts();
      initializeSocket(user._id);
    } else {
      disconnectSocket();
    }
  }, [user]);

  return (
    <>
      <PushNotificationManager />
      <AutoLogout />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/quote/:orderId" element={<QuotePage />} />

          {/* Protected — all inside AppShell */}
          <Route element={<AuthGate><AppShell /></AuthGate>}>

            {/* ── ziporiclass — Main ── */}
            <Route index element={<HomePage />} />
            <Route path="new-order"                       element={<OrderPage />} />
            <Route path="orders-history"                  element={<OrdersPage />} />
            <Route path="edit-order/:orderId"             element={<EditOrderPage />} />
            <Route path="leads"                           element={<LeadsPage />} />
            <Route path="sales-guide"                     element={<PricingLogicPage />} />
            <Route path="whatsapp"                        element={<WhatsAppPage />} />
            <Route path="chat"                            element={<ChatPage />} />
            <Route path="excel-import"                    element={<ExcelImportPage />} />
            <Route path="order-confirmation/:orderId"     element={<OrderConfirmationPage />} />
            <Route path="manage-pricelists"               element={<ManagePriceListsPage />} />
            <Route path="bookings"                        element={<BookingManagementPage />} />
            <Route path="housekeeping-mgr"                element={<HousekeepingManager />} />
            <Route path="maintenance-worker"              element={<HousekeeperView />} />

            {/* ── ziporiclass — Admin ── */}
            <Route path="admin">
              <Route index                  element={<AdminDashboardPage />} />
              <Route path="daily-plan"      element={<AdminDailyDashboard />} />
              <Route path="calendar"        element={<AdminCalendarPage />} />
              <Route path="maintenance"     element={<AdminMaintenanceDashboard />} />
              <Route path="orders"          element={<ManageOrdersPage />} />
              <Route path="users"           element={<ManageUsersPage />} />
              <Route path="hotels"          element={<ManageHotelsPage />} />
              <Route path="rooms/create"    element={<ManagePhysicalRoomsPage />} />
              <Route path="rooms-status"    element={<RoomStatusPage />} />
              <Route path="room-assignment" element={<RoomAssignmentPage />} />
              <Route path="announcements"   element={<ManageAnnouncementsPage />} />
              <Route path="referrers"       element={<ManageReferrersPage />} />
              <Route path="extras"          element={<ManageExtrasPage />} />
              <Route path="triggers"        element={<ManageTriggersPage />} />
              <Route path="auto-replies"    element={<ManageAutoRepliesPage />} />
              <Route path="audit-logs"      element={<AuditLogsPage />} />
              <Route path="commissions"     element={<CommissionsPage />} />
              <Route path="affiliates"      element={<AffiliateReportsPage />} />
              <Route path="customer-lookup" element={<CustomerLookupPage />} />
              <Route path="performance"     element={<SalesPerformancePage />} />
            </Route>

            {/* ── hotel4u PMS (future) ── */}
            <Route path="pms" element={<PmsRoleGuard />}>
              <Route index                    element={<DashboardPage />} />
              <Route path="tape-chart"        element={<TapeChartPage />} />
              <Route path="room-rack"         element={<RoomRackPage />} />
              <Route path="reservations"      element={<ReservationsPage />} />
              <Route path="reservations/new"  element={<NewReservationPage />} />
              <Route path="check-in"          element={<CheckInPage />} />
              <Route path="check-out"         element={<CheckOutPage />} />
              <Route path="rooms"             element={<RoomsPage />} />
              <Route path="housekeeping"      element={<HousekeepingPage />} />
              <Route path="maintenance"       element={<MaintenancePage />} />
              <Route path="guests"            element={<GuestsPage />} />
              <Route path="folio"             element={<FolioPage />} />
              <Route path="invoices"          element={<InvoicesPage />} />
              <Route path="companies"         element={<CompaniesPage />} />
              <Route path="leads"             element={<LeadInboxPage />} />
              <Route path="opportunities"     element={<OpportunityBoardPage />} />
              <Route path="reports"           element={<ReportsPage />} />
              <Route path="night-audit"       element={<NightAuditPage />} />
              <Route path="bulk-jobs"         element={<BulkJobsPage />} />
              <Route path="rates"             element={<RatesPage />} />
              <Route path="automation"        element={<AutomationRulesPage />} />
              <Route path="settings"          element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
