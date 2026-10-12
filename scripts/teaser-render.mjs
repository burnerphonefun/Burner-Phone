// node scripts/teaser-render.mjs [--story=city|blocky|games|both|all|a,b] [--preview=1,4.2,9.5] [--plates] [--no-audio]
// Steps the edit page (web/teaser.html) at 60 Hz, pipes JPEG frames into ffmpeg-static with the synthesized score.
// Outputs: launch/teaser-<story>.mp4 (high quality) + web/public/media/teaser-<story>.mp4 (web, ≤ 6 MB) + posters.
//   --plates   re-capture the phone plates from the real phone first (needs the dev site on :5207 + API on :8790)
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { renderScore } from './teaser-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCH = join(ROOT, '..', 'launch');
const MEDIA = join(ROOT, 'web/public/media');
const TMP = join(ROOT, 'node_modules/.teaser');
mkdirSync(MEDIA, { recursive: true }); mkdirSync(TMP, { recursive: true }); mkdirSync(LAUNCH, { recursive: true });
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const stories = !args.story || args.story === 'all' ? ['city', 'blocky', 'games'] : args.story === 'both' ? ['city', 'blocky'] : String(args.story).split(',');
const PORT = 5231;

if (args.plates) execFileSync(process.execPath, [join(ROOT, 'scripts/teaser-plates.mjs'), '--stories=' + stories.join(',')], { stdio: 'inherit' });

// our own vite for the edit page (only the teaser page is needed, no API)
const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('vite did not start')), 20000); vite.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(to); res(); } }); vite.on('exit', (c) => rej(new Error('vite exited ' + c))); });

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
try {
  for (const story of stories) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    await page.goto(`http://localhost:${PORT}/teaser.html?story=${story}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.ready);
    const { dur, fps } = await page.evaluate(() => window.teaser);
    if (errs.length) console.log(story, 'page errors:', errs);

    if (args.preview) {
      const ts = String(args.preview).split(',').map(Number);
      for (const t of ts) {
        const url = await page.evaluate((t) => window.renderFrame(t), t);
        const f = join(TMP, `${story}-${t.toFixed(2)}.jpg`);
        writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
        console.log('preview', f);
      }
      await page.close();
      continue;
    }

    const wav = join(TMP, `${story}.wav`);
    if (!args['no-audio']) { renderScore(story, wav); console.log('score', wav); }
    const hq = join(LAUNCH, `teaser-${story}.mp4`);
    const ff = spawn(ffmpeg, [
      '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      ...(args['no-audio'] ? [] : ['-i', wav]),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      ...(args['no-audio'] ? [] : ['-c:a', 'aac', '-b:a', '192k']),
      '-movflags', '+faststart', '-shortest', hq,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let fferr = ''; ff.stderr.on('data', (d) => { fferr = (fferr + d).slice(-3000); });
    const n = Math.round(dur * fps);
    const t0 = Date.now();
    let poster = null;
    for (let i = 0; i < n; i++) {
      const url = await page.evaluate((t) => window.renderFrame(t), i / fps);
      const buf = Buffer.from(url.split(',')[1], 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i === Math.round(n * (story === 'city' ? 0.66 : story === 'games' ? 0.505 : 0.58))) poster = buf; // WASTED / the achievement
      if (i % 120 === 0) console.log(story, `frame ${i}/${n}`, Math.round((Date.now() - t0) / 1000) + 's');
    }
    ff.stdin.end();
    const code = await new Promise((r) => ff.on('exit', r));
    if (code !== 0) { console.log(fferr); throw new Error('ffmpeg failed ' + code); }
    if (poster) writeFileSync(join(LAUNCH, `teaser-${story}-poster.jpg`), poster);
    // the web copy: smaller, still 1080p
    const web = join(MEDIA, `teaser-${story}.mp4`);
    execFileSync(ffmpeg, ['-y', '-i', hq, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-maxrate', '2.6M', '-bufsize', '5.2M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', web], { stdio: 'ignore' });
    execFileSync(ffmpeg, ['-y', '-i', join(LAUNCH, `teaser-${story}-poster.jpg`), '-vf', 'scale=1280:-2', '-q:v', '4', join(MEDIA, `teaser-${story}-poster.jpg`)], { stdio: 'ignore' });
    console.log(story, 'done in', Math.round((Date.now() - t0) / 1000) + 's', hq, (statSync(hq).size / 1e6).toFixed(2) + ' MB', '| web', (statSync(web).size / 1e6).toFixed(2) + ' MB');
    await page.close();
  }
} finally {
  await browser.close();
  vite.kill();
}
