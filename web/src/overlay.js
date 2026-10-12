// Burner for Windows: the same phone as the site, over whatever game is in front.
import '../../shared/phone/phone.css';
import './overlay.css';
import { createNet } from '../../shared/phone/net.js';
import { createWallet } from '../../shared/phone/wallet.js';
import { createRealWallet, createSwitchWallet } from '../../shared/phone/wallet-real.js';
import { createPhone } from '../../shared/phone/phone.js';
import { initSound, isMuted, setMuted } from '../../shared/phone/sound.js';

// outside Electron (vite dev in a browser) everything still runs, minus capture/click-through
const B = window.burner || {
  config: { api: new URLSearchParams(location.search).get('api') || 'http://localhost:8787', skin: 'default', test: false },
  setIgnore() {}, setUp() {}, ready() {}, capture: async () => null, on() {}, shot: async () => null, log: (...a) => console.log(...a),
};

initSound();
const net = createNet({ base: B.config.api });
// paper until a real key is ready in the main process, then the real wallet (and back on forget), swapped live
const paper = createWallet(net);
const wallet = createSwitchWallet(paper);

const phone = createPhone(document.body, {
  net, wallet,
  mode: 'overlay',
  skin: B.config.skin || 'default',
  hotkey: B.config.hotkey || null,
  grab,
  onFx,
  toggleSound: () => setMuted(!isMuted()),
  isMuted,
  onEvent: (type, v) => {
    if (type === 'raise') { B.setUp(v); setTimeout(recheck, 30); setTimeout(recheck, 450); }
  },
});
net.connect();

B.on('toggle', () => phone.toggle());

// ---------- real wallet (app/shared/WALLET.md) ----------
let picking = null;
async function pickWallet() {
  if (!B.wallet) return wallet.kind;
  if (picking) return picking;
  picking = (async () => {
    const st = await B.wallet.status().catch(() => null);
    if (st?.ready && st.address) {
      if (wallet.kind !== 'real' || wallet.address !== st.address) {
        const rw = createRealWallet(net, B.wallet);
        if (await rw.init().catch(() => false)) wallet.swap(rw);
      }
    } else if (wallet.kind !== 'paper') wallet.swap(paper);
    return wallet.kind;
  })();
  try { return await picking; } finally { picking = null; }
}
B.wallet?.on('status', () => pickWallet());
window.__burnerSwitchWallet = pickWallet;
pickWallet();
B.on('skin', (s) => phone.setSkin(s));
B.ready?.();

// ---------- click-through: the window only takes the mouse while it's over the phone ----------
let mx = -1, my = -1, capturing = false, dragging = false;
function overPhone(x, y) {
  if (x < 0) return false;
  const t = document.elementFromPoint(x, y);
  return !!t?.closest?.('.bp-phone');
}
function recheck() {
  const want = dragging || overPhone(mx, my);
  if (want !== capturing) { capturing = want; B.setIgnore(!want); }
}
addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; recheck(); }, { passive: true });
addEventListener('mouseleave', () => { mx = my = -1; if (!dragging) recheck(); });
addEventListener('pointerdown', (e) => { if (e.target.closest?.('.bp-phone')) dragging = true; }, true);
addEventListener('pointerup', () => { dragging = false; recheck(); }, true);
addEventListener('pointercancel', () => { dragging = false; recheck(); }, true);

// keys while the phone is up: Esc puts it away, any key unlocks the lock screen
addEventListener('keydown', (e) => {
  if (!phone.isUp()) return;
  if (e.key === 'Escape') { phone.lower(); return; }
  if (phone.view() === 'lock' && (e.key.length === 1 || e.key === 'Enter' || e.key === ' ')) phone.unlock();
});

// ---------- screen capture (the game behind the phone) ----------
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function toCanvas(buf) {
  if (!buf) return null;
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}
function layers() { return [phone.el, document.querySelector('.bn-layer')].filter(Boolean); }
let hiding = 0;
function hide() { hiding++; for (const l of layers()) l.style.visibility = 'hidden'; }
function unhide() { if (--hiding <= 0) { hiding = 0; for (const l of layers()) l.style.visibility = ''; } }

// A live stream of the screen (getUserMedia + the screen's source id from main). Starting it costs a few hundred ms
// with the phone still on screen; after that a clean still only hides the phone for ~2 video frames.
// desktopCapturer.getSources takes ~1.4 s per full-res still, far too long to hide the phone.
const live = {
  video: null, ms: null, w: 0, starting: null, lastUse: 0,
  async start(maxW) {
    this.lastUse = performance.now();
    if (this.video && this.w >= maxW) return this.video;
    if (this.starting) { await this.starting; if (this.video && this.w >= maxW) return this.video; }
    this.starting = (async () => {
      const src = await B.screenSource?.();
      if (!src) throw new Error('no screen source');
      const W = Math.min(maxW, src.w), H = Math.round((W * src.h) / src.w);
      // Chrome shares one capturer per screen: the old stream must go before a bigger one starts, or the new one comes back at the old size
      this.stop();
      const ms = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, minWidth: 320, maxWidth: W, maxHeight: H, maxFrameRate: 20 } } });
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = ms;
      await v.play();
      await nextFrames(v, 1, 1500);
      this.video = v; this.ms = ms; this.w = W;
    })();
    try { await this.starting; } finally { this.starting = null; }
    return this.video;
  },
  stop() { this.ms?.getTracks().forEach((t) => t.stop()); this.ms = null; this.video = null; this.w = 0; },
};
setInterval(() => { if (live.video && performance.now() - live.lastUse > 2500) live.stop(); }, 1000);
function nextFrames(v, n, timeout) {
  return new Promise((res) => {
    let left = n;
    const done = setTimeout(res, timeout);
    const step = () => { if (--left <= 0) { clearTimeout(done); res(); } else v.requestVideoFrameCallback(step); };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else setTimeout(() => { clearTimeout(done); res(); }, 150);
  });
}
function draw(v, into) {
  const c = into || document.createElement('canvas');
  if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
  c.getContext('2d').drawImage(v, 0, 0);
  return c;
}

async function captureClean() {
  const dpr = devicePixelRatio || 1;
  const full = Math.round(screen.width * dpr);
  try {
    const v = await live.start(full);
    hide();
    try { await raf(); await nextFrames(v, 2, 400); return draw(v); } finally { unhide(); }
  } catch (e) {
    // no stream: the slow path, a single desktopCapturer still
    hide();
    await raf(); await raf(); await sleep(70);
    try { return await toCanvas(await B.capture(full, Math.round(screen.height * dpr))); } finally { unhide(); }
  }
}

// viewfinder: the live stream, the phone stays visible (a centre crop never reaches the phone in the corner)
const vf = document.createElement('canvas');
let vfReady = false;
function grab(w, h, full) {
  if (full) return captureClean();
  live.start(960).then(() => { vfReady = true; }).catch(() => {});
  if (!vfReady) return null;
  return live.video ? draw(live.video, vf) : vf; // while the stream restarts bigger, keep the last frame
}

// ---------- events from main: the overlay moved display, the hotkey changed, first run ----------
// a new display means a new capture source: drop the old stream, the next grab starts one for the new screen
B.on('display', (d) => { live.stop(); vfReady = false; if (B.config.test) B.log('display ' + d?.id); });
B.on('hotkey', (k) => { phone.setKey(k); if (B.config.test) B.log('hotkey ' + k); });
B.hotkey?.().then((k) => phone.setKey(k)).catch(() => {});
// the first time the phone ever comes up, it says how to use it (main sends this once per install)
B.on('firstRun', (o) => {
  const key = o?.hotkey || 'Alt+Q';
  phone.notify({ title: 'burnerphone is running', body: 'press ' + key + ' in any game (borderless)', icon: 'bolt', tone: 'gold', buzz: false, ms: 5200 });
  if (B.config.test) B.log('firstRun ' + key);
});

// ---------- WASTED in a game: a greyscale still of it pushes in behind the banner ----------
let fxId = 0, still = null;
async function onFx(fx) {
  if (fx.gray > 0) {
    const id = ++fxId;
    let c = null;
    try { c = await captureClean(); } catch {}
    if (id !== fxId || !c) return;
    still?.remove();
    still = c; c.className = 'ov-still';
    document.body.prepend(c);
    await raf();
    c.classList.add('ov-in');
  } else {
    fxId++;
    const s = still; still = null;
    if (s) { s.classList.remove('ov-in'); s.classList.add('ov-out'); setTimeout(() => s.remove(), 650); }
  }
}

// ---------- BURNER_TEST hooks (driven from main) ----------
if (B.config.test) {
  addEventListener('error', (e) => B.log('page error', e.message));
  B.on('test', async (kind) => {
    if (kind.startsWith('shot:')) { await B.shot(kind.slice(5)); return; }
    if (kind.startsWith('skin:')) { phone.setSkin(kind.slice(5)); return; }
    if (kind === 'wasted') { phone.notify({ title: '$TEST is dumping', body: 'test ring', tone: 'dn' }); phone.buzz('ring', 2600); phone.banners.wasted({ sym: '$TEST', loss: 1.84, reason: 'dump' }); return; }
    if (kind === 'wallet-swap') {
      const before = wallet.kind;
      const c = await B.wallet.createKey();
      let t0 = performance.now();
      while (wallet.kind !== 'real' && performance.now() - t0 < 8000) await sleep(100);
      const mid = wallet.kind, swapMs = Math.round(performance.now() - t0), addrMatch = wallet.address === c.address;
      await B.wallet.forget();
      t0 = performance.now();
      while (wallet.kind !== 'paper' && performance.now() - t0 < 5000) await sleep(100);
      B.log('wallet-swap', JSON.stringify({ before, created: !!c.ok, mid, swapMs, addrMatch, after: wallet.kind }));
      return;
    }
    if (kind === 'camera') {
      let t0 = performance.now();
      grab(480, 300);
      let v2 = null;
      while (!v2 && performance.now() - t0 < 3000) { await sleep(50); v2 = grab(480, 300); }
      B.log('viewfinder first frame', v2 ? v2.width + 'x' + v2.height : 'null', Math.round(performance.now() - t0) + 'ms');
      t0 = performance.now();
      let hiddenAt = 0, shownAt = 0;
      const mo = new MutationObserver(() => { if (phone.el.style.visibility === 'hidden') hiddenAt = performance.now(); else if (hiddenAt && !shownAt) shownAt = performance.now(); });
      mo.observe(phone.el, { attributes: true, attributeFilter: ['style'] });
      const c = await grab(1600, 900, true);
      mo.disconnect();
      B.log('camera still', c ? c.width + 'x' + c.height : 'null', 'total ' + Math.round(performance.now() - t0) + 'ms', 'phone hidden for ' + Math.round(shownAt - hiddenAt) + 'ms', 'visible again:', phone.el.style.visibility === '');
    }
  });
  setInterval(() => B.log('state', JSON.stringify({ up: phone.isUp(), view: phone.view(), coins: net.coins.size, signal: net.signal(), mode: net.st.mode })), 4000);
}
