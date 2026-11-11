import { useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Plus, Trash2, Pencil, Check, FileDown, MessageCircle, History, Scale, RefreshCw, X } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { jsPDF } from 'jspdf';

type Entry = { id: number; raw: string; kg: number; grams: number };
type SavedBill = { id: number; date: string; entries: Entry[]; totalKg: number; totalGrams: number };
const STORE = 'nexora-calc-bills-v1';

function digits(s: string) {
  return s.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[，]/g, ',').replace(/[.]/g, ',');
}
function parseEntry(value: string): Entry | null {
  const clean = digits(value).replace(/[^0-9,]/g, '');
  const match = clean.match(/^(\d{1,4})[,]?(\d{1,3})?$/);
  if (!match) return null;
  const kg = Number(match[1]);
  const grams = match[2] ? Number(match[2].padEnd(3, '0')) : 0;
  if (grams > 999) return null;
  return { id: Date.now() + Math.random(), raw: value, kg, grams };
}
function total(entries: Entry[]) {
  const grams = entries.reduce((sum, e) => sum + e.kg * 1000 + e.grams, 0);
  return { totalKg: Math.floor(grams / 1000), totalGrams: grams % 1000 };
}
function readBills(): SavedBill[] {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
}

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('ছবি তুলুন অথবা গ্যালারি থেকে খাতা নির্বাচন করুন');
  const [bills, setBills] = useState<SavedBill[]>(readBills);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const sum = useMemo(() => total(entries), [entries]);

  async function scan(file?: File) {
    if (!file) return;
    setBusy(true); setMessage('ছবি পড়া হচ্ছে… একটু অপেক্ষা করুন');
    try {
      const worker = await createWorker('eng+ben', 1, {
        logger: m => { if (m.status === 'recognizing text') setMessage('ছবি পড়া হচ্ছে… ' + Math.round(m.progress * 100) + '%'); }
      });
      const result = await worker.recognize(file);
      await worker.terminate();
      const lines = result.data.text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      const found: Entry[] = [];
      for (const line of lines) {
        const normalized = digits(line);
        const candidates = normalized.match(/\d{1,4}\s*[,،.]\s*\d{1,3}|\d{1,4}/g) || [];
        for (const candidate of candidates) {
          const item = parseEntry(candidate.replace(/\s/g, '').replace(/[،.]/g, ','));
          if (item && (candidate.includes(',') || candidate.includes('،') || candidate.includes('.') || item.kg <= 300)) found.push(item);
        }
      }
      setEntries(found);
      setMessage(found.length ? found.length + 'টি সংখ্যা পাওয়া গেছে। হিসাবের আগে সব লাইন যাচাই করুন।' : 'সংখ্যা পাওয়া যায়নি। আলো ভালো করে আবার ছবি তুলুন অথবা হাতে যোগ করুন।');
    } catch (e) {
      setMessage('OCR চালু হয়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।');
    } finally { setBusy(false); }
  }
  function addEntry() {
    const item = parseEntry(draft);
    if (!item) { setMessage('উদাহরণ: 44,100 অথবা 39,300 লিখুন।'); return; }
    setEntries(old => [...old, item]); setDraft('');
  }
  function updateEntry(id: number, value: string) {
    const item = parseEntry(value);
    if (item) setEntries(old => old.map(e => e.id === id ? { ...item, id } : e));
  }
  function saveBill() {
    if (!entries.length) return;
    const bill = { id: Date.now(), date: new Date().toLocaleString('bn-BD'), entries, ...sum };
    const next = [bill, ...bills].slice(0, 100);
    setBills(next); localStorage.setItem(STORE, JSON.stringify(next));
    setMessage('বিল হিস্ট্রিতে সেভ হয়েছে।');
  }
  function pdf() {
    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('NEXORA CALC', 18, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text('Weight calculation bill', 18, 28);
    doc.text('Date: ' + new Date().toLocaleString(), 18, 38);
    let y = 52;
    entries.forEach((e, i) => { doc.text(String(i + 1), 20, y); doc.text(e.kg + ' kg ' + e.grams + ' g', 42, y); y += 9; });
    doc.setFont('helvetica', 'bold'); doc.text('TOTAL: ' + sum.totalKg + ' kg ' + sum.totalGrams + ' g', 18, y + 8);
    doc.save('Nexora-Calc-Bill.pdf');
  }
  function shareWhatsApp() {
    const lines = entries.map((e, i) => (i + 1) + '. ' + e.kg + ' kg ' + e.grams + ' g').join('\n');
    const text = 'NEXORA CALC BILL\n' + lines + '\n----------------\nTOTAL: ' + sum.totalKg + ' kg ' + sum.totalGrams + ' g';
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }
  function loadBill(bill: SavedBill) { setEntries(bill.entries); setShowHistory(false); setMessage('পুরোনো হিসাব খোলা হয়েছে।'); }

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark"><Scale size={23}/></div><div><strong>Nexora Calc</strong><small>হাতের লেখার ওজন ক্যালকুলেটর</small></div><button className="icon-button" onClick={() => setShowHistory(true)} aria-label="History"><History/></button></header>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">SMART WEIGHT BOOK</span><h1>ওজনের হিসাব,<br/>এখন আরও সহজ</h1><p>খাতার ছবি তুলুন, সংখ্যাগুলো যাচাই করুন, মোট ওজন বের করুন।</p></div><div className="hero-icon"><Scale size={58}/></div></section>
    <section className="upload-card">
      <div className="section-heading"><div><span className="step">01</span><h2>খাতার ছবি দিন</h2></div><span className="offline-tag">OCR</span></div>
      <div className="upload-actions">
        <button className="primary-action" onClick={() => cameraRef.current?.click()} disabled={busy}><Camera/>ক্যামেরা</button>
        <button className="secondary-action" onClick={() => galleryRef.current?.click()} disabled={busy}><ImagePlus/>গ্যালারি</button>
      </div>
      <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e => scan(e.target.files?.[0])}/>
      <input ref={galleryRef} hidden type="file" accept="image/*" onChange={e => scan(e.target.files?.[0])}/>
      <p className="status-line">{busy && <RefreshCw className="spin" size={15}/>} {message}</p>
      <p className="hint">উদাহরণ: 44,100 = ৪৪ কেজি ১০০ গ্রাম। OCR ভুল করতে পারে, তাই হিসাবের আগে যাচাই করুন।</p>
    </section>
    <section className="entries-card">
      <div className="section-heading"><div><span className="step">02</span><h2>সংখ্যা যাচাই করুন</h2></div><span className="count">{entries.length} লাইন</span></div>
      {entries.length === 0 ? <div className="empty-state">এখনও কোনো ওজন যোগ হয়নি</div> : <div className="entry-list">{entries.map((e, i) => <div className="entry-row" key={e.id}><span className="row-number">{String(i + 1).padStart(2, '0')}</span>{editing === e.id ? <input autoFocus defaultValue={e.raw} onBlur={ev => { updateEntry(e.id, ev.target.value); setEditing(null); }} onKeyDown={ev => { if (ev.key === 'Enter') { updateEntry(e.id, ev.currentTarget.value); setEditing(null); } }}/> : <strong>{e.kg} <small>kg</small> {e.grams} <small>g</small></strong>}<button className="tiny-button" onClick={() => setEditing(e.id)} aria-label="Edit"><Pencil size={16}/></button><button className="tiny-button danger" onClick={() => setEntries(old => old.filter(x => x.id !== e.id))} aria-label="Delete"><Trash2 size={16}/></button></div>)}</div>}
      <div className="add-row"><input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEntry()} placeholder="নতুন ওজন লিখুন, যেমন 44,100"/><button onClick={addEntry} aria-label="Add"><Plus/></button></div>
    </section>
    <section className="total-card"><div className="total-top"><span>মোট ওজন</span><span className="verified"><Check size={14}/> যাচাইয়ের পর</span></div><div className="total-value">{sum.totalKg}<small>kg</small> <i>{sum.totalGrams}</i><small>g</small></div><div className="total-caption">মোট {entries.length}টি এন্ট্রি</div></section>
    <section className="bottom-actions"><button className="primary-action" onClick={saveBill} disabled={!entries.length}><Check/>সেভ করুন</button><button className="secondary-action" onClick={pdf} disabled={!entries.length}><FileDown/>PDF</button><button className="whatsapp-action" onClick={shareWhatsApp} disabled={!entries.length}><MessageCircle/>WhatsApp</button></section>
    <button className="clear-button" onClick={() => { setEntries([]); setMessage('নতুন হিসাব শুরু করুন।'); }}> <X size={15}/> নতুন হিসাব শুরু</button>
    <footer> NEXORA CALC <span>•</span> Simple. Accurate. Yours.</footer>
    {showHistory && <div className="modal-backdrop" onClick={() => setShowHistory(false)}><div className="history-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>আগের হিসাব</h2><button className="icon-button" onClick={() => setShowHistory(false)}><X/></button></div>{bills.length ? bills.map(b => <button className="history-item" key={b.id} onClick={() => loadBill(b)}><span><b>{b.totalKg} kg {b.totalGrams} g</b><small>{b.date}</small></span><span>{b.entries.length} লাইন →</span></button>) : <p className="empty-state">কোনো হিস্ট্রি নেই</p>}</div></div>}
  </main>;
}
