// Roomie+ server piece for Cloudflare Pages.
// It does one job: POST /api/scan takes receipt photos from the app and asks Claude to read them,
// using the ANTHROPIC_API_KEY you add in the Pages project settings. Everything else is served as files.
// The key never reaches anyone's phone.

const prompt = (n, today) => `${n > 1
  ? `These ${n} images are parts of one store receipt, in order from top to bottom; lines that appear in two images because the photos overlap must be listed once.`
  : 'This image is a photo of a store receipt or bill.'} It can be from any country. Read it and reply with only one JSON object in this shape:
{"store": string, "date": "YYYY-MM-DD" or null, "items": [{"name": string, "price": number, "taxed": boolean}], "tax": number, "total": number or null}
Rules:
- One entry in "items" per purchased line. "price" is the final amount for that line after quantity or weight (2 @ 1.99 is 3.98), as a plain number with a dot as the decimal separator.
- Discounts, coupons and member savings printed on their own line are separate items with a negative price. Deposits, bag fees, delivery fees and tips are items too.
- Write each name so a person can recognize it: expand store abbreviations when you are confident ("ORG BAN" becomes "Organic bananas"); otherwise keep the printed text. Keep the receipt's language.
- "taxed" is true when the line carries a tax marker (H, HST, T, G, P, A, B, a VAT code, or a similar flag) and the tax is added on top of the listed prices; otherwise false.
- "tax" is the sum of every tax line that is added on top of the item prices (HST, GST, PST, sales tax). If prices already include tax (VAT shown only as information), "tax" is 0.
- "total" is the printed grand total. Do not list subtotal, total, tax, payment, change, points or loyalty lines as items.
- Today is ${today}; use it to resolve a date printed without a year.
- If the image is not a receipt or cannot be read, reply {"error": "not_a_receipt"}.`;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function parse(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

async function scan(request, env, url) {
  if (request.method === 'GET') return json({ ok: true, ready: !!env.ANTHROPIC_API_KEY });
  if (request.method !== 'POST') return json({ error: 'bad_request' }, 405);

  // Only the app served from this same address may call it.
  let origin = null; try { origin = new URL(request.headers.get('Origin')).host; } catch {}
  if (origin !== url.host) return json({ error: 'forbidden' }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'no_key' }, 503);

  let body; try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const images = Array.isArray(body?.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return json({ error: 'bad_request' }, 400);
  if (images.some(x => typeof x !== 'string' || x.length > 4000000 || !/^[A-Za-z0-9+/=]+$/.test(x))) return json({ error: 'image_rejected' }, 413);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.SCAN_MODEL || 'claude-sonnet-5-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: [
          ...images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
          { type: 'text', text: prompt(images.length, today) }
        ] }]
      })
    });
  } catch { return json({ error: 'upstream' }, 502); }

  if (res.status === 429) return json({ error: 'rate_limited' }, 429);
  if (res.status === 401 || res.status === 403) return json({ error: 'bad_key' }, 502);
  if (!res.ok) return json({ error: 'upstream', status: res.status }, 502);

  const out = await res.json().catch(() => null);
  const text = (out?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const receipt = parse(text);
  if (!receipt) return json({ error: 'invalid_json' }, 502);
  if (receipt.error) return json({ error: 'not_a_receipt' }, 422);
  return json({ receipt });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/scan') return scan(request, env, url);
    return env.ASSETS.fetch(request);
  }
};
