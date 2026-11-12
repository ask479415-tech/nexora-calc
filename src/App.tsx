import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Plus, Trash2, Pencil, Check, FileDown, MessageCircle, History, RefreshCw, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { createWorker } from 'tesseract.js';
import CropPhotoModal from './CropPhotoModal';
import { Preferences } from '@capacitor/preferences';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

type Entry = { id: number; raw: string; kg: number; grams: number };
type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number };
type Customer = { name: string; address: string; phone: string };
type SavedBill = { id: number; date: string; customer: Customer; entries: Entry[]; totalKg: number; totalGrams: number; rate?: number; totalAmount?: number };
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
    // Remove a row number only when it is clearly separated from the weight.
    line = line.replace(/^\s*\d{1,3}\s*[.)\-:]\s*(?=\d)/, '');
    line = line.replace(/^\s*\d{1,3}\s+(?=\d{1,3}\s*[,.:]\s*\d)/, '');
    // Accept the entire line only. Never extract random numbers from the middle of text.
    const pair = line.match(/^(\d{1,3})\s*[,.:]\s*(\d{1,3})$/) || line.match(/^(\d{1,3})\s+(\d{3})$/);
    const single = line.match(/^(\d{1,3})$/);
    if (!pair && !single) continue;
    const kg = Number(pair ? pair[1] : single![1]);
    const grams = pair ? Number(pair[2].padEnd(3, '0')) : 0;
    if (!Number.isFinite(kg) || kg < 1 || kg > 300 || grams > 999) continue;
    rows.push({ id: Date.now() + Math.random(), raw: pair ? pair[1] + ',' + pair[2] : String(kg), kg, grams });
  }
  return rows;
}
async function makeOcrImages(file: File): Promise<HTMLCanvasElement[]> {
  const bitmap = await createImageBitmap(file);
  // Keep a practical maximum dimension; crop selection happens before OCR.
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
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
  // One OCR pass on the user-selected paper area avoids four slow duplicate passes.
  return [source];
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
  const [rate, setRate] = useState('20.00');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Take a photo or choose a page from your gallery.');
  const [bills, setBills] = useState<SavedBill[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [reviewPhoto, setReviewPhoto] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [pendingEntries, setPendingEntries] = useState<Entry[]>([]);
  const [ocrText, setOcrText] = useState('');
  const [ocrWords, setOcrWords] = useState<OcrWord[]>([]);
  const [selectedOcrWords, setSelectedOcrWords] = useState<number[]>([]);
  const [ocrImageSize, setOcrImageSize] = useState({ width: 1, height: 1 });
  const workerRef = useRef<Awaited<ReturnType<typeof createWorker>> | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const sum = useMemo(() => total(entries), [entries]);
  const totalWeightKg = (sum.totalKg * 1000 + sum.totalGrams) / 1000;
  const numericRate = Math.max(0, Number(rate) || 0);
  const totalAmount = Math.round(totalWeightKg * numericRate * 100) / 100;
  const money = (value: number) => '₹' + value.toFixed(2);
  function selectedOcrText() {
    const words = selectedOcrWords.map(index => ocrWords[index]).filter(Boolean).sort((a,b) => (a.y0+a.y1)-(b.y0+b.y1));
    const lines: { center: number; height: number; words: string[] }[] = [];
    for (const word of words) {
      const center = (word.y0 + word.y1) / 2, height = word.y1 - word.y0;
      let line = lines.find(item => Math.abs(item.center-center) <= Math.max(8, Math.min(item.height,height)*0.7));
      if (!line) lines.push(line = { center, height, words: [] });
      line.words.push(word.text);
    }
    return lines.sort((a,b)=>a.center-b.center).map(line=>line.words.join(' ')).join('\\n');
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 1600);
    Preferences.get({ key: STORE }).then(({ value }) => { if (value) setBills(JSON.parse(value) as SavedBill[]); }).catch(() => setMessage('Bill history could not be loaded on this device.'));
    return () => window.clearTimeout(timer);
  }, []);

  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) setCropFile(file);
  }

  async function scan(file?: File) {
    if (!file) return;
    setBusy(true); setOcrText(''); setPendingEntries([]); setOcrWords([]); setSelectedOcrWords([]);
    setMessage('Preparing photo for English scanning...');
    try {
      // Reuse the OCR worker between scans; create it only on the first scan.
      if (!workerRef.current) workerRef.current = await createWorker('eng');
      const worker = workerRef.current;
      const images = await makeOcrImages(file);
      let bestText = '';
      let bestRows: Entry[] = [];
      let bestScore = -1;
      let fullPageWords: OcrWord[] = [];
      setOcrImageSize({ width: images[0].width, height: images[0].height });
      for (let index = 0; index < images.length; index++) {
        setMessage('Scanning the selected paper area...');
        await worker.setParameters({
          tessedit_pageseg_mode: (index === 0 ? '11' : '6') as any,
          tessedit_char_whitelist: '0123456789,.',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        });
        const result = await worker.recognize(images[index]);
        const rows = extractWeightRows(result.data.text);
        if (index === 0) fullPageWords = (((result.data as any).words || []) as any[]).filter((word: any) => word.text?.trim()).map((word: any) => ({ text: String(word.text).trim(), x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 }));
        const confidence = Number(result.data.confidence) || 0;
        const score = rows.length * 100 + confidence;
        if (score > bestScore) {
          bestScore = score;
          bestText = result.data.text;
          bestRows = rows;
        }
      }
      setOcrText(bestText);
      setOcrWords(fullPageWords);
      setPendingEntries(bestRows);
      setReviewPhoto(URL.createObjectURL(file));
      setMessage(bestRows.length ? bestRows.length + ' possible weight rows found. Check the transcription and confirm.' : 'Page scanned. No clear weight rows found; check the full OCR text and add/correct entries.');
    } catch (error) {
      setMessage('Scanning failed: ' + (error instanceof Error ? error.message : 'Check internet and try again.'));
    } finally {
      setBusy(false);
    }
  }
  function confirmPhotoSelection() {
    const chosen = pendingEntries;
    setEntries(chosen);
    if (reviewPhoto) URL.revokeObjectURL(reviewPhoto);
    setReviewPhoto(null); setPendingEntries([]); setOcrText(''); setOcrWords([]); setSelectedOcrWords([]);
    setMessage(chosen.length + ' selected entries are ready for calculation.');
  }
  function cancelPhotoReview() {
    if (reviewPhoto) URL.revokeObjectURL(reviewPhoto);
    setReviewPhoto(null); setPendingEntries([]); setOcrText(''); setOcrWords([]); setSelectedOcrWords([]);
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
      const bill: SavedBill = { id: Date.now(), date: new Date().toLocaleString('en-IN'), customer: { ...customer }, entries: entries.map(entry => ({ ...entry })), ...total(entries), rate: numericRate, totalAmount };
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
    const billNo = 'GNX-' + String(now.getTime()).slice(-8);
    doc.setFillColor(18, 42, 72); doc.rect(0, 0, w, 43, 'F');
    doc.setFillColor(35, 101, 162); doc.roundedRect(m, 9, 25, 25, 4, 4, 'F');
    doc.setDrawColor(225, 242, 255); doc.setLineWidth(1.2);
    doc.line(m+12.5,12,m+12.5,19); doc.line(m+5,19,m+20,19);
    doc.line(m+7,19,m+4,27); doc.line(m+18,19,m+21,27);
    doc.line(m+2,27,m+8,27); doc.line(m+17,27,m+23,27);
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(19);
    doc.setFontSize(8); doc.text('POWERED BY NEXORA DIGITAL',m+32,9);
    doc.setFontSize(19); doc.text('GLOBAL NEXUS',m+32,20);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(198,216,235);
    doc.text('WEIGHT RECORD & BILL',m+32,28);
    doc.setFontSize(8); doc.text('GLOBAL NEXUS • WEIGHT BILL',m+32,35);
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
    doc.setDrawColor(205,215,226);doc.line(m,y,w-m,y);y+=8;
    const summaryMid=m+tableW/2;
    doc.setFillColor(239,245,251);doc.roundedRect(m,y,tableW,30,3,3,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(70,86,104);
    doc.text('TOTAL WEIGHT',m+7,y+9);
    doc.text('TOTAL AMOUNT',w-m-7,y+9,{align:'right'});
    doc.setFontSize(14);doc.setTextColor(18,65,110);
    doc.text(sum.totalKg+' kg '+String(sum.totalGrams).padStart(3,'0')+' g',m+7,y+22);
    doc.text(money(totalAmount),w-m-7,y+22,{align:'right'});
    y+=35;doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(90,105,121);
    doc.text('Rate per KG: '+money(numericRate),m+2,y);
    y+=18; doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(18,65,110);
    doc.text('Global Nexus',w-m-24,y+3,{align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(105,119,135);
    doc.text('Authorised Signature',w-m-24,y+9,{align:'center'});
    doc.setDrawColor(225,231,238);doc.line(m,278,w-m,278);doc.setFontSize(8);doc.setTextColor(125,138,153);
    doc.text('Please verify all weight entries before accepting this bill.',w/2,285,{align:'center'});
    doc.setFont('helvetica','bold');doc.setTextColor(18,65,110);doc.text('GLOBAL NEXUS',w/2,291,{align:'center'});
    try {
      const saved = await Filesystem.writeFile({ path: 'Global-Nexus-Weight-Bill.pdf', data: doc.output('datauristring').split(',')[1], directory: Directory.Cache });
      await Share.share({ title: 'Global Nexus Weight Bill', text: 'Your weight bill from Global Nexus. Powered by Nexora Digital.', url: saved.uri, dialogTitle: 'Save or share PDF bill' });
      setMessage('PDF created. Choose WhatsApp, Drive or Save to Files from the Android share panel.');
    } catch (error) {
      try { doc.save('Global-Nexus-Weight-Bill.pdf'); setMessage('PDF generated. Check your Downloads folder.'); }
      catch { setMessage('PDF could not be saved: ' + (error instanceof Error ? error.message : 'Please try again.')); }
    }
  }
  async function shareWhatsApp() {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1450;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Could not create bill image.');
      ctx.fillStyle='#f1f5f9';ctx.fillRect(0,0,1080,1450);ctx.fillStyle='#fff';ctx.fillRect(48,48,984,1354);
      ctx.fillStyle='#123b70';ctx.fillRect(48,48,984,250);ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(88,96,132,132,24);ctx.fill();
      ctx.fillStyle='#123b70';ctx.font='bold 94px Arial';ctx.fillText('N',123,198);ctx.fillStyle='#c9def2';ctx.font='bold 20px Arial';ctx.fillText('POWERED BY NEXORA DIGITAL',252,112);ctx.fillStyle='#fff';ctx.font='bold 48px Arial';ctx.fillText('GLOBAL NEXUS',252,165);
      ctx.font='24px Arial';ctx.fillStyle='#c9def2';ctx.fillText('WEIGHT RECORD & BILL',254,210);
      ctx.fillStyle='#243b53';ctx.font='bold 30px Arial';ctx.fillText('BILL DETAILS',92,365);ctx.font='22px Arial';ctx.fillStyle='#64748b';ctx.fillText('Date: '+new Date().toLocaleString('en-IN'),92,410);ctx.fillStyle='#243b53';ctx.font='bold 22px Arial';ctx.fillText('Customer: '+(customer.name.trim()||'Walk-in Customer'),92,450);ctx.font='21px Arial';ctx.fillText('Phone: '+(customer.phone.trim()||'—'),92,485);ctx.fillText('Address: '+(customer.address.trim()||'—').slice(0,75),92,520);
      ctx.strokeStyle='#dbe4ee';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(92,545);ctx.lineTo(988,545);ctx.stroke();
      ctx.fillStyle='#eaf0f6';ctx.fillRect(92,565,896,64);ctx.fillStyle='#31506f';ctx.font='bold 22px Arial';ctx.fillText('SL NO.',118,606);ctx.fillText('WEIGHT',360,606);ctx.textAlign='right';ctx.fillText('GRAMS',950,606);ctx.textAlign='left';
      let y=680;entries.forEach((entry,index)=>{if(index%2===0){ctx.fillStyle='#f8fafc';ctx.fillRect(92,y-38,896,58);}ctx.fillStyle='#243b53';ctx.font='24px Arial';ctx.fillText(String(index+1).padStart(2,'0'),118,y);ctx.font='bold 26px Arial';ctx.fillText(entry.kg+' kg',360,y);ctx.textAlign='right';ctx.fillText(String(entry.grams).padStart(3,'0')+' g',950,y);ctx.textAlign='left';y+=62;});
      y=Math.max(y+50,1000);ctx.fillStyle='#123b70';ctx.fillRect(92,y,896,190);ctx.fillStyle='#c9def2';ctx.font='bold 24px Arial';ctx.fillText('TOTAL WEIGHT',125,y+48);ctx.fillStyle='#fff';ctx.font='bold 34px Arial';ctx.fillText(sum.totalKg+' kg '+String(sum.totalGrams).padStart(3,'0')+' g',125,y+105);ctx.fillStyle='#c9def2';ctx.font='bold 24px Arial';ctx.textAlign='right';ctx.fillText('TOTAL AMOUNT',950,y+48);ctx.fillStyle='#fff';ctx.font='bold 38px Arial';ctx.fillText(money(totalAmount),950,y+105);ctx.fillStyle='#c9def2';ctx.font='20px Arial';ctx.fillText('Rate: '+money(numericRate)+' / KG',950,y+150);ctx.textAlign='left';
      ctx.fillStyle='#123b70';ctx.font='bold 34px Arial';ctx.textAlign='center';ctx.fillText('Global Nexus',540,1285);ctx.fillStyle='#64748b';ctx.font='22px Arial';ctx.fillText('Authorised Signature',540,1320);ctx.fillText('Powered by Nexora Digital',540,1360);ctx.textAlign='left';
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Bill image export failed.')),'image/png'));
      const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Image conversion failed.'));reader.readAsDataURL(blob);});
      const saved=await Filesystem.writeFile({path:'Global-Nexus-Weight-Bill.png',data:base64,directory:Directory.Cache});
      await Share.share({title:'Global Nexus Bill',text:'Global Nexus Weight Bill. Powered by Nexora Digital.',url:saved.uri,dialogTitle:'Share bill image'});
      setMessage('Bill image ready. Choose WhatsApp from the Android share panel.');
    } catch(error) { setMessage('Bill image could not be shared: '+(error instanceof Error?error.message:'Please try again.')); }
  }
  function loadBill(bill: SavedBill) {
    setEntries(bill.entries); setCustomer(bill.customer || { name: '', address: '', phone: '' }); setRate(String(typeof bill.rate === 'number' ? bill.rate : 20)); setShowHistory(false); setMessage('Previous bill loaded.');
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
      <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
      <input ref={galleryRef} hidden type="file" accept="image/*" onChange={choosePhoto} />
      <p className="status-line">{busy && <RefreshCw className="spin" size={15} />} {message}</p>
      <p className="hint">Example: 44,100 = 44 kg 100 g. The first scan needs internet to download English OCR data. Always check the detected entries before calculating.</p>
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
    <section className="customer-card rate-card">
      <div className="section-heading"><div><span className="step">04</span><h2>Rate & Amount</h2></div><span className="count">Editable rate</span></div>
      <label>Rate per KG (₹)<input type="number" min="0" step="0.01" inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} placeholder="Enter rate per KG" /></label>
      <div className="rate-calculation"><span>{totalWeightKg.toFixed(3)} KG × {money(numericRate)}</span><strong>{money(totalAmount)}</strong></div>
      <p className="hint">Change the rate anytime. Total amount updates automatically.</p>
    </section>
    <section className="bill-preview">
      <div className="preview-top"><div><span className="eyebrow">POWERED BY NEXORA DIGITAL</span><h2>GLOBAL NEXUS</h2><small>Weight Bill Preview</small></div><img src="./nexora-logo.svg" alt="Nexora logo" /></div>
      <div className="preview-customer"><strong>{customer.name.trim() || 'Customer Name'}</strong><span>{customer.phone.trim() || 'Phone number'}</span><p>{customer.address.trim() || 'Customer address will appear here'}</p></div>
      <div className="preview-rows">{entries.length ? entries.map((entry,index)=><div className="preview-row" key={entry.id}><span>{index+1}. {entry.kg} kg</span><strong>{String(entry.grams).padStart(3,'0')} g</strong></div>) : <p className="preview-empty">Weight entries will appear here</p>}</div>
      <div className="preview-summary"><div><span>Total Weight</span><strong>{sum.totalKg} kg {String(sum.totalGrams).padStart(3,'0')} g</strong></div><div><span>Total Amount</span><strong>{money(totalAmount)}</strong><small>Rate: {money(numericRate)} / KG</small></div></div>
      <div className="preview-sign"><strong>Global Nexus</strong><small>Authorised Signature</small></div>
    </section>
    <section className="total-card"><div className="total-top"><span>Total Weight</span><span className="verified"><Check size={14} /> Verified entries</span></div><div className="total-value">{sum.totalKg}<small>kg</small> <i>{sum.totalGrams}</i><small>g</small></div><div className="total-caption">{entries.length} entries in total</div></section>
    <section className="bottom-actions"><button className="primary-action" onClick={saveBill} disabled={!entries.length}><Check />Save Bill</button><button className="secondary-action" onClick={pdf} disabled={!entries.length}><FileDown />PDF</button><button className="whatsapp-action" onClick={shareWhatsApp} disabled={!entries.length}><MessageCircle />WhatsApp</button></section>
    <button className="clear-button" onClick={() => { setEntries([]); setMessage('Start a new calculation.'); }}><X size={15} /> Start New Calculation</button>
    <footer>NEXORA DIGITAL <span>•</span> Weight Record & Bill</footer>
    {cropFile && <CropPhotoModal file={cropFile} onCancel={() => setCropFile(null)} onScan={croppedFile => { setCropFile(null); void scan(croppedFile); }} />}
    {reviewPhoto && <div className="modal-backdrop review-backdrop"><div className="review-modal" onClick={event => event.stopPropagation()}>
      <div className="modal-head"><div><h2>Review All Detected Entries</h2><p>All detected rows are selected. Check the count against your paper; correct any wrong weight after adding.</p></div><button className="icon-button" onClick={cancelPhotoReview} aria-label="Close"><X /></button></div>
      <div className="review-photo-wrap"><div className="lens-photo"><img src={reviewPhoto} alt="Selected weight page" />{ocrWords.map((word,index)=><span key={index} className="lens-word" style={{left:(word.x0/ocrImageSize.width*100)+'%',top:(word.y0/ocrImageSize.height*100)+'%',width:(Math.max(1,word.x1-word.x0)/ocrImageSize.width*100)+'%',height:(Math.max(1,word.y1-word.y0)/ocrImageSize.height*100)+'%'}}>{word.text}{' '}</span>)}</div></div>
      <div className="review-tools"><strong>Detected rows: {pendingEntries.length}</strong><span className="selection-help">ছবির লেখার উপর আঙুল চেপে ধরে টেনে Select করুন</span><button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>{const text=window.getSelection()?.toString().trim()||'';if(text){void navigator.clipboard?.writeText(text).then(()=>setMessage('Selected OCR text copied.')).catch(()=>setMessage('Copy failed. Use the phone selection menu.'));}else setMessage('আগে ছবির লেখার উপর চেপে ধরে Select করুন।');}}>Copy selected</button><button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>{const text=window.getSelection()?.toString().trim()||'';const rows=extractWeightRows(text);if(rows.length)setPendingEntries(rows);else setMessage('Selected text থেকে কোনো weight row পাওয়া যায়নি।');}}>Use selected text</button></div>
      {pendingEntries.length ? <div className="review-list">{pendingEntries.map((item,index) => <div className="review-row" key={item.id}><label className="review-edit-label">{index+1}. Weight (KG, grams)<input aria-label={'Edit detected weight row ' + (index+1)} defaultValue={item.raw} onBlur={event => { const corrected = parseEntry(event.currentTarget.value); if (corrected) setPendingEntries(old => old.map(row => row.id === item.id ? { ...corrected, id: row.id } : row)); }} /></label><small>Calculated: {item.kg} kg {item.grams} g</small></div>)}</div> : <div className="empty-state">No clear weight rows detected. You can add them manually after closing this photo.</div>}{ocrText && <div className="ocr-transcript"><strong>Full page text recognized (compare with the photo):</strong><pre className="ocr-debug">{ocrText.slice(0,5000)}</pre></div>}
      <div className="review-footer"><button className="secondary-action" onClick={cancelPhotoReview}>Cancel</button><button className="primary-action" onClick={confirmPhotoSelection}><Check />Add All Detected Rows</button></div>
    </div></div>}
    {showHistory && <div className="modal-backdrop" onClick={() => setShowHistory(false)}><div className="history-modal" onClick={event => event.stopPropagation()}><div className="modal-head"><h2>Bill History</h2><button className="icon-button" onClick={() => setShowHistory(false)}><X /></button></div>{bills.length ? bills.map(bill => <button className="history-item" key={bill.id} onClick={() => loadBill(bill)}><span><b>{bill.totalKg} kg {bill.totalGrams} g</b><small>{bill.date}</small></span><span>{bill.entries.length} entries →</span></button>) : <p className="empty-state">No saved bills yet.</p>}</div></div>}
  </main>;
}
