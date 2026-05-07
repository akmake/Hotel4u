import { useState } from 'react';
import { ArrowLeft, Crown, X } from 'lucide-react';

function nightsBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

function fmt(n) {
  return Math.abs(n).toLocaleString('he-IL');
}

export default function RoomMoveDialog({ pending, allRooms, onConfirm, onCancel }) {
  const { res, sourceRoomId, targetRoomId } = pending;
  const g = res.primaryGuest || {};
  const targetRoom = allRooms.find(r => String(r._id) === String(targetRoomId));
  const sourceRoom = allRooms.find(r => String(r._id) === String(sourceRoomId));

  const currentRate = res.ratePerNight || 0;
  const nights      = nightsBetween(res.arrivalDate, res.departureDate);
  const suggested   = targetRoom?.roomType?.baseRate ?? currentRate;

  const [newRate,  setNewRate]  = useState(String(suggested));
  const [adjType,  setAdjType]  = useState('none');

  const parsedNew = Number(newRate) || 0;
  const diff      = parsedNew - currentRate;
  const totalDiff = diff * nights;

  function getAmount() {
    switch (adjType) {
      case 'charge_full': return  totalDiff;
      case 'charge_half': return  totalDiff / 2;
      case 'credit_full': return -Math.abs(totalDiff);
      case 'credit_half': return -Math.abs(totalDiff) / 2;
      default:            return  0;
    }
  }

  function getNote() {
    const from = sourceRoom?.number || '—';
    const to   = targetRoom?.number || '—';
    const base = `העברה מחדר ${from} לחדר ${to}`;
    switch (adjType) {
      case 'charge_full': return `חיוב הפרש מלא — ${base}`;
      case 'charge_half': return `חיוב חצי הפרש — ${base}`;
      case 'credit_full': return `זיכוי מלא — ${base}`;
      case 'credit_half': return `זיכוי חצי הפרש — ${base}`;
      default:            return base;
    }
  }

  const OPTIONS = [
    { value: 'none',        label: 'ללא שינוי במחיר',  amount: 0,                        color: '#64748b' },
    { value: 'charge_full', label: 'חיוב הפרש מלא',    amount: totalDiff,                 color: '#dc2626', prefix: '+' },
    { value: 'charge_half', label: 'חיוב חצי הפרש',    amount: totalDiff / 2,             color: '#ea580c', prefix: '+' },
    { value: 'credit_full', label: 'זיכוי מלא',        amount: -Math.abs(totalDiff),      color: '#059669', prefix: '−' },
    { value: 'credit_half', label: 'זיכוי חצי הפרש',   amount: -Math.abs(totalDiff) / 2, color: '#0891b2', prefix: '−' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ direction: 'rtl' }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative w-full max-w-md overflow-hidden"
        style={{ background: '#fff', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}
      >
        {/* ── Header ── */}
        <div style={{ background: 'linear-gradient(135deg,#2A1A0E,#4A3020)', padding: '18px 20px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>העברת חדר</span>
            <button
              onClick={onCancel}
              style={{ color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            {g.vipLevel > 0 && <Crown size={12} style={{ color: '#fde68a' }} />}
            <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600, fontSize: 13 }}>
              {g.firstName} {g.lastName}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>·</span>
            <span style={{ color: 'rgba(196,147,64,0.85)', fontSize: 12 }}>{nights} לילות</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
              חדר {sourceRoom?.number || '—'}
            </span>
            <ArrowLeft size={12} style={{ color: '#C49340' }} />
            <span style={{ color: '#C49340', fontSize: 13, fontWeight: 700 }}>
              חדר {targetRoom?.number || '—'}
            </span>
            {targetRoom?.roomType?.name && (
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
                ({targetRoom.roomType.name})
              </span>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Rate comparison */}
          <div style={{ background: '#F7F3EE', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#6B4C30' }}>מחיר נוכחי ללילה</span>
              <span style={{ fontWeight: 700, color: '#2A1A0E', fontFamily: 'monospace' }}>
                ₪{currentRate.toLocaleString('he-IL')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#6B4C30' }}>מחיר חדר חדש ללילה</span>
              <input
                type="number"
                value={newRate}
                onChange={e => setNewRate(e.target.value)}
                style={{
                  width: 110, textAlign: 'left', fontFamily: 'monospace',
                  fontWeight: 700, fontSize: 13, color: '#2A1A0E',
                  border: '1.5px solid #C8B89A', borderRadius: 7,
                  padding: '4px 8px', background: '#fff', outline: 'none',
                }}
              />
            </div>
            {diff !== 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderTop: '1px solid #DDD0BC', paddingTop: 10, marginTop: 10,
              }}>
                <span style={{ fontSize: 12, color: '#6B4C30', fontWeight: 600 }}>
                  הפרש סה"כ ({nights} לילות)
                </span>
                <span style={{
                  fontWeight: 800, fontFamily: 'monospace', fontSize: 15,
                  color: diff > 0 ? '#dc2626' : '#059669',
                }}>
                  {diff > 0 ? '+' : '−'}₪{fmt(totalDiff)}
                </span>
              </div>
            )}
          </div>

          {/* Options */}
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#9A7A50',
              textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 8,
            }}>
              מה לעשות עם ההפרש?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {OPTIONS.map(opt => {
                const active = adjType === opt.value;
                const showAmount = opt.amount !== 0 && Math.abs(totalDiff) > 0;
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                      border: `1.5px solid ${active ? opt.color : '#DDD0BC'}`,
                      background: active ? `${opt.color}12` : '#FAFAF8',
                      transition: 'border-color 0.12s, background 0.12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio" name="adj" value={opt.value}
                        checked={active}
                        onChange={() => setAdjType(opt.value)}
                        style={{ accentColor: opt.color, width: 14, height: 14 }}
                      />
                      <span style={{
                        fontSize: 13, fontWeight: active ? 700 : 500,
                        color: active ? opt.color : '#2A1A0E',
                      }}>
                        {opt.label}
                      </span>
                    </div>
                    {showAmount && (
                      <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: opt.color }}>
                        {opt.prefix}₪{fmt(opt.amount)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onConfirm({ amount: getAmount(), note: getNote(), newRate: parsedNew })}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                cursor: 'pointer', fontWeight: 700, fontSize: 13, color: '#fff',
                background: 'linear-gradient(135deg,#2A1A0E,#4A3020)',
              }}
            >
              אשר העברה
            </button>
            <button
              onClick={onCancel}
              style={{
                padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
                fontWeight: 600, fontSize: 13, color: '#6B4C30',
                border: '1.5px solid #DDD0BC', background: '#fff',
              }}
            >
              ביטול
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
