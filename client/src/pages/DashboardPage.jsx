import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { dashboard, platform } from '../utils/api';
import DailyWorkspace from '../components/frontdesk/DailyWorkspace';
import ReservationDrawer from '../components/reservations/ReservationDrawer';

export default function DashboardPage() {
  const { propertyId, property } = useProperty() || {};
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const deps = [propertyId, revision];
  const skip = !propertyId;
  const stats = useApi(() => dashboard.stats(propertyId), deps, skip);
  const arrivals = useApi(() => dashboard.arrivals(propertyId), deps, skip);
  const departures = useApi(() => dashboard.departures(propertyId), deps, skip);
  const alerts = useApi(() => dashboard.alerts(propertyId), deps, skip);
  const work = useApi(() => platform.work(propertyId, { status: 'open' }), deps, skip);
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible') setRevision(v => v + 1); }, 60000); return () => clearInterval(timer); }, []);
  const refresh = () => setRevision(v => v + 1);
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday:'long', day:'numeric', month:'long' }).format(new Date());
  const alertAction = a => {
    if (a.reservationId) { setSelected(a.reservationId); return; }
    const routes = { maintenance:'/pms/maintenance', housekeeping:'/pms/housekeeping', payments:'/pms/folio', rooms:'/pms/tape-chart', channels:'/pms/channel-manager' };
    navigate(routes[a.category] || '/pms/work');
  };
  if (skip) return <div className="reception-message">יש לבחור נכס כדי להציג את יום העבודה.</div>;
  return <>
    <DailyWorkspace property={property} date={date} stats={stats} arrivals={arrivals} departures={departures} alerts={alerts} work={work} refresh={refresh} navigate={navigate} onOpen={setSelected} onAlert={alertAction}/>
    {selected && <ReservationDrawer propertyId={propertyId} reservationId={selected} onChanged={refresh} onClose={() => { setSelected(null); refresh(); }}/>} 
  </>;
}
