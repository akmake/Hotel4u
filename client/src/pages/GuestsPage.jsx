import { useState, useCallback, useEffect } from 'react';
import {
  Search, Plus, Crown, Globe, Phone, Mail, X, Edit3,
  BookOpen, Tag, FileText, ShieldOff, AlertTriangle,
  CheckCircle2, User, Save, Trash2, History, Loader2, Merge,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { guests as guestApi } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const COUNTRIES = ['ישראל','ארצות הברית','בריטניה','צרפת','גרמניה','איטליה','ספרד','הולנד','שוויץ','רוסיה','יפן','סין','הודו','ברזיל','אוסטרליה'];
const VIP_LABELS = { 0:'רגיל', 1:'VIP', 2:'VVIP', 3:'VVVIP', 4:'Diamond', 5:'Elite' };
const GENDER_LABELS = { M:'זכר', F:'נקבה', other:'אחר', unknown:'לא ידוע' };
const IDOC_TYPES = { passport:'דרכון', id_card:'ת.ז.', drivers_license:'רישיון נהיגה', other:'אחר' };
const PRESET_TAGS = ['חוזר','VIP','ארוחה צמחונית','אלרגיות','ייבוא מ-OTA','עסקי','פנאי','זוג','משפחה','קשיש'];

// ── Merge Modal ────────────────────────────────────────────────────────────────
function MergeModal({ guest, propertyId, onClose, onMerged }) {
  const [search,  setSearch]  = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [target,  setTarget]  = useState(null);
  const [merging, setMerging] = useState(false);
  const { error: toastErr, success } = useToast();

  useEffect(() => {
    if (search.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await guestApi.list(propertyId, { q: search });
        setResults((list || []).filter(g => String(g._id) !== String(guest._id)));
      } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, propertyId, guest._id]);

  async function merge() {
    if (!target) return;
    setMerging(true);
    try {
      await guestApi.merge(String(guest._id), String(target._id));
      success(`"${target.firstName} ${target.lastName}" מוזג אל "${guest.firstName} ${guest.lastName}"`);
      onMerged();
      onClose();
    } catch (e) { toastErr(e.message); }
    finally { setMerging(false); }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.6)', direction:'rtl' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div className="font-bold text-ink flex items-center gap-2"><Merge size={15} /> מיזוג פרופילים</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            הפרופיל שנבחר יאוחד <strong>אל תוך &quot;{guest.firstName} {guest.lastName}&quot;</strong>. ההזמנות, הסטטיסטיקות והתגיות יעברו. הפרופיל הממוזג יסומן כ&quot;הועבר&quot;.
          </div>
          <div className="relative">
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input pr-8 w-full text-sm" placeholder="חפש אורח למיזוג..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {loading && <div className="flex justify-center py-2"><Spinner size={18} /></div>}
          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-surface-border divide-y divide-surface-hover">
              {results.map(g => (
                <div key={String(g._id)} onClick={() => setTarget(g)}
                  className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${target?._id === g._id ? 'bg-brand/8' : 'hover:bg-surface-hover'}`}>
                  <div className="flex-1">
                    <div className="font-semibold text-ink text-sm">{g.firstName} {g.lastName}</div>
                    <div className="text-xs text-ink-muted">{g.email || g.phone || '—'} · שהיות: {g.totalStays || 0}</div>
                  </div>
                  {String(target?._id) === String(g._id) && <CheckCircle2 size={14} className="text-brand" />}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-danger flex-1 justify-center gap-1" disabled={!target || merging} onClick={merge}>
              {merging ? <Spinner size={14} /> : <Merge size={13} />} {merging ? 'ממזג...' : 'מזג'}
            </button>
            <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Guest Profile Drawer ───────────────────────────────────────────────────────
function GuestDrawer({ guestId, propertyId, onClose, onUpdated }) {
  const [tab,       setTab]      = useState('info');
  const [editMode,  setEditMode] = useState(false);
  const [form,      setForm]     = useState(null);
  const [saving,    setSaving]   = useState(false);
  const [noteText,  setNoteText] = useState('');
  const [addingNote,setAddNote]  = useState(false);
  const [showMerge, setShowMerge]= useState(false);
  const [anonConf,  setAnonConf] = useState(false);
  const { toasts, success, error: toastErr } = useToast();

  const { data: raw, loading, error, refetch } = useApi(
    () => guestApi.get(guestId),
    [guestId], false
  );

  useEffect(() => { if (raw) setForm({ ...raw }); }, [raw]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setSaving(true);
    try {
      await guestApi.update(guestId, {
        firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone,
        country: form.country, citizenship: form.citizenship, language: form.language,
        gender: form.gender, vipLevel: Number(form.vipLevel),
        preferences: form.preferences, allergies: form.allergies, internalNotes: form.internalNotes,
        dateOfBirth: form.dateOfBirth, passportNumber: form.passportNumber, passportExpiry: form.passportExpiry,
        loyaltyId: form.loyaltyId, marketingConsent: form.marketingConsent, privacyConsent: form.privacyConsent,
        isBlacklisted: form.isBlacklisted, blacklistReason: form.blacklistReason,
      });
      success('פרופיל עודכן!');
      setEditMode(false);
      refetch();
      onUpdated?.();
    } catch (e) { toastErr(e.message); }
    finally { setSaving(false); }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    setAddNote(true);
    try { await guestApi.addNote(guestId, noteText); setNoteText(''); success('הערה נוספה'); refetch(); }
    catch (e) { toastErr(e.message); }
    finally { setAddNote(false); }
  }

  async function deleteNote(noteId) {
    try { await guestApi.deleteNote(guestId, noteId); refetch(); } catch (e) { toastErr(e.message); }
  }

  async function toggleTag(tag) {
    try {
      const hasTg = (raw?.tags || []).includes(tag);
      if (hasTg) await guestApi.removeTag(guestId, tag); else await guestApi.addTag(guestId, tag);
      refetch();
    } catch (e) { toastErr(e.message); }
  }

  async function anonymize() {
    try { await guestApi.anonymize(guestId, 'GDPR request'); success('אורח אונונם'); setAnonConf(false); onUpdated?.(); onClose(); }
    catch (e) { toastErr(e.message); setAnonConf(false); }
  }

  const g = raw || {};
  const initial = `${g.firstName?.slice(0,1) || ''}${g.lastName?.slice(0,1) || ''}`;
  const isVip = (g.vipLevel || 0) > 0;
  const stats = g.stats || {};

  return (
    <div className="fixed inset-0 z-50 flex" style={{ direction: 'rtl' }}>
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white flex flex-col shadow-2xl overflow-hidden">
        <ToastContainer toasts={toasts} />
        {showMerge && <MergeModal guest={g} propertyId={propertyId} onClose={() => setShowMerge(false)} onMerged={() => { refetch(); onUpdated?.(); }} />}

        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-start justify-between bg-gradient-to-l from-brand/5 to-white flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="avatar font-black text-lg" style={{ width:52, height:52, fontSize:18, background: isVip ? 'rgba(234,179,8,0.15)' : 'rgba(99,102,241,0.1)', color: isVip ? '#b45309' : '#6366f1' }}>
              {initial}
            </div>
            <div>
              {loading
                ? <div className="h-5 w-32 bg-surface-hover rounded animate-pulse" />
                : <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-lg text-ink">{g.firstName} {g.lastName}</span>
                    {isVip && <span className="badge badge-pending flex items-center gap-1"><Crown size={10} className="text-yellow-500" />{VIP_LABELS[g.vipLevel]}</span>}
                    {g.isBlacklisted && <span className="badge badge-dirty">Blacklisted</span>}
                  </div>
              }
              <div className="flex gap-3 mt-1 text-xs text-ink-muted">
                {g.email && <span className="flex items-center gap-1"><Mail size={10} />{g.email}</span>}
                {g.phone && <span className="flex items-center gap-1"><Phone size={10} />{g.phone}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!editMode && <button className="btn btn-secondary btn-sm gap-1" onClick={() => setEditMode(true)}><Edit3 size={12} />ערוך</button>}
            {editMode && (
              <>
                <button className="btn btn-primary btn-sm gap-1" onClick={save} disabled={saving}><Save size={12} />{saving ? '...' : 'שמור'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditMode(false); setForm({ ...raw }); }}>ביטול</button>
              </>
            )}
            <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* Stats bar */}
        {!loading && (
          <div className="grid grid-cols-4 border-b border-surface-border flex-shrink-0">
            {[
              { label:'שהיות',   val: stats.totalStays || 0,    color:'#6366f1' },
              { label:'הכנסה',   val: stats.totalRevenue ? `₪${Number(stats.totalRevenue).toLocaleString()}` : '—', color:'#059669' },
              { label:'No-Show', val: stats.noShowCount || 0,   color:'#ef4444' },
              { label:'ביטולים', val: stats.cancellationCount || 0, color:'#d97706' },
            ].map(({ label, val, color }) => (
              <div key={label} className="flex flex-col items-center justify-center py-3 border-l border-surface-border last:border-0">
                <div className="text-lg font-black text-num" style={{ color }}>{val}</div>
                <div className="text-xs text-ink-muted">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-surface-border px-6 flex-shrink-0">
          {[['info','פרטים'],['history','היסטוריה'],['notes','הערות'],['tags','תגיות']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === k ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="flex justify-center py-12"><Spinner size={24} /></div>}
          {error   && <div className="text-xs text-red-500 text-center py-4">{error}</div>}

          {!loading && !error && tab === 'info' && (
            <div className="flex flex-col gap-6">
              <section>
                <div className="text-xs font-bold text-ink-secondary mb-3 flex items-center gap-2"><User size={12} />פרטים אישיים</div>
                <div className="grid grid-cols-2 gap-3">
                  {[{label:'שם פרטי',key:'firstName'},{label:'שם משפחה',key:'lastName'},{label:'אימייל',key:'email',type:'email'},{label:'טלפון',key:'phone',type:'tel'}].map(({label,key,type='text'}) => (
                    <div key={key}>
                      <label className="text-xs font-semibold text-ink-secondary block mb-1">{label}</label>
                      {editMode ? <input className="input w-full text-sm" type={type} value={form?.[key]||''} onChange={e=>set(key,e.target.value)} />
                        : <div className="text-sm text-ink">{g[key]||<span className="text-ink-faint">—</span>}</div>}
                    </div>
                  ))}
                  {[{label:'מגדר',key:'gender',opts:Object.entries(GENDER_LABELS)},{label:'VIP',key:'vipLevel',opts:Object.entries(VIP_LABELS)}].map(({label,key,opts}) => (
                    <div key={key}>
                      <label className="text-xs font-semibold text-ink-secondary block mb-1">{label}</label>
                      {editMode ? <select className="select w-full text-sm" value={form?.[key]||''} onChange={e=>set(key,e.target.value)}>{opts.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                        : <div className="text-sm text-ink">{key==='vipLevel'?VIP_LABELS[g.vipLevel]||'רגיל':GENDER_LABELS[g.gender]||'—'}</div>}
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-semibold text-ink-secondary block mb-1">מדינה</label>
                    {editMode ? <select className="select w-full text-sm" value={form?.country||''} onChange={e=>set('country',e.target.value)}>{COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
                      : <div className="text-sm text-ink">{g.country||'—'}</div>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-secondary block mb-1">אזרחות</label>
                    {editMode ? <input className="input w-full text-sm" value={form?.citizenship||''} onChange={e=>set('citizenship',e.target.value)} />
                      : <div className="text-sm text-ink">{g.citizenship||'—'}</div>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-secondary block mb-1">תאריך לידה</label>
                    {editMode ? <input className="input w-full text-sm" type="date" value={form?.dateOfBirth?form.dateOfBirth.slice(0,10):''} onChange={e=>set('dateOfBirth',e.target.value)} />
                      : <div className="text-sm text-num text-ink">{g.dateOfBirth?new Date(g.dateOfBirth).toLocaleDateString('he-IL'):'—'}</div>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-secondary block mb-1">Loyalty ID</label>
                    {editMode ? <input className="input w-full text-sm" value={form?.loyaltyId||''} onChange={e=>set('loyaltyId',e.target.value)} />
                      : <div className="text-sm text-ink font-mono">{g.loyaltyId||'—'}</div>}
                  </div>
                </div>
              </section>

              <section>
                <div className="text-xs font-bold text-ink-secondary mb-3 flex items-center gap-2"><FileText size={12} />מסמך מזהה</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-ink-secondary block mb-1">סוג</label>
                    {editMode ? <select className="select w-full text-sm" value={form?.idDocType||'passport'} onChange={e=>set('idDocType',e.target.value)}>{Object.entries(IDOC_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                      : <div className="text-sm text-ink">{IDOC_TYPES[g.idDocType]||'דרכון'}</div>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-secondary block mb-1">מספר</label>
                    {editMode ? <input className="input w-full text-sm" value={form?.passportNumber||''} onChange={e=>set('passportNumber',e.target.value)} />
                      : <div className="text-sm text-ink font-mono">{g.passportNumber||'—'}</div>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-secondary block mb-1">תוקף</label>
                    {editMode ? <input className="input w-full text-sm" type="date" value={form?.passportExpiry?form.passportExpiry.slice(0,10):''} onChange={e=>set('passportExpiry',e.target.value)} />
                      : <div className="text-sm text-num text-ink">{g.passportExpiry?new Date(g.passportExpiry).toLocaleDateString('he-IL'):'—'}</div>}
                  </div>
                </div>
              </section>

              <section>
                <div className="text-xs font-bold text-ink-secondary mb-3 flex items-center gap-2"><BookOpen size={12} />העדפות</div>
                <div className="flex flex-col gap-3">
                  {[{label:'העדפות',key:'preferences',ph:'חדר, מיטה, קומה, נוף...'},{label:'אלרגיות',key:'allergies',ph:'אלרגיות...'},{label:'הערות פנימיות',key:'internalNotes',ph:'לשימוש פנימי בלבד'}].map(({label,key,ph}) => (
                    <div key={key}>
                      <label className="text-xs font-semibold text-ink-secondary block mb-1">{label}</label>
                      {editMode ? <textarea className="input w-full text-sm resize-none" rows={2} placeholder={ph} value={form?.[key]||''} onChange={e=>set(key,e.target.value)} />
                        : <div className="text-sm text-ink bg-surface-hover rounded-lg p-2.5 min-h-8">{g[key]||<span className="text-ink-faint italic">—</span>}</div>}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="text-xs font-bold text-ink-secondary mb-3">הסכמות</div>
                <div className="flex flex-col gap-2">
                  {[{key:'marketingConsent',label:'הסכמה לשיווק'},{key:'privacyConsent',label:'הסכמת פרטיות'},{key:'isBlacklisted',label:'Blacklisted'}].map(({key,label}) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={editMode?!!form?.[key]:!!g[key]} disabled={!editMode} onChange={e=>editMode&&set(key,e.target.checked)} className="w-4 h-4 rounded" />
                      <span className="text-sm text-ink">{label}</span>
                      {key==='isBlacklisted'&&g.isBlacklisted&&g.blacklistReason&&<span className="text-xs text-red-500">({g.blacklistReason})</span>}
                    </label>
                  ))}
                  {editMode&&form?.isBlacklisted&&<input className="input text-sm w-full" placeholder="סיבת blacklist" value={form?.blacklistReason||''} onChange={e=>set('blacklistReason',e.target.value)} />}
                </div>
              </section>

              <section className="border border-red-200 rounded-xl p-4 bg-red-50/20">
                <div className="text-xs font-bold text-red-700 mb-3">פעולות רגישות</div>
                <div className="flex gap-2 flex-wrap">
                  <button className="btn btn-secondary btn-sm gap-1" onClick={() => setShowMerge(true)}><Merge size={12} />מזג פרופיל</button>
                  {!anonConf
                    ? <button className="btn btn-danger btn-sm gap-1" onClick={() => setAnonConf(true)}><ShieldOff size={12} />אנונמיזציה (GDPR)</button>
                    : <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-red-700 font-semibold">בטוח? פעולה בלתי הפיכה!</span>
                        <button className="btn btn-danger btn-sm" onClick={anonymize}>כן, מחק</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setAnonConf(false)}>ביטול</button>
                      </div>
                  }
                </div>
              </section>
            </div>
          )}

          {!loading && !error && tab === 'history' && (
            <div className="flex flex-col gap-3">
              <div className="text-xs font-bold text-ink-secondary flex items-center gap-2"><History size={12} />היסטוריית שהיות</div>
              {!(g.reservations||[]).length && <div className="empty-state mt-4"><History size={28} className="empty-state-icon" /><span>אין שהיות קודמות</span></div>}
              {(g.reservations||[]).map(r => {
                const statusColor = {checked_out:'#059669',in_house:'#3b82f6',confirmed:'#6366f1',cancelled:'#ef4444',no_show:'#f59e0b'}[r.status]||'#6b7280';
                const statusLabel = {checked_out:'עזב',in_house:'In House',confirmed:'מאושר',cancelled:'בוטל',no_show:'No Show'}[r.status]||r.status;
                return (
                  <div key={String(r._id)} className="card p-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-xs text-brand font-bold">{r.confirmationNumber}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{background:`${statusColor}18`,color:statusColor}}>{statusLabel}</span>
                      </div>
                      <div className="text-xs text-ink-muted">{r.arrivalDate} → {r.departureDate} · {r.roomType?.name} · חדר {r.assignedRoom?.number||'—'}</div>
                    </div>
                    <div className="text-num font-bold text-sm">₪{Number(r.totalAmount||r.ratePerNight||0).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && tab === 'notes' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-ink-secondary">הוסף הערה</label>
                <textarea className="input text-sm resize-none" rows={3} placeholder="הערה לשימוש פנימי..." value={noteText} onChange={e=>setNoteText(e.target.value)} />
                <button className="btn btn-primary btn-sm self-end gap-1" onClick={addNote} disabled={addingNote||!noteText.trim()}>
                  {addingNote?<Spinner size={12}/>:<Plus size={12}/>} הוסף
                </button>
              </div>
              {!(g.notes||[]).length && <div className="empty-state mt-2"><FileText size={24} className="empty-state-icon" /><span className="text-xs">אין הערות</span></div>}
              {(g.notes||[]).slice().reverse().map(note => (
                <div key={String(note._id)} className="bg-surface-hover rounded-xl p-3 flex items-start gap-2 border border-surface-border">
                  <div className="flex-1">
                    <div className="text-sm text-ink">{note.text}</div>
                    <div className="text-xs text-ink-faint mt-1">{note.createdBy} · {note.createdAt?new Date(note.createdAt).toLocaleDateString('he-IL'):''}</div>
                  </div>
                  <button className="btn btn-ghost btn-icon text-ink-faint hover:text-red-500" onClick={()=>deleteNote(String(note._id))}><Trash2 size={12}/></button>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && tab === 'tags' && (
            <div className="flex flex-col gap-4">
              <div className="text-xs font-bold text-ink-secondary flex items-center gap-2"><Tag size={12}/>תגיות</div>
              <div className="flex flex-wrap gap-2">
                {PRESET_TAGS.map(tag => {
                  const active = (g.tags||[]).includes(tag);
                  return (
                    <button key={tag} onClick={()=>toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition-all ${active?'bg-brand text-white border-brand':'bg-white text-ink border-surface-border hover:border-brand/40'}`}>
                      {active&&'✓ '}{tag}
                    </button>
                  );
                })}
              </div>
              {(g.tags||[]).filter(t=>!PRESET_TAGS.includes(t)).length>0&&(
                <div className="flex flex-wrap gap-2">
                  {(g.tags||[]).filter(t=>!PRESET_TAGS.includes(t)).map(tag=>(
                    <div key={tag} className="flex items-center gap-1 bg-brand/10 text-brand rounded-xl px-2.5 py-1 text-xs font-semibold border border-brand/20">
                      {tag}<button onClick={()=>toggleTag(tag)} className="hover:text-red-500"><X size={10}/></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input id="custom-tag-inp" className="input text-sm flex-1" placeholder="הוסף תגית..." onKeyDown={async e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v){await toggleTag(v);e.target.value='';}}} } />
                <button className="btn btn-secondary btn-sm" onClick={async()=>{const inp=document.getElementById('custom-tag-inp');const v=inp?.value.trim();if(v){await toggleTag(v);inp.value='';}}}>הוסף</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── New Guest Modal ────────────────────────────────────────────────────────────
function NewGuestModal({ propertyId, onClose, onCreated }) {
  const [form, setForm] = useState({ firstName:'', lastName:'', email:'', phone:'', country:'ישראל', language:'he', vipLevel:0, gender:'unknown' });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try { const g = await guestApi.create({ propertyId, ...form, vipLevel: Number(form.vipLevel) }); onCreated(g); onClose(); }
    catch (err) { setError(err.message || 'שגיאה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', direction:'rtl' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="font-bold text-ink">אורח חדש</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">שם פרטי *</label><input className="input w-full" required value={form.firstName} onChange={e=>set('firstName',e.target.value)} /></div>
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">שם משפחה *</label><input className="input w-full" required value={form.lastName} onChange={e=>set('lastName',e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">אימייל</label><input className="input w-full" type="email" value={form.email} onChange={e=>set('email',e.target.value)} /></div>
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">טלפון</label><input className="input w-full" value={form.phone} onChange={e=>set('phone',e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">מדינה</label><select className="select w-full text-xs" value={form.country} onChange={e=>set('country',e.target.value)}>{COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">מגדר</label><select className="select w-full text-xs" value={form.gender} onChange={e=>set('gender',e.target.value)}>{Object.entries(GENDER_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">VIP</label><select className="select w-full text-xs" value={form.vipLevel} onChange={e=>set('vipLevel',e.target.value)}>{Object.entries(VIP_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn btn-primary flex-1 justify-center" disabled={loading}>{loading?<Spinner size={14}/>:'צור אורח'}</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function GuestsPage() {
  const { propertyId } = useProperty();
  const skip = !propertyId;
  const { toasts, success } = useToast();

  const [search,    setSearch]    = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [timer,     setTimer]     = useState(null);
  const [filterVip, setFilterVip] = useState(false);
  const [filterBL,  setFilterBL]  = useState(false);
  const [filterTag, setFilterTag] = useState('');
  const [showNew,   setShowNew]   = useState(false);
  const [selectedId,setSelectedId]= useState(null);

  const handleSearch = useCallback((val) => {
    setSearch(val);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebSearch(val.trim()), 350);
    setTimer(t);
  }, [timer]);

  const params = {};
  if (debSearch) params.q = debSearch;
  if (filterVip) params.vip = 'true';
  if (filterBL)  params.blacklisted = 'true';
  if (filterTag) params.tag = filterTag;

  const { data, loading, error, refetch } = useApi(
    () => guestApi.list(propertyId, params),
    [propertyId, debSearch, filterVip, filterBL, filterTag], skip
  );

  if (skip || loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const list = data || [];

  return (
    <div className="animate-fade-in" style={{ direction:'rtl' }}>
      <ToastContainer toasts={toasts} />
      {selectedId && <GuestDrawer guestId={selectedId} propertyId={propertyId} onClose={() => setSelectedId(null)} onUpdated={() => refetch()} />}
      {showNew && <NewGuestModal propertyId={propertyId} onClose={() => setShowNew(false)} onCreated={() => { success('אורח נוצר בהצלחה!'); refetch(); }} />}

      <div className="page-header">
        <div><div className="page-title">אורחים</div><div className="page-subtitle">{list.length} פרופילים</div></div>
        <button className="btn btn-primary gap-1.5" onClick={() => setShowNew(true)}><Plus size={14}/>אורח חדש</button>
      </div>

      <div className="flex flex-wrap gap-3 mb-3 items-center">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input pr-8 text-xs w-full" placeholder="שם, אימייל, טלפון, דרכון..." value={search} onChange={e=>handleSearch(e.target.value)} />
        </div>
        <button onClick={()=>setFilterVip(v=>!v)} className={`btn btn-sm gap-1 ${filterVip?'btn-primary':'btn-secondary'}`}><Crown size={11}/>VIP</button>
        <button onClick={()=>setFilterBL(v=>!v)}  className={`btn btn-sm gap-1 ${filterBL?'btn-danger':'btn-secondary'}`}><AlertTriangle size={11}/>Blacklisted</button>
        {(filterVip||filterBL||filterTag)&&<button className="btn btn-ghost btn-sm text-ink-muted" onClick={()=>{setFilterVip(false);setFilterBL(false);setFilterTag('')}}><X size={11}/>נקה</button>}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {PRESET_TAGS.slice(0,7).map(tag=>(
          <button key={tag} onClick={()=>setFilterTag(filterTag===tag?'':tag)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${filterTag===tag?'bg-brand text-white border-brand':'bg-white text-ink-muted border-surface-border hover:border-ink-faint'}`}>
            #{tag}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr><th>אורח</th><th>פרטי קשר</th><th>מדינה</th><th>שהיות</th><th>הכנסה</th><th>VIP</th><th>תגיות</th></tr>
          </thead>
          <tbody>
            {list.map(g => {
              const initials = `${g.firstName?.slice(0,1)||''}${g.lastName?.slice(0,1)||''}`;
              const isVip = g.vipLevel > 0;
              return (
                <tr key={String(g._id)} className="cursor-pointer" onClick={() => setSelectedId(String(g._id))}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="avatar text-xs font-bold flex-shrink-0" style={{width:30,height:30,fontSize:11,background:g.isBlacklisted?'rgba(239,68,68,0.1)':isVip?'rgba(234,179,8,0.15)':'rgba(99,102,241,0.1)',color:g.isBlacklisted?'#dc2626':isVip?'#b45309':'#6366f1'}}>{initials}</div>
                      <div>
                        <div className="flex items-center gap-1 font-semibold text-ink">
                          {g.firstName} {g.lastName}
                          {isVip&&<Crown size={11} className="text-yellow-500"/>}
                          {g.isBlacklisted&&<AlertTriangle size={11} className="text-red-500"/>}
                        </div>
                        {g.preferences&&<div className="text-xs text-ink-faint truncate max-w-40">{g.preferences}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {g.email&&<div className="flex items-center gap-1 text-xs text-ink-secondary"><Mail size={10} className="text-ink-faint"/>{g.email}</div>}
                    {g.phone&&<div className="flex items-center gap-1 text-xs text-ink-muted"><Phone size={10} className="text-ink-faint"/>{g.phone}</div>}
                  </td>
                  <td><span className="flex items-center gap-1 text-xs"><Globe size={11} className="text-ink-faint"/>{g.country||'—'}</span></td>
                  <td className="text-num font-semibold">{g.totalStays??0}</td>
                  <td className="text-num text-xs">{g.totalRevenue?`₪${Number(g.totalRevenue).toLocaleString()}`:'—'}</td>
                  <td>{isVip?<span className="badge badge-pending flex items-center gap-1 w-fit"><Crown size={9} className="text-yellow-500"/>{VIP_LABELS[g.vipLevel]}</span>:<span className="text-ink-faint text-xs">—</span>}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {(g.tags||[]).slice(0,2).map(t=><span key={t} className="px-1.5 py-0.5 bg-brand/8 text-brand rounded text-xs">{t}</span>)}
                      {(g.tags||[]).length>2&&<span className="text-xs text-ink-faint">+{g.tags.length-2}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length&&<div className="empty-state"><Search size={28} className="empty-state-icon"/><span>לא נמצאו אורחים</span></div>}
      </div>
    </div>
  );
}

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const g = await guestApi.create({ propertyId, ...form, vipLevel: Number(form.vipLevel) });
      onCreated(g);
      onClose();
    } catch (err) { setError(err.message || 'שגיאה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in" style={{ direction:'rtl' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="font-bold text-ink">אורח חדש</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">שם פרטי *</label>
              <input className="input w-full" required value={form.firstName} onChange={e => set('firstName', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">שם משפחה *</label>
              <input className="input w-full" required value={form.lastName} onChange={e => set('lastName', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">אימייל</label>
            <input className="input w-full" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-secondary block mb-1">טלפון</label>
            <input className="input w-full" value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מדינה</label>
              <select className="select w-full" value={form.country} onChange={e => set('country', e.target.value)}>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">רמת VIP</label>
              <select className="select w-full" value={form.vipLevel} onChange={e => set('vipLevel', e.target.value)}>
                <option value={0}>רגיל</option>
                <option value={1}>VIP</option>
                <option value={2}>VVIP</option>
              </select>
            </div>
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn btn-primary flex-1 justify-center" disabled={loading}>
              {loading ? 'שומר...' : 'צור אורח'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

