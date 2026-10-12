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
}

// the UTC day's rugs, the biggest fall in dollars first. A $3K coin going to $1K is noise; it needs a real top.
export function topWasted(n = 5, minPeak = 12000) {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const today = log.filter((x) => x.at >= day.getTime() && x.peakMc >= minPeak);
  const pool = today.length ? today : log.filter((x) => Date.now() - x.at < 24 * 3600e3 && x.peakMc >= minPeak);
  return { day: day.toISOString().slice(0, 10), count: log.filter((x) => x.at >= day.getTime()).length, top: pool.sort((a, b) => b.lost - a.lost).slice(0, n) };
}
