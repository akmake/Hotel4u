import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, Navigate, Outlet, useLocation } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { useAuthStore } from './stores/authStore';
import { useChatStore } from './stores/chatStore';
import AutoLogout from './components/AutoLogout';
import PushNotificationManager from './components/PushNotificationManager';

// ── Public pages ──────────────────────────────────────────────────────────────
import LoginPage from './pages/LoginPage';
const ResetPasswordPage = lazy(() => import('./pages/sys/ResetPasswordPage'));
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
const ReservationsPage     = lazy(() => import('./pages/rsv/ReservationsListPage'));
const NewReservationPage   = lazy(() => import('./pages/rsv/BookingWizardPage'));
const ReservationPage      = lazy(() => import('./pages/rsv/ReservationPage'));
const ArrivalsPage         = lazy(() => import('./pages/ArrivalsPage'));
const ArrivalQueuePage     = lazy(() => import('./pages/ArrivalQueuePage'));
const InHousePage          = lazy(() => import('./pages/InHousePage'));
const DeparturesPage       = lazy(() => import('./pages/DeparturesPage'));
const RoomsPage            = lazy(() => import('./pages/RoomsPage'));
const HousekeepingBoardPage = lazy(() => import('./pages/ops/HousekeepingBoardPage'));
const MyTasksPage          = lazy(() => import('./pages/ops/MyTasksPage'));
const InspectionPage       = lazy(() => import('./pages/ops/InspectionPage'));
const OpsRoomStatusPage    = lazy(() => import('./pages/ops/RoomStatusPage'));
const LostFoundPage        = lazy(() => import('./pages/ops/LostFoundPage'));
const MaintenancePage      = lazy(() => import('./pages/ops/MaintenancePage'));
const GuestsPage           = lazy(() => import('./pages/GuestsPage'));
const FolioPage            = lazy(() => import('./pages/fin/FolioPage'));
const CompaniesPage        = lazy(() => import('./pages/CompaniesPage'));
const LeadInboxPage        = lazy(() => import('./pages/LeadInboxPage'));
const OpportunityBoardPage = lazy(() => import('./pages/OpportunityBoardPage'));
const ReportsPage          = lazy(() => import('./pages/ReportsPage'));
const InvoicesPage         = lazy(() => import('./pages/InvoicesPage'));
const DayClosePage         = lazy(() => import('./pages/fin/DayClosePage'));
const DayReportPage        = lazy(() => import('./pages/fin/DayReportPage'));
const ChargeCodesPage      = lazy(() => import('./pages/sys/ChargeCodesPage'));
const BulkJobsPage              = lazy(() => import('./pages/BulkJobsPage'));
const RatesPage                 = lazy(() => import('./pages/RatesPage'));
const AutomationRulesPage       = lazy(() => import('./pages/AutomationRulesPage'));
const ChannelManagerPage        = lazy(() => import('./pages/ChannelManagerPage'));
const SettingsPage              = lazy(() => import('./pages/SettingsPage'));
const UsersAdminPage            = lazy(() => import('./pages/sys/UsersAdminPage'));
const PolicyPage                = lazy(() => import('./pages/sys/PolicyPage'));
const AuditPage                 = lazy(() => import('./pages/sys/AuditPage'));
const ProfilePage               = lazy(() => import('./pages/sys/ProfilePage'));
const WorkCenterPage            = lazy(() => import('./pages/sys/WorkCenterPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthGate({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  // remember where the user was going so login can return them there
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

// Roles that can only access specific PMS sections (first entry is their home).
const PMS_ROLE_SECTIONS = {
  maintenance: ['/pms/maintenance', '/pms/work', '/pms/me'],
  technician:  ['/pms/maintenance', '/pms/housekeeping/rooms', '/pms/work', '/pms/me'],
  housekeeper: ['/pms/housekeeping', '/pms/work', '/pms/me'],
};

function PmsRoleGuard() {
  const { user } = useAuthStore();
  const { pathname } = useLocation();
  const allowed = user?.role ? PMS_ROLE_SECTIONS[user.role] : undefined;
  if (allowed && !allowed.some((p) => pathname.startsWith(p))) {
    return <Navigate to={allowed[0]} replace />;
  }
  return <Outlet />;
}

// /pms/housekeeping lands each role on the view it works in (OPS-01 is for supervisors/desk).
function HousekeepingHome() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'housekeeper') return <Navigate to="/pms/housekeeping/my" replace />;
  if (['technician', 'maintenance_manager'].includes(role)) return <Navigate to="/pms/housekeeping/rooms" replace />;
  return <HousekeepingBoardPage />;
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
          <Route path="/reset-password" element={<ResetPasswordPage />} />
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
              <Route path="reservations/:id"  element={<ReservationPage />} />
              <Route path="arrivals"          element={<ArrivalsPage />} />
              <Route path="arrival-queue"     element={<ArrivalQueuePage />} />
              <Route path="check-in"          element={<Navigate to="/pms/arrivals" replace />} />
              <Route path="in-house"          element={<InHousePage />} />
              <Route path="departures"        element={<DeparturesPage />} />
              <Route path="check-out"         element={<Navigate to="/pms/departures" replace />} />
              <Route path="rooms"             element={<RoomsPage />} />
              <Route path="housekeeping"      element={<HousekeepingHome />} />
              <Route path="housekeeping/my"   element={<MyTasksPage />} />
              <Route path="housekeeping/inspection" element={<InspectionPage />} />
              <Route path="housekeeping/rooms" element={<OpsRoomStatusPage />} />
              <Route path="housekeeping/lost-found" element={<LostFoundPage />} />
              <Route path="maintenance"       element={<MaintenancePage />} />
              <Route path="guests"            element={<GuestsPage />} />
              <Route path="folio"             element={<FolioPage />} />
              <Route path="invoices"          element={<InvoicesPage />} />
              <Route path="companies"         element={<CompaniesPage />} />
              <Route path="leads"             element={<LeadInboxPage />} />
              <Route path="opportunities"     element={<OpportunityBoardPage />} />
              <Route path="reports"           element={<ReportsPage />} />
              <Route path="night-audit"       element={<DayClosePage />} />
              <Route path="night-audit/report" element={<DayReportPage />} />
              <Route path="bulk-jobs"         element={<BulkJobsPage />} />
              <Route path="rates"             element={<RatesPage />} />
              <Route path="automation"        element={<AutomationRulesPage />} />
              <Route path="channel-manager"   element={<ChannelManagerPage />} />
              <Route path="settings"          element={<SettingsPage />} />
              <Route path="admin/users"       element={<UsersAdminPage />} />
              <Route path="admin/policy"      element={<PolicyPage />} />
              <Route path="admin/audit"       element={<AuditPage />} />
              <Route path="admin/charge-codes" element={<ChargeCodesPage />} />
              <Route path="me"                element={<ProfilePage />} />
              <Route path="work"              element={<WorkCenterPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
