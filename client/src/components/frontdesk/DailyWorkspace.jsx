import { ArrowLeft, RefreshCw, Plus, CalendarDays, LogIn, LogOut, ClipboardList, AlertCircle, BedDouble, CheckCircle2 } from 'lucide-react';

const nameOf = r => [r.primaryGuest?.firstName, r.primaryGuest?.lastName].filter(Boolean).join(' ') || 'אורח';
function ready(r) {
  if (!r.assignedRoom) return ['ללא שיבוץ חדר', 'danger'];
  if ((r.assignedRoom.opsStatus && r.assignedRoom.opsStatus !== 'available') || !['clean', 'inspected'].includes(r.assignedRoom.cleanStatus)) return ['חדר לא מוכן', 'warning'];
  return ['חדר מוכן', 'success'];
}
function QueryState({ query, children, empty }) {
  if (query.error) return <div className="reception-state" role="alert">המידע לא נטען<button type="button" onClick={query.refetch}>ניסיון נוסף</button></div>;
  if (query.loading && !query.data) return <div className="reception-state">טוען מידע…</div>;
  return children || <div className="reception-state"><CheckCircle2 size={19}/>{empty}</div>;
}
function GuestList({ query, departure, onOpen, navigate }) {
  const rows = [...(query.data || [])];
  if (!departure) rows.sort((a,b) => Number(ready(a)[1] === 'success') - Number(ready(b)[1] === 'success'));
  else rows.sort((a,b) => Number(a.paymentStatus === 'paid') - Number(b.paymentStatus === 'paid'));
  const Icon = departure ? LogOut : LogIn;
  return <section className="reception-section">
    <header className="reception-section-head"><div><span className={`reception-section-icon ${departure ? 'departure' : ''}`}><Icon size={20}/></span><div><h2>{departure ? 'עזיבות היום' : 'הגעות היום'}<span>{query.error || !query.data ? '—' : rows.length}</span></h2><p>{departure ? 'חשבונות ויציאות הממתינים לטיפול' : 'שיבוץ חדרים והכנה לקבלת האורחים'}</p></div></div><button type="button" onClick={() => navigate(departure ? '/pms/departures' : '/pms/arrivals')}>לרשימה המלאה <ArrowLeft size={14}/></button></header>
    <QueryState query={query} empty={departure ? 'אין עזיבות הממתינות לטיפול היום.' : 'אין הגעות הממתינות לקבלה היום.'}>
      {rows.length ? <div className="reception-guest-list"><div className="reception-guest-columns"><span>אורח</span><span>חדר</span><span>{departure ? 'חשבון' : 'מוכנות'}</span><span/></div>{rows.map(r => {
        const [status,tone] = departure ? [r.paymentStatus === 'paid' ? 'שולם' : 'בדיקת חשבון', r.paymentStatus === 'paid' ? 'success' : 'warning'] : ready(r);
        return <button type="button" className="reception-guest-row" key={r._id} onClick={() => onOpen(r._id)}><span className="reception-guest-name"><strong>{nameOf(r)}</strong><small>{r.confirmationNumber || 'הזמנה'}{r.roomType?.name ? ` · ${r.roomType.name}` : ''}</small></span><span className="reception-room-number">{r.assignedRoom?.number || '—'}</span><span className={`reception-status ${tone}`}>{status}</span><ArrowLeft size={15}/></button>;
      })}</div> : null}
    </QueryState>
  </section>;
}
export default function DailyWorkspace({ property, date, stats, arrivals, departures, alerts, work, refresh, navigate, onOpen, onAlert }) {
  const issues = [...(alerts.data || [])].sort((a,b) => Number(b.type === 'danger') - Number(a.type === 'danger'));
  const notes = (work.data?.rows || []).filter(w => w.kind === 'handover');
  const metric = (query, key) => query.error || query.data == null ? '—' : key ? query.data[key] ?? '—' : query.data.length;
  return <div className="reception-workspace" dir="rtl">
    <header className="reception-topbar"><div><span className="reception-eyebrow">{property?.name || 'קבלת המלון'} · {date}</span><h1>היום בקבלה</h1><p>תמונת היום, האורחים והדברים שצריך לקדם — במקום אחד.</p></div><nav aria-label="פעולות קבלה"><button type="button" className="reception-refresh" onClick={refresh} aria-label="רענון מידע" title="רענון מידע"><RefreshCw size={17}/></button><button type="button" onClick={() => navigate('/pms/tape-chart')}><CalendarDays size={17}/>לוח חדרים</button><button type="button" className="reception-primary" onClick={() => navigate('/pms/reservations/new')}><Plus size={18}/>הזמנה חדשה</button></nav></header>
    <section className="reception-overview" aria-label="מצב המלון">
      {[{label:'ממתינים להגעה',value:metric(arrivals),Icon:LogIn,route:'/pms/arrivals'},{label:'ממתינים לעזיבה',value:metric(departures),Icon:LogOut,route:'/pms/departures'},{label:'שוהים במלון',value:metric(stats,'inHouse'),Icon:BedDouble,route:'/pms/in-house'},{label:'חדרים נקיים',value:metric(stats,'cleanRooms'),Icon:CheckCircle2,route:'/pms/housekeeping'}].map(({label,value,Icon,route}) => <button type="button" key={label} onClick={() => navigate(route)}><span className="reception-metric-label"><Icon size={18}/>{label}</span><strong>{value}</strong></button>)}
    </section>
    {stats.error && <div className="reception-state" role="alert">נתוני הסיכום לא נטענו<button type="button" onClick={stats.refetch}>ניסיון נוסף</button></div>}
    <div className="reception-content">
      <main className="reception-guests"><GuestList query={arrivals} onOpen={onOpen} navigate={navigate}/><GuestList query={departures} departure onOpen={onOpen} navigate={navigate}/></main>
      <aside className="reception-day-notes">
        <section className="reception-section reception-attention"><header className="reception-section-head"><div><span className="reception-section-icon attention"><AlertCircle size={20}/></span><div><h2>דורש טיפול<span>{alerts.error || !alerts.data ? '—' : issues.length}</span></h2><p>הנושאים שכדאי לקדם קודם</p></div></div></header><QueryState query={alerts} empty="אין התראות פתוחות כרגע.">{issues.length ? <div>{issues.map(a => <button type="button" className="reception-issue" key={a.id} onClick={() => onAlert(a)}><span className={`reception-status ${a.type === 'danger' ? 'danger' : 'warning'}`}>{a.type === 'danger' ? 'עדיפות גבוהה' : 'לטיפול'}</span><p>{a.text}</p><span className="reception-text-action">{a.reservationId ? 'פתיחת ההזמנה' : 'לפרטי הטיפול'}<ArrowLeft size={14}/></span></button>)}</div> : null}</QueryState></section>
        <section className="reception-section"><header className="reception-section-head"><div><span className="reception-section-icon journal"><ClipboardList size={20}/></span><div><h2>העברת משמרת<span>{work.error || !work.data ? '—' : notes.length}</span></h2><p>מה נשאר מהמשמרת הקודמת</p></div></div></header><QueryState query={work} empty="אין פריטי העברת משמרת פתוחים.">{notes.length ? <div>{notes.map(w => <button type="button" className="reception-note" key={w.id || w._id} onClick={() => navigate('/pms/work')}><strong>{w.title}</strong>{w.body && <p>{w.body}</p>}<small>{w.owner?.name ? `בטיפול ${w.owner.name}` : 'ממתין לקבלת טיפול'}</small></button>)}</div> : null}</QueryState><button type="button" className="reception-journal-link" onClick={() => navigate('/pms/work')}>יומן המשמרת ומרכז המשימות<ArrowLeft size={14}/></button></section>
      </aside>
    </div>
  </div>;
}
