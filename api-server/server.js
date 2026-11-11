import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 10000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '12mb' }));
app.use('/api/scan', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'Nexora Calc AI API' }));

app.post('/api/scan', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ success: false, error: 'AI সার্ভারে API key সেট করা হয়নি।' });

    const { imageBase64, mimeType } = req.body || {};
    if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      return res.status(400).json({ success: false, error: 'ছবিটি পাওয়া যায়নি। আবার ছবি তুলুন।' });
    }
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMime.includes(mimeType)) {
      return res.status(400).json({ success: false, error: 'শুধু JPG, PNG অথবা WEBP ছবি ব্যবহার করুন।' });
    }
    const base64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (base64.length > 10_000_000) {
      return res.status(413).json({ success: false, error: 'ছবিটি খুব বড়। ছোট/কম রেজোলিউশনের ছবি দিন।' });
    }

    const prompt = `You are a careful visual data-entry assistant for a Bengali/English handwritten weight ledger.
Inspect the ENTIRE image visually, line by line. Extract ONLY actual weight entries written by the user in the list.
The user's common notation is "44,100" meaning 44 kilograms and 100 grams; "39,300" means 39 kg 300 g. Bengali digits are equally valid.
Rules:
1. Never treat page numbers, dates, phone numbers, prices, serial numbers, sums/totals, headings, or unrelated numbers as weight entries.
2. Do not extract a number merely because it appears somewhere on the page. It must clearly be a standalone weight row in the list.
3. Preserve top-to-bottom reading order. One row = one entry. Do not duplicate an entry.
4. For comma notation, first group is whole kilograms and second group is grams (pad mentally only if clearly written); grams must be 0..999.
5. If the writing is ambiguous or partly obscured, do NOT guess. Omit that row rather than inventing digits.
6. Do not calculate a total. Return only individual rows.
7. Keep originalText exactly as seen (including Bengali digits if present). confidence must be high, medium, or low. Include only high/medium entries; omit low-confidence guesses.
Return JSON only matching this schema. If no clear weights exist, return an empty weights array.`;

    const schema = {
      type: 'OBJECT',
      properties: {
        weights: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              kg: { type: 'INTEGER' },
              grams: { type: 'INTEGER' },
              originalText: { type: 'STRING' },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] }
            },
            required: ['kg', 'grams', 'originalText', 'confidence']
          }
        },
        note: { type: 'STRING' }
      },
      required: ['weights', 'note']
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } }
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingLevel: 'medium' } }
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error('Gemini API error:', payload?.error?.message || response.status);
      return res.status(response.status === 429 ? 429 : 502).json({
        success: false,
        error: response.status === 429
          ? 'AI ব্যবহারের সীমা শেষ হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।'
          : 'AI দিয়ে ছবি পড়া যায়নি। আবার চেষ্টা করুন।'
      });
    }

    const output = payload.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!output) return res.status(502).json({ success: false, error: 'AI কোনো লেখা শনাক্ত করতে পারেনি।' });
    const parsed = JSON.parse(output);
    const weights = (Array.isArray(parsed.weights) ? parsed.weights : [])
      .filter(w => Number.isInteger(w.kg) && Number.isInteger(w.grams) && w.kg >= 1 && w.kg <= 300 && w.grams >= 0 && w.grams <= 999 && ['high', 'medium'].includes(w.confidence))
      .map(w => ({ kg: w.kg, grams: w.grams, originalText: String(w.originalText || (w.kg + ',' + w.grams)), confidence: w.confidence }));

    return res.json({ success: true, data: { weights, note: String(parsed.note || '') } });
  } catch (error) {
    console.error('Nexora Calc scan error:', error);
    return res.status(500).json({ success: false, error: 'ছবি পড়ার সময় সমস্যা হয়েছে। আবার চেষ্টা করুন।' });
  }
});

app.listen(PORT, () => console.log(`Nexora Calc AI API listening on ${PORT}`));
