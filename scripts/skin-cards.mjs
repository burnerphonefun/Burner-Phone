// node scripts/skin-cards.mjs [url] — the real phone in each skin, on a transparent background, for the site's game cards
// → web/public/skins/<world>.png. Also renders each world's poster → web/public/poster-<world>.jpg when --posters is passed.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://localhost:5207/';
const posters = args.includes('--posters');
const worlds = (args.find((a) => a.startsWith('--worlds=')) || '--worlds=blocky,toon,tactical,obby,survival,city').slice(9).split(',');
mkdirSync('web/public/skins', { recursive: true });
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
for (const w of worlds) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await p.goto(url + '?debug&still&world=' + w, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(11000);
  if (posters) {
    const data = await p.evaluate(async (id) => {
      const wd = window.getWorld?.(); if (!wd) return null;
      await wd.ready; await wd.setWorld(id); wd.stop(); wd.renderAt(1.5);
      return wd.snapshot(1600, 1000).toDataURL('image/jpeg', 0.74);
    }, w);
    if (data) { writeFileSync('web/public/poster-' + w + '.jpg', Buffer.from(data.split(',')[1], 'base64')); console.log('poster', w); }
  }
  await p.addStyleTag({ content: 'html,body,.st-hero{background:transparent!important} .st-world,.st-shade,.hud,.st-top,.st-pitch,.st-keys,.st-picker,.st-ticker,.st-main,.st-foot,.bn-layer{visibility:hidden!important}' });
  await p.waitForTimeout(400);
  const box = await p.locator('.bp-rig').boundingBox();
  const clip = { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 50), width: Math.min(1440 - Math.max(0, box.x - 60), box.width + 140), height: 900 - Math.max(0, box.y - 50) };
  await p.screenshot({ path: 'web/public/skins/' + w + '.png', omitBackground: true, clip });
  console.log('skin', w);
  await p.close();
}
await b.close();
