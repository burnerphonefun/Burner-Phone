// Burner server: the site, the api, and one shared set of live pump.fun connections for every phone.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { gzipSync } from 'node:zlib';
import { startFeed } from './feed.mjs';
import { coinAge, coinDetail, health, iconOf, onLaunch, onMigrate, snapshot, startMarket, stats } from './market.mjs';
import { clientCount, startHub } from './hub.mjs';
import { TF, candleHealth, candlesFor, startCandles } from './candles.mjs';
import { serveStatic } from './static.mjs';
import { topWasted } from './wasted.mjs';
import { BROWSER_HEADERS, LRU, isMint, meters } from './util.mjs';

const PORT = Number(process.env.PORT) || 8787;
const CANONICAL = (process.env.CANONICAL_HOST || '').toLowerCase(); // www.<this> answers with a 301 to it
const started = Date.now();

process.on('uncaughtException', (e) => console.error('uncaught', e));
process.on('unhandledRejection', (e) => console.error('unhandled', e));

const feed = startFeed({ onLaunch, onMigrate });
startMarket(feed);
startCandles();

function json(req, res, status, obj, extra = {}) {
  let body = Buffer.from(JSON.stringify(obj));
  const headers = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...extra };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'Accept-Encoding';
  }
  headers['content-length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------- coin pictures ----------
const imgs = new LRU(600);
const imgMiss = new LRU(3000);
const imgFlight = new Map();
let imgActive = 0;

async function getImage(url, timeout, hops = 3) {
  try {
    // redirects are followed by hand, and only to plain https public hosts: an icon URL comes from token
    // metadata, so it must not bounce us somewhere internal. images.pump.fun itself 302s to its image CDNs.
    const r = await fetch(url, {
      headers: { ...BROWSER_HEADERS, accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
    });
    if (r.status >= 300 && r.status < 400) {
      await r.arrayBuffer().catch(() => {});
      const loc = r.headers.get('location');
      // a picture pump.fun hasn't processed yet (the coin's first second or two) redirects to its stock pepe:
      // that's "not up yet", never the coin's picture, or it would stick to the coin for good
      if (loc && loc.includes('/coin-image/placeholder')) return null;
      const next = loc && hops > 0 ? safeIcon(new URL(loc, url).href) : null;
      return next ? getImage(next, timeout, hops - 1) : null;
    }
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/') || type.includes('svg')) { await r.arrayBuffer().catch(() => {}); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 400 * 1024) return null;
    return { buf, type };
  } catch { return null; }
}

// a token's own icon URL is only fetched if it's plain https on a public-looking host name
function safeIcon(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return null;
    const h = url.hostname.toLowerCase();
    if (isIP(h) || h.startsWith('[') || h === 'localhost' || !h.includes('.') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.flycast')) return null;
    return url.href;
  } catch { return null; }
}

async function fetchImg(mint) {
  while (imgActive >= 8) await new Promise((r) => setTimeout(r, 50));
  imgActive++;
  try {
    const img = await getImage('https://images.pump.fun/coin-image/' + mint + '?variant=86x86', 6000);
    if (img) return img;
    // fallback: the icon Jupiter lists for the coin (often ipfs or the launch site's CDN)
    const icon = safeIcon(iconOf(mint));
    return icon ? await getImage(icon, 5000) : null;
  } finally { imgActive--; }
}

// ---------- Windows build downloads ----------
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || path.join(import.meta.dirname, '..', 'downloads'));
const downloads = { total: 0, files: {} };

async function serveDownload(req, res, name) {
  const notFound = () => json(req, res, 404, { error: 'not available' }, { 'cache-control': 'no-cache' });
  if (!/^[a-z0-9-]+\.zip$/.test(name)) return notFound();
  const abs = path.join(DOWNLOAD_DIR, name);
  let st;
  try { st = await stat(abs); } catch { return notFound(); }
  if (!st.isFile()) return notFound();
  const headers = {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${name}"`,
    'cache-control': 'public, max-age=3600',
    'accept-ranges': 'bytes',
    'last-modified': st.mtime.toUTCString(),
    'access-control-allow-origin': '*',
  };
  let start = 0, end = st.size - 1, status = 200;
  const range = req.headers.range;
  if (typeof range === 'string' && range.startsWith('bytes=')) {
    const [a, b] = range.slice(6).split(',')[0].split('-');
    if (a === '' && b) { start = Math.max(0, st.size - Number(b)); }
    else { start = Number(a); if (b) end = Math.min(Number(b), st.size - 1); }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['content-length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  // a download is a GET that starts at byte 0 (resumed pieces don't count again)
  if (start === 0) { downloads.total++; downloads.files[name] = (downloads.files[name] || 0) + 1; }
  const stream = createReadStream(abs, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function serveImg(req, res, mint) {
  const hit = imgs.get(mint);
  const send = (img) => {
    if (!img) {
      // 204, not 404: an <img> still fires onerror (the phone shows the coin's initial and retries young coins),
      // but the browser doesn't log a console error for every picture that isn't up yet
      const young = (coinAge(mint) ?? 0) < 5 * 60e3;
      res.writeHead(204, { 'access-control-allow-origin': '*', 'cache-control': young ? 'no-store' : 'public, max-age=600' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': img.type, 'content-length': img.buf.length, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : img.buf);
  };
  if (hit) return send(hit);
  const miss = imgMiss.get(mint);
  if (miss && Date.now() < miss) return send(null);
  let p = imgFlight.get(mint);
  if (!p) {
    p = fetchImg(mint).then((img) => {
      imgFlight.delete(mint);
      if (img) imgs.set(mint, img);
      else imgMiss.set(mint, Date.now() + ((coinAge(mint) ?? Infinity) < 5 * 60e3 ? 2500 : 600000));
      return img;
    });
    imgFlight.set(mint, p);
  }
  send(await p);
}

// ---------- routes ----------
let snapCache = null, snapAt = 0;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://x');
    const p = url.pathname;
    if (CANONICAL && (req.headers.host || '').toLowerCase() === 'www.' + CANONICAL) {
      res.writeHead(301, { location: 'https://' + CANONICAL + (req.url || '/') });
      return res.end();
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-max-age': '86400' });
      return res.end();
    }
    if (p === '/health') {
      return json(req, res, 200, { ok: true, uptime: Math.round((Date.now() - started) / 1000), coins: health().coins, clients: clientCount(), up: stats().up, lpm: stats().lpm, downloads: downloads.total, downloadFiles: downloads.files, market: health(), candles: candleHealth(), feed: { ...feed }, meters });
    }
    if (p === '/api/download') {
      // the site asks here (a 200 either way) so a missing build never shows up as a console error
      let size = null;
      try { const st = await stat(path.join(DOWNLOAD_DIR, 'burnerphone-windows.zip')); if (st.isFile()) size = st.size; } catch {}
      return json(req, res, 200, { available: size != null, size, url: size != null ? '/download/burnerphone-windows.zip' : null }, { 'cache-control': 'no-cache' });
    }
    if (p.startsWith('/download/') && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveDownload(req, res, p.slice('/download/'.length));
    }
    if (p === '/api/wasted') return json(req, res, 200, topWasted(5), { 'cache-control': 'public, max-age=15' });
    if (p === '/api/snapshot') {
      if (!snapCache || Date.now() - snapAt > 1000) { snapCache = snapshot(); snapAt = Date.now(); }
      return json(req, res, 200, snapCache);
    }
    if (p.startsWith('/api/candles/')) {
      const mint = p.slice('/api/candles/'.length);
      if (!isMint(mint)) return json(req, res, 400, { error: 'bad mint' });
      const tf = url.searchParams.get('tf') || '1m';
      if (!TF[tf]) return json(req, res, 400, { error: 'tf must be 5s, 1m or 5m' });
      return json(req, res, 200, await candlesFor(mint, tf));
    }
    if (p.startsWith('/api/coin/')) {
      const mint = p.slice('/api/coin/'.length);
      if (!isMint(mint)) return json(req, res, 400, { error: 'bad mint' });
      const r = await coinDetail(mint);
      if (r.status !== 200) return json(req, res, r.status, { error: r.status === 404 ? 'unknown coin' : r.status === 503 ? 'loading, try again' : 'bad request' });
      return json(req, res, 200, r.body);
    }
    if (p.startsWith('/img/')) {
      const mint = p.slice(5);
      if (!isMint(mint)) { res.writeHead(400); return res.end(); }
      return serveImg(req, res, mint);
    }
    if (p.startsWith('/api/')) return json(req, res, 404, { error: 'not found' });
    if (await serveStatic(req, res, p)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (e) {
    console.error('request failed', req.url, e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
});

startHub(server);
server.listen(PORT, () => console.log(`burner server on :${PORT}`));

const stop = () => { server.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
