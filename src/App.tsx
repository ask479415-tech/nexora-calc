import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Plus, Trash2, Pencil, Check, FileDown, MessageCircle, History, RefreshCw, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { createWorker } from 'tesseract.js';

type Entry = { id: number; raw: string; kg: number; grams: number };
type SavedBill = { id: number; date: string; entries: Entry[]; totalKg: number; totalGrams: number };
const STORE = 'nexora-calc-bills-v1';

function extractWeightRows(ocrText: string): Entry[] {
  const rows: Entry[] = [];
  for (const line of ocrText.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^[•*\-–—]+\s*/, '').replace(/\b(?:kg|kgs|gram|grams|gm|g)\b/gi, '').trim();
    if (!cleaned || /total|date|phone|mobile|page|invoice|bill/i.test(cleaned)) continue;
    const withoutSerial = cleaned
      .replace(/^(?:sl\.?\s*no\.?|serial\s*no\.?)\s*\d{1,3}\s*[:.)-]?\s*/i, '')
      .replace(/^\d{1,3}\s*[,.)-]\s*(?=\d{1,3}\s*[,.:/\-])/, '')
      .replace(/^\d{1,3}\s+(?=\d{1,3}\s*[,.:/\-])/, '');
    const match = withoutSerial.match(/^(\d{1,3})\s*[,.:/\-]\s*(\d{1,3})$/)
      || withoutSerial.match(/^(\d{1,3})\s+(\d{3})$/);
    if (!match) continue;
    const kg = Number(match[1]);
    const grams = Number(match[2].padEnd(3, '0'));
    if (kg < 1 || kg > 300 || grams < 0 || grams > 999) continue;
    rows.push({ id: Date.now() + Math.random(), raw: match[1] + ',' + match[2], kg, grams });
  }
  return rows;
}
async function makeOcrImages(file: File): Promise<HTMLCanvasElement[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(2, Math.min(3, 2200 / bitmap.width));
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('Image processing is not supported on this device.');
  sourceCtx.imageSmoothingEnabled = true; sourceCtx.imageSmoothingQuality = 'high';
  sourceCtx.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  const pixels = sourceCtx.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114;
    const v = Math.max(0, Math.min(255, (gray - 128) * 1.65 + 128));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
  }
  sourceCtx.putImageData(pixels, 0, 0);
  const images: HTMLCanvasElement[] = [];
  for (let band = 0; band < 3; band++) {
    const y = Math.floor(band * height / 3), bottom = band === 2 ? height : Math.floor((band + 1) * height / 3);
    const crop = document.createElement('canvas'); crop.width = width; crop.height = bottom - y;
    const ctx = crop.getContext('2d', { willReadFrequently: true }); if (!ctx) continue;
    ctx.drawImage(source, 0, y, width, bottom - y, 0, 0, width, bottom - y); images.push(crop);
  }
  return images;
}
function thresholdImage(input: HTMLCanvasElement, threshold: number): HTMLCanvasElement {
  const output = document.createElement('canvas'); output.width = input.width; output.height = input.height;
  const ctx = output.getContext('2d', { willReadFrequently: true }); if (!ctx) return input;
  ctx.drawImage(input, 0, 0);
  const pixels = ctx.getImageData(0, 0, output.width, output.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const v = pixels.data[i] >= threshold ? 255 : 0;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
  }
  ctx.putImageData(pixels, 0, 0); return output;
}
function voteOcrRows(results: Entry[][]): Entry[] {
  const base = results[0] || [];
  const longest = results.reduce((best, current) => current.length > best.length ? current : best, base);
  return longest.map((fallback, index) => {
    const counts = new Map<string, { count: number; entry: Entry }>();
    results.map(r => r[index]).filter(Boolean).forEach(entry => {
      const key = entry.kg + ',' + String(entry.grams).padStart(3, '0');
      const old = counts.get(key); counts.set(key, { count: (old?.count || 0) + 1, entry });
    });
    const winner = [...counts.values()].sort((x, y) => y.count - x.count)[0];
    return { ...(winner && winner.count > 1 ? winner.entry : fallback), id: Date.now() + Math.random() + index };
  });
}
function digits(value: string) {
  return value.replace(/[，.]/g, ',');
}
function parseEntry(value: string): Entry | null {
  const clean = digits(value).replace(/[^0-9,]/g, '');
  const match = clean.match(/^(\d{1,4})[,]?(\d{1,3})?$/);
  if (!match) return null;
  const kg = Number(match[1]);
  const grams = match[2] ? Number(match[2].padEnd(3, '0')) : 0;
  if (kg < 1 || grams > 999) return null;
  return { id: Date.now() + Math.random(), raw: value, kg, grams };
}
function total(entries: Entry[]) {
  const grams = entries.reduce((sum, entry) => sum + entry.kg * 1000 + entry.grams, 0);
  return { totalKg: Math.floor(grams / 1000), totalGrams: grams % 1000 };
}
function readBills(): SavedBill[] {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Take a photo or choose a page from your gallery.');
  const [bills, setBills] = useState<SavedBill[]>(readBills);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [reviewPhoto, setReviewPhoto] = useState<string | null>(null);
  const [pendingEntries, setPendingEntries] = useState<Entry[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const sum = useMemo(() => total(entries), [entries]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  async function scan(file?: File) {
    if (!file) return;
    setBusy(true); setMessage('Enhancing the photo and comparing multiple OCR readings...');
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      worker = await createWorker('eng');
      const images = await makeOcrImages(file), detected: Entry[] = [];
      for (const image of images) {
        const readings: Entry[][] = [];
        for (const variant of [image, thresholdImage(image, 155), thresholdImage(image, 195)]) {
          await worker.setParameters({ tessedit_pageseg_mode: '6' as any, tessedit_char_whitelist: '0123456789,. ', preserve_interword_spaces: '1' });
          const result = await worker.recognize(variant);
          readings.push(extractWeightRows(result.data.text));
        }
        detected.push(...voteOcrRows(readings));
      }
      setPendingEntries(detected); setSelectedIds(detected.map(item => item.id));
      setReviewPhoto(URL.createObjectURL(file));
      setMessage(detected.length
        ? detected.length + ' possible weights found using 3 OCR readings per section. Check every digit before calculating.'
        : 'No clear weight entries detected. You can add them manually.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OCR could not run. Please try again.');
    } finally { if (worker) await worker.terminate(); setBusy(false); }
  }
  function confirmPhotoSelection() {
    const chosen = pendingEntries.filter(item => selectedIds.includes(item.id));
    setEntries(chosen);
    if (reviewPhoto) URL.revokeObjectURL(reviewPhoto);
    setReviewPhoto(null); setPendingEntries([]); setSelectedIds([]);
    setMessage(chosen.length + ' selected entries are ready for calculation.');
  }
  function cancelPhotoReview() {
    if (reviewPhoto) URL.revokeObjectURL(reviewPhoto);
    setReviewPhoto(null); setPendingEntries([]); setSelectedIds([]);
    setMessage('Photo selection cancelled.');
  }
  function addEntry() {
    const item = parseEntry(draft);
    if (!item) { setMessage('Enter a weight like 44,100 or 39,300.'); return; }
    setEntries(old => [...old, item]); setDraft('');
  }
  function updateEntry(id: number, value: string) {
    const item = parseEntry(value);
    if (item) setEntries(old => old.map(entry => entry.id === id ? { ...item, id } : entry));
  }
  function saveBill() {
    if (!entries.length) return;
    const bill = { id: Date.now(), date: new Date().toLocaleString('en-IN'), entries, ...sum };
    const next = [bill, ...bills].slice(0, 100);
    setBills(next); localStorage.setItem(STORE, JSON.stringify(next));
    setMessage('Bill saved to history.');
  }
  function pdf() {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const w = doc.internal.pageSize.getWidth(), m = 16, now = new Date(), tableW = w - 2 * m;
    const billNo = 'NXD-' + String(now.getTime()).slice(-8);
    doc.setFillColor(18, 42, 72); doc.rect(0, 0, w, 43, 'F');
    doc.setFillColor(35, 101, 162); doc.roundedRect(m, 9, 25, 25, 4, 4, 'F');
    doc.setDrawColor(225, 242, 255); doc.setLineWidth(1.2);
    doc.line(m+12.5,12,m+12.5,19); doc.line(m+5,19,m+20,19);
    doc.line(m+7,19,m+4,27); doc.line(m+18,19,m+21,27);
    doc.line(m+2,27,m+8,27); doc.line(m+17,27,m+23,27);
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(19);
    doc.text('NEXORA DIGITAL',m+32,19);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(198,216,235);
    doc.text('WEIGHT RECORD & BILL',m+32,27);
    doc.setFontSize(8); doc.text('DIGITAL WEIGHT CALCULATION',m+32,33);
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9);
    doc.text('INVOICE',w-m,15,{align:'right'});
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    doc.text('Bill No: '+billNo,w-m,23,{align:'right'});
    doc.text('Date: '+now.toLocaleDateString('en-IN'),w-m,30,{align:'right'});
    let y=55; doc.setTextColor(35,53,73); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('BILL TO',m,y); doc.setDrawColor(205,215,226); doc.setLineWidth(.35);
    doc.line(m,y+2,w-m,y+2); doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(90,105,121);
    doc.text('Customer Name: __________________________________',m,y+12);
    doc.text('Phone: __________________________',w-m,y+12,{align:'right'});
    doc.text('Address: ______________________________________________________________',m,y+22);
    y=91; doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(35,53,73);
    doc.text('WEIGHT DETAILS',m,y); y+=8;
    doc.setFillColor(235,241,247); doc.rect(m,y-5,tableW,12,'F');
    doc.setFontSize(8); doc.setTextColor(43,68,94);
    doc.text('WEIGHT (KG)',m+7,y+2); doc.text('WEIGHT (GRAMS)',w-m-7,y+2,{align:'right'}); y+=12;
    entries.forEach((entry,index)=>{
      if(y>245){doc.addPage();y=25;}
      if(index%2===0){doc.setFillColor(249,251,253);doc.rect(m,y-5,tableW,10,'F');}
      doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(42,56,72);
      doc.text(entry.kg+' kg',m+7,y+1);doc.text(String(entry.grams).padStart(3,'0')+' g',w-m-7,y+1,{align:'right'});y+=10;
    });
    y+=12;if(y>242){doc.addPage();y=35;}
    doc.setDrawColor(205,215,226);doc.line(m,y,w-m,y);y+=10;
    doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(35,53,73);doc.text('GRAND TOTAL',m+2,y);
    doc.setFontSize(18);doc.setTextColor(18,65,110);
    doc.text(sum.totalKg+' kg '+String(sum.totalGrams).padStart(3,'0')+' g',w-m-2,y,{align:'right'});
    y+=24;doc.setDrawColor(145,158,172);doc.line(w-m-48,y,w-m,y);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(105,119,135);
    doc.text('Authorized Signature',w-m-24,y+5,{align:'center'});
    doc.setDrawColor(225,231,238);doc.line(m,278,w-m,278);doc.setFontSize(8);doc.setTextColor(125,138,153);
    doc.text('Please verify all weight entries before accepting this bill.',w/2,285,{align:'center'});
    doc.setFont('helvetica','bold');doc.setTextColor(18,65,110);doc.text('NEXORA DIGITAL',w/2,291,{align:'center'});
    doc.save('Nexora-Digital-Weight-Bill.pdf');
  }
  function shareWhatsApp() {
    const lines = entries.map(entry => entry.kg + ' kg ' + String(entry.grams).padStart(3, '0') + ' g').join('\n');
    const billText = 'NEXORA DIGITAL | WEIGHT BILL\nBill Date: ' + new Date().toLocaleString('en-IN') + '\n\nWEIGHT ENTRIES\n' + lines + '\n\nGRAND TOTAL: ' + sum.totalKg + ' kg ' + String(sum.totalGrams).padStart(3, '0') + ' g\n\nThank you.';
    window.open('https://wa.me/?text=' + encodeURIComponent(billText), '_blank');
  }
  function loadBill(bill: SavedBill) {
    setEntries(bill.entries); setShowHistory(false); setMessage('Previous bill loaded.');
  }

  if (showSplash) return <div className="splash-screen">
    <img src="/nexora-logo.svg" alt="Nexora logo" />
    <h1>Nexora Digital</h1>
    <p>Simple. Accurate. Yours.</p>
  </div>;

  return <main className="app-shell">
    <header className="topbar">
      <img className="brand-logo" src="/nexora-logo.svg" alt="Nexora Digital logo" />
      <div className="brand-copy"><strong>Nexora Digital</strong><small>Weight Calculation & Billing</small></div>
      <button className="icon-button" onClick={() => setShowHistory(true)} aria-label="History"><History /></button>
    </header>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow">SMART WEIGHT BOOK</span><h1>Weight records,<br />made simple.</h1><p>Scan your page, review the numbers and calculate the total weight.</p></div>
      <div className="hero-icon"><img src="/nexora-logo.svg" alt="" /></div>
    </section>
    <section className="upload-card">
      <div className="section-heading"><div><span className="step">01</span><h2>Choose a weight photo</h2></div><span className="offline-tag">ENGLISH OCR</span></div>
      <div className="upload-actions">
        <button className="primary-action" onClick={() => cameraRef.current?.click()} disabled={busy}><Camera />Camera</button>
        <button className="secondary-action" onClick={() => galleryRef.current?.click()} disabled={busy}><ImagePlus />Gallery</button>
      </div>
      <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={event => scan(event.target.files?.[0])} />
      <input ref={galleryRef} hidden type="file" accept="image/*" onChange={event => scan(event.target.files?.[0])} />
      <p className="status-line">{busy && <RefreshCw className="spin" size={15} />} {message}</p>
      <p className="hint">Example: 44,100 = 44 kg 100 g. The first scan needs an internet connection to download English OCR data. Always check the detected entries before calculating.</p>
    </section>
    <section className="entries-card">
      <div className="section-heading"><div><span className="step">02</span><h2>Review weight entries</h2></div><span className="count">{entries.length} entries</span></div>
      {entries.length === 0 ? <div className="empty-state">No weight entries added yet.</div> : <div className="entry-list">{entries.map(entry => <div className="entry-row" key={entry.id}>{editing === entry.id ? <input autoFocus defaultValue={entry.raw} onBlur={event => { updateEntry(entry.id, event.target.value); setEditing(null); }} onKeyDown={event => { if (event.key === 'Enter') { updateEntry(entry.id, event.currentTarget.value); setEditing(null); } }} /> : <strong>{entry.kg} <small>kg</small> {entry.grams} <small>g</small></strong>}<button className="tiny-button" onClick={() => setEditing(entry.id)} aria-label="Edit"><Pencil size={16} /></button><button className="tiny-button danger" onClick={() => setEntries(old => old.filter(item => item.id !== entry.id))} aria-label="Delete"><Trash2 size={16} /></button></div>)}</div>}
      <div className="add-row"><input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && addEntry()} placeholder="Add a weight, e.g. 44,100" /><button onClick={addEntry} aria-label="Add"><Plus /></button></div>
    </section>
    <section className="total-card"><div className="total-top"><span>Total Weight</span><span className="verified"><Check size={14} /> Verified entries</span></div><div className="total-value">{sum.totalKg}<small>kg</small> <i>{sum.totalGrams}</i><small>g</small></div><div className="total-caption">{entries.length} entries in total</div></section>
    <section className="bottom-actions"><button className="primary-action" onClick={saveBill} disabled={!entries.length}><Check />Save Bill</button><button className="secondary-action" onClick={pdf} disabled={!entries.length}><FileDown />PDF</button><button className="whatsapp-action" onClick={shareWhatsApp} disabled={!entries.length}><MessageCircle />WhatsApp</button></section>
    <button className="clear-button" onClick={() => { setEntries([]); setMessage('Start a new calculation.'); }}><X size={15} /> Start New Calculation</button>
    <footer>NEXORA DIGITAL <span>•</span> Weight Record & Bill</footer>
    {reviewPhoto && <div className="modal-backdrop review-backdrop"><div className="review-modal" onClick={event => event.stopPropagation()}>
      <div className="modal-head"><div><h2>Select Weight Entries</h2><p>Compare the list with your photo and select the correct weights.</p></div><button className="icon-button" onClick={cancelPhotoReview} aria-label="Close"><X /></button></div>
      <div className="review-photo-wrap"><img src={reviewPhoto} alt="Selected weight page" /></div>
      <div className="review-tools"><strong>Detected weights: {pendingEntries.length}</strong><button type="button" onClick={() => setSelectedIds(pendingEntries.map(item => item.id))}>Select All</button><button type="button" onClick={() => setSelectedIds([])}>Clear All</button></div>
      {pendingEntries.length ? <div className="review-list">{pendingEntries.map(item => <label className="review-row" key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(old => event.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))} /><b>{item.kg},{String(item.grams).padStart(3, '0')}</b><small>{item.kg} kg {item.grams} g</small></label>)}</div> : <div className="empty-state">No weights detected. You can add them manually after closing this photo.</div>}
      <div className="review-footer"><button className="secondary-action" onClick={cancelPhotoReview}>Cancel</button><button className="primary-action" onClick={confirmPhotoSelection}><Check />OK - Calculate Selected</button></div>
    </div></div>}
    {showHistory && <div className="modal-backdrop" onClick={() => setShowHistory(false)}><div className="history-modal" onClick={event => event.stopPropagation()}><div className="modal-head"><h2>Bill History</h2><button className="icon-button" onClick={() => setShowHistory(false)}><X /></button></div>{bills.length ? bills.map(bill => <button className="history-item" key={bill.id} onClick={() => loadBill(bill)}><span><b>{bill.totalKg} kg {bill.totalGrams} g</b><small>{bill.date}</small></span><span>{bill.entries.length} entries →</span></button>) : <p className="empty-state">No saved bills yet.</p>}</div></div>}
  </main>;
}
