import { useCallback, useRef, useState } from 'react';

export default function useReservationDragResize({
  dragActivationPx = 0,
  onTapReservation,
  resolveDropRoomId,
  resolveResizeDepartureDate,
}) {
  const [drag, setDrag] = useState(null);
  const [dropRoomId, setDropRoomId] = useState(null);
  const [resizeDraft, setResizeDraft] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);
  const [pendingResize, setPendingResize] = useState(null);

  const dragRef = useRef(null);
  const dropRef = useRef(null);
  const resizeRef = useRef(null);
  const suppressClickRef = useRef(false);

  const startDrag = useCallback((e, res, sourceRoomId) => {
    e.preventDefault();
    const info = {
      res,
      resId: String(res._id),
      sourceRoomId: String(sourceRoomId),
    };
    dragRef.current = info;
    dropRef.current = null;

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = dragActivationPx <= 0;

    if (moved) {
      setDrag({ ...info, x: startX, y: startY });
    }

    function onMove(ev) {
      if (!moved) {
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (Math.max(dx, dy) <= dragActivationPx) return;
        moved = true;
      }

      setDrag((current) => (
        current
          ? { ...current, x: ev.clientX, y: ev.clientY }
          : { ...info, x: ev.clientX, y: ev.clientY }
      ));

      const rid = resolveDropRoomId ? resolveDropRoomId(ev.clientX, ev.clientY) : null;
      dropRef.current = rid;
      setDropRoomId(rid);
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      const dragData = dragRef.current;
      const targetRoomId = dropRef.current;

      setDrag(null);
      setDropRoomId(null);
      dragRef.current = null;
      dropRef.current = null;

      if (!dragData) return;
      if (!moved) {
        onTapReservation?.(dragData.res);
        return;
      }

      if (targetRoomId && targetRoomId !== dragData.sourceRoomId && targetRoomId !== 'unassigned') {
        setPendingMove({
          res: dragData.res,
          resId: dragData.resId,
          sourceRoomId: dragData.sourceRoomId,
          targetRoomId,
        });
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [dragActivationPx, onTapReservation, resolveDropRoomId]);

  const startResize = useCallback((e, res) => {
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = true;

    if (!resolveResizeDepartureDate) {
      setTimeout(() => { suppressClickRef.current = false; }, 0);
      return;
    }

    const startState = {
      res,
      resId: String(res._id),
      oldDepartureDate: res.departureDate,
      newDepartureDate: res.departureDate,
    };
    resizeRef.current = startState;
    setResizeDraft(startState);

    function onMove(ev) {
      const nextDeparture = resolveResizeDepartureDate(ev.clientX, ev.clientY, res);
      if (!nextDeparture) return;

      setResizeDraft((current) => (
        current ? { ...current, newDepartureDate: nextDeparture } : null
      ));
      if (resizeRef.current) {
        resizeRef.current = { ...resizeRef.current, newDepartureDate: nextDeparture };
      }
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      const finalState = resizeRef.current;
      setResizeDraft(null);
      resizeRef.current = null;

      if (finalState && finalState.newDepartureDate !== finalState.oldDepartureDate) {
        setPendingResize(finalState);
      }

      setTimeout(() => { suppressClickRef.current = false; }, 0);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [resolveResizeDepartureDate]);

  return {
    drag,
    dropRoomId,
    resizeDraft,
    pendingMove,
    setPendingMove,
    pendingResize,
    setPendingResize,
    suppressClickRef,
    startDrag,
    startResize,
  };
}
