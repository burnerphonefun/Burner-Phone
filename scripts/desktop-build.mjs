// node scripts/desktop-build.mjs page|icon|detector|dist
//   page: build the overlay page into desktop/app-dist (+ config.json with the API base)
//   icon: render web/public/favicon.svg to desktop/build/icon.png (256) and tray.png (32) with the installed Chrome
//   detector: cargo build the Rust game detector (desktop/detect) → desktop/bin/burner-detect.exe
//   dist: page + icon + detector + electron-builder → desktop/dist/burner-windows.zip
// BURNER_API=https://... bakes the live server into the app (default http://localhost:8787 for dev).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const APP = resolve(import.meta.dirname, '..');
const DESK = join(APP, 'desktop');
const cmd = process.argv[2] || 'page';
const api = (process.env.BURNER_API || 'http://localhost:8787').replace(/\/+$/, '');

function run(command, args, cwd, env = {}) {
  const r = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(command + ' ' + args.join(' ') + ' failed (' + r.status + ')'); process.exit(r.status || 1); }
}

// Content-Security-Policy for the overlay page: our own files, the baked API (+ its websocket), Google Fonts. Nothing inline.
export function overlayCsp(apiUrl) {
  const u = new URL(apiUrl);
  const ws = (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host;
  return [
    "default-src 'none'",
    "script-src 'self' file:",
    "style-src 'self' file: 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' file: data: https://fonts.gstatic.com",
    `img-src 'self' file: data: blob: ${u.origin}`,
    `connect-src ${u.origin} ${ws}`,
    "media-src 'self' blob: mediastream:",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "worker-src 'none'",
  ].join('; ');
}

function page() {
  if (process.env.BURNER_RELEASE && !api.startsWith('https://')) { console.error('a release build needs an https BURNER_API'); process.exit(1); }
  run('npx', ['vite', 'build', '--logLevel', 'warn'], APP, { INPUT: 'overlay', BASE: './', OUT: '../desktop/app-dist', NO_PUBLIC: '1' });
  writeFileSync(join(DESK, 'app-dist', 'config.json'), JSON.stringify({ api }, null, 1));
  const htmlFile = join(DESK, 'app-dist', 'overlay.html');
  const html = readFileSync(htmlFile, 'utf8');
  if (!html.includes('__BURNER_CSP__')) { console.error('overlay.html lost its CSP placeholder'); process.exit(1); }
  writeFileSync(htmlFile, html.split('__BURNER_CSP__').join(overlayCsp(api)));
  console.log('overlay page built → desktop/app-dist (api ' + api + ', CSP set)');
}

async function icon(force) {
  const out = join(DESK, 'build');
  if (!force && existsSync(join(out, 'icon.png')) && existsSync(join(out, 'tray.png'))) return;
  mkdirSync(out, { recursive: true });
  const { chromium } = await import('playwright-core');
  const svg = readFileSync(join(APP, 'web', 'public', 'favicon.svg'), 'utf8');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const [name, size] of [['icon.png', 256], ['tray.png', 32]]) {
    const pg = await browser.newPage({ viewport: { width: size, height: size } });
    await pg.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await pg.screenshot({ path: join(out, name), omitBackground: true });
    await pg.close();
  }
  await browser.close();
  console.log('icons → desktop/build/icon.png, tray.png');
}

// the Rust game detector. No cargo: the app ships without it and uses PowerShell + detect.cs (with a warning here).
function detector(required) {
  const cargo = [process.env.CARGO, join(homedir(), '.cargo', 'bin', 'cargo.exe'), 'cargo']
    .find((c) => c && spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
  if (!cargo) {
    if (required) { console.error('no cargo found (install Rust from rustup.rs)'); process.exit(1); }
    console.warn('warning: no cargo, so no burner-detect.exe: the app will detect games with PowerShell');
    return;
  }
  const crate = join(DESK, 'detect');
  run(cargo, ['build', '--release', '--quiet', '--manifest-path', join(crate, 'Cargo.toml')], crate);
  mkdirSync(join(DESK, 'bin'), { recursive: true });
  copyFileSync(join(crate, 'target', 'release', 'burner-detect.exe'), join(DESK, 'bin', 'burner-detect.exe'));
  console.log('game detector built → desktop/bin/burner-detect.exe');
}

if (cmd === 'page') page();
else if (cmd === 'icon') await icon(true);
else if (cmd === 'detector') detector(true);
else if (cmd === 'dist') {
  if (!process.env.BURNER_API) console.warn('warning: BURNER_API not set, the app will look for a server on localhost:8787');
  await icon(false);
  page();
  detector(false);
  rmSync(join(DESK, 'dist'), { recursive: true, force: true });
  run('npx', ['electron-builder', '--win', 'zip', '--x64', '--publish', 'never'], DESK);
  const zip = join(DESK, 'dist', 'burner-windows.zip');
  if (existsSync(zip)) console.log('built ' + zip);
} else { console.error('usage: desktop-build.mjs page|icon|detector|dist'); process.exit(1); }
