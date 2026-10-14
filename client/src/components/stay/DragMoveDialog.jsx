// Dropping a booking on another room in the room chart / room rack.
//  - Guest already in house → this is a room MOVE (FD-09): the real move dialog opens with the
//    dropped-on room preselected (remaining nights, price rule by initiator, old room to cleaning).
//  - Booking not arrived yet → this is an ASSIGNMENT (INV-02): no price question at all; replacing
//    an existing assignment asks for a reason. The server re-checks every night for conflicts.
import { useAuthStore } from '../../stores/authStore';
import { reservations as resApi } from '../../utils/api';
import { ConfirmDialog } from '../kit';
import { MoveRoomDialog } from './StayChangeDialogs';

const IN_HOUSE = ['in_house', 'checked_in', 'partially_checked_in', 'partially_checked_out'];
const PRICE_ROLES = ['super_admin', 'chain_admin', 'property_admin', 'general_manager', 'front_desk_manager', 'revenue_manager'];

export default function DragMoveDialog({ pending, rooms, propertyId, onClose, onDone }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!pending) return null;
  const { res, resId, sourceRoomId, targetRoomId } = pending;
  const target = (rooms || []).find((r) => String(r._id) === String(targetRoomId));
  const source = (rooms || []).find((r) => String(r._id) === String(sourceRoomId));
  const guest = res?.primaryGuest ? `${res.primaryGuest.firstName || ''} ${res.primaryGuest.lastName || ''}`.trim() : '';

  if (IN_HOUSE.includes(res?.status)) {
    return (
      <MoveRoomDialog
        open
        onClose={onClose}
        propertyId={propertyId}
        reservationId={resId}
        fromRoomId={sourceRoomId || undefined}
        initialRoomId={String(targetRoomId)}
        canChangePrice={PRICE_ROLES.includes(role)}
        onDone={(out) => onDone(`${guest || 'האורח'} עבר מחדר ${out.from || '—'} לחדר ${out.to}${out.price?.changed ? ` · מחיר הלילות שנותרו עודכן (${out.price.difference > 0 ? '+' : ''}${out.price.difference})` : ''}${out.key ? ' · יש להנפיק מפתח' : ''}`)}
      />
    );
  }

  const replacing = !!sourceRoomId;
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="שיבוץ חדר"
      subtitle={`${guest}${res?.confirmationNumber ? ` · ${res.confirmationNumber}` : ''}`}
      confirmLabel={`שיבוץ לחדר ${target?.number || ''}`}
      requireReason={replacing}
      reasonLabel="סיבת החלפת השיבוץ"
      onConfirm={async (reason) => {
        await resApi.assignRoom(resId, targetRoomId, replacing ? { reason } : {});
        onDone(`שובץ חדר ${target?.number || ''}`);
      }}
    >
      <p className="ui-p">
        {replacing ? `השיבוץ יוחלף מחדר ${source?.number || '—'} לחדר ${target?.number || '—'}.` : `ההזמנה תשובץ לחדר ${target?.number || '—'}.`}
        {' '}האורח עוד לא הגיע — המחיר שהוסכם לא משתנה. לשינוי סוג חדר או מחיר: "שינוי הזמנה" בתיק ההזמנה.
      </p>
    </ConfirmDialog>
  );
}
