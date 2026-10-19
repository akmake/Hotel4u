// /book — hero, search, results (room type → rate options with the full price for the stay), the
// hotel in three lines and the rooms gallery. A search lives in the URL (?arrival&departure&adults…).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { HeroArt } from './BookArt';
import { useSite, withP, SearchBar, RoomMedia, Specs, Modal } from './BookLayout';
import { bookApi, money, readSearch, searchQuery, shortDate, guestsLabel } from './bookApi';

const WHY = {
  capacity: (r) => `החדר מתאים עד ${r.roomType.capacity.max} אורחים`,
  sold_out: () => 'אזל לתאריכים אלה',
  min_los: () => 'נדרש מספר לילות גדול יותר',
  closed: () => 'לא זמין לתאריכים אלה',
};

function RoomDetails({ room, onClose }) {
  return (
    <Modal title={room.name} onClose={onClose}>
      {room.images?.length > 1 ? (
        <div className="bk-gallery">{room.images.map((src) => <img key={src} src={src} alt={room.name} loading="lazy" />)}</div>
      ) : <RoomMedia room={room} />}
      <Specs room={room} />
      <p style={{ margin: 0 }}>{room.fullDesc || room.shortDesc}</p>
      {room.amenities?.length > 0 && (
        <div>
          <div className="bk-eyebrow" style={{ marginBottom: 10 }}>בחדר</div>
          <ul style={{ columns: 2, margin: 0, paddingInlineStart: 0, listStyle: 'none', display: 'block' }}>
            {room.amenities.map((a) => <li key={a} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><Check size={15} color="#a8834f" aria-hidden="true" />{a}</li>)}
          </ul>
        </div>
      )}
      <p className="bk-note" style={{ margin: 0 }}>
        עד {room.capacity.max} אורחים בחדר · עד {room.capacity.adults} מבוגרים{room.capacity.children ? ` · עד ${room.capacity.children} ילדים` : ''}
        {room.extraBed ? ' · אפשר מיטה נוספת' : ''}{room.crib ? ' · עריסה לפי בקשה' : ''}
      </p>
    </Modal>
  );
}

export default function BookSearchPage() {
  const { site, p } = useSite();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const q = useMemo(() => readSearch(sp), [sp]);
  const hasSearch = !!(q.arrival && q.departure);
  const [res, setRes] = useState({ data: null, error: null, loading: false });
  const [details, setDetails] = useState(null);
  const resultsRef = useRef(null);
  const prop = site.property;
  const indexOf = (id) => Math.max(0, site.roomTypes.findIndex((r) => r.id === id));

  useEffect(() => {
    if (!hasSearch) { setRes({ data: null, error: null, loading: false }); return undefined; }
    let live = true;
    setRes((r) => ({ ...r, loading: true, error: null }));
    bookApi.search(p, { arrival: q.arrival, departure: q.departure, adults: q.adults, children: q.children, childAges: q.ages.join(',') })
      .then((data) => { if (live) { setRes({ data, error: null, loading: false }); setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); } })
      .catch((error) => live && setRes({ data: null, error, loading: false }));
    return () => { live = false; };
  }, [p, q.arrival, q.departure, q.adults, q.children, q.ages.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = (s) => nav(withP(`/book?${searchQuery(s)}`, p));
  const choose = (room, offer) => nav(withP(`/book/checkout?${searchQuery(q, { room: room.roomType.id, plan: offer.ratePlanId, board: offer.board, sig: offer.priceSignature })}`, p));
  const available = res.data?.rooms.filter((r) => r.offers.length) || [];
  const off = res.data?.rooms.filter((r) => !r.offers.length) || [];

  return (
    <>
      <section className="bk-hero">
        <HeroArt />
        <div className="bk-wrap bk-hero-in bk-fade">
          <div className="bk-eyebrow" style={{ color: '#e2c391' }}>{prop.city ? `${prop.city} · ` : ''}הזמנה ישירה באתר המלון</div>
          <h1>{prop.headline || prop.name}</h1>
          <p>{prop.intro}</p>
        </div>
      </section>
      <div className="bk-wrap">
        <SearchBar site={site} value={q} onSearch={runSearch} busy={res.loading} />
      </div>

      {hasSearch && (
        <section className="bk-section" ref={resultsRef} style={{ paddingTop: 80, scrollMarginTop: 80 }} aria-live="polite">
          <div className="bk-wrap">
            <div className="bk-results-head">
              <div>
                <div className="bk-eyebrow">החדרים הפנויים</div>
                <h2>{shortDate(q.arrival)} – {shortDate(q.departure)}</h2>
              </div>
              <div className="bk-note" style={{ fontSize: 15 }}>
                {res.data ? `${res.data.nights} ${res.data.nights === 1 ? 'לילה' : 'לילות'} · ` : ''}{guestsLabel(q.adults, q.children)} · המחירים לכל השהייה וכוללים מע״מ
              </div>
            </div>
            {res.loading && [0, 1].map((i) => <div key={i} className="bk-skel" style={{ height: 300, marginBottom: 28 }} />)}
            {res.error && (
              <div className="bk-alert" role="alert">
                {res.error.fields ? Object.values(res.error.fields).join(' · ') : res.error.message}
              </div>
            )}
            {res.data && available.length === 0 && (
              <div className="bk-empty">
                <h3>אין חדר פנוי שמתאים לחיפוש</h3>
                <p className="bk-lead" style={{ marginInline: 'auto' }}>
                  {off.some((r) => r.unavailable === 'capacity') && off.every((r) => ['capacity', 'sold_out'].includes(r.unavailable))
                    ? `ההרכב גדול מהחדרים הפנויים. החדר הגדול ביותר מתאים עד ${site.maxGuests} אורחים — לקבוצה גדולה יותר צרו קשר ונמצא פתרון.`
                    : 'נסו תאריכים אחרים, או התקשרו אלינו ונשמח לעזור.'}
                </p>
                {prop.phone && <a className="bk-btn bk-btn-ghost" href={`tel:${prop.phone.replace(/[^\d+]/g, '')}`} style={{ marginTop: 14 }}>להתקשר למלון</a>}
              </div>
            )}
            {available.map((r) => (
              <article key={r.roomType.id} className="bk-result bk-fade">
                <RoomMedia room={r.roomType} index={indexOf(r.roomType.id)} />
                <div className="bk-result-body">
                  <div>
                    <h3>{r.roomType.name}</h3>
                    <p className="bk-lead" style={{ margin: '6px 0 0', fontSize: 15.5 }}>{r.roomType.shortDesc}</p>
                  </div>
                  <Specs room={r.roomType} />
                  {r.roomType.amenities.length > 0 && (
                    <div className="bk-amen">
                      {r.roomType.amenities.slice(0, 5).map((a) => <span key={a}>{a}</span>)}
                      <button type="button" className="bk-link" style={{ fontSize: 13.5 }} onClick={() => setDetails(r.roomType)}>כל פרטי החדר</button>
                    </div>
                  )}
                  <div className="bk-offers">
                    {r.offers.map((o) => (
                      <div key={o.key} className="bk-offer">
                        <div>
                          <div className="bk-offer-name">
                            {o.boardLabel || o.name}
                            {o.refundable ? <span className="bk-badge is-ok">ביטול גמיש</span> : <span className="bk-badge is-warn">ללא החזר</span>}
                            {o.left && <span className="bk-badge is-bad">{o.left === 1 ? 'נותר חדר אחרון' : `נותרו ${o.left} חדרים`}</span>}
                          </div>
                          <div className="bk-offer-terms">{o.cancellation}</div>
                          {o.payNow.kind === 'deposit' && <div className="bk-offer-terms">תשלום עכשיו: מקדמה {money(o.payNow.amount, res.data.currency)} ({o.payNow.pct}%)</div>}
                        </div>
                        <div className="bk-offer-price">
                          <b>{money(o.total, res.data.currency)}</b>
                          <small>{money(o.averageNight, res.data.currency)} ללילה בממוצע</small>
                          <button type="button" className="bk-btn bk-btn-primary bk-btn-sm" style={{ marginTop: 8 }} onClick={() => choose(r, o)}>להזמנה</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
            {available.length > 0 && off.map((r) => (
              <article key={r.roomType.id} className="bk-result is-off">
                <RoomMedia room={r.roomType} index={indexOf(r.roomType.id)} />
                <div className="bk-result-body">
                  <h3>{r.roomType.name}</h3>
                  <Specs room={r.roomType} />
                  <div className="bk-offer-terms">{(WHY[r.unavailable] || WHY.closed)(r)}</div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="bk-section" id="hotel" style={hasSearch ? { paddingTop: 30 } : undefined}>
        <div className="bk-wrap">
          <div className="bk-section-head">
            <div>
              <div className="bk-eyebrow">המלון</div>
              <h2>מקום לנשום בו</h2>
            </div>
            <p className="bk-lead">{prop.intro}</p>
          </div>
          <div className="bk-pillars">
            {[
              ['החדרים', `${site.roomTypes.length} סוגי חדרים וסוויטות, עד ${site.maxGuests} אורחים בחדר. לכל חדר — הגודל, המיטה והנוף מפורטים למטה.`],
              ['הגעה ועזיבה', `כניסה מ־${prop.checkInTime}, עזיבה עד ${prop.checkOutTime}.${prop.phone ? ` צוות הקבלה זמין בטלפון ${prop.phone}.` : ''}`],
              ['הזמנה ישירה', 'מחיר סופי לכל השהייה כולל מע״מ, אישור מיידי לדוא״ל ותשלום מאובטח באתר.'],
            ].map(([t, d], i) => (
              <div key={t} className="bk-pillar">
                <span className="bk-pillar-n">0{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bk-section" id="rooms" style={{ background: 'var(--sand)' }}>
        <div className="bk-wrap">
          <div className="bk-section-head">
            <div>
              <div className="bk-eyebrow">החדרים והסוויטות</div>
              <h2>{site.roomTypes.length} דרכים להתארח</h2>
            </div>
            <p className="bk-lead">בחרו תאריכים למעלה כדי לראות מחיר וזמינות לכל חדר.</p>
          </div>
          <div className="bk-rooms">
            {site.roomTypes.map((room, i) => (
              <article key={room.id} className="bk-room">
                <button type="button" onClick={() => setDetails(room)} style={{ all: 'unset', cursor: 'pointer', display: 'block' }} aria-label={`פרטי ${room.name}`}>
                  <RoomMedia room={room} index={i} />
                </button>
                <h3>{room.name}</h3>
                <p>{room.shortDesc}</p>
                <Specs room={room} />
                <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                  <button type="button" className="bk-link" onClick={() => setDetails(room)}>פרטי החדר</button>
                  <a className="bk-link" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => document.getElementById('bk-in')?.focus(), 500); }}>בדיקת זמינות</a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      {details && <RoomDetails room={details} onClose={() => setDetails(null)} />}
    </>
  );
}
