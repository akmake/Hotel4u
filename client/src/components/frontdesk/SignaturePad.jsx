// FD-05-F06 signature. Clearing is local until the registration is saved (U05).
import { useEffect, useRef, useState } from 'react';

export default function SignaturePad({ value, onChange, id }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(!value);

  useEffect(() => {
    // Keep the drawing crisp on high-DPI screens.
    const c = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * ratio;
    c.height = h * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#171717';
  }, []);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e) {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange?.(canvasRef.current.toDataURL('image/png'));
  }
  function clear() {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange?.(null);
  }

  return (
    <div>
      <div className="ui-sign">
        <canvas
          id={id}
          ref={canvasRef}
          aria-label="אזור חתימה — חתימה באמצעות עכבר, עט או מגע"
          role="img"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        {empty && <span className="ui-sign-ph" aria-hidden="true">חתימת האורח</span>}
      </div>
      <div className="flex justify-end mt-1">
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={empty}>ניקוי חתימה</button>
      </div>
    </div>
  );
}
