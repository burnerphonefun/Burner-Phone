// Static files from app/dist: gzip for text, immutable hashed assets, SPA fallback.
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const DIST = path.resolve(process.env.DIST_DIR || path.join(import.meta.dirname, '..', 'dist'));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.zip': 'application/zip',
  '.exe': 'application/octet-stream', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml',
};
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest', '.xml']);
const cache = new Map(); // abs path -> { mtime, size, buf, gz }

async function load(abs) {
  let st;
  try { st = await stat(abs); } catch { return null; }
  if (!st.isFile()) return null;
  const hit = cache.get(abs);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit;
  // big files and every video are streamed from disk with byte ranges (iOS won't play a video without 206s)
  const video = ['.mp4', '.webm', '.mov'].includes(path.extname(abs).toLowerCase());
  if (st.size > 8 * 1024 * 1024 || video) return { mtime: st.mtimeMs, size: st.size, buf: null, gz: null, big: true };
  const buf = await readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const gz = TEXT.has(ext) && buf.length > 1024 ? gzipSync(buf, { level: 9 }) : null;
  const ent = { mtime: st.mtimeMs, size: st.size, buf, gz };
  cache.set(abs, ent);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return ent;
}

export async function serveStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return false; }
  if (rel.includes('\0')) return false;
  if (rel.endsWith('/')) rel += 'index.html';
  let abs = path.resolve(DIST, '.' + path.posix.normalize('/' + rel));
  if (abs !== DIST && !abs.startsWith(DIST + path.sep)) return false;
  let ent = await load(abs);
  if (!ent) {
    const last = rel.split('/').pop() || '';
    if (last.includes('.') && rel !== '/index.html') return false;
    abs = path.join(DIST, 'index.html');
    ent = await load(abs);
    if (!ent) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('burner: site not built yet (run npm run build)');
      return true;
    }
  }
  const ext = path.extname(abs).toLowerCase();
  const isAsset = urlPath.startsWith('/assets/');
  const headers = {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : isAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  };
  if (ent.big) {
    const { createReadStream } = await import('node:fs');
    headers['content-length'] = ent.size;
    headers['accept-ranges'] = 'bytes';
    const range = req.headers.range;
    const m = typeof range === 'string' ? range.match(/bytes=(\d*)-(\d*)/) : null;
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), ent.size - 1) : ent.size - 1;
      if (start <= end && start < ent.size) {
        headers['content-range'] = `bytes ${start}-${end}/${ent.size}`;
        headers['content-length'] = end - start + 1;
        res.writeHead(206, headers);
        if (req.method === 'HEAD') return res.end(), true;
        createReadStream(abs, { start, end }).pipe(res);
        return true;
      }
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end(), true;
    createReadStream(abs).pipe(res);
    return true;
  }
  let body = ent.buf;
  if (ent.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = ent.gz;
    headers['content-encoding'] = 'gzip';
  }
  if (ent.gz) headers.vary = 'Accept-Encoding';
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
