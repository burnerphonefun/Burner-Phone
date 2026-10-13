// Today's rugs, biggest first: every real rug the market sees, with the cap it fell from and where it landed.
// The site replays the day's biggest one to every visitor. Saved to the volume so a deploy doesn't forget the day.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || (existsSync('/data') ? '/data' : path.join(import.meta.dirname, '..', 'data'));
const FILE = path.join(DIR, 'wasted.json');
const KEEP_MS = 36 * 3600e3;
let log = [];
try { log = JSON.parse(readFileSync(FILE, 'utf8')).filter((r) => Date.now() - r.at < KEEP_MS); } catch {}

let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(log)); } catch {} }, 2000);
}

// r = { mint, sym, name, peakMc, rugMc, drop, reason, at, born }
export function recordRug(r) {
  if (!r?.mint || !(r.peakMc > 0) || !(r.rugMc >= 0)) return;
  if (log.some((x) => x.mint === r.mint)) return;
  log.push({ ...r, lost: Math.round(r.peakMc - r.rugMc) });
  const cut = Date.now() - KEEP_MS;
  log = log.filter((x) => x.at >= cut).slice(-2000);
  save();
  verifySoon();
}

// Fake market caps: a coin that bonds on a near-empty pool can print "$17M" on a few hundred $K of trades, then
// "rug" from a top nobody could ever sell at. Above the bonding curve's range a peak only counts if real money
// traded: pump.fun's own candles (USD volume from launch to the rug) must add up to >= 10% of the peak.
const VERIFY_ABOVE = 150000; // the curve can't print more than ~$100K, so a bigger peak is a bonded pool
const MIN_TRADED = 0.1;
const SWAP = 'https://swap-api.pump.fun/v2/coins/';
let verifying = false;

async function traded(r) {
  const from = r.born || r.at - 6 * 3600e3;
  const res = await fetch(SWAP + r.mint + '/candles?interval=5m&limit=300&currency=USD&createdTs=' + Math.round(from), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('candles ' + res.status);
  const candles = await res.json();
  if (!Array.isArray(candles)) throw new Error('candles: not a list');
  let usd = 0;
  for (const k of candles) if (+k.timestamp <= r.at + 300000 && Number.isFinite(+k.volume)) usd += +k.volume;
  return Math.round(usd);
}

// one at a time, a pause between calls, each entry at most once per pass; a failure retries on the next pass (a new
// rug comes in about once a minute), up to 3 tries, and stays unverified meanwhile
async function verifySoon() {
  if (verifying) return;
  verifying = true;
  const seen = new Set();
  try {
    for (;;) {
      const r = log.find((x) => x.peakMc >= VERIFY_ABOVE && x.traded == null && (x.tries || 0) < 3 && !seen.has(x));
      if (!r) break;
      seen.add(r);
      try { r.traded = await traded(r); } catch { r.tries = (r.tries || 0) + 1; }
      save();
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  } finally { verifying = false; }
}
verifySoon(); // whatever the volume already holds from before this check existed

// a peak worth headlining: inside the curve's range, or verified by real trading. Unverified big peaks wait.
const real = (x) => x.peakMc < VERIFY_ABOVE || (x.traded != null && x.traded >= MIN_TRADED * x.peakMc);

// the UTC day's rugs, the biggest fall in dollars first. A $3K coin going to $1K is noise; it needs a real top.
export function topWasted(n = 5, minPeak = 12000) {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const ok = (x) => x.peakMc >= minPeak && real(x);
  const today = log.filter((x) => x.at >= day.getTime() && ok(x));
  const pool = today.length ? today : log.filter((x) => Date.now() - x.at < 24 * 3600e3 && ok(x));
  const top = pool.sort((a, b) => b.lost - a.lost).slice(0, n).map(({ tries, ...x }) => x);
  return { day: day.toISOString().slice(0, 10), count: log.filter((x) => x.at >= day.getTime()).length, top };
}
