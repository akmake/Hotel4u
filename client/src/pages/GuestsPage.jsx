import { useState, useCallback, useEffect } from 'react';
import {
  Search, Plus, Crown, Globe, Phone, Mail, X, Edit3,
  BookOpen, Tag, FileText, ShieldOff, AlertTriangle,
  CheckCircle2, User, Save, Trash2, History, Merge, Download,
  Building2, Star, MapPin, Bed, Shield, CreditCard,
} from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { guests as guestApi, guestDataExport } from '../utils/api';
import { PageSpinner, ErrorState, Spinner } from '../components/ui/Spinner';
import { ToastContainer } from '../components/ui/Toast';

const COUNTRIES = ['ישראל','ארצות הברית','בריטניה','צרפת','גרמניה','איטליה','ספרד','הולנד','שוויץ','רוסיה','יפן','סין','הודו','ברזיל','אוסטרליה'];
const VIP_LABELS = { 0:'רגיל', 1:'VIP', 2:'VVIP', 3:'VVVIP', 4:'Diamond', 5:'Elite' };
const VIP_COLORS = { 0:'#6b7280', 1:'#6366f1', 2:'#8b5cf6', 3:'#d946ef', 4:'#f59e0b', 5:'#ef4444' };
const GENDER_LABELS = { M:'זכר', F:'נקבה', other:'אחר', unknown:'לא ידוע' };
const IDOC_TYPES = { passport:'דרכון', id_card:'ת.ז.', drivers_license:'רישיון נהיגה', other:'אחר' };
const PRESET_TAGS = ['חוזר','VIP','ארוחה צמחונית','אלרגיות','ייבוא מ-OTA','עסקי','פנאי','זוג','משפחה','קשיש'];
const TITLE_OPTIONS = ['','Mr','Mrs','Ms','Dr','Prof'];
const MEMBERSHIP_TIERS = { '':'ללא', standard:'Standard', silver:'Silver', gold:'Gold', platinum:'Platinum', diamond:'Diamond' };
const MEMBERSHIP_COLORS = { '':'#6b7280', standard:'#6b7280', silver:'#64748b', gold:'#b45309', platinum:'#7c3aed', diamond:'#0891b2' };
const BED_TYPES = { '':'לא ידוע', king:'King', queen:'Queen', twin:'Twin', double:'Double', single:'Single' };
const FLOOR_PREF = { any:'ללא העדפה', high:'קומה גבוהה', low:'קומה נמוכה', middle:'אמצע' };
const SMOKING_PREF = { 'non-smoking':'ללא עישון', smoking:'מעשן', any:'ללא העדפה' };
const PILLOW_TYPES = { '':'ללא', feather:'נוצות', foam:'קצף', any:'ללא העדפה' };
const PHONE_TYPES = { mobile:'נייד', home:'בית', work:'עבודה', fax:'פקס', other:'אחר' };
const EMAIL_TYPES = { personal:'פרטי', work:'עבודה', other:'אחר' };
const ADDR_TYPES = { home:'בית', work:'עבודה', other:'אחר' };

const SECTIONS = [
  { id: 'overview',    label: 'סקירה',        icon: User },
  { id: 'contact',     label: 'פרטי קשר',     icon: Phone },
  { id: 'identity',    label: 'מסמכים',        icon: CreditCard },
  { id: 'membership',  label: 'חברות & VIP',  icon: Star },
  { id: 'preferences', label: 'העדפות',        icon: Bed },
  { id: 'history',     label: 'היסטוריה',      icon: History },
  { id: 'notes',       label: 'הערות',         icon: FileText },
  { id: 'tags',        label: 'תגיות',         icon: Tag },
  { id: 'privacy',     label: 'פרטיות',        icon: Shield },
];

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '0.06em' }} className="text-xs font-semibold text-ink-secondary mb-1 uppercase tracking-wide">{label}</div>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 rounded-full bg-brand" />
        <Icon size={13} className="text-brand" />
        <span style={{ fontSize: 11 }} className="text-xs font-bold text-ink uppercase tracking-wide">{title}</span>
      </div>
      {action}
    </div>
  );
}

function Badge({ color, children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
      {children}
    </span>
  );
}

function MergeModal({ guest, propertyId, onClose, onMerged }) {
  const [search, setSearch]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget]   = useState(null);
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
      success(`"${target.firstName} ${target.lastName}" מוזג`);
      onMerged(); onClose();
    } catch (e) { toastErr(e.message); }
    finally { setMerging(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', direction: 'rtl' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="font-bold text-ink flex items-center gap-2"><Merge size={14} /> מיזוג פרופילים</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            הפרופיל שנבחר יאוחד <strong>אל תוך &quot;{guest.firstName} {guest.lastName}&quot;</strong>.
          </div>
          <div className="relative">
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input pr-8 w-full text-sm" placeholder="חפש אורח..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {loading && <div className="flex justify-center py-2"><Spinner size={18} /></div>}
          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-surface-border divide-y">
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
              {merging ? <Spinner size={14} /> : <Merge size={13} />} מזג
            </button>
            <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuestDrawer({ guestId, propertyId, onClose, onUpdated }) {
  const [section,    setSection]   = useState('overview');
  const [editMode,   setEditMode]  = useState(false);
  const [form,       setForm]      = useState(null);
  const [saving,     setSaving]    = useState(false);
  const [noteText,   setNoteText]  = useState('');
  const [addingNote, setAddNote]   = useState(false);
  const [showMerge,  setShowMerge] = useState(false);
  const [anonConf,   setAnonConf]  = useState(false);
  const [exporting,  setExporting] = useState(false);
  const { toasts, success, error: toastErr } = useToast();

  const { data: raw, loading, error, refetch } = useApi(() => guestApi.get(guestId), [guestId], false);
  useEffect(() => { if (raw) setForm({ ...raw }); }, [raw]);
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setSaving(true);
    try {
      await guestApi.update(guestId, {
        firstName: form.firstName, lastName: form.lastName,
        title: form.title, company: form.company, jobTitle: form.jobTitle,
        email: form.email, phone: form.phone,
        phones: form.phones, emails: form.emails, addresses: form.addresses,
        country: form.country, citizenship: form.citizenship, language: form.language,
        gender: form.gender, vipLevel: Number(form.vipLevel),
        loyaltyId: form.loyaltyId, membershipTier: form.membershipTier,
        membershipPoints: Number(form.membershipPoints || 0),
        preferences: form.preferences, allergies: form.allergies,
        internalNotes: form.internalNotes, specialRequests: form.specialRequests,
        roomTypePreference: form.roomTypePreference, bedTypePreference: form.bedTypePreference,
        floorPreference: form.floorPreference, smokingPreference: form.smokingPreference,
        pillow: form.pillow, newspaper: form.newspaper,
        dateOfBirth: form.dateOfBirth, idDocType: form.idDocType,
        passportNumber: form.passportNumber, passportExpiry: form.passportExpiry,
        marketingConsent: form.marketingConsent, privacyConsent: form.privacyConsent,
        isBlacklisted: form.isBlacklisted, blacklistReason: form.blacklistReason,
      });
      success('פרופיל עודכן'); setEditMode(false); refetch(); onUpdated?.();
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
      const has = (raw?.tags || []).includes(tag);
      if (has) await guestApi.removeTag(guestId, tag); else await guestApi.addTag(guestId, tag);
      refetch();
    } catch (e) { toastErr(e.message); }
  }

  async function exportData() {
    setExporting(true);
    try {
      const data = await guestDataExport.request(guestId, 'בקשת האורח');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `guest-${guestId}.json`; a.click();
      URL.revokeObjectURL(url);
      success('ייצוא הושלם');
    } catch (e) { toastErr(e.message); }
    finally { setExporting(false); }
  }

  async function anonymize() {
    try { await guestApi.anonymize(guestId, 'GDPR'); success('אורח אונונם'); setAnonConf(false); onUpdated?.(); onClose(); }
    catch (e) { toastErr(e.message); setAnonConf(false); }
  }

  const g = raw || {};
  const stats = g.stats || {};
  const initial = `${g.firstName?.slice(0,1)||''}${g.lastName?.slice(0,1)||''}`;
  const isVip = (g.vipLevel || 0) > 0;
  const vipColor = VIP_COLORS[g.vipLevel || 0];
  const E = editMode;

  function renderSection() {
    if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>;
    if (error)   return <div className="text-xs text-red-500 text-center py-8">{error}</div>;

    switch (section) {

      case 'overview': return (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'סה"כ שהיות',   val: stats.totalStays || 0,     color: '#6366f1', icon: History },
              { label: 'סה"כ הכנסה',   val: stats.totalRevenue ? `₪${Number(stats.totalRevenue).toLocaleString()}` : '—', color: '#059669', icon: CreditCard },
              { label: 'ממוצע לשהייה', val: stats.avgRevPerStay ? `₪${Math.round(stats.avgRevPerStay).toLocaleString()}` : '—', color: '#0891b2', icon: Star },
              { label: 'שהות אחרונה',  val: g.lastStay ? new Date(g.lastStay).toLocaleDateString('he-IL') : '—', color: '#7c3aed', icon: User },
            ].map(({ label, val, color, icon: Icon }) => (
              <div key={label} className="rounded-xl p-3 flex items-center gap-3" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}18` }}>
                  <Icon size={14} style={{ color }} />
                </div>
                <div>
                  <div className="text-sm font-black text-num" style={{ color }}>{val}</div>
                  <div className="text-xs text-ink-muted">{label}</div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <SectionHeader icon={User} title="פרטים אישיים" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Title / כינוי">
                {E ? <select className="select w-full text-sm" value={form?.title||''} onChange={e=>set('title',e.target.value)}>{TITLE_OPTIONS.map(t=><option key={t} value={t}>{t||'—'}</option>)}</select>
                   : <div className="text-sm text-ink">{g.title||'—'}</div>}
              </Field>
              <Field label="מגדר">
                {E ? <select className="select w-full text-sm" value={form?.gender||'unknown'} onChange={e=>set('gender',e.target.value)}>{Object.entries(GENDER_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                   : <div className="text-sm text-ink">{GENDER_LABELS[g.gender]||'—'}</div>}
              </Field>
              <Field label="חברה / ארגון">
                {E ? <input className="input w-full text-sm" value={form?.company||''} onChange={e=>set('company',e.target.value)} />
                   : <div className="text-sm text-ink">{g.company||'—'}</div>}
              </Field>
              <Field label="תפקיד">
                {E ? <input className="input w-full text-sm" value={form?.jobTitle||''} onChange={e=>set('jobTitle',e.target.value)} />
                   : <div className="text-sm text-ink">{g.jobTitle||'—'}</div>}
              </Field>
              <Field label="תאריך לידה">
                {E ? <input type="date" className="input w-full text-sm" value={form?.dateOfBirth?form.dateOfBirth.slice(0,10):''} onChange={e=>set('dateOfBirth',e.target.value)} />
                   : <div className="text-sm text-num text-ink">{g.dateOfBirth?new Date(g.dateOfBirth).toLocaleDateString('he-IL'):'—'}</div>}
              </Field>
              <Field label="שפה">
                {E ? <input className="input w-full text-sm" value={form?.language||''} onChange={e=>set('language',e.target.value)} />
                   : <div className="text-sm text-ink">{g.language||'—'}</div>}
              </Field>
              <Field label="מדינת מגורים">
                {E ? <select className="select w-full text-sm" value={form?.country||''} onChange={e=>set('country',e.target.value)}><option value="">—</option>{COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
                   : <div className="text-sm text-ink">{g.country||'—'}</div>}
              </Field>
              <Field label="אזרחות">
                {E ? <input className="input w-full text-sm" value={form?.citizenship||''} onChange={e=>set('citizenship',e.target.value)} />
                   : <div className="text-sm text-ink">{g.citizenship||'—'}</div>}
              </Field>
            </div>
          </div>

          {g.isBlacklisted && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-red-700">אורח זה ב-Blacklist</div>
                {g.blacklistReason && <div className="text-xs text-red-600 mt-0.5">{g.blacklistReason}</div>}
              </div>
            </div>
          )}
        </div>
      );

      case 'contact': return (
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeader icon={Phone} title="פרטי קשר ראשיים" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="טלפון ראשי">
                {E ? <input className="input w-full text-sm" type="tel" value={form?.phone||''} onChange={e=>set('phone',e.target.value)} />
                   : <div className="text-sm text-ink font-mono">{g.phone||'—'}</div>}
              </Field>
              <Field label="אימייל ראשי">
                {E ? <input className="input w-full text-sm" type="email" value={form?.email||''} onChange={e=>set('email',e.target.value)} />
                   : <div className="text-sm text-ink">{g.email||'—'}</div>}
              </Field>
            </div>
          </div>

          <div>
            <SectionHeader icon={Phone} title="טלפונים נוספים"
              action={E && <button className="btn btn-ghost btn-sm gap-1 text-xs" onClick={()=>set('phones',[...(form.phones||[]),{number:'',type:'mobile',primary:false}])}><Plus size={11}/>הוסף</button>} />
            {!(E?(form?.phones||[]):(g.phones||[])).length && <div className="text-xs text-ink-faint italic">אין טלפונים נוספים</div>}
            <div className="flex flex-col gap-2">
              {(E?(form?.phones||[]):(g.phones||[])).map((ph,i)=>(
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl border border-surface-border bg-surface-hover/30">
                  {E ? (
                    <>
                      <select className="select text-xs w-24 flex-shrink-0" value={ph.type} onChange={e=>{const a=[...form.phones];a[i]={...a[i],type:e.target.value};set('phones',a);}}>
                        {Object.entries(PHONE_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                      </select>
                      <input className="input text-sm flex-1 font-mono" value={ph.number} onChange={e=>{const a=[...form.phones];a[i]={...a[i],number:e.target.value};set('phones',a);}} />
                      <button className="btn btn-ghost btn-icon text-ink-faint hover:text-red-500" onClick={()=>set('phones',form.phones.filter((_,idx)=>idx!==i))}><Trash2 size={12}/></button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs bg-brand/10 text-brand rounded px-1.5 py-0.5 font-semibold flex-shrink-0">{PHONE_TYPES[ph.type]||ph.type}</span>
                      <span className="text-sm text-ink font-mono">{ph.number}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader icon={Mail} title="כתובות אימייל נוספות"
              action={E && <button className="btn btn-ghost btn-sm gap-1 text-xs" onClick={()=>set('emails',[...(form.emails||[]),{address:'',type:'personal',primary:false}])}><Plus size={11}/>הוסף</button>} />
            {!(E?(form?.emails||[]):(g.emails||[])).length && <div className="text-xs text-ink-faint italic">אין אימיילים נוספים</div>}
            <div className="flex flex-col gap-2">
              {(E?(form?.emails||[]):(g.emails||[])).map((em,i)=>(
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl border border-surface-border bg-surface-hover/30">
                  {E ? (
                    <>
                      <select className="select text-xs w-24 flex-shrink-0" value={em.type} onChange={e=>{const a=[...form.emails];a[i]={...a[i],type:e.target.value};set('emails',a);}}>
                        {Object.entries(EMAIL_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                      </select>
                      <input className="input text-sm flex-1" type="email" value={em.address} onChange={e=>{const a=[...form.emails];a[i]={...a[i],address:e.target.value};set('emails',a);}} />
                      <button className="btn btn-ghost btn-icon text-ink-faint hover:text-red-500" onClick={()=>set('emails',form.emails.filter((_,idx)=>idx!==i))}><Trash2 size={12}/></button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs bg-brand/10 text-brand rounded px-1.5 py-0.5 font-semibold flex-shrink-0">{EMAIL_TYPES[em.type]||em.type}</span>
                      <span className="text-sm text-ink">{em.address}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader icon={MapPin} title="כתובות"
              action={E && <button className="btn btn-ghost btn-sm gap-1 text-xs" onClick={()=>set('addresses',[...(form.addresses||[]),{type:'home',line1:'',city:'',zip:'',country:''}])}><Plus size={11}/>הוסף</button>} />
            {!(E?(form?.addresses||[]):(g.addresses||[])).length && <div className="text-xs text-ink-faint italic">אין כתובות</div>}
            <div className="flex flex-col gap-3">
              {(E?(form?.addresses||[]):(g.addresses||[])).map((addr,i)=>(
                <div key={i} className="rounded-xl border border-surface-border p-3 bg-surface-hover/20">
                  {E ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <select className="select text-xs w-24" value={addr.type} onChange={e=>{const a=[...form.addresses];a[i]={...a[i],type:e.target.value};set('addresses',a);}}>
                          {Object.entries(ADDR_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                        </select>
                        <button className="btn btn-ghost btn-icon text-ink-faint hover:text-red-500" onClick={()=>set('addresses',form.addresses.filter((_,idx)=>idx!==i))}><Trash2 size={12}/></button>
                      </div>
                      <input className="input text-sm w-full" placeholder="כתובת" value={addr.line1||''} onChange={e=>{const a=[...form.addresses];a[i]={...a[i],line1:e.target.value};set('addresses',a);}} />
                      <div className="grid grid-cols-3 gap-2">
                        <input className="input text-sm" placeholder="עיר" value={addr.city||''} onChange={e=>{const a=[...form.addresses];a[i]={...a[i],city:e.target.value};set('addresses',a);}} />
                        <input className="input text-sm" placeholder="מיקוד" value={addr.zip||''} onChange={e=>{const a=[...form.addresses];a[i]={...a[i],zip:e.target.value};set('addresses',a);}} />
                        <input className="input text-sm" placeholder="מדינה" value={addr.country||''} onChange={e=>{const a=[...form.addresses];a[i]={...a[i],country:e.target.value};set('addresses',a);}} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="text-xs bg-brand/10 text-brand rounded px-1.5 py-0.5 font-semibold">{ADDR_TYPES[addr.type]||addr.type}</span>
                      <div className="text-sm text-ink mt-1">{[addr.line1,addr.city,addr.zip,addr.country].filter(Boolean).join(', ')}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );

      case 'identity': return (
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeader icon={CreditCard} title="מסמך מזהה" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="סוג מסמך">
                {E ? <select className="select w-full text-sm" value={form?.idDocType||'passport'} onChange={e=>set('idDocType',e.target.value)}>{Object.entries(IDOC_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                   : <div className="text-sm text-ink">{IDOC_TYPES[g.idDocType]||'דרכון'}</div>}
              </Field>
              <Field label="מספר מסמך">
                {E ? <input className="input w-full text-sm font-mono" value={form?.passportNumber||''} onChange={e=>set('passportNumber',e.target.value)} />
                   : <div className="text-sm text-ink font-mono tracking-wider">{g.passportNumber||'—'}</div>}
              </Field>
              <Field label="תוקף">
                {E ? <input type="date" className="input w-full text-sm" value={form?.passportExpiry?form.passportExpiry.slice(0,10):''} onChange={e=>set('passportExpiry',e.target.value)} />
                   : <div className="text-sm text-num text-ink">{g.passportExpiry?new Date(g.passportExpiry).toLocaleDateString('he-IL'):'—'}</div>}
              </Field>
              <Field label="מדינה מנפיקה">
                {E ? <select className="select w-full text-sm" value={form?.citizenship||''} onChange={e=>set('citizenship',e.target.value)}><option value="">—</option>{COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
                   : <div className="text-sm text-ink">{g.citizenship||'—'}</div>}
              </Field>
            </div>
          </div>
          {g.passportExpiry && (() => {
            const daysLeft = Math.ceil((new Date(g.passportExpiry) - new Date()) / 86400000);
            if (daysLeft >= 90) return null;
            return (
              <div className={`rounded-xl border p-3 flex items-center gap-2 text-xs font-semibold ${daysLeft < 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                <AlertTriangle size={13} />
                {daysLeft < 0 ? `מסמך פג תוקף לפני ${Math.abs(daysLeft)} ימים` : `מסמך יפוג תוקפו בעוד ${daysLeft} ימים`}
              </div>
            );
          })()}
        </div>
      );

      case 'membership': return (
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeader icon={Crown} title="רמת VIP" />
            <div className="flex gap-2 flex-wrap">
              {Object.entries(VIP_LABELS).map(([k,v]) => {
                const active = String(E?form?.vipLevel:g.vipLevel) === k;
                const color = VIP_COLORS[Number(k)];
                return (
                  <button key={k} disabled={!E} onClick={()=>E&&set('vipLevel',Number(k))}
                    className="px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all"
                    style={active?{background:`${color}18`,color,borderColor:color}:{background:'white',color:'#6b7280',borderColor:'#e5e7eb'}}>
                    {Number(k)>0 && <Crown size={10} className="inline ml-1"/>}{v}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <SectionHeader icon={Star} title="תוכנית נאמנות" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Loyalty ID">
                {E ? <input className="input w-full text-sm font-mono" value={form?.loyaltyId||''} onChange={e=>set('loyaltyId',e.target.value)} />
                   : <div className="text-sm text-ink font-mono">{g.loyaltyId||'—'}</div>}
              </Field>
              <Field label="רמת חברות">
                {E ? <select className="select w-full text-sm" value={form?.membershipTier||''} onChange={e=>set('membershipTier',e.target.value)}>{Object.entries(MEMBERSHIP_TIERS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                   : g.membershipTier ? <Badge color={MEMBERSHIP_COLORS[g.membershipTier]||'#6b7280'}><Star size={9}/>{MEMBERSHIP_TIERS[g.membershipTier]}</Badge> : <span className="text-sm text-ink-faint">—</span>}
              </Field>
              <Field label="נקודות צבורות">
                {E ? <input type="number" className="input w-full text-sm" value={form?.membershipPoints||0} onChange={e=>set('membershipPoints',e.target.value)} />
                   : <div className="text-sm text-num font-bold text-ink">{(g.membershipPoints||0).toLocaleString()}</div>}
              </Field>
            </div>
          </div>
          <div>
            <SectionHeader icon={AlertTriangle} title="Blacklist" />
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" disabled={!E} checked={E?!!form?.isBlacklisted:!!g.isBlacklisted} onChange={e=>E&&set('isBlacklisted',e.target.checked)} className="w-4 h-4 rounded" />
              <span className="text-sm text-ink font-semibold">האורח ב-Blacklist</span>
            </label>
            {(E?form?.isBlacklisted:g.isBlacklisted) && (
              <div className="mt-3">
                <Field label="סיבה">
                  {E ? <input className="input w-full text-sm" placeholder="סיבת blacklist" value={form?.blacklistReason||''} onChange={e=>set('blacklistReason',e.target.value)} />
                     : <div className="text-sm text-red-600">{g.blacklistReason||'—'}</div>}
                </Field>
              </div>
            )}
          </div>
        </div>
      );

      case 'preferences': return (
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeader icon={Bed} title="העדפות חדר" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="סוג חדר מועדף">
                {E ? <input className="input w-full text-sm" placeholder="Deluxe, Suite..." value={form?.roomTypePreference||''} onChange={e=>set('roomTypePreference',e.target.value)} />
                   : <div className="text-sm text-ink">{g.roomTypePreference||'—'}</div>}
              </Field>
              <Field label="סוג מיטה">
                {E ? <select className="select w-full text-sm" value={form?.bedTypePreference||''} onChange={e=>set('bedTypePreference',e.target.value)}>{Object.entries(BED_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                   : <div className="text-sm text-ink">{BED_TYPES[g.bedTypePreference]||'—'}</div>}
              </Field>
              <Field label="העדפת קומה">
                {E ? <select className="select w-full text-sm" value={form?.floorPreference||'any'} onChange={e=>set('floorPreference',e.target.value)}>{Object.entries(FLOOR_PREF).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                   : <div className="text-sm text-ink">{FLOOR_PREF[g.floorPreference]||'—'}</div>}
              </Field>
              <Field label="עישון">
                {E ? <select className="select w-full text-sm" value={form?.smokingPreference||'non-smoking'} onChange={e=>set('smokingPreference',e.target.value)}>{Object.entries(SMOKING_PREF).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                   : <div className="text-sm text-ink">{SMOKING_PREF[g.smokingPreference]||'—'}</div>}
              </Field>
              <Field label="כרית">
                {E ? <select className="select w-full text-sm" value={form?.pillow||''} onChange={e=>set('pillow',e.target.value)}>{Object.entries(PILLOW_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                   : <div className="text-sm text-ink">{PILLOW_TYPES[g.pillow]||'—'}</div>}
              </Field>
              <Field label="עיתון">
                {E ? <input className="input w-full text-sm" placeholder="Haaretz, TheMarker..." value={form?.newspaper||''} onChange={e=>set('newspaper',e.target.value)} />
                   : <div className="text-sm text-ink">{g.newspaper||'—'}</div>}
              </Field>
            </div>
          </div>
          <div>
            <SectionHeader icon={BookOpen} title="הערות והעדפות נוספות" />
            <div className="flex flex-col gap-4">
              {[
                {label:'בקשות מיוחדות',key:'specialRequests',ph:'בקשות ספציפיות...'},
                {label:'העדפות כלליות',key:'preferences',ph:'העדפות נוספות...'},
                {label:'אלרגיות',key:'allergies',ph:'אלרגיות למזון...'},
                {label:'הערות פנימיות',key:'internalNotes',ph:'לשימוש פנימי בלבד'},
              ].map(({label,key,ph})=>(
                <Field key={key} label={label}>
                  {E ? <textarea className="input w-full text-sm resize-none" rows={2} placeholder={ph} value={form?.[key]||''} onChange={e=>set(key,e.target.value)} />
                     : <div className="text-sm text-ink bg-surface-hover/50 rounded-lg p-2.5 min-h-8">{g[key]||<span className="text-ink-faint italic">—</span>}</div>}
                </Field>
              ))}
            </div>
          </div>
        </div>
      );

      case 'history': return (
        <div className="flex flex-col gap-3">
          <SectionHeader icon={History} title="היסטוריית שהיות" />
          {!(g.reservations||[]).length
            ? <div className="empty-state mt-4"><History size={28} className="empty-state-icon"/><span>אין שהיות קודמות</span></div>
            : (g.reservations||[]).map(r=>{
                const sm={checked_out:['#059669','עזב'],in_house:['#3b82f6','In House'],confirmed:['#6366f1','מאושר'],cancelled:['#ef4444','בוטל'],no_show:['#f59e0b','No Show']};
                const [color,label]=sm[r.status]||['#6b7280',r.status];
                return (
                  <div key={String(r._id)} className="rounded-xl border border-surface-border p-3 hover:border-brand/30 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-brand font-bold">{r.confirmationNumber}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{background:`${color}18`,color}}>{label}</span>
                      </div>
                      <div className="text-num font-bold text-sm">₪{Number(r.totalAmount||r.ratePerNight||0).toLocaleString()}</div>
                    </div>
                    <div className="text-xs text-ink-muted">
                      {r.arrivalDate} → {r.departureDate}
                      {r.roomType?.name&&<> · {r.roomType.name}</>}
                      {r.assignedRoom?.number&&<> · חדר {r.assignedRoom.number}</>}
                    </div>
                  </div>
                );
              })
          }
        </div>
      );

      case 'notes': return (
        <div className="flex flex-col gap-4">
          <SectionHeader icon={FileText} title="הערות פנימיות" />
          <div className="flex flex-col gap-2">
            <textarea className="input text-sm resize-none" rows={3} placeholder="הערה פנימית..." value={noteText} onChange={e=>setNoteText(e.target.value)} />
            <button className="btn btn-primary btn-sm self-end gap-1" onClick={addNote} disabled={addingNote||!noteText.trim()}>
              {addingNote?<Spinner size={12}/>:<Plus size={12}/>} הוסף הערה
            </button>
          </div>
          {!(g.notes||[]).length && <div className="empty-state mt-2"><FileText size={24} className="empty-state-icon"/><span className="text-xs">אין הערות</span></div>}
          {(g.notes||[]).slice().reverse().map(note=>(
            <div key={String(note._id)} className="rounded-xl border border-surface-border p-3 flex items-start gap-2 hover:border-brand/20 transition-colors">
              <div className="flex-1">
                <div className="text-sm text-ink">{note.text}</div>
                <div className="text-xs text-ink-faint mt-1">{note.createdBy} · {note.createdAt?new Date(note.createdAt).toLocaleDateString('he-IL'):''}</div>
              </div>
              <button className="btn btn-ghost btn-icon text-ink-faint hover:text-red-500" onClick={()=>deleteNote(String(note._id))}><Trash2 size={12}/></button>
            </div>
          ))}
        </div>
      );

      case 'tags': return (
        <div className="flex flex-col gap-4">
          <SectionHeader icon={Tag} title="תגיות" />
          <div className="flex flex-wrap gap-2">
            {PRESET_TAGS.map(tag=>{
              const active=(g.tags||[]).includes(tag);
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
            <input id="custom-tag-inp" className="input text-sm flex-1" placeholder="הוסף תגית מותאמת..." onKeyDown={async e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v){await toggleTag(v);e.target.value=''}}}} />
            <button className="btn btn-secondary btn-sm" onClick={async()=>{const inp=document.getElementById('custom-tag-inp');const v=inp?.value.trim();if(v){await toggleTag(v);inp.value=''}}}>הוסף</button>
          </div>
        </div>
      );

      case 'privacy': return (
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeader icon={Shield} title="הסכמות" />
            <div className="flex flex-col gap-3">
              {[
                {key:'marketingConsent',label:'הסכמה לשיווק',sub:g.marketingConsentAt?`ניתן: ${new Date(g.marketingConsentAt).toLocaleDateString('he-IL')}`:null},
                {key:'privacyConsent',label:'הסכמת מדיניות פרטיות',sub:g.privacyConsentAt?`ניתן: ${new Date(g.privacyConsentAt).toLocaleDateString('he-IL')}`:null},
              ].map(({key,label,sub})=>(
                <label key={key} className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-surface-border hover:bg-surface-hover transition-colors">
                  <input type="checkbox" disabled={!E} checked={E?!!form?.[key]:!!g[key]} onChange={e=>E&&set(key,e.target.checked)} className="w-4 h-4 rounded mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm text-ink font-semibold">{label}</div>
                    {sub&&<div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
                  </div>
                  {(E?!!form?.[key]:!!g[key])
                    ?<span className="text-xs text-green-600 font-semibold bg-green-50 border border-green-200 rounded px-1.5 py-0.5">✓ אושר</span>
                    :<span className="text-xs text-ink-faint">לא אושר</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/30 p-4">
            <div className="text-xs font-bold text-red-700 mb-3 flex items-center gap-1.5"><ShieldOff size={12}/>פעולות GDPR</div>
            <div className="flex flex-col gap-2">
              <button className="btn btn-secondary btn-sm gap-1 w-full justify-center" onClick={()=>setShowMerge(true)}><Merge size={12}/>מזג פרופיל</button>
              <button className="btn btn-secondary btn-sm gap-1 w-full justify-center" onClick={exportData} disabled={exporting}>
                {exporting?<Spinner size={12}/>:<Download size={12}/>} ייצוא נתונים אישיים
              </button>
              {!anonConf
                ?<button className="btn btn-danger btn-sm gap-1 w-full justify-center" onClick={()=>setAnonConf(true)}><ShieldOff size={12}/>אנונמיזציה (GDPR)</button>
                :(
                  <div className="flex flex-col gap-2 p-2 border border-red-300 rounded-xl bg-red-100">
                    <div className="text-xs text-red-800 font-bold text-center">פעולה בלתי הפיכה!</div>
                    <div className="flex gap-2">
                      <button className="btn btn-danger btn-sm flex-1 justify-center" onClick={anonymize}>כן, מחק</button>
                      <button className="btn btn-secondary btn-sm flex-1 justify-center" onClick={()=>setAnonConf(false)}>ביטול</button>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      );

      default: return null;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex" style={{ direction:'rtl' }}>
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full flex shadow-2xl overflow-hidden" style={{ maxWidth:860 }}>
        <ToastContainer toasts={toasts} />
        {showMerge && <MergeModal guest={g} propertyId={propertyId} onClose={()=>setShowMerge(false)} onMerged={()=>{refetch();onUpdated?.();}} />}

        {/* OPERA dark sidebar */}
        <div className="w-52 flex-shrink-0 flex flex-col overflow-y-auto" style={{ background:'#1a2235', direction:'rtl' }}>
          <div className="px-4 py-5 border-b border-white/10 flex flex-col items-center gap-2">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black"
              style={{ background: isVip?`${vipColor}30`:'rgba(99,102,241,0.2)', color: isVip?vipColor:'#818cf8' }}>
              {initial||<User size={22}/>}
            </div>
            {loading
              ? <div className="h-4 w-28 bg-white/10 rounded animate-pulse"/>
              : (
                <div className="text-center">
                  <div className="text-white font-bold text-sm leading-tight">{g.title?`${g.title} `:''}{g.firstName} {g.lastName}</div>
                  {g.company && <div className="text-xs text-white/40 mt-0.5">{g.company}</div>}
                  {isVip && (
                    <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold"
                      style={{ background:`${vipColor}25`, color:vipColor }}>
                      <Crown size={9}/>{VIP_LABELS[g.vipLevel]}
                    </div>
                  )}
                  {g.membershipTier && g.membershipTier!=='' && (
                    <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold"
                      style={{ background:`${MEMBERSHIP_COLORS[g.membershipTier]}25`, color:MEMBERSHIP_COLORS[g.membershipTier] }}>
                      <Star size={8}/>{MEMBERSHIP_TIERS[g.membershipTier]}
                    </div>
                  )}
                </div>
              )
            }
          </div>

          <nav className="flex-1 py-2">
            {SECTIONS.map(({id,label,icon:Icon})=>{
              const active = section===id;
              return (
                <button key={id} onClick={()=>setSection(id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-right"
                  style={active
                    ?{background:'rgba(99,102,241,0.25)',color:'#a5b4fc',borderRight:'3px solid #6366f1'}
                    :{color:'rgba(255,255,255,0.5)'}}>
                  <Icon size={14} className="flex-shrink-0"/>
                  <span className="font-medium">{label}</span>
                  {id==='notes'&&(g.notes||[]).length>0&&<span className="mr-auto text-xs bg-white/10 rounded-full px-1.5 py-0.5 text-white/60">{(g.notes||[]).length}</span>}
                  {id==='tags'&&(g.tags||[]).length>0&&<span className="mr-auto text-xs bg-white/10 rounded-full px-1.5 py-0.5 text-white/60">{(g.tags||[]).length}</span>}
                  {id==='history'&&(g.reservations||[]).length>0&&<span className="mr-auto text-xs bg-white/10 rounded-full px-1.5 py-0.5 text-white/60">{(g.reservations||[]).length}</span>}
                </button>
              );
            })}
          </nav>

          <div className="px-4 py-3 border-t border-white/10 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">שהיות</span>
              <span className="text-white/80 font-bold">{stats.totalStays||0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">הכנסה</span>
              <span className="text-white/80 font-bold">{stats.totalRevenue?`₪${Number(stats.totalRevenue).toLocaleString()}`:'—'}</span>
            </div>
            {g.noShowCount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/40">No-Show</span>
                <span className="text-red-400 font-bold">{g.noShowCount}</span>
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="px-6 py-3 border-b border-surface-border flex items-center justify-between flex-shrink-0 bg-gray-50/80">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-ink">{SECTIONS.find(s=>s.id===section)?.label}</span>
              {g.isBlacklisted && <Badge color="#ef4444"><AlertTriangle size={9}/>Blacklisted</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {!editMode
                ? <button className="btn btn-secondary btn-sm gap-1" onClick={()=>setEditMode(true)}><Edit3 size={12}/>ערוך</button>
                : <>
                    <button className="btn btn-primary btn-sm gap-1" onClick={save} disabled={saving}>
                      {saving?<Spinner size={12}/>:<Save size={12}/>} שמור
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditMode(false);setForm({...raw});}}>ביטול</button>
                  </>
              }
              <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">{renderSection()}</div>
        </div>
      </div>
    </div>
  );
}

function NewGuestModal({ propertyId, onClose, onCreated }) {
  const [form, setForm] = useState({ firstName:'', lastName:'', title:'', email:'', phone:'', country:'ישראל', language:'he', vipLevel:0, gender:'unknown' });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  function set(k,v){ setForm(f=>({...f,[k]:v})); }

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try { const g = await guestApi.create({ propertyId, ...form, vipLevel:Number(form.vipLevel) }); onCreated(g); onClose(); }
    catch(err){ setError(err.message||'שגיאה'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.55)', direction:'rtl' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between" style={{ background:'#1a2235' }}>
          <div className="font-bold text-white flex items-center gap-2"><User size={14} className="text-indigo-400"/>אורח חדש</div>
          <button className="btn btn-ghost btn-icon text-white/60 hover:text-white" onClick={onClose}><X size={18}/></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">Title</label>
              <select className="select w-full text-sm" value={form.title} onChange={e=>set('title',e.target.value)}>
                {TITLE_OPTIONS.map(t=><option key={t} value={t}>{t||'—'}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">שם פרטי *</label>
              <input className="input w-full text-sm" required value={form.firstName} onChange={e=>set('firstName',e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">שם משפחה *</label>
              <input className="input w-full text-sm" required value={form.lastName} onChange={e=>set('lastName',e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">אימייל</label><input className="input w-full text-sm" type="email" value={form.email} onChange={e=>set('email',e.target.value)} /></div>
            <div><label className="text-xs font-semibold text-ink-secondary block mb-1">טלפון</label><input className="input w-full text-sm" value={form.phone} onChange={e=>set('phone',e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מדינה</label>
              <select className="select w-full text-xs" value={form.country} onChange={e=>set('country',e.target.value)}>{COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">מגדר</label>
              <select className="select w-full text-xs" value={form.gender} onChange={e=>set('gender',e.target.value)}>{Object.entries(GENDER_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-secondary block mb-1">VIP</label>
              <select className="select w-full text-xs" value={form.vipLevel} onChange={e=>set('vipLevel',e.target.value)}>{Object.entries(VIP_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
            </div>
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn btn-primary flex-1 justify-center" disabled={loading}>{loading?<Spinner size={14}/>:'צור פרופיל'}</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
      {selectedId && <GuestDrawer guestId={selectedId} propertyId={propertyId} onClose={()=>setSelectedId(null)} onUpdated={()=>refetch()} />}
      {showNew && <NewGuestModal propertyId={propertyId} onClose={()=>setShowNew(false)} onCreated={()=>{success('אורח נוצר!');refetch();}} />}

      <div className="page-header">
        <div>
          <div className="page-title">פרופילי אורחים</div>
          <div className="page-subtitle">{list.length} פרופילים רשומים</div>
        </div>
        <button className="btn btn-primary gap-1.5" onClick={()=>setShowNew(true)}><Plus size={14}/>אורח חדש</button>
      </div>

      <div className="flex flex-wrap gap-3 mb-3 items-center">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input pr-8 text-xs w-full" placeholder="שם, אימייל, טלפון, דרכון, Loyalty ID..." value={search} onChange={e=>handleSearch(e.target.value)} />
        </div>
        <button onClick={()=>setFilterVip(v=>!v)} className={`btn btn-sm gap-1 ${filterVip?'btn-primary':'btn-secondary'}`}><Crown size={11}/>VIP בלבד</button>
        <button onClick={()=>setFilterBL(v=>!v)}  className={`btn btn-sm gap-1 ${filterBL?'btn-danger':'btn-secondary'}`}><AlertTriangle size={11}/>Blacklisted</button>
        {(filterVip||filterBL||filterTag) && <button className="btn btn-ghost btn-sm text-ink-muted" onClick={()=>{setFilterVip(false);setFilterBL(false);setFilterTag('')}}><X size={11}/>נקה</button>}
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
            <tr><th>אורח</th><th>קשר</th><th>VIP / חברות</th><th>מסמך</th><th>שהיות</th><th>הכנסה</th><th>תגיות</th></tr>
          </thead>
          <tbody>
            {list.map(g=>{
              const initials=`${g.firstName?.slice(0,1)||''}${g.lastName?.slice(0,1)||''}`;
              const isVip=g.vipLevel>0;
              const vc=VIP_COLORS[g.vipLevel||0];
              return (
                <tr key={String(g._id)} className="cursor-pointer" onClick={()=>setSelectedId(String(g._id))}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="avatar text-xs font-bold flex-shrink-0"
                        style={{width:32,height:32,fontSize:11,background:g.isBlacklisted?'rgba(239,68,68,0.1)':isVip?`${vc}18`:'rgba(99,102,241,0.1)',color:g.isBlacklisted?'#dc2626':isVip?vc:'#6366f1'}}>
                        {initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 font-semibold text-ink text-sm">
                          {g.title?`${g.title} `:''}{g.firstName} {g.lastName}
                          {isVip&&<Crown size={10} style={{color:vc}}/>}
                          {g.isBlacklisted&&<AlertTriangle size={10} className="text-red-500"/>}
                        </div>
                        {g.company&&<div className="text-xs text-ink-faint">{g.company}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {g.email&&<div className="flex items-center gap-1 text-xs text-ink-secondary"><Mail size={9} className="text-ink-faint flex-shrink-0"/>{g.email}</div>}
                    {g.phone&&<div className="flex items-center gap-1 text-xs text-ink-muted"><Phone size={9} className="text-ink-faint flex-shrink-0"/>{g.phone}</div>}
                    {g.country&&<div className="flex items-center gap-1 text-xs text-ink-faint"><Globe size={9} className="flex-shrink-0"/>{g.country}</div>}
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      {isVip&&<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold" style={{background:`${vc}15`,color:vc}}><Crown size={9}/>{VIP_LABELS[g.vipLevel]}</span>}
                      {g.membershipTier&&g.membershipTier!==''&&<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold" style={{background:`${MEMBERSHIP_COLORS[g.membershipTier]}15`,color:MEMBERSHIP_COLORS[g.membershipTier]}}><Star size={8}/>{MEMBERSHIP_TIERS[g.membershipTier]}</span>}
                      {!isVip&&(!g.membershipTier||g.membershipTier==='')&&<span className="text-ink-faint text-xs">—</span>}
                    </div>
                  </td>
                  <td>
                    {g.passportNumber?<div className="text-xs font-mono text-ink">{g.passportNumber}</div>:<span className="text-ink-faint text-xs">—</span>}
                    {g.passportExpiry&&<div className="text-xs text-ink-faint">{new Date(g.passportExpiry).toLocaleDateString('he-IL')}</div>}
                  </td>
                  <td className="text-num font-semibold">{g.totalStays??0}</td>
                  <td className="text-num text-xs">{g.totalRevenue?`₪${Number(g.totalRevenue).toLocaleString()}`:'—'}</td>
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
