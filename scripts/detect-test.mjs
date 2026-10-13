// node scripts/detect-test.mjs [path/to/burner-detect.exe] — the game detector, Windows only, no Electron:
// runs main.cjs's own startDetector/skinFor code (lifted out of the file, Electron stubbed) against
//   1. the Rust helper (bin/burner-detect.exe): lines arrive and parse
//   2. no helper: falls back to PowerShell + detect.cs and still gets lines
//   3. a helper that dies without a line, twice: gives up on it and falls back
// plus skinFor on the names that matter (ourselves never changes the skin).
import { readFileSync, mkdtempSync, copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') { console.log('detect-test: Windows only, skipped'); process.exit(0); }
const DESK = resolve(import.meta.dirname, '..', 'desktop');
const exe = resolve(process.argv[2] || join(DESK, 'bin', 'burner-detect.exe'));
if (!existsSync(exe)) { console.error('no helper at ' + exe + ' (cargo build --release in desktop/detect, or npm run dist)'); process.exit(1); }

const src = readFileSync(join(DESK, 'main.cjs'), 'utf8');
const block = src.slice(src.indexOf('// ---------- which game is in front'), src.indexOf('// ---------- tray ----------'));
if (!block.includes('function startDetector')) { console.error('could not find the detector block in main.cjs'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${info ? '  · ' + info : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// one sandboxed copy of the detector per case, with its own UNPACKED folder
function load(unpacked) {
  const ctx = vm.createContext({ process, console, setTimeout, fs, path, spawn, UNPACKED: unpacked, send: () => {}, rebuildTray: () => {}, skin: () => 'x' });
  vm.runInContext(`let detector = null, detected = 'default', override = null, quitting = false;
    ${block}
    globalThis.t = { startDetector, skinFor, get detected() { return detected; }, get nativeFails() { return nativeFails; },
      get detector() { return detector; }, stop() { quitting = true; try { detector?.kill(); } catch {} } };`, ctx);
  return ctx.t;
}
function folder(withExe, fake) {
  const d = mkdtempSync(join(tmpdir(), 'burner-detect-'));
  copyFileSync(join(DESK, 'detect.ps1'), join(d, 'detect.ps1'));
  copyFileSync(join(DESK, 'detect.cs'), join(d, 'detect.cs'));
  if (withExe || fake) { mkdirSync(join(d, 'bin')); copyFileSync(fake || exe, join(d, 'bin', 'burner-detect.exe')); }
  return d;
}
// count the lines a detector produces by watching its stdout from the outside
function watch(t) { const seen = { n: 0, child: t.detector }; seen.child?.stdout.on('data', (c) => { seen.n += String(c).split('\n').filter(Boolean).length; }); return seen; }

console.log('skinFor');
{
  const t = load(tmpdir());
  ok('our own window keeps the skin (packaged name)', t.skinFor('BurnerPhone', 'BurnerPhone') === null);
  ok('our own window keeps the skin (dev name)', t.skinFor('electron', '') === null);
  ok('nothing in front keeps the skin', t.skinFor('', '') === null);
  ok('any other program is the default phone', t.skinFor('notepad', 'notes') === 'default');
}

console.log('native helper');
{
  const d = folder(true);
  const t = load(d);
  t.startDetector();
  const seen = watch(t);
  ok('starts the Rust helper', /burner-detect\.exe$/i.test(t.detector?.spawnfile || ''), t.detector?.spawnfile);
  await wait(4600);
  ok('lines arrive every 2 s', seen.n >= 2, seen.n + ' lines, skin now ' + t.detected);
  t.stop(); await wait(300); rmSync(d, { recursive: true, force: true });
}

console.log('no helper: PowerShell + detect.cs');
{
  const d = folder(false);
  const t = load(d);
  t.startDetector();
  const seen = watch(t);
  ok('starts PowerShell', /powershell/i.test(t.detector?.spawnfile || ''), t.detector?.spawnfile);
  await wait(9000); // PowerShell compiles detect.cs first (slow on CI runners)
  ok('lines arrive', seen.n >= 1, seen.n + ' lines');
  t.stop(); await wait(300); rmSync(d, { recursive: true, force: true });
}

console.log('a helper that dies without a line');
{
  const d = folder(false, process.execPath); // node with no script and no stdin: exits at once, prints nothing
  const t = load(d);
  t.startDetector();
  await wait(10000); // two failed starts (2 s, 4 s back-off), then PowerShell
  ok('gives up on it after two silent exits', t.nativeFails >= 2, 'nativeFails ' + t.nativeFails);
  ok('falls back to PowerShell', /powershell/i.test(t.detector?.spawnfile || ''), t.detector?.spawnfile);
  t.stop(); await wait(300); rmSync(d, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
