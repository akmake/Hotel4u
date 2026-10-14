// Charge code picker (G1): codes come from the property catalogue, grouped by revenue group.
// Manager-level codes are marked; the lodging code is never offered (system posting only).
import { useChargeCodes, manualCodes } from '../../hooks/useChargeCodes';

const GROUP_ORDER = ['rooms', 'f_and_b', 'other_operated', 'fees', 'misc'];

export default function ChargeCodeSelect({ id, propertyId, value, onChange, disabled }) {
  const { charges, revenueGroups = {}, loading, error } = useChargeCodes(propertyId);
  const list = manualCodes(charges);
  const groups = GROUP_ORDER.map((g) => ({ g, items: list.filter((c) => c.revenueGroup === g) })).filter((x) => x.items.length);
  return (
    <select
      id={id}
      className="select w-full"
      value={value || ''}
      disabled={disabled || loading}
      onChange={(ev) => onChange(list.find((c) => c.code === ev.target.value) || null)}
    >
      <option value="">{loading ? 'טוען קודים…' : error ? 'שגיאה בטעינת הקודים' : 'בחירה…'}</option>
      {groups.map(({ g, items }) => (
        <optgroup key={g} label={revenueGroups[g] || g}>
          {items.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}{c.postLevel === 'manager' ? ' · מנהל' : ''}{c.vatClass !== 'standard' ? ' · ללא מע״מ' : ''}{c.priceEditable === false && c.defaultPrice ? ` · ${Number(c.defaultPrice).toFixed(2)}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// VAT split for a gross amount under a code's class (mirrors the server; display only).
export function vatPreview(gross, code, vatRate) {
  const g = Math.round((Number(gross) + Number.EPSILON) * 100) / 100;
  if (code && code.vatClass && code.vatClass !== 'standard') return { net: g, tax: 0, exempt: true };
  const net = Math.round((g / (1 + Number(vatRate ?? 18) / 100) + Number.EPSILON) * 100) / 100;
  return { net, tax: Math.round((g - net + Number.EPSILON) * 100) / 100, exempt: false };
}
