// Small helpers shared by the server modules. Nothing here throws on bad upstream data.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function isMint(s) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  for (const ch of s) if (!B58.includes(ch)) return false;
  return true;
}

export const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  origin: 'https://pump.fun',
  referer: 'https://pump.fun/',
};

// fetch JSON with a hard timeout. Always resolves: { ok, status, data, ms }
export async function getJSON(url, { headers, timeout = 4000 } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    const status = r.status;
    if (!r.ok) {
      await r.arrayBuffer().catch(() => {});
      const ra = Number(r.headers.get('retry-after'));
      return { ok: false, status, data: null, ms: Date.now() - t0, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
    }
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { return { ok: false, status: 598, data: null, ms: Date.now() - t0 }; }
    return { ok: true, status, data, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: e?.name === 'TimeoutError' ? 599 : 597, data: null, ms: Date.now() - t0 };
  }
}

// a number from an upstream field, or null
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const sig = (n, d = 5) => (n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toPrecision(d)));
export const fix = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

// insertion-ordered LRU on top of Map
export class LRU {
  constructor(max) { this.max = max; this.m = new Map(); }
  get(k) { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k, v) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.max) this.m.delete(this.m.keys().next().value); }
  has(k) { return this.m.has(k); }
  delete(k) { this.m.delete(k); }
  get size() { return this.m.size; }
}

// log at most once per `every` ms per key
const lastLog = new Map();
export function logEvery(key, every, ...args) {
  const now = Date.now();
  if (now - (lastLog.get(key) || 0) < every) return;
  lastLog.set(key, now);
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

// A rolling one-minute call budget for an upstream that blocks per IP. pump.fun's swap-api
// trades endpoint (measured 2026-10-12): ~20 calls in a burst, then 429 with retry-after: 60
// for a fixed minute; even 10 calls/min hit a block every ~2 min. So: start low, drop 2 per
// 429 (min 3), creep back 1 per 10 clean minutes (up to max).
export function budget(limit, max = limit) {
  return { limit, max, calls: [], blockedUntil: 0, cleanSince: Date.now(), blocks: 0 };
}
export function canSpend(b, now = Date.now()) {
  if (now < b.blockedUntil) return false;
  while (b.calls.length && b.calls[0] < now - 60000) b.calls.shift();
  if (now - b.cleanSince > 600000 && b.limit < b.max) { b.limit++; b.cleanSince = now; }
  return b.calls.length < b.limit;
}
export function spend(b) { b.calls.push(Date.now()); }
export function blocked(b, retryAfter) {
  b.blockedUntil = Date.now() + (retryAfter || 60) * 1000 + 1000;
  b.limit = Math.max(3, b.limit - 2);
  b.cleanSince = Date.now();
  b.blocks++;
}

// per-upstream counters, shown on /health
export const meters = {};
export function meter(name) {
  return (meters[name] ||= { calls: 0, ok: 0, e429: 0, err: 0, lastOk: 0, lastMs: 0 });
}
export function record(name, res) {
  const m = meter(name);
  m.calls++;
  m.lastMs = res.ms;
  if (res.ok) { m.ok++; m.lastOk = Date.now(); }
  else if (res.status === 429) m.e429++;
  else m.err++;
}
