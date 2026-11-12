import { useEffect, useRef, useState } from 'react';
import { Check, X, Scan, Move } from 'lucide-react';

type CropRect = { x: number; y: number; w: number; h: number };
type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type Props = { file: File; onCancel: () => void; onScan: (file: File) => void };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function CropPhotoModal({ file, onCancel, onScan }: Props) {
  const [src, setSrc] = useState('');
  const [rect, setRect] = useState<CropRect>({ x: 4, y: 4, w: 92, h: 92 });
  const [processing, setProcessing] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; rect: CropRect } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function startDrag(event: React.PointerEvent<HTMLDivElement>, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    frameRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect: { ...rect } };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!drag || !bounds) return;
    const dx = (event.clientX - drag.startX) / bounds.width * 100;
    const dy = (event.clientY - drag.startY) / bounds.height * 100;
    const r = drag.rect;
    const min = 8;
    let next = { ...r };
    if (drag.mode === 'move') {
      next.x = clamp(r.x + dx, 0, 100 - r.w);
      next.y = clamp(r.y + dy, 0, 100 - r.h);
    } else {
      if (drag.mode.includes('w')) {
        next.x = clamp(r.x + dx, 0, r.x + r.w - min);
        next.w = r.w + r.x - next.x;
      }
      if (drag.mode.includes('e')) next.w = clamp(r.w + dx, min, 100 - r.x);
      if (drag.mode.includes('n')) {
        next.y = clamp(r.y + dy, 0, r.y + r.h - min);
        next.h = r.h + r.y - next.y;
      }
      if (drag.mode.includes('s')) next.h = clamp(r.h + dy, min, 100 - r.y);
    }
    setRect(next);
  }

  function stopDrag() {
    dragRef.current = null;
  }

  async function cropAndScan() {
    const image = imageRef.current;
    if (!image || !image.naturalWidth) return;
    setProcessing(true);
    try {
      const sx = Math.round(image.naturalWidth * rect.x / 100);
      const sy = Math.round(image.naturalHeight * rect.y / 100);
      const sw = Math.max(1, Math.round(image.naturalWidth * rect.w / 100));
      const sh = Math.max(1, Math.round(image.naturalHeight * rect.h / 100));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not crop this photo.');
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Photo crop failed.')), 'image/jpeg', 0.92);
      });
      onScan(new File([blob], 'nexora-cropped-photo.jpg', { type: 'image/jpeg' }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not crop this photo.');
      setProcessing(false);
    }
  }

  const handleStyle: React.CSSProperties = {
    position: 'absolute', width: 22, height: 22, borderRadius: 7,
    background: '#fff', border: '3px solid #1677ff', zIndex: 3,
    touchAction: 'none', padding: 0
  };

  return <div className="modal-backdrop" style={{ zIndex: 1000 }}>
    <div className="review-modal" style={{ maxWidth: 560, width: '94vw', maxHeight: '92vh', overflowY: 'auto' }}>
      <div className="modal-head">
        <div><h2>Select Paper Area</h2><p>Drag the four blue corners to fit the paper. Move inside the frame to reposition it.</p></div>
        <button className="icon-button" onClick={onCancel} aria-label="Close"><X /></button>
      </div>
      <div style={{ background: '#101827', borderRadius: 14, padding: 10, textAlign: 'center', overflow: 'hidden' }}>
        <div ref={frameRef} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}
          style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0, touchAction: 'none', userSelect: 'none' }}>
          <img ref={imageRef} src={src} alt="Photo to crop" draggable={false}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '58vh', width: 'auto', height: 'auto', objectFit: 'contain' }} />
          <div onPointerDown={event => startDrag(event, 'move')}
            style={{ position: 'absolute', left: rect.x + '%', top: rect.y + '%', width: rect.w + '%', height: rect.h + '%', border: '2px solid #1683ff', background: 'rgba(22,131,255,.08)', boxSizing: 'border-box', cursor: 'move', touchAction: 'none' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr', pointerEvents: 'none' }}>
              {[0,1,2,3,4,5,6,7,8].map(n => <span key={n} style={{ borderRight: n%3!==2 ? '1px solid rgba(255,255,255,.55)' : 0, borderBottom: n<6 ? '1px solid rgba(255,255,255,.55)' : 0 }} />)}
            </div>
          </div>
          {(['nw','ne','sw','se'] as const).map(corner => <div key={corner}
            onPointerDown={event => startDrag(event, corner)}
            style={{ ...handleStyle, left: (corner.includes('w') ? rect.x : rect.x + rect.w) + '%', top: (corner.includes('n') ? rect.y : rect.y + rect.h) + '%', transform: 'translate(-50%,-50%)', cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize' }} />)}
        </div>
      </div>
      <div className="review-tools" style={{ justifyContent: 'space-between' }}><span><Move size={15} /> Adjust crop area</span><span>Original photo stays unchanged</span></div>
      <div className="review-footer">
        <button className="secondary-action" onClick={onCancel} disabled={processing}>Cancel</button>
        <button className="primary-action" onClick={cropAndScan} disabled={processing}><Scan />{processing ? 'Preparing...' : 'Crop & Scan'}</button>
      </div>
    </div>
  </div>;
}
