import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Plus, Trash2, Pencil, Check, FileDown, MessageCircle, History, RefreshCw, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { createWorker } from 'tesseract.js';
import { Preferences } from '@capacitor/preferences';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

type Entry = { id: number; raw: string; kg: number; grams: number };
type Customer = { name: string; address: string; phone: string };
type SavedBill = { id: number; date: string; customer: Customer; entries: Entry[]; totalKg: number; totalGrams: number };
const STORE = 'nexora-calc-bills-v1';

function normalizeOcrDigits(value: string): string {
  const bengali = '০১২৩৪৫৬৭৮৯';
  return value.replace(/[০-৯]/g, digit => String(bengali.indexOf(digit))).replace(/[，٫]/g, ',').replace(/[।]/g, '.');
}
function extractWeightRows(ocrText: string): Entry[] {
  const rows: Entry[] = [];
  const ignored = /^(?:total|date|phone|mobile|page|invoice|bill|weight|kg|serial|sl\.?\s*no\.?)/i;
  for (const originalLine of normalizeOcrDigits(ocrText).split(/\r?\n/)) {
    let line = originalLine.trim().replace(/^[•*\-–—]+\s*/, '');
    if (!line || ignored.test(line)) continue;
    line = line.replace(/\b(?:kgs?|grams?|gms?|gm|g)\b/gi, ' ').trim();
    // Remove a leading row/serial number, but only when another weight follows it.
    line = line.replace(/^\s*\d{1,3}\s*[.)\-:]\s*(?=\d)/, '');
    line = line.replace(/^\s*\d{1,3}\s+(?=\d{1,3}\s*[,.:/]\s*\d)/, '');
    // Accept common handwritten forms: 12,250 / 12.250 / 12 250 / 12 kg 250 g.
    const matches = [...line.matchAll(/\d{1,3}\s*[,.:/]\s*\d{1,3}|\d{1,3}\s+\d{3}|\b\d{1,3}\b/g)];
    if (!matches.length) continue;
    for (const found of matches) {
      const token = found[0].trim();
      const pair = token.match(/^(\d{1,3})\s*[,.:/]\s*(\d{1,3})$/) || token.match(/^(\d{1,3})\s+(\d{3})$/);
      const kg = Number(pair ? pair[1] : token);
      const grams = pair ? Number(pair[2].padEnd(3, '0')) : 0;
      if (!Number.isFinite(kg) || kg < 1 || kg > 300 || grams < 0 || grams > 999) continue;
      rows.push({ id: Date.now() + Math.random(), raw: pair ? pair[1] + ',' + pair[2] : String(kg), kg, grams });
    }
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
  // Five full-width, non-overlapping strips make small handwriting easier to read
  // without losing the top or bottom rows of a long page.
  const bandCount = 5;
  for (let band = 0; band < bandCount; band++) {
    const y = Math.floor(band * height / bandCount);
    const bottom = band === bandCount - 1 ? height : Math.floor((band + 1) * height / bandCount);
    const crop = document.createElement('canvas'); crop.width = width; crop.height = bottom - y;
    const ctx = crop.getContext('2d', { willReadFrequently: true }); if (!ctx) continue;
    ctx.drawImage(source, 0, y, width, bottom - y, 0, 0, width, bottom - y);
    images.push(crop);
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
function downloadPdfBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [customer, setCustomer] = useState<Customer>({ name: '', address: '', phone: '' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Take a photo or choose a page from your gallery.');
  const [bills, setBills] = useState<SavedBill[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [reviewPhoto, setReviewPhoto] = useState<string | null>(null);
  const [pendingEntries, setPendingEntries] = useState<Entry[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const sum = useMemo(() => total(entries), [entries]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 1600);
    Preferences.get({ key: STORE }).then(({ value }) => { if (value) setBills(JSON.parse(value) as SavedBill[]); }).catch(() => setMessage('Bill history could not be loaded on this device.'));
    return () => window.clearTimeout(timer);
  }, []);

  async function scan(file?: File) {
    if (!file) return;
    setBusy(true); setMessage('Scanning the full page in 5 sections and checking 6 OCR readings per section...');
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      worker = await createWorker('eng');
      const images = await makeOcrImages(file), detected: Entry[] = [];
      for (let index = 0; index < images.length; index++) {
        const image = images[index];
        const readings: Entry[][] = [];
        // Compare original, two contrast levels, and two page-segmentation modes.
        // Keep the reading that finds the most rows in this strip instead of voting
        // row-by-row (which can accidentally discard a row seen by only one pass).
        const variants = [image, thresholdImage(image, 145), thresholdImage(image, 175)];
        for (const variant of variants) {
          for (const pageMode of ['6', '11']) {
            await worker.setParameters({
              tessedit_pageseg_mode: pageMode as any,
              tessedit_char_whitelist: '0123456789০১২৩৪৫৬৭৮৯,. ',
              preserve_interword_spaces: '1',
              user_defined_dpi: '300'
            });
            const result = await worker.recognize(variant);
            readings.push(extractWeightRows(result.data.text));
          }
        }
        const bestReading = readings.reduce((best, current) => current.length > best.length ? current : best, [] as Entry[]);
        detected.push(...bestReading.map((entry, row) => ({ ...entry, id: Date.now() + Math.random() + index * 1000 + row })));
      }
      setPendingEntries(detected);
      setReviewPhoto(URL.createObjectURL(file));
      setMessage(detected.length
        ? detected.length + ' weight entries detected across 5 page sections. Please compare the count with your paper and edit any incorrect reading.'
        : 'No clear weight entries detected. You can add them manually.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OCR could not run. Please try again.');
    } finally { if (worker) await worker.terminate(); setBusy(false); }
  }
  function confirmPhotoSelection() {
    const chosen = pendingEntries;
    setEntries(chosen);
    if (reviewPhoto) URL.revokeObjectURL(reviewPhoto);
    setReviewPhoto(null); setPendingEntries([]);
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
  async function saveBill() {
    if (!entries.length) { setMessage('Please add at least one weight before saving.'); return; }
    try {
      const bill: SavedBill = { id: Date.now(), date: new Date().toLocaleString('en-IN'), customer: { ...customer }, entries: entries.map(entry => ({ ...entry })), ...total(entries) };
      const next = [bill, ...bills].slice(0, 100);
      await Preferences.set({ key: STORE, value: JSON.stringify(next) });
      const check = await Preferences.get({ key: STORE });
      if (!check.value) throw new Error('Device storage did not confirm the saved bill.');
      setBills(next); setMessage('Bill permanently saved on this device. Open History to view it.');
    } catch (error) { setMessage('Bill could not be saved: ' + (error instanceof Error ? error.message : 'Check device storage and try again.')); }
  }
  async function pdf() {
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
    doc.setTextColor(35,53,73); doc.setFont('helvetica','bold');
    doc.text('Customer:',m,y+12); doc.setFont('helvetica','normal');
    doc.text(customer.name.trim() || 'Walk-in Customer',m+25,y+12);
    doc.setFont('helvetica','bold'); doc.text('Phone:',w-m-57,y+12); doc.setFont('helvetica','normal');
    doc.text(customer.phone.trim() || '—',w-m,y+12,{align:'right'});
    doc.setFont('helvetica','bold'); doc.text('Address:',m,y+22); doc.setFont('helvetica','normal');
    const addressLines = doc.splitTextToSize(customer.address.trim() || '—', tableW-22);
    doc.text(addressLines.slice(0,2),m+19,y+22);
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
    y+=24; doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(18,65,110);
    doc.text('Nexora',w-m-24,y+3,{align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(105,119,135);
    doc.text('Authorised Signature',w-m-24,y+9,{align:'center'});
    doc.setDrawColor(225,231,238);doc.line(m,278,w-m,278);doc.setFontSize(8);doc.setTextColor(125,138,153);
    doc.text('Please verify all weight entries before accepting this bill.',w/2,285,{align:'center'});
    doc.setFont('helvetica','bold');doc.setTextColor(18,65,110);doc.text('NEXORA DIGITAL',w/2,291,{align:'center'});
    try {
      const saved = await Filesystem.writeFile({ path: 'Nexora-Digital-Weight-Bill.pdf', data: doc.output('datauristring').split(',')[1], directory: Directory.Cache });
      await Share.share({ title: 'Nexora Digital Weight Bill', text: 'Your weight bill from Nexora Digital.', url: saved.uri, dialogTitle: 'Save or share PDF bill' });
      setMessage('PDF created. Choose WhatsApp, Drive or Save to Files from the Android share panel.');
    } catch (error) {
      try { doc.save('Nexora-Digital-Weight-Bill.pdf'); setMessage('PDF generated. Check your Downloads folder.'); }
      catch { setMessage('PDF could not be saved: ' + (error instanceof Error ? error.message : 'Please try again.')); }
    }
  }
  async function shareWhatsApp() {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1450;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Could not create bill image.');
      ctx.fillStyle='#f1f5f9';ctx.fillRect(0,0,1080,1450);ctx.fillStyle='#fff';ctx.fillRect(48,48,984,1354);
      ctx.fillStyle='#123b70';ctx.fillRect(48,48,984,250);ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(88,96,132,132,24);ctx.fill();
      ctx.fillStyle='#123b70';ctx.font='bold 94px Arial';ctx.fillText('N',123,198);ctx.fillStyle='#fff';ctx.font='bold 48px Arial';ctx.fillText('NEXORA DIGITAL',252,150);
      ctx.font='24px Arial';ctx.fillStyle='#c9def2';ctx.fillText('WEIGHT RECORD & BILL',254,197);
      ctx.fillStyle='#243b53';ctx.font='bold 30px Arial';ctx.fillText('BILL DETAILS',92,365);ctx.font='22px Arial';ctx.fillStyle='#64748b';ctx.fillText('Date: '+new Date().toLocaleString('en-IN'),92,410);ctx.fillStyle='#243b53';ctx.font='bold 22px Arial';ctx.fillText('Customer: '+(customer.name.trim()||'Walk-in Customer'),92,450);ctx.font='21px Arial';ctx.fillText('Phone: '+(customer.phone.trim()||'—'),92,485);ctx.fillText('Address: '+(customer.address.trim()||'—').slice(0,75),92,520);
      ctx.strokeStyle='#dbe4ee';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(92,545);ctx.lineTo(988,545);ctx.stroke();
      ctx.fillStyle='#eaf0f6';ctx.fillRect(92,565,896,64);ctx.fillStyle='#31506f';ctx.font='bold 22px Arial';ctx.fillText('SL NO.',118,606);ctx.fillText('WEIGHT',360,606);ctx.textAlign='right';ctx.fillText('GRAMS',950,606);ctx.textAlign='left';
      let y=680;entries.forEach((entry,index)=>{if(index%2===0){ctx.fillStyle='#f8fafc';ctx.fillRect(92,y-38,896,58);}ctx.fillStyle='#243b53';ctx.font='24px Arial';ctx.fillText(String(index+1).padStart(2,'0'),118,y);ctx.font='bold 26px Arial';ctx.fillText(entry.kg+' kg',360,y);ctx.textAlign='right';ctx.fillText(String(entry.grams).padStart(3,'0')+' g',950,y);ctx.textAlign='left';y+=62;});
      y=Math.max(y+50,1000);ctx.fillStyle='#123b70';ctx.fillRect(92,y,896,150);ctx.fillStyle='#c9def2';ctx.font='bold 24px Arial';ctx.fillText('GRAND TOTAL',125,y+55);ctx.fillStyle='#fff';ctx.font='bold 52px Arial';ctx.textAlign='right';ctx.fillText(sum.totalKg+' kg '+String(sum.totalGrams).padStart(3,'0')+' g',950,y+112);ctx.textAlign='left';
      ctx.fillStyle='#123b70';ctx.font='bold 34px Arial';ctx.textAlign='center';ctx.fillText('Nexora',540,1285);ctx.fillStyle='#64748b';ctx.font='22px Arial';ctx.fillText('Authorised Signature',540,1320);ctx.fillText('Thank you for choosing Nexora Digital',540,1360);ctx.textAlign='left';
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Bill image export failed.')),'image/png'));
      const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Image conversion failed.'));reader.readAsDataURL(blob);});
      const saved=await Filesystem.writeFile({path:'Nexora-Digital-Weight-Bill.png',data:base64,directory:Directory.Cache});
      await Share.share({title:'Nexora Digital Bill',text:'Nexora Digital Weight Bill',url:saved.uri,dialogTitle:'Share bill image'});
      setMessage('Bill image ready. Choose WhatsApp from the Android share panel.');
    } catch(error) { setMessage('Bill image could not be shared: '+(error instanceof Error?error.message:'Please try again.')); }
  }
  function loadBill(bill: SavedBill) {
    setEntries(bill.entries); setCustomer(bill.customer || { name: '', address: '', phone: '' }); setShowHistory(false); setMessage('Previous bill loaded.');
  }

  if (showSplash) return <div className="splash-screen">
    <img src="./nexora-logo.svg" alt="Nexora logo" />
    <h1>Nexora Digital</h1>
    <p>Simple. Accurate. Yours.</p>
  </div>;

  return <main className="app-shell">
    <header className="topbar">
      <img className="brand-logo" src="./nexora-logo.svg" alt="Nexora Digital logo" />
      <div className="brand-copy"><strong>Nexora Digital</strong><small>Weight Calculation & Billing</small></div>
      <button className="icon-button" onClick={() => setShowHistory(true)} aria-label="History"><History /></button>
    </header>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow">SMART WEIGHT BOOK</span><h1>Weight records,<br />made simple.</h1><p>Scan your page, review the numbers and calculate the total weight.</p></div>
      <div className="hero-icon"><img src="./nexora-logo.svg" alt="" /></div>
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
    <section className="customer-card">
      <div className="section-heading"><div><span className="step">03</span><h2>Customer details</h2></div><span className="count">Live preview</span></div>
      <label>Customer Name<input value={customer.name} onChange={event => setCustomer(old => ({ ...old, name: event.target.value }))} placeholder="Enter customer name" /></label>
      <label>Phone Number<input type="tel" inputMode="tel" value={customer.phone} onChange={event => setCustomer(old => ({ ...old, phone: event.target.value }))} placeholder="Enter phone number" /></label>
      <label>Address<textarea rows={2} value={customer.address} onChange={event => setCustomer(old => ({ ...old, address: event.target.value }))} placeholder="Enter customer address" /></label>
    </section>
    <section className="bill-preview">
      <div className="preview-top"><div><span className="eyebrow">NEXORA DIGITAL</span><h2>Bill Preview</h2></div><img src="./nexora-logo.svg" alt="Nexora logo" /></div>
      <div className="preview-customer"><strong>{customer.name.trim() || 'Customer Name'}</strong><span>{customer.phone.trim() || 'Phone number'}</span><p>{customer.address.trim() || 'Customer address will appear here'}</p></div>
      <div className="preview-rows">{entries.length ? entries.map((entry,index)=><div className="preview-row" key={entry.id}><span>{index+1}. {entry.kg} kg</span><strong>{String(entry.grams).padStart(3,'0')} g</strong></div>) : <p className="preview-empty">Weight entries will appear here</p>}</div>
      <div className="preview-total"><span>Grand Total</span><strong>{sum.totalKg} kg {String(sum.totalGrams).padStart(3,'0')} g</strong></div>
      <div className="preview-sign"><strong>Nexora</strong><small>Authorised Signature</small></div>
    </section>
    <section className="total-card"><div className="total-top"><span>Total Weight</span><span className="verified"><Check size={14} /> Verified entries</span></div><div className="total-value">{sum.totalKg}<small>kg</small> <i>{sum.totalGrams}</i><small>g</small></div><div className="total-caption">{entries.length} entries in total</div></section>
    <section className="bottom-actions"><button className="primary-action" onClick={saveBill} disabled={!entries.length}><Check />Save Bill</button><button className="secondary-action" onClick={pdf} disabled={!entries.length}><FileDown />PDF</button><button className="whatsapp-action" onClick={shareWhatsApp} disabled={!entries.length}><MessageCircle />WhatsApp</button></section>
    <button className="clear-button" onClick={() => { setEntries([]); setMessage('Start a new calculation.'); }}><X size={15} /> Start New Calculation</button>
    <footer>NEXORA DIGITAL <span>•</span> Weight Record & Bill</footer>
    {reviewPhoto && <div className="modal-backdrop review-backdrop"><div className="review-modal" onClick={event => event.stopPropagation()}>
      <div className="modal-head"><div><h2>Review All Detected Entries</h2><p>All detected rows are selected. Check the count against your paper; correct any wrong weight after adding.</p></div><button className="icon-button" onClick={cancelPhotoReview} aria-label="Close"><X /></button></div>
      <div className="review-photo-wrap"><img src={reviewPhoto} alt="Selected weight page" /></div>
      <div className="review-tools"><strong>Detected rows: {pendingEntries.length}</strong></div>
      {pendingEntries.length ? <div className="review-list">{pendingEntries.map((item,index) => <div className="review-row" key={item.id}><b>{index+1}. {item.kg},{String(item.grams).padStart(3, '0')}</b><small>{item.kg} kg {item.grams} g</small></div>)}</div> : <div className="empty-state">No weights detected. You can add them manually after closing this photo.</div>}
      <div className="review-footer"><button className="secondary-action" onClick={cancelPhotoReview}>Cancel</button><button className="primary-action" onClick={confirmPhotoSelection}><Check />Add All Detected Rows</button></div>
    </div></div>}
    {showHistory && <div className="modal-backdrop" onClick={() => setShowHistory(false)}><div className="history-modal" onClick={event => event.stopPropagation()}><div className="modal-head"><h2>Bill History</h2><button className="icon-button" onClick={() => setShowHistory(false)}><X /></button></div>{bills.length ? bills.map(bill => <button className="history-item" key={bill.id} onClick={() => loadBill(bill)}><span><b>{bill.totalKg} kg {bill.totalGrams} g</b><small>{bill.date}</small></span><span>{bill.entries.length} entries →</span></button>) : <p className="empty-state">No saved bills yet.</p>}</div></div>}
  </main>;
}
