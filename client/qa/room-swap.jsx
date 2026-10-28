// Loaded only by the explicit disposable QA server, never by App.jsx.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RoomSwapDialog from '../src/components/stay/RoomSwapDialog';
import '../src/index.css';
import '../src/components/kit/kit.css';

const boot = await fetch(`/__qa/bootstrap${location.search}`).then((r) => r.json());
localStorage.setItem('hotel4u_token', boot.token);
function Preview() {
  const [open, setOpen] = useState(false), [result, setResult] = useState(null);
  async function done(out) { setOpen(false); setResult({ ...await fetch('/__qa/state').then((r) => r.json()), duplicate: !!out.duplicate }); }
  return <main dir="rtl" className="ui-page"><h1>בדיקת החלפת חדרים — נתוני דמה בלבד</h1>
    <p>דני בחדר 101, נועה בחדר 102. המחירים שונים ונשארים עם האורח.</p>
    <button className="btn btn-primary" onClick={() => setOpen(true)}>פתיחת החלפת חדרים</button>
    {open && <RoomSwapDialog open {...boot} onClose={() => setOpen(false)} onDone={done} />}
    {result && <div role="status"><h2>הפעולה הושלמה</h2>{result.assignments.map((u) => <p key={u.guest}>{u.guest}: חדר {u.room}</p>)}<p>מספר החלפות: {result.swaps} · זיהוי ניסיון חוזר: {String(result.duplicate)}</p></div>}
  </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Preview /></React.StrictMode>);
