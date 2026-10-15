// "היום בקבלה" — the desk's control board, one screen, no page scroll.
// Layout follows the pattern professional PMS dashboards share (Cloudbeds' Activity board): a
// day + occupancy rail on one side, and one "Activity" card whose big-number tiles switch the list
// (arrivals / departures / alerts). Each arrival row shows the room, its cleanliness, payment and
// what is still missing, next to the button that resolves it; a click opens the specific room,
// payment and the guest's special requests. Readiness is computed by the server.
import { useState } from 'react';
import { RefreshCw, Plus, CalendarDays, LogIn, LogOut, CheckCircle2, Check, ChevronDown, Crown, MessageSquareText, BedDouble, Moon, User, Baby, AlertTriangle, Wrench, Sparkles, ChevronLeft, Users, Bell } from 'lucide-react';
import { guestInitials } from '../kit';
import { cleanLabel, opsLabel } from '../../lib/labels';

const money = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(Number(n || 0));
const RANK = { blocked: 0, waiting: 1, queued: 2, ready: 3, checked_in: 4 };
const STATE_TEXT = { ready: 'מוכן לצ׳ק-אין', waiting: 'ממתין', queued: 'בתור המתנה', blocked: 'חסום', checked_in: 'נכנס' };
const STATE_TONE = { ready: 'ok', waiting: 'warn', queued: 'warn', blocked: 'bad', checked_in: 'done' };

// What stands between a departing guest and a clean check-out, from the departures row.
function problems(r) {
  const out = [];
  if (r.state === 'late') out.push('מועד היציאה עבר והאורח עדיין רשום בבית');
  if (r.money.owed > 0) out.push(`יתרה פתוחה ${money(r.money.owed)}`);
  if (r.money.credit < 0) out.push(`זכות לאורח ${money(-r.money.credit)} — לבדוק החזר`);
  if (r.money.settledOpen > 0) out.push('חשבון מסולק עם יתרה פתוחה');
  if (r.documents?.draft > 0) out.push('חשבונית בטיוטה שלא הופקה');
  if (r.documents?.pending > 0) out.push('חשבונית ממתינה למספר הקצאה');
  return out;
}

function payment(g) {
  if (!g) return { tone: '', text: '—' };
  if (g.total > 0 && g.paid >= g.total) return { tone: 'ok', text: 'שולם במלואו' };
  if (g.paid > 0) return { tone: 'warn', text: `שולם ${money(g.paid)} מתוך ${money(g.total)}` };
  return g.ok ? { tone: 'warn', text: 'לא שולם · יש ערבות' } : { tone: 'bad', text: 'לא שולם' };
}

function GuestCell({ name, vip, note, sub }) {
  return (
    <div className="dk-guest">
      <span className="dk-av" aria-hidden="true">{guestInitials(name)}</span>
      <div>
        <b>{name}{vip && <Crown size={13} className="dk-vip" aria-label="VIP" />}{note && <MessageSquareText size={13} className="dk-note-ic" aria-label="יש בקשות מיוחדות" />}</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}

// The rooms today's arrivals are about to enter: cleanliness and maintenance per room, worst first.
// Same card + row language as the activity list next to it.
function RoomsCard({ arrivals, tickets, onPick }) {
  const rows = (arrivals.data?.rows || []).filter((r) => r.readiness.state !== 'checked_in');
  const byRoom = new Map();
  for (const t of tickets.data?.rows || []) {
    if (!t.room?.id) continue;
    if (!byRoom.has(t.room.id)) byRoom.set(t.room.id, []);
    byRoom.get(t.room.id).push(t);
  }
  const ORDER = { bad: 0, warn: 1, ok: 2 };
  const items = rows.map((r) => {
    if (!r.room) return { r, tone: 'bad', none: true, tk: [] };
    const tk = byRoom.get(r.room.id) || [];
    // A guest still in the room means it is not ready, whatever its last cleaning said.
    const occupied = !!r.room.occupiedBy;
    const clean = !occupied && ['clean', 'inspected'].includes(r.room.cleanStatus);
    const blocked = !!(r.room.opsStatus && r.room.opsStatus !== 'available');
    const hard = occupied || blocked || tk.some((t) => t.blocksRoom || t.priority === 'critical');
    return { r, tk, clean, occupied, blocked, tone: hard ? 'bad' : (!clean || tk.length) ? 'warn' : 'ok' };
  }).sort((x, y) => ORDER[x.tone] - ORDER[y.tone] || String(x.r.room?.number || '~').localeCompare(String(y.r.room?.number || '~'), 'he', { numeric: true }));
  const ready = items.filter((x) => x.tone === 'ok').length;
  const noRoom = items.filter((x) => x.none).length;
  const sub = arrivals.data ? `${ready} מוכנים · ${items.length - ready - noRoom} דורשים טיפול · ${noRoom} ללא חדר` : '';
  return (
    <aside className="dk-rooms" aria-label="חדרים להגעות">
      <div className="dk-rooms-head"><h2>החדרים של המגיעים</h2><span>{sub}</span></div>
      <div className="dk-scroll dk-cardlist">
        {arrivals.data && !items.length && <div className="dk-state"><CheckCircle2 size={18} />אין הגעות פתוחות.</div>}
        {items.map(({ r, tk, clean, occupied, blocked, tone, none }) => (
          <button type="button" key={r.key} className={`dk-rcard is-${tone}`} onClick={() => onPick(r.key)}>
            <div className="dk-rc-top">
              <div className="dk-rc-room"><small>חדר</small><b className={none ? 'is-none' : ''}>{none ? '—' : r.room.number}</b></div>
              <div className="dk-rc-who">
                <b>{r.guest.name}</b>
                <span>{r.roomType?.name}{!none && r.room.floor != null ? ` · קומה ${r.room.floor}` : ''}{r.eta ? ` · הגעה ${r.eta}` : ''}</span>
              </div>
              <span className={`dk-rc-pill ${tone}`}>{none ? 'ללא חדר' : tone === 'ok' ? 'מוכן' : tone === 'bad' ? 'חסום' : 'לטיפול'}</span>
            </div>
            <div className="dk-rc-meters">
              {none ? (
                <div className="bad"><div><span>חדר</span><b>לא משובץ</b></div><i /></div>
              ) : (
                <>
                  <div className={clean ? 'ok' : 'warn'}><div><span>ניקיון</span><b>{cleanLabel(r.room.cleanStatus)}</b></div><i /></div>
                  <div className={blocked || tk.length ? (tone === 'bad' ? 'bad' : 'warn') : 'ok'}><div><span>תחזוקה</span><b>{blocked ? opsLabel(r.room.opsStatus) : tk.length ? `${tk.length} תקלות` : 'תקינה'}</b></div><i /></div>
                </>
              )}
            </div>
            {tk.length > 0 && <div className="dk-rc-tk">{tk[0].description}{tk.length > 1 ? ` · ועוד ${tk.length - 1}` : ''}</div>}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Tile({ on, onClick, Icon, label, value, badge, tone }) {
  return (
    <button type="button" className={`dk-tile ${on ? 'is-on' : ''}`} onClick={onClick} aria-pressed={on}>
      <strong>{value}{badge > 0 && <em className={tone || ''}>{badge}</em>}</strong>
      <span><Icon size={14} />{label}</span>
    </button>
  );
}

function Filter({ on, setOn, issues }) {
  return (
    <div className="dk-seg" role="group" aria-label="סינון">
      <button type="button" className={!on ? 'is-on' : ''} onClick={() => setOn(false)}>הכל</button>
      <button type="button" className={on ? 'is-on' : ''} onClick={() => setOn(true)}>דורשים טיפול{issues > 0 && <em>{issues}</em>}</button>
    </div>
  );
}

function Status({ query, empty, children }) {
  if (query.error) return <div className="dk-state" role="alert">המידע לא נטען<button type="button" onClick={query.refetch}>ניסיון נוסף</button></div>;
  if (query.loading && !query.data) return <div className="dk-state">טוען מידע…</div>;
  return children || <div className="dk-state"><CheckCircle2 size={18} />{empty}</div>;
}

function Detail({ cols, items }) {
  return (
    <tr className="dk-detail"><td colSpan={cols}>
      <div className="dk-facts">{items.map(([k, v]) => <div key={k}><span>{k}</span><div>{v}</div></div>)}</div>
    </td></tr>
  );
}

function ArrivalsTable({ rows, openKey, setOpenKey, onCheckIn, onAssign, onQueue }) {
  return (
    <table className="dk-table">
      <thead><tr><th>אורח</th><th>חדר</th><th>שהייה</th><th>מצב וחסרים</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => {
          const st = r.readiness.state;
          const tone = STATE_TONE[st] || 'warn';
          const done = st === 'checked_in';
          const room = r.room;
          const clean = room && ['clean', 'inspected'].includes(room.cleanStatus);
          const pay = payment(r.guarantee);
          const all = r.readiness.reasons || [];
          const reasons = all.filter((x) => x.code !== 'guarantee' || all.length === 1);
          const isOpen = openKey === r.key;
          return [
            <tr key={r.key} className={`${done ? 'is-done' : ''} ${isOpen ? 'is-open' : ''}`} onClick={() => setOpenKey(isOpen ? null : r.key)}>
              <td><GuestCell name={r.guest.name} vip={r.guest.vip} note={!!r.specialRequests} sub={<><bdi>{r.confirmationNumber}</bdi> · {r.eta ? `הגעה ${r.eta}` : 'שעה לא ידועה'}</>} /></td>
              <td>
                <div className="dk-room"><b className={room ? '' : 'is-none'}>{room ? room.number : '—'}</b><span>{r.roomType?.name}</span></div>
              </td>
              <td>
                <div className="dk-stay2">
                  <span><Moon size={12} />{r.nights} לילות</span>
                  <span><User size={12} />{r.adults} מבוגרים</span>
                  <span><Baby size={12} />{r.children || 0} ילדים</span>
                  <span><BedDouble size={12} />{r.unitsTotal || 1} {(r.unitsTotal || 1) === 1 ? 'חדר' : 'חדרים'}</span>
                </div>
              </td>
              <td className="dk-wide">
                {done ? <span className="dk-muted">נכנס</span> : (
                  <>
                    <div className="dk-chips">
                      <span className={`dk-state-tag ${tone}`}>{STATE_TEXT[st] || st}</span>
                      <span className={`dk-chip ${pay.tone}`}>{pay.text}</span>
                      {!room && <span className="dk-chip bad">לא משובץ חדר</span>}
                    </div>
                    {reasons.length > 0 && <div className="dk-why"><AlertTriangle size={12} />{reasons[0].label}{reasons.length > 1 ? ` · ועוד ${reasons.length - 1}` : ''}</div>}
                  </>
                )}
              </td>
              <td className="dk-act" onClick={(e) => e.stopPropagation()}>
                {done ? null : st === 'ready'
                  ? <button type="button" className="dk-btn is-primary" onClick={() => onCheckIn(r.reservationId)}>צ׳ק-אין</button>
                  : !room
                    ? <button type="button" className="dk-btn is-primary" onClick={() => onAssign(r)}><BedDouble size={14} />שיבוץ חדר</button>
                    : <div className="dk-btns">
                      <button type="button" className="dk-btn" onClick={() => onCheckIn(r.reservationId)}>צ׳ק-אין</button>
                      <button type="button" className="dk-btn is-ghost" onClick={() => onAssign(r)}>החלפת חדר</button>
                      {st === 'waiting' && !r.queue && <button type="button" className="dk-btn is-ghost" onClick={() => onQueue(r)}>להמתנה</button>}
                    </div>}
              </td>
            </tr>,
            isOpen && (
              <Detail key={`${r.key}-d`} cols={5} items={[
                ['החדר', room ? <><b>חדר {room.number}</b> · קומה {room.floor ?? '—'} · {r.roomType?.name}<br />{room.occupiedBy ? `עדיין תפוס (${room.occupiedBy}) — יעבור לניקיון אחרי היציאה` : cleanLabel(room.cleanStatus)} · {opsLabel(room.opsStatus)}</> : <b>טרם שובץ חדר</b>],
                ['תשלום', <><b>{pay.text}</b><br />סה״כ {money(r.guarantee?.total)} · {r.guarantee?.label}</>],
                ['בקשות מיוחדות', r.specialRequests ? <span className="dk-req">{r.specialRequests}</span> : <span className="dk-muted">אין בקשות מיוחדות בהזמנה</span>],
                ['מה חסר לצ׳ק-אין', all.length ? <ul className="dk-issues">{all.map((x, i) => <li key={i}>{x.label}</li>)}</ul> : <span className="dk-muted">הכל מוכן</span>],
              ]} />
            ),
          ];
        })}
        {!rows.length && <tr><td colSpan={5}><div className="dk-state"><CheckCircle2 size={18} />אין הגעות שדורשות טיפול.</div></td></tr>}
      </tbody>
    </table>
  );
}

function DeparturesTable({ rows, openKey, setOpenKey, outTime, onCheckOut }) {
  return (
    <table className="dk-table">
      <thead><tr><th>אורח</th><th>חדר</th><th>חשבון ולטיפול</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => {
          const done = r.state === 'completed';
          const owed = r.money.owed;
          const list = problems(r);
          const flagged = !done && list.length > 0;
          const isOpen = openKey === r.reservationId;
          return [
            <tr key={r.reservationId} className={`${done ? 'is-done' : ''} ${isOpen ? 'is-open' : ''}`} onClick={() => setOpenKey(isOpen ? null : r.reservationId)}>
              <td><GuestCell name={r.guest.name} vip={r.guest.vip} note={!!r.specialRequests} sub={<><bdi>{r.confirmationNumber}</bdi>{r.company ? ` · ${r.company.name}` : ''}</>} /></td>
              <td><div className="dk-room"><b>{r.units.map((u) => u.room || '—').join(' · ')}</b></div></td>
              <td className="dk-wide">
                {done ? <span className="dk-muted">יצא</span> : (
                  <>
                    <div className="dk-chips">
                      {r.state === 'late' ? <span className="dk-chip bad">באיחור</span> : <span className="dk-chip">יציאה {r.etd || `עד ${outTime}`}</span>}
                      {owed > 0 ? <span className="dk-chip warn">יתרה {money(owed)}</span> : <span className="dk-chip ok">שולם</span>}
                    </div>
                    {flagged && <div className="dk-why"><AlertTriangle size={12} />{list[0]}{list.length > 1 ? ` · ועוד ${list.length - 1}` : ''}</div>}
                  </>
                )}
              </td>
              <td className="dk-act" onClick={(e) => e.stopPropagation()}>
                {done ? null : <button type="button" className={`dk-btn ${flagged ? '' : 'is-primary'}`} onClick={() => onCheckOut(r.reservationId)}>{flagged ? 'טיפול ויציאה' : 'צ׳ק-אאוט'}</button>}
              </td>
            </tr>,
            isOpen && (
              <Detail key={`${r.reservationId}-d`} cols={4} items={[
                ['הזמנה', <><b><bdi>{r.confirmationNumber}</bdi></b>{r.company ? <><br />{r.company.name}</> : null}</>],
                ['חשבון', <><b>{owed > 0 ? `יתרה ${money(owed)}` : 'שולם במלואו'}</b>{r.money.credit < 0 ? <><br />זכות {money(-r.money.credit)}</> : null}</>],
                ['בקשות מיוחדות', r.specialRequests ? <span className="dk-req">{r.specialRequests}</span> : <span className="dk-muted">אין בקשות מיוחדות בהזמנה</span>],
                ['לטיפול', list.length ? <ul className="dk-issues">{list.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="dk-muted">הכל תקין לצ׳ק-אאוט</span>],
              ]} />
            ),
          ];
        })}
        {!rows.length && <tr><td colSpan={4}><div className="dk-state"><CheckCircle2 size={18} />אין עזיבות שדורשות טיפול.</div></td></tr>}
      </tbody>
    </table>
  );
}

function InHouseTable({ rows, onOpen }) {
  return (
    <table className="dk-table">
      <thead><tr><th>אורח</th><th>חדר</th><th>שהייה</th><th>חשבון ולטיפול</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => {
          const owed = r.money?.owed || 0;
          const notes = (r.exceptions || []).map((x) => x.label);
          if (r.openRequests > 0) notes.push(`${r.openRequests} בקשות אורח פתוחות`);
          return (
            <tr key={r.reservationId} onClick={() => onOpen(r.reservationId)}>
              <td><GuestCell name={r.guest.name} vip={r.guest.vip} sub={<><bdi>{r.confirmationNumber}</bdi>{r.company ? ` · ${r.company.name}` : ''}</>} /></td>
              <td><div className="dk-room"><b>{(r.rooms || []).map((x) => x.number).join(' · ') || '—'}</b><span>{r.roomType}</span></div></td>
              <td>
                <div className="dk-stay2">
                  <span><Moon size={12} />יציאה {r.departureDate?.slice(5).split('-').reverse().join('/')}</span>
                  <span><User size={12} />{r.adults} מבוגרים</span>
                  <span><Baby size={12} />{r.children || 0} ילדים</span>
                  <span><BedDouble size={12} />{r.unitsTotal || 1} {(r.unitsTotal || 1) === 1 ? 'חדר' : 'חדרים'}</span>
                </div>
              </td>
              <td className="dk-wide">
                <div className="dk-chips">{owed > 0 ? <span className="dk-chip warn">יתרה {money(owed)}</span> : <span className="dk-chip ok">שולם</span>}</div>
                {notes.length > 0 && <div className="dk-why"><AlertTriangle size={12} />{notes[0]}{notes.length > 1 ? ` · ועוד ${notes.length - 1}` : ''}</div>}
              </td>
              <td className="dk-act" onClick={(e) => e.stopPropagation()}><button type="button" className="dk-btn" onClick={() => onOpen(r.reservationId)}>פרטים</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AlertsList({ alerts, notes, onAlert }) {
  const items = [...(alerts.data || [])].sort((a, b) => Number(b.type === 'danger') - Number(a.type === 'danger'));
  if (!items.length && !notes.length) return <div className="dk-state"><CheckCircle2 size={18} />אין התראות פתוחות.</div>;
  return (
    <div className="dk-list">
      {items.map((a) => {
        const inner = (
          <>
            <span className={`dk-chip ${a.type === 'danger' ? 'bad' : 'warn'}`}>{a.type === 'danger' ? 'דחוף' : 'לטיפול'}</span>
            <p>{a.text}</p>{a.reservationId && <ChevronLeft size={14} />}
          </>
        );
        return a.reservationId
          ? <button type="button" className="dk-alert" key={a.id} onClick={() => onAlert(a)}>{inner}</button>
          : <div className="dk-alert is-static" key={a.id}>{inner}</div>;
      })}
      {notes.map((w) => (
        <div className="dk-alert is-static" key={w.id || w._id}>
          <span className="dk-chip">העברת משמרת</span>
          <p><b>{w.title}</b>{w.body ? ` — ${w.body}` : ''}</p>
        </div>
      ))}
    </div>
  );
}

export default function DailyWorkspace({ property, date, stats, arrivals, departures, alerts, work, tickets, inhouse, refresh, navigate, onOpen, onCheckIn, onCheckOut, onAssign, onQueue, onAlert }) {
  const [tab, setTab] = useState('arrivals');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [openKey, setOpenKey] = useState(null);
  const notes = (work.data?.rows || []).filter((w) => w.kind === 'handover');

  const aAll = arrivals.data?.rows || [];
  const aCounts = arrivals.data?.counts || {};
  const aOpen = aAll.filter((r) => r.readiness.state !== 'checked_in');
  const aIssues = aOpen.filter((r) => r.readiness.state !== 'ready');
  const aRows = [...(onlyIssues ? aIssues : aAll)].sort((a, b) => (RANK[a.readiness.state] ?? 9) - (RANK[b.readiness.state] ?? 9) || String(a.eta || '99').localeCompare(String(b.eta || '99')));

  const dAll = departures.data?.rows || [];
  const flagged = (r) => r.state !== 'completed' && problems(r).length > 0;
  const dOpen = dAll.filter((r) => r.state !== 'completed');
  const dIssues = dOpen.filter(flagged);
  const dRows = [...(onlyIssues ? dIssues : dAll)].sort((a, b) => Number(a.state === 'completed') - Number(b.state === 'completed') || Number(flagged(b)) - Number(flagged(a)) || String(a.etd || '99').localeCompare(String(b.etd || '99')));

  const extra = (alerts.data?.length || 0) + notes.length;
  const pick = (t) => { setTab(t); setOpenKey(null); setOnlyIssues(false); };
  const issuesNow = tab === 'arrivals' ? aIssues.length : dIssues.length;
  const summary = tab === 'arrivals'
    ? (arrivals.data ? `${aCounts.ready || 0} מוכנים · ${aIssues.length} דורשים טיפול · ${aCounts.checked_in || 0} כבר נכנסו` : '')
    : tab === 'departures' ? (departures.data ? `${dOpen.length - dIssues.length} תקינים · ${dIssues.length} דורשים טיפול · ${dAll.length - dOpen.length} כבר יצאו` : '') : tab === 'inhouse' ? `${(inhouse.data?.rows || []).length} אורחים בבית כרגע` : 'חשבונות פתוחים, תקלות והעברת משמרת';

  return (
    <div className="dk" dir="rtl">
      <header className="dk-head">
        <div className="dk-title"><h1>היום בקבלה</h1><span>{date}{stats.data ? ` · תפוסה ${stats.data.occupancy}% · ${stats.data.inHouse} שוהים מתוך ${stats.data.totalRooms} חדרים` : ''}</span></div>
        <nav aria-label="פעולות קבלה">
          <button type="button" className="dk-btn is-icon" onClick={refresh} aria-label="רענון מידע" title="רענון מידע"><RefreshCw size={15} /></button>
          <button type="button" className="dk-btn" onClick={() => navigate('/pms/tape-chart')}><CalendarDays size={15} />לוח חדרים</button>
          <button type="button" className="dk-btn is-primary" onClick={() => navigate('/pms/reservations/new')}><Plus size={15} />הזמנה חדשה</button>
        </nav>
      </header>
      {stats.error && <div className="dk-state" role="alert">נתוני הסיכום לא נטענו<button type="button" onClick={stats.refetch}>ניסיון נוסף</button></div>}

      <div className="dk-body">
        <section className="dk-activity">
          <div className="dk-tiles" role="tablist" aria-label="פעילות היום">
            <Tile on={tab === 'arrivals'} onClick={() => pick('arrivals')} Icon={LogIn} label="הגעות" value={arrivals.data ? aOpen.length : '—'} badge={aIssues.length} tone="warn" />
            <Tile on={tab === 'departures'} onClick={() => pick('departures')} Icon={LogOut} label="עזיבות" value={departures.data ? dOpen.length : '—'} badge={dIssues.length} tone="warn" />
            <Tile on={tab === 'inhouse'} onClick={() => pick('inhouse')} Icon={Users} label="שוהים" value={inhouse.data ? (inhouse.data.rows || []).length : (stats.data?.inHouse ?? '—')} />
            <Tile on={tab === 'alerts'} onClick={() => pick('alerts')} Icon={Bell} label="התראות" value={alerts.data ? extra : '—'} />
          </div>
          <div className="dk-bar">
            <span>{summary}</span>
            {(tab === 'arrivals' || tab === 'departures') && <Filter on={onlyIssues} setOn={setOnlyIssues} issues={issuesNow} />}
          </div>
          <div className="dk-scroll">
            {tab === 'arrivals' && (
              <Status query={arrivals} empty="אין הגעות היום.">
                {aAll.length ? <ArrivalsTable rows={aRows} openKey={openKey} setOpenKey={setOpenKey} onCheckIn={onCheckIn} onAssign={onAssign} onQueue={onQueue} /> : null}
              </Status>
            )}
            {tab === 'departures' && (
              <Status query={departures} empty="אין עזיבות היום.">
                {dAll.length ? <DeparturesTable rows={dRows} openKey={openKey} setOpenKey={setOpenKey} outTime={property?.checkOutTime || '11:00'} onCheckOut={onCheckOut} /> : null}
              </Status>
            )}
            {tab === 'inhouse' && (
              <Status query={inhouse} empty="אין שוהים כרגע.">
                {(inhouse.data?.rows || []).length ? <InHouseTable rows={inhouse.data.rows} onOpen={onOpen} /> : null}
              </Status>
            )}
            {tab === 'alerts' && <Status query={alerts} empty="אין התראות פתוחות."><AlertsList alerts={alerts} notes={notes} onAlert={onAlert} /></Status>}
          </div>
        </section>
        <RoomsCard arrivals={arrivals} tickets={tickets} onPick={(key) => { setTab('arrivals'); setOnlyIssues(false); setOpenKey(key); }} />
      </div>
    </div>
  );
}
