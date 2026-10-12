// node scripts/shots.mjs [url] [outDir] [--times=2,20] [--only=desktop|mobile] [--eval=js] [--q=world=blocky]
// Screenshots desktop 1440x900 + mobile 390x844, prints console errors and failed requests.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
const [url = 'http://localhost:5207/', out = 'shots'] = args.filter((a) => !a.startsWith('--'));
const times = String(flags.times || '2,20').split(',').map(Number);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const extra = flags.vp ? String(flags.vp).split(',').map((v) => { const [w, h] = v.split('x').map(Number); return ['vp' + w + 'x' + h, { width: w, height: h }, 1]; }) : [];
const views = [...(flags.vp ? [] : [['desktop', { width: 1440, height: 900 }, 1], ['mobile', { width: 390, height: 844 }, 3]]), ...extra].filter(([n]) => !flags.only || flags.only === n || n.startsWith('vp'));
for (const [name, vp, dpr] of views) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errs.push('http ' + r.status() + ' ' + r.url().slice(0, 100)); });
  page.on('requestfailed', (r) => { if (!r.url().includes('/img/')) errs.push('reqfail: ' + r.url().slice(0, 120) + ' ' + r.failure()?.errorText); });
  const u = url + (flags.q ? (url.includes('?') ? '&' : '?') + flags.q : '');
  const t0 = Date.now();
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => errs.push('goto: ' + e.message));
  for (const t of times) {
    const wait = t * 1000 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    if (flags.eval && t === times[0]) { try { console.log('eval:', JSON.stringify(await page.evaluate(flags.eval))); } catch (e) { console.log('eval err', e.message); } }
    const f = join(out, `${name}-${t}s.png`);
    await page.screenshot({ path: f }).catch((e) => errs.push('shot: ' + e.message));
    console.log('shot', f);
  }
  console.log(name, errs.length ? '\n  ' + [...new Set(errs)].slice(0, 25).join('\n  ') : 'no console errors');
  await ctx.close();
}
await browser.close();
