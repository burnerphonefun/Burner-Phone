// Burner for Windows: one transparent, click-through, always-on-top window over the screen with the phone in it.
// It never touches a game process: it only draws on top (like a stream overlay) and reads which window is in front.
const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, Tray, Menu, nativeImage, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const TEST = !!process.env.BURNER_TEST;
const WALLET_SELFTEST = !!process.env.BURNER_WALLET_SELFTEST;
// self-tests never touch the real profile (settings, first-run flags, wallet)
if (TEST || WALLET_SELFTEST || process.env.BURNER_TEST_WALLET) app.setPath('userData', require('node:path').join(require('node:os').tmpdir(), 'burner-wallet-selftest-' + process.pid));
const wallet = require('./wallet.cjs');
// the hotkeys a player can pick in the tray (Electron accelerators)
const HOTKEYS = ['Alt+Q', 'Alt+W', 'Alt+E', 'Ctrl+Shift+Space', 'F8', 'F9'];
const DEFAULT_HOTKEY = 'Alt+Q';
const ROOT = __dirname;
const UNPACKED = ROOT.replace('app.asar', 'app.asar.unpacked');

function baked() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'app-dist', 'config.json'), 'utf8')); } catch { return {}; }
}
// packaged builds only take the baked https API (no env overrides, never localhost); dev runs may point anywhere
const DEV = !app.isPackaged;
const PROD_API = 'https://burner-production-5f82.up.railway.app';
const API = (() => {
  const v = String((DEV ? process.env.BURNER_API : null) || baked().api || (DEV ? 'http://localhost:8787' : PROD_API)).replace(/\/+$/, '');
  return DEV || /^https:\/\/[^/]+$/.test(v) ? v : PROD_API;
})();

let win = null, tray = null, detector = null, quitting = false;
let detected = 'default', override = null, up = false;
let hotkey = null;            // the accelerator registered right now (null if none could be)
let savedHotkey = DEFAULT_HOTKEY;
let firstRunShown = false, firstRaiseShown = false;
let lastNotice = null;        // last tray notice (tests read it)
let trayTip = '';
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    override = s.skin || null;
    if (HOTKEYS.includes(s.hotkey)) savedHotkey = s.hotkey;
    firstRunShown = !!s.firstRunShown; firstRaiseShown = !!s.firstRaiseShown;
  } catch {}
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ skin: override, hotkey: savedHotkey, firstRunShown, firstRaiseShown })); } catch {}
}
const skin = () => override || detected;
const keyLabel = () => hotkey || 'no hotkey';

// a small notice from the tray (Windows balloon); falls back to a system notification
function notice(title, content) {
  lastNotice = { title, content, at: Date.now() };
  if (TEST) console.log('[notice] ' + title + ' | ' + content);
  try { if (tray && process.platform === 'win32') { tray.displayBalloon({ iconType: 'info', title, content, noSound: true }); return; } } catch {}
  try { const { Notification } = require('electron'); if (Notification.isSupported()) new Notification({ title, body: content, silent: true }).show(); } catch {}
}

// ---------- hotkey: register the new one before letting go of the old one ----------
let registerFn = (acc, cb) => globalShortcut.register(acc, cb); // tests swap this to simulate "taken by another app"
function setHotkey(next, { quiet = false } = {}) {
  if (!HOTKEYS.includes(next)) return { err: 'not a hotkey burnerphone offers' };
  if (next === hotkey) return { ok: true, hotkey };
  let okReg = false;
  try { okReg = registerFn(next, () => toggle()); } catch { okReg = false; }
  if (!okReg) {
    if (!quiet) notice('BurnerPhone: ' + next + ' is taken', 'another app already uses ' + next + '. still on ' + keyLabel() + '.');
    return { err: next + ' is taken by another app', hotkey };
  }
  if (hotkey) { try { globalShortcut.unregister(hotkey); } catch {} }
  hotkey = next; savedHotkey = next;
  saveSettings();
  setTrayTip();
  rebuildTray();
  send('hotkey', hotkey);
  return { ok: true, hotkey };
}
// at start: the saved key, else the default, else none (the tray still works)
function initHotkey() {
  for (const k of [...new Set([savedHotkey, DEFAULT_HOTKEY, ...HOTKEYS])]) {
    let okReg = false;
    try { okReg = registerFn(k, () => toggle()); } catch {}
    if (okReg) {
      hotkey = k;
      if (k !== savedHotkey) notice('BurnerPhone: ' + savedHotkey + ' is taken', 'another app already uses ' + savedHotkey + '. using ' + k + ' instead (change it in the tray).');
      return;
    }
  }
  hotkey = null;
  notice('BurnerPhone: no hotkey free', 'every burnerphone hotkey is taken by other apps. click the tray icon to bring the phone up.');
}
function setTrayTip() { trayTip = 'BurnerPhone (' + keyLabel() + ')'; try { tray?.setToolTip(trayTip); } catch {} }

if (!WALLET_SELFTEST && !app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => toggle(true));

function createWindow() {
  const d = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...d.bounds,
    transparent: true, frame: false, hasShadow: false, thickFrame: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000', title: 'BurnerPhone',
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false, devTools: DEV },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setMenu(null);
  win.loadFile(path.join(ROOT, 'app-dist', 'overlay.html'));
  win.once('ready-to-show', () => { win.showInactive(); displayId = null; moveTo(screen.getPrimaryDisplay()); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; pageReady = false; });
  win.webContents.on('did-start-loading', () => { pageReady = false; });
  if (TEST || (DEV && process.env.BURNER_LOG)) {
    win.webContents.on('console-message', (e, level, message) => {
      const msg = typeof e?.message === 'string' ? e.message : message;
      const lvl = e?.level ?? level;
      console.log('[page ' + lvl + ']', String(msg).slice(0, 400));
    });
  }
  win.webContents.on('render-process-gone', (_e, d2) => { console.error('renderer gone', d2.reason); if (!quitting) setTimeout(() => { win?.destroy(); createWindow(); }, 1000); });
}

// ---------- displays: the overlay covers one display, the one the player is on when the phone comes up ----------
let displayId = null;
const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
function targetDisplay() {
  // games keep the cursor inside their window, and Electron's cursor point is already DPI-correct on mixed-scale setups
  try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); } catch { return screen.getPrimaryDisplay(); }
}
function moveTo(d) {
  if (!win || win.isDestroyed() || !d) return false;
  const moved = displayId !== d.id || !sameBounds(win.getBounds(), d.bounds);
  if (moved) {
    win.setBounds(d.bounds);
    // crossing displays with different scale factors can land one step off; set it once more
    if (!sameBounds(win.getBounds(), d.bounds)) win.setBounds(d.bounds);
    displayId = d.id;
    send('display', { id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor });
  }
  return moved;
}
// display added/removed/rescaled: stay on ours if it still exists, else go to the primary
function fit() {
  if (!win) return;
  const d = screen.getAllDisplays().find((x) => x.id === displayId) || screen.getPrimaryDisplay();
  displayId = null; // force the bounds and the 'display' event even when the id is unchanged (its size may be new)
  moveTo(d);
}

function send(ch, arg) { win?.webContents.send(ch, arg); }

// the hotkey or the tray: the page owns the phone's state and reports back on 'up'
// toggles that arrive before the page is listening are kept until it says ready
let pageReady = false, pendingToggle = false;
function toggle(forceUp) {
  if (forceUp && up) return;
  if (!up) moveTo(targetDisplay()); // the phone comes up on the display you're playing on
  if (!pageReady) { pendingToggle = !pendingToggle; return; }
  send('toggle');
}

function setUp(v) {
  up = v;
  if (!win) return;
  // first time the phone ever comes up: the phone says how to use it (once per install)
  if (v && !firstRaiseShown) { firstRaiseShown = true; saveSettings(); send('firstRun', { hotkey: keyLabel() }); }
  if (v) {
    win.setFocusable(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    win.focus();
  } else {
    // hand focus back to whatever was in front (the game)
    win.blur();
    win.setFocusable(false);
  }
  rebuildTray();
}

// ---------- which game is in front: bin/burner-detect.exe (Rust), else PowerShell + detect.cs; a line every 2 s ----------
function skinFor(name, title) {
  const n = String(name || '').toLowerCase();
  // ourselves (the raised phone and the wallet window take focus) or nothing: keep the current skin
  if (!n || n === 'electron' || n === 'burner' || n === 'burnerphone') return null;
  if (n === 'gta5' || n === 'gta5_enhanced') return 'city';
  if (n === 'fortniteclient-win64-shipping') return 'toon';
  if (n === 'cs2' || n === 'valorant-win64-shipping') return 'tactical';
  if (n === 'robloxplayerbeta') return 'obby';
  if (n === 'rustclient') return 'survival';
  if (n === 'minecraft.windows') return 'blocky';
  if ((n === 'javaw' || n === 'java') && /minecraft/i.test(title || '')) return 'blocky';
  return 'default';
}
let detectFails = 0, nativeFails = 0;
function startDetector() {
  if (process.platform !== 'win32' || quitting) return;
  // the native helper (a few MB of memory, exits with us); PowerShell if it's missing or died twice without a line
  const exe = path.join(UNPACKED, 'bin', 'burner-detect.exe');
  const native = nativeFails < 2 && fs.existsSync(exe);
  const ps1 = path.join(UNPACKED, 'detect.ps1');
  let lines = 0, over = false;
  try {
    detector = native
      ? spawn(exe, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { console.error('detector spawn failed', e.message); if (native) { nativeFails++; startDetector(); } return; }
  const child = detector;
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      lines++; detectFails = 0;
      const bar = line.indexOf('|');
      const s = skinFor(line.slice(0, bar), line.slice(bar + 1));
      if (s && s !== detected) { detected = s; if (!override) send('skin', skin()); rebuildTray(); }
    }
  });
  // 'error' (it couldn't start) and 'exit' can both fire: restart once
  const ended = () => {
    if (over) return;
    over = true;
    if (detector === child) detector = null;
    if (quitting) return;
    if (native && !lines) nativeFails++;
    detectFails++;
    setTimeout(startDetector, Math.min(60000, 2000 * detectFails));
  };
  child.on('error', (e) => { console.error('detector error', e.message); ended(); });
  child.on('exit', ended);
}

// ---------- tray ----------
function trayImage() {
  const p = path.join(ROOT, 'build', 'tray.png');
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}
function rebuildTray() {
  if (!tray) return;
  const pick = (v) => () => { override = v; saveSettings(); send('skin', skin()); rebuildTray(); };
  const label = { city: 'city', blocky: 'blocky', toon: 'toon', tactical: 'tactical', obby: 'obby', survival: 'survival', default: 'graphite' };
  const ws = wallet.statusSync();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: (up ? 'put the phone away' : 'bring the phone up') + '  (' + keyLabel() + ')', click: () => toggle() },
    { label: 'hotkey', submenu: HOTKEYS.map((k) => ({ label: k + (k === DEFAULT_HOTKEY ? '  (default)' : ''), type: 'radio', checked: k === hotkey, click: () => { setHotkey(k); rebuildTray(); } })) },
    { label: 'phone', submenu: [
      { label: 'auto (match the game: ' + label[detected] + ')', type: 'radio', checked: !override, click: pick(null) },
      { label: 'city', type: 'radio', checked: override === 'city', click: pick('city') },
      { label: 'blocky', type: 'radio', checked: override === 'blocky', click: pick('blocky') },
      { label: 'toon', type: 'radio', checked: override === 'toon', click: pick('toon') },
      { label: 'tactical', type: 'radio', checked: override === 'tactical', click: pick('tactical') },
      { label: 'obby', type: 'radio', checked: override === 'obby', click: pick('obby') },
      { label: 'survival', type: 'radio', checked: override === 'survival', click: pick('survival') },
      { label: 'graphite', type: 'radio', checked: override === 'default', click: pick('default') },
    ] },
    { label: 'open the burner website', click: () => shell.openExternal(API) },
    { type: 'separator' },
    { label: ws.ready ? 'real wallet ' + ws.address.slice(0, 4) + '…' + ws.address.slice(-4) + (ws.sol != null ? ' · ' + ws.sol.toFixed(3) + ' SOL' : '') : 'paper SOL (import a wallet in the phone)', enabled: false },
    { label: 'quit burner', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- ipc (every handler answers only our own overlay page) ----------
const fromOverlay = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents;
ipcMain.on('config', (e) => { e.returnValue = fromOverlay(e) ? { api: API, skin: skin(), hotkey: keyLabel(), test: TEST, version: app.getVersion() } : null; });
// read-only: the page can ask which key raises the phone (changes arrive as the 'hotkey' event); it can't set it
ipcMain.handle('hotkey', (e) => (fromOverlay(e) ? keyLabel() : null));
ipcMain.on('mouse', (e, ignore) => { if (!fromOverlay(e)) return; win.setIgnoreMouseEvents(!!ignore, { forward: true }); if (TEST) console.log('[mouse] ignore=' + !!ignore); });
ipcMain.on('up', (e, v) => { if (fromOverlay(e)) setUp(!!v); });
ipcMain.on('ready', (e) => { if (!fromOverlay(e)) return; pageReady = true; send('skin', skin()); if (pendingToggle) { pendingToggle = false; send('toggle'); } });
const overlayLogs = []; // the self-test reads what the page reported
ipcMain.on('log', (e, s) => {
  if (!fromOverlay(e)) return;
  const line = String(s).slice(0, 400);
  console.log('[overlay]', line);
  if (TEST) { overlayLogs.push(line); if (overlayLogs.length > 200) overlayLogs.shift(); }
});
ipcMain.handle('capture', async (e, { w, h } = {}) => {
  if (!fromOverlay(e)) return null;
  const d = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const W = Math.max(64, Math.min(2560, Math.round(w || d.size.width * d.scaleFactor)));
  const H = Math.max(36, Math.min(1600, Math.round(h || d.size.height * d.scaleFactor)));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: H }, fetchWindowIcons: false });
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) return null;
  return src.thumbnail.toJPEG(88);
});
// the screen under the overlay, for a live getUserMedia stream (fast stills + the camera viewfinder)
ipcMain.handle('screen-source', async (e) => {
  if (!fromOverlay(e)) return null;
  const d = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
  return src ? { id: src.id, w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) } : null;
});
ipcMain.handle('test-shot', async (e, name) => {
  if (!TEST || !win || !fromOverlay(e)) return null;
  const dir = process.env.BURNER_TEST_DIR || path.join(process.cwd(), 'test-shots');
  fs.mkdirSync(dir, { recursive: true });
  const img = await win.webContents.capturePage();
  const f = path.join(dir, String(name).replace(/[^a-z0-9-]/gi, '') + '.png');
  fs.writeFileSync(f, img.toPNG());
  console.log('[test] shot', f);
  return f;
});

app.whenReady().then(async () => {
  if (WALLET_SELFTEST) {
    const res = await wallet.selfTest();
    for (const r of res) console.log('[wallet-selftest] ' + JSON.stringify(r));
    console.log('[wallet-selftest] ' + (res.every((r) => r.ok) ? 'ALL OK' : 'FAILED'));
    try { require('node:fs').rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch {}
    app.exit(res.every((r) => r.ok) ? 0 : 1);
    return;
  }
  // the overlay may capture the screen (camera, WASTED still) and write an image to the clipboard (camera); nothing else
  const ALLOWED = new Set(['media', 'clipboard-sanitized-write']);
  const permitted = (wc, perm, details) => !!win && wc === win.webContents && ALLOWED.has(perm) && !(perm === 'media' && (details?.mediaTypes || []).includes('audio'));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(permitted(wc, perm, details)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, _origin, details) => permitted(wc, perm, details));
  loadSettings();
  wallet.register({ getWin: () => win, onStatus: () => rebuildTray(), getApi: () => API });
  if (DEV && process.env.BURNER_TEST_WALLET) wallet.autoConfirmForTests(true);
  // BURNER_WALLET_E2E=1 BURNER_E2E_MINT=<mint> [BURNER_E2E_SOL=0.003]: one real tiny buy then sell-all from the saved wallet, results printed (sigs, never the key)
  if (DEV && process.env.BURNER_WALLET_E2E) {
    const mint = process.env.BURNER_E2E_MINT, sol = Number(process.env.BURNER_E2E_SOL || 0.003);
    const st = wallet.statusSync();
    if (!st.ready || !mint) { console.log('[e2e] needs a saved wallet (import one in the app) and BURNER_E2E_MINT'); app.exit(1); return; }
    console.log('[e2e] wallet ' + st.address + ' buying ' + sol + ' SOL of ' + mint);
    const b = await wallet.api.trade({ side: 'buy', mint, sol, slippage: 20 });
    console.log('[e2e] buy ' + JSON.stringify(b));
    if (b.ok) { await new Promise((r) => setTimeout(r, 6000)); const s = await wallet.api.trade({ side: 'sell', mint, pct: 1, slippage: 20 }); console.log('[e2e] sell ' + JSON.stringify(s)); }
    console.log('[e2e] balances ' + JSON.stringify(await wallet.api.balances()));
    app.exit(0); return;
  }
  createWindow();
  try { tray = new Tray(trayImage()); tray.on('click', () => toggle()); } catch (e) { console.error('tray failed', e.message); }
  initHotkey();
  setTrayTip();
  rebuildTray();
  // first run: one notice from the tray (the phone says it again the first time it comes up: the 'firstRun' event)
  if (!firstRunShown) {
    firstRunShown = true; saveSettings();
    setTimeout(() => notice('BurnerPhone is running', 'press ' + keyLabel() + ' in any game (run games borderless windowed)'), 1500);
  }
  startDetector();
  screen.on('display-metrics-changed', fit);
  screen.on('display-added', fit);
  screen.on('display-removed', fit);
  // some borderless games climb over topmost windows; put ourselves back on top now and then
  setInterval(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver'); }, 5000);
  if (TEST) runTest();
});

app.on('will-quit', () => {
  quitting = true; globalShortcut.unregisterAll(); try { detector?.kill(); } catch {}
  if (TEST || process.env.BURNER_TEST_WALLET) { try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch {} }
});
app.on('window-all-closed', () => app.quit());

// BURNER_TEST=1 (temp profile): raise, shoot, fake a WASTED, try the camera, check click-through, the hotkey change,
// the display move and the first-run notices, print [selftest] lines, quit
function runTest() {
  const at = (ms, fn) => setTimeout(() => { try { fn(); } catch (e) { console.error('[test]', e.message); } }, ms);
  const b = () => screen.getPrimaryDisplay().bounds;
  const results = [];
  const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log('[selftest] ' + JSON.stringify({ name, ok: !!ok, info })); };
  const saw = (s) => overlayLogs.some((l) => l.includes(s));
  // the page may be busy (the camera test runs alongside), so page-side checks wait up to 3 s for their log line
  const waitSaw = (name, s, extra = () => true) => {
    const t0 = Date.now();
    const poll = () => { if (saw(s) && extra()) check(name, true); else if (Date.now() - t0 > 3000) check(name, false, 'no "' + s + '" from the page'); else setTimeout(poll, 100); };
    poll();
  };
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
  at(1000, () => {
    check('a hotkey is registered at start', !!hotkey && globalShortcut.isRegistered(hotkey), hotkey);
    check('the tray tooltip shows it', trayTip.includes(keyLabel()), trayTip);
  });
  at(2100, () => check('first-run tray notice', lastNotice?.title === 'BurnerPhone is running' && lastNotice.content.includes(keyLabel()), lastNotice?.content));
  at(2600, () => waitSaw("first raise sends 'firstRun' to the page (once)", 'firstRun ', () => readSettings().firstRaiseShown === true));
  at(6000, () => {
    const before = hotkey;
    const r = setHotkey('F9');
    check('hotkey change to F9', r.ok && hotkey === 'F9' && globalShortcut.isRegistered('F9') && (before === 'F9' || !globalShortcut.isRegistered(before)), JSON.stringify(r));
    check('hotkey saved in settings.json', readSettings().hotkey === 'F9');
    check('tray tooltip follows the hotkey', trayTip.includes('F9'), trayTip);
    const real = registerFn;
    registerFn = () => false; // pretend another app owns F8
    const t = setHotkey('F8');
    registerFn = real;
    check('a taken hotkey is refused, the old one kept, the player told', !!t.err && hotkey === 'F9' && globalShortcut.isRegistered('F9') && /taken/.test(lastNotice?.title || ''), t.err);
  });
  at(6100, () => waitSaw("the page got the 'hotkey' event", 'hotkey F9'));
  at(6800, () => { const r = setHotkey(DEFAULT_HOTKEY); check('hotkey back to the default', r.ok || !!r.err, JSON.stringify(r)); });
  at(7200, () => {
    const all = screen.getAllDisplays();
    const nDisp = () => overlayLogs.filter((l) => l.includes('display ')).length;
    const n0 = nDisp();
    let okAll = true;
    for (const d of all) { displayId = null; moveTo(d); if (!sameBounds(win.getBounds(), d.bounds)) okAll = false; }
    check('the overlay moves to each display and takes its bounds', okAll, all.length + ' display(s)');
    const t = targetDisplay();
    const c = screen.getCursorScreenPoint();
    check('the target display is the one under the cursor', t.bounds.x <= c.x && c.x < t.bounds.x + t.bounds.width && t.bounds.y <= c.y && c.y < t.bounds.y + t.bounds.height, JSON.stringify(c));
    displayId = null; moveTo(screen.getPrimaryDisplay());
    // one 'display' event per move above (each display, then back to the primary)
    waitSaw("the page got a 'display' event for every move", 'display ', () => nDisp() >= n0 + all.length + 1);
  });
  at(17300, () => console.log('[selftest] ' + (results.every((r) => r.ok) ? 'ALL OK' : 'FAILED') + ' (' + results.filter((r) => r.ok).length + '/' + results.length + ')'));
  at(1800, () => { console.log('[test] down'); send('test', 'shot:down-2s'); });
  at(2400, () => { console.log('[test] toggle up'); toggle(); });
  at(4200, () => send('test', 'shot:up-4s'));
  at(4600, () => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(b().width * 0.3), y: Math.round(b().height * 0.4) }); });
  at(5000, () => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(b().width * 0.84), y: Math.round(b().height * 0.6) }); });
  at(5400, () => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(b().width * 0.3), y: Math.round(b().height * 0.4) }); });
  at(5600, () => send('test', 'camera'));
  if (process.env.BURNER_TEST_WALLET) at(6400, () => send('test', 'wallet-swap'));
  at(8500, () => send('test', 'wasted'));
  at(10100, () => send('test', 'shot:wasted'));
  at(13000, () => send('test', 'shot:after-wasted'));
  at(13400, () => send('test', 'skin:blocky'));
  at(14600, () => send('test', 'shot:blocky'));
  at(15200, () => { console.log('[test] toggle down'); toggle(); });
  at(16400, () => send('test', 'shot:down-again'));
  at(17400, () => { console.log('[test] done, detected skin=' + detected); quitting = true; app.quit(); });
}
