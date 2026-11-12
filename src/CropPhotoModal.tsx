import { useEffect, useRef, useState } from 'react';
import { Check, X, Scan, Crop } from 'lucide-react';

type CropRect = { x: number; y: number; w: number; h: number };
type Props = { file: File; onCancel: () => void; onScan: (file: File) => void };

export default function CropPhotoModal({ file, onCancel, onScan }: Props) {
  const [src, setSrc] = useState('');
  const [rect, setRect] = useState<CropRect | null>(null);
  const [processing, setProcessing] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function point(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)),
      y: Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100))
    };
  }

  function startSelect(event: React.PointerEvent<HTMLDivElement>) {
    if (processing) return;
    const p = point(event);
    if (!p) return;
    event.preventDefault();
    frameRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = p;
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function moveSelect(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    const current = point(event);
    if (!start || !current) return;
    setRect({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y)
    });
  }

  function stopSelect() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setRect(current => current && current.w >= 2 && current.h >= 2 ? current : null);
  }

  async function cropAndScan() {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !rect || rect.w < 2 || rect.h < 2) return;
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
      onScan(new File([blob], 'nexora-selected-photo.jpg', { type: 'image/jpeg' }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not crop this photo.');
      setProcessing(false);
    }
  }

  return <div className="modal-backdrop" style={{ zIndex: 1000 }}>
    <div className="review-modal" style={{ maxWidth: 560, width: '94vw', maxHeight: '92vh', overflowY: 'auto' }}>
      <div className="modal-head">
        <div><h2>Select Photo Area</h2><p>Touch and drag across the photo to draw a selection, just like selecting an area on a computer.</p></div>
        <button className="icon-button" onClick={onCancel} aria-label="Close"><X /></button>
      </div>
      <div style={{ background: '#101827', borderRadius: 14, padding: 10, textAlign: 'center', overflow: 'auto' }}>
        <div ref={frameRef} onPointerDown={startSelect} onPointerMove={moveSelect} onPointerUp={stopSelect} onPointerCancel={stopSelect}
          style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0, touchAction: 'none', userSelect: 'none', cursor: 'crosshair' }}>
          <img ref={imageRef} src={src} alt="Photo to select" draggable={false}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '58vh', width: 'auto', height: 'auto', objectFit: 'contain', pointerEvents: 'none' }} />
          {rect && <div style={{ position: 'absolute', left: rect.x + '%', top: rect.y + '%', width: rect.w + '%', height: rect.h + '%', border: '2px solid #1683ff', background: 'rgba(22,131,255,.12)', boxSizing: 'border-box', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' }}>
              {[0,1,2,3,4,5,6,7,8].map(n => <span key={n} style={{ borderRight: n%3!==2 ? '1px solid rgba(255,255,255,.55)' : 0, borderBottom: n<6 ? '1px solid rgba(255,255,255,.55)' : 0 }} />)}
            </div>
          </div>}
        </div>
      </div>
      <div className="review-tools" style={{ justifyContent: 'space-between' }}>
        <span><Crop size={15} /> {rect ? 'Area selected — drag again to change' : 'Drag to select the exact area'}</span>
        <button type="button" onClick={() => setRect(null)} disabled={!rect || processing}>Clear selection</button>
      </div>
      <div className="review-footer">
        <button className="secondary-action" onClick={onCancel} disabled={processing}>Cancel</button>
        <button className="primary-action" onClick={cropAndScan} disabled={processing || !rect || rect.w < 2 || rect.h < 2}><Scan />{processing ? 'Preparing...' : 'Crop & Scan'}</button>
      </div>
    </div>
  </div>;
}
