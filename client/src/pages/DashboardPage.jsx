import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProperty } from '../context/PropertyContext';
import { useAuthStore } from '../stores/authStore';
import { useApi } from '../hooks/useApi';
import { dashboard, platform, frontdesk, ops } from '../utils/api';
import DailyWorkspace from '../components/frontdesk/DailyWorkspace';
import StayDialog from '../components/frontdesk/StayDialog';
import CheckInWizard from '../components/frontdesk/CheckInWizard';
import CheckOutWizard from '../components/frontdesk/CheckOutWizard';
import AssignRoomDialog from '../components/frontdesk/AssignRoomDialog';
import QueueDialog from '../components/frontdesk/QueueDialog';

const MANAGER_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager'];
const REFUND_ROLES = [...MANAGER_ROLES, 'finance_manager'];

export default function DashboardPage() {
  const { propertyId, property } = useProperty() || {};
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  // Arrivals open the check-in wizard right here — no side panel in between.
  const [checkinId, setCheckinId] = useState(null);
  const [checkoutId, setCheckoutId] = useState(null);
  const [checkinUnits, setCheckinUnits] = useState(undefined); // undefined = the ready ones; [n] = only those rooms
  const openCheckIn = (id, units) => { setCheckinUnits(units); setCheckinId(id); };
  const [assignRow, setAssignRow] = useState(null);
  const [queueRow, setQueueRow] = useState(null);
  const [wizardReload, setWizardReload] = useState(null);
  const deps = [propertyId, revision];
  const skip = !propertyId;
  const stats = useApi(() => dashboard.stats(propertyId), deps, skip);
  const arrivals = useApi(() => frontdesk.arrivals(propertyId, { pageSize: 100, includeCheckedIn: '1', sort: 'eta' }), deps, skip);
  const departures = useApi(() => frontdesk.departures(propertyId, { pageSize: 100 }), deps, skip);
  const alerts = useApi(() => dashboard.alerts(propertyId), deps, skip);
  const inhouse = useApi(() => frontdesk.inHouse(propertyId, { pageSize: 100 }), deps, skip);
  const tickets = useApi(() => ops.tickets(propertyId), deps, skip);
  const work = useApi(() => platform.work(propertyId, { status: 'open' }), deps, skip);
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible' && !checkinId && !checkoutId) setRevision(v => v + 1); }, 60000); return () => clearInterval(timer); }, [checkinId, checkoutId]);
  const refresh = () => setRevision(v => v + 1);
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday:'long', day:'numeric', month:'long' }).format(new Date());
  const alertAction = a => {
    if (a.reservationId) { setSelected(a.reservationId); return; }
    const routes = { maintenance:'/pms/maintenance', housekeeping:'/pms/housekeeping', payments:'/pms/folio', rooms:'/pms/tape-chart', channels:'/pms/channel-manager' };
    navigate(routes[a.category] || '/pms/work');
  };
  if (skip) return <div className="dk-state">יש לבחור נכס כדי להציג את יום העבודה.</div>;
  const isManager = MANAGER_ROLES.includes(user?.role);
  return <>
    <DailyWorkspace propertyId={propertyId} property={property} date={date} stats={stats} arrivals={arrivals} departures={departures} alerts={alerts} work={work} tickets={tickets} inhouse={inhouse} onOpen={setSelected} refresh={refresh} navigate={navigate} onOpen={setSelected} onCheckIn={openCheckIn} onCheckOut={setCheckoutId} onAssign={setAssignRow} onQueue={setQueueRow} onAlert={alertAction}/>
    <StayDialog
      open={!!selected}
      propertyId={propertyId}
      onChanged={refresh}
      reservationId={selected}
      onClose={() => { setSelected(null); refresh(); }}
      onCheckIn={(id) => { setSelected(null); openCheckIn(String(id), undefined); }}
      onCheckOut={(id) => { setSelected(null); setCheckoutId(String(id)); }}
    />
    <CheckInWizard
      open={!!checkinId}
      propertyId={propertyId}
      reservationId={checkinId}
      initialUnits={checkinUnits}
      isManager={isManager}
      onClose={() => { setCheckinId(null); refresh(); }}
      onDone={() => { setCheckinId(null); refresh(); }}
      onAssign={(row, reload) => { setAssignRow(row); setWizardReload(() => reload); }}
      onQueue={(row, reload) => { setQueueRow(row); setWizardReload(() => reload); }}
    />
    <CheckOutWizard
      open={!!checkoutId}
      propertyId={propertyId}
      reservationId={checkoutId}
      isManager={isManager || user?.role === 'finance_manager'}
      canRefund={REFUND_ROLES.includes(user?.role)}
      initialEarlyReason=""
      onClose={() => { setCheckoutId(null); refresh(); }}
      onDone={() => { setCheckoutId(null); refresh(); }}
    />
    <AssignRoomDialog
      open={!!assignRow}
      propertyId={propertyId}
      row={assignRow}
      onClose={() => { setAssignRow(null); setWizardReload(null); }}
      onAssigned={() => { setAssignRow(null); refresh(); wizardReload?.(); setWizardReload(null); }}
    />
    <QueueDialog
      open={!!queueRow}
      propertyId={propertyId}
      row={queueRow}
      currentUser={user}
      isManager={isManager}
      onClose={() => { setQueueRow(null); setWizardReload(null); }}
      onQueued={() => { setQueueRow(null); refresh(); wizardReload?.(); setWizardReload(null); }}
    />
  </>;
}
