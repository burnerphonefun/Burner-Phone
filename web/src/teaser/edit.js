// The teaser edit: every frame is a pure function of t. World (renderAt) + real phone plates + banners + grade.
// Driven by scripts/teaser-render.mjs: window.ready, then window.renderFrame(t) -> jpeg data URL.
import { createWorld, WORLDS } from '../scene/world.js';
import { STORIES, sec, dur, spb } from './timeline.js';

const W = 1920, H = 1080;
const story = new URLSearchParams(location.search).get('story') || 'city';
const S = STORIES[story];
const C = S.cues;
const b = (beats) => sec(story, beats);

const out = document.getElementById('out');
const g = out.getContext('2d');
const gl = document.getElementById('gl');
const small = Object.assign(document.createElement('canvas'), { width: 240, height: 135 });
const sg = small.getContext('2d');

// ---------- helpers ----------
const clamp = (x, a = 0, z = 1) => Math.max(a, Math.min(z, x));
const lerp = (a, z, k) => a + (z - a) * k;
const smooth = (a, z, x) => { const k = clamp((x - a) / (z - a)); return k * k * (3 - 2 * k); };
const eOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
const eIn = (k) => Math.pow(clamp(k), 3);
const eInOut = (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const eBack = (k) => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
// the phone's own spring (k 210, d 21 in phone.js), a touch bouncier for film: settles from 0 to 1
const OM = Math.sqrt(210), ZE = 0.6, OD = OM * Math.sqrt(1 - ZE * ZE);
const spring = (tau) => (tau <= 0 ? 0 : 1 - Math.exp(-ZE * OM * tau) * (Math.cos(OD * tau) + (ZE * OM / OD) * Math.sin(OD * tau)));
const FIRST_HIT = Math.PI / OD - Math.atan(Math.sqrt(1 - ZE * ZE) / ZE) / OD; // first time r = 1: start early so it lands on the beat
function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- assets ----------
const plates = {};
let meta = null;
const grain = document.createElement('canvas'); grain.width = grain.height = 512;
{
  const x = grain.getContext('2d'), d = x.createImageData(512, 512), r = rng(11);
  for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - 0.5) * 200; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  x.putImageData(d, 0, 0);
}

async function init() {
  await Promise.all(['900 120px "Big Shoulders Display"', '600 40px Geist', '500 30px Geist', '700 40px Geist', '600 40px "Pixelify Sans"', '700 40px "Pixelify Sans"', '400 40px "Lilita One"'].map((f) => document.fonts.load(f)));
  meta = (await (await fetch('/src/teaser/plates/plates.json', { cache: 'no-store' })).json())[story];
  if (meta) await Promise.all(Object.entries(meta.plates).map(([k, f]) => new Promise((res, rej) => { const i = new Image(); i.onload = () => { plates[k] = i; res(); }; i.onerror = rej; i.src = '/src/teaser/plates/' + f + '?v=' + Date.now(); })));
  gl.style.width = W + 'px'; gl.style.height = H + 'px';
  world = createWorld(gl, { world: S.world, seed: 7, manual: true, pixelRatio: 1 });
  await world.ready;
  // every world a story cuts to is built up front (blocky's first build stalls ~0.5 s)
  for (const id of new Set(S.shots.map((s) => s.world))) await world.prepare(id);
  world.renderAt(0);
  return true;
}
// dev: look at any world at any time (scripts/teaser-probe.mjs)
window.probe = async (id, t) => {
  await window.ready;
  await world.setWorld(id);
  world.fx({ gray: 0, slow: 0, push: 0 });
  world.renderAt(t);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  g.drawImage(gl, 0, 0, W, H);
  return out.toDataURL('image/jpeg', 0.8);
};
let world = null;

// ---------- time ----------
function shotAt(t) { let s = S.shots[0]; for (const sh of S.shots) if (t >= b(sh.from)) s = sh; return s; }
function slowAmt(u) { // city: the world slows to ~12% from the tape stop into WASTED, until the hard cut
  if ((story !== 'city' && story !== 'games') || u >= b(C.cut2)) return 0;
  return smooth(b(C.tapestop), b(C.wasted) + 0.15, u);
}
function worldTime(t) {
  const sh = shotAt(t), t0 = b(sh.from);
  let wt = sh.wt0, u = t0;
  const step = 1 / 240;
  while (u < t) { const h = Math.min(step, t - u); wt += h * (1 - 0.88 * slowAmt(u + h / 2)); u += h; }
  return wt;
}

// ---------- phone ----------
function plateMix(t) {
  if (story === 'games') return gamesPlate(t);
  if (story === 'any') return anyPlate(t);
  if (story === 'city') {
    const land = b(C.raise);
    if (t < land - 0.3) { const lit = C.peek.some((pb) => t >= b(pb) && t < b(pb) + 0.34 && Math.sin((t - b(pb)) * Math.PI * 9) > -0.2); return [lit ? 'peek-lit' : 'peek']; }
    if (t < land + 0.1) return ['peek', 'lock', (t - (land - 0.3)) / 0.4];
    if (t < b(C.unlock)) return ['lock'];
    if (t < b(C.unlock) + 0.16) return ['lock', 'pump', (t - b(C.unlock)) / 0.16];
    if (t < b(C.launch)) return ['pump'];
    if (t < b(C.launch) + 0.06) return ['pump-slide1'];
    if (t < b(C.launch) + 0.14) return ['pump-slide2'];
    if (t < b(C.launch) + 0.26) return ['pump-slide2', 'pump-new', (t - b(C.launch) - 0.14) / 0.12];
    if (t < b(C.tap)) return ['pump-new'];
    if (t < b(C.buzz)) return ['pump-buy'];
    if (t < b(C.rugstamp)) return ['pump-dump'];
    if (t < b(C.rugstamp) + 0.06) return ['pump-rugged-a'];
    if (t < b(C.ring)) return ['pump-rugged'];
    if (t < b(C.cut2)) { const u = t - b(C.ring); return [Math.sin(u * Math.PI * 5) > 0 && t < b(C.wasted) + 0.6 ? 'ring-lit' : 'ring']; }
    if (t < b(C.sell)) return ['win'];
    if (t < b(C.sell) + 0.14) return ['win-press'];
    if (t < b(C.sell) + 0.24) return ['win-press', 'sold', (t - b(C.sell) - 0.14) / 0.1];
    return ['sold'];
  }
  if (t < b(C.tap)) return ['pump'];
  if (t < b(C.dip)) return ['pump-buy'];
  if (t < b(C.dip) + 0.12) return ['pump-buy', 'dip', (t - b(C.dip)) / 0.12];
  if (t < b(C.up)) return ['dip'];
  if (t < b(C.up) + 0.12) return ['dip', 'up', (t - b(C.up)) / 0.12];
  if (t < b(C.sell)) return ['up'];
  if (t < b(C.sell) + 0.16) return ['up-press'];
  if (t < b(C.sell) + 0.3) return ['up-press', 'pump', (t - b(C.sell) - 0.16) / 0.14];
  return ['pump'];
}

function phoneRaise(t) {
  if (story === 'games') return gamesRaise(t);
  if (story === 'any') return anyRaise(t);
  const tr = b(C.raise) - FIRST_HIT;
  let r = spring(t - tr);
  const te = b(C.endcard);
  if (t > te - 0.2) r *= 1 - eIn((t - (te - 0.2)) / 0.38); // gone before the wordmark lands
  return r;
}

const PHONE_SCALE = 1.2; // a little bigger than on the site, so the screen reads on a phone in a feed
function phonePose(t) {
  const css = (H / meta.view.heroH) * PHONE_SCALE, k = css / meta.view.dpr; // plate css px -> frame px, image px -> frame px
  const ref = plates.pump || Object.values(plates)[0]; // every plate of a story shares one clip
  const pw = ref.width * k, ph = ref.height * k;
  // flush with the right edge (the hand is cut there in the plate), hero bottom on the frame bottom
  // the hero's right edge on the frame's right edge; the sleeve runs off frame like it would in a game
  const restX = W - (meta.view.heroW - meta.clip.x) * css + (story === 'blocky' ? -40 : story === 'games' || story === 'any' ? -24 : 10);
  const restY = H - (meta.view.heroH - meta.clip.y) * css + 6;
  const r = phoneRaise(t);
  // city opens with the phone peeking: only the top of it (status bar + the island with the bag's +%) above the edge
  const downY = story === 'city' && t < b(C.endcard) ? H - 150 - 40 * css : H + 60;
  let x = restX, y = restY + (1 - r) * (downY - restY), rot = (1 - r) * (story === 'city' && t < b(C.endcard) ? 0.04 : 0.1);
  // handheld drift
  x += Math.sin(t * 0.9) * 3 + Math.sin(t * 2.3) * 1.2;
  y += Math.sin(t * 1.3 + 1) * 2.5;
  rot += Math.sin(t * 0.7) * 0.004;
  // buzzes and the ring
  const buzzes = story === 'city' ? [...C.peek.map(b), b(C.unlock), b(C.buzz)] : story === 'any' ? [b(C.run)] : [b(C.dip)];
  for (const tb of buzzes) { const u = t - tb; if (u >= 0 && u < 0.32) { const a = (1 - u / 0.32) * 5; x += Math.sin(u * 2 * Math.PI * 23) * a; rot += Math.sin(u * 2 * Math.PI * 17) * a * 0.0015; } }
  if (story === 'city' || story === 'games') { const u = t - b(C.ring); if (u >= 0 && t < b(C.wasted) + 0.5) { const a = (Math.sin(u * Math.PI * 5) > 0 ? 1 : 0.15) * 6; x += Math.sin(u * 2 * Math.PI * 23) * a; rot += Math.sin(u * 2 * Math.PI * 13) * a * 0.002; } }
  if (story === 'blocky') { const u = t - b(C.hiss[0]); if (u >= 0 && t < b(C.up)) { const a = smooth(0, b(C.up) - b(C.hiss[0]), u) * 3.5; x += Math.sin(u * 2 * Math.PI * 19) * a; y += Math.cos(u * 2 * Math.PI * 15) * a * 0.5; } }
  // a thumb press squeezes the phone a hair
  let s = 1;
  for (const [tt] of tapList()) { const u = t - tt; if (u >= 0 && u < 0.18) s *= 1 - Math.sin((u / 0.18) * Math.PI) * 0.012; }
  // any: the phone comes closer for the keypad, about the keypad's centre (drawPhone applies it)
  const f = anyFocus(t), kp = meta.taps.kpc;
  const K = kp ? [x + kp[0] * meta.view.dpr * k, y + kp[1] * meta.view.dpr * k] : null;
  return { x, y, rot, s, pw, ph, k, r, f, K };
}
// every thumb tap in the story: [time, point in plate css px]
function tapList() {
  if (story === 'any') {
    const T = meta.taps;
    // keypad taps are quick (typing), and the confirm's ripple is gone before the sheet drops away from under it
    return [[C.sizetap, T.size], [C.keys[0], T.k0, 0.24], [C.keys[1], T.kd, 0.24], [C.keys[2], T.k6, 0.24], [C.keys[3], T.k9, 0.24], [C.go, T.go, 0.13], [C.buy, T.buy],
      [C.anytap, T.any], [C.keys2[0], T.b5, 0.24], [C.keys2[1], T.b0, 0.24], [C.go2, T.go2, 0.13]].map(([c, p, len]) => [b(c), p, len]);
  }
  return [[b(C.tap), meta.taps.buy], [b(C.sell), meta.taps.sell]];
}
// any: 0..1, how far the phone has come in for the keypad (act 1: the buy size, act 2: the sell %)
function anyFocus(t) {
  if (story !== 'any') return 0;
  const a1 = smooth(b(C.sizetap), b(C.sizetap) + 0.42, t) * (1 - smooth(b(C.focusOut), b(C.focusOut) + 0.42, t));
  const a2 = smooth(b(C.anytap), b(C.anytap) + 0.42, t) * (1 - smooth(b(C.go2) + 0.3, b(C.go2) + 0.72, t));
  return Math.max(a1, a2);
}
const FOCUS_TO = [1400, 640], FOCUS_SCALE = 0.34;

function drawPhone(t) {
  const P = phonePose(t);
  lastPose = P;
  if (P.r <= 0.001 && !(story === 'city' && t < b(C.endcard))) return P;
  const [a, bb, m] = plateMix(t);
  const pivX = P.x + P.pw * 0.72, pivY = P.y + P.ph * 0.95;
  g.save();
  if (P.f > 0 && P.K) { // closer: grow about the keypad and bring it up to the middle right
    const sF = 1 + FOCUS_SCALE * P.f;
    g.translate(P.K[0] + (FOCUS_TO[0] - P.K[0]) * P.f, P.K[1] + (FOCUS_TO[1] - P.K[1]) * P.f); g.scale(sF, sF); g.translate(-P.K[0], -P.K[1]);
  }
  g.translate(pivX, pivY); g.rotate(P.rot); g.scale(P.s, P.s); g.translate(-pivX, -pivY);
  g.globalAlpha = 1; g.drawImage(plates[a], P.x, P.y, P.pw, P.ph);
  if (bb && plates[bb]) { g.globalAlpha = clamp(m); g.drawImage(plates[bb], P.x, P.y, P.pw, P.ph); }
  g.globalAlpha = 1;
  // any: the burst's "×N" lights up (an outline that stays, a ring on each beat)
  if (story === 'any' && meta.taps.burst && t >= b(C.rings[0]) && t < b(C.sizetap) + 0.1) {
    const cx = P.x + (meta.taps.burst[0] + 4) * meta.view.dpr * P.k, cy = P.y + meta.taps.burst[1] * meta.view.dpr * P.k;
    const on = eOut((t - b(C.rings[0])) / 0.12) * (1 - clamp((t - b(C.sizetap)) / 0.1));
    g.save(); g.globalAlpha = on; g.strokeStyle = '#FF5A1F'; g.lineWidth = 3.5;
    g.beginPath(); g.roundRect(cx - 34, cy - 16, 68, 32, 9); g.stroke();
    for (const rb of C.rings) {
      const u = t - b(rb); if (u < 0 || u > 0.45) continue;
      g.globalAlpha = on * (1 - u / 0.45); g.lineWidth = 3;
      const grow = eOut(u / 0.45) * 26;
      g.beginPath(); g.roundRect(cx - 34 - grow, cy - 16 - grow * 0.6, 68 + grow * 2, 32 + grow * 1.2, 12); g.stroke();
    }
    g.restore();
  }
  // thumb tap ripples
  const taps = tapList();
  for (const [tt, pt, len = 0.4] of taps) {
    const u = t - tt;
    if (!pt || u < 0 || u > len) continue;
    const cx = P.x + pt[0] * meta.view.dpr * P.k, cy = P.y + pt[1] * meta.view.dpr * P.k;
    g.beginPath(); g.arc(cx, cy, 10 + eOut(u / len) * 46 * (len / 0.4), 0, Math.PI * 2);
    g.fillStyle = `rgba(255,255,255,${0.42 * (1 - u / len)})`; g.fill();
  }
  g.restore();
  return P;
}

// ---------- text ----------
function text(str, x, y, { font, fill = '#fff', stroke = null, sw = 0, shadow = null, sh = 0, align = 'center', ls = '0px', alpha = 1 }) {
  g.save();
  g.globalAlpha = alpha; g.font = font; g.textAlign = align; g.textBaseline = 'alphabetic'; g.letterSpacing = ls; g.lineJoin = 'round';
  if (shadow) { g.fillStyle = shadow; if (stroke) { g.strokeStyle = shadow; g.lineWidth = sw; g.strokeText(str, x, y + sh); } g.fillText(str, x, y + sh); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = sw; g.strokeText(str, x, y); }
  g.fillStyle = fill; g.fillText(str, x, y);
  g.restore();
}
function pill(str, x, y, { font, alpha = 1, bg = 'rgba(0,0,0,.62)' }) {
  g.save(); g.font = font; g.letterSpacing = '0px';
  const w = g.measureText(str).width + 40, h = 52;
  g.globalAlpha = alpha; g.fillStyle = bg;
  g.beginPath(); g.roundRect(x - w / 2, y - h / 2 - 10, w, h, 8); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, x, y - 10 + 1);
  g.restore();
}

const BX = 640; // banners sit in the space left of the phone
// games: the hand puts one phone away just before every cut and pulls the next game's phone up on it
function gamesRaise(t) {
  const sh = shotAt(t);
  const t0 = b(sh.from + (sh.raiseAt || 0));
  let r = spring(t - t0);
  const lowerAt = sh.stayUp != null ? b(C.endcard) - 0.2 : b(sh.to) - 0.13;
  const len = sh.stayUp != null ? 0.38 : 0.13;
  if (t > lowerAt) r *= 1 - eIn((t - lowerAt) / len);
  return r;
}
function gamesPlate(t) {
  const sh = shotAt(t);
  if (sh.from === 0) {
    const u = t - b(C.tap);
    return [u < 0 ? 'blocky-pump' : u < 0.05 ? 'blocky-buy1' : u < 0.12 ? 'blocky-buy2' : u < 0.22 ? 'blocky-buy3' : 'blocky-bought'];
  }
  if (sh.world === 'blocky') {
    if (t < b(C.rugstamp)) return ['blocky-pump2'];
    if (t < b(C.rugstamp) + 0.06) return ['blocky-rugged-a'];
    if (t < b(C.ring)) return ['blocky-rugged'];
    const u = t - b(C.ring);
    return [Math.sin(u * Math.PI * 5) > 0 && t < b(C.wasted) + 0.6 ? 'blocky-ring-lit' : 'blocky-ring'];
  }
  if (sh.from === 22) {
    if (t < b(C.sell)) return ['toon-win'];
    if (t < b(C.sell) + 0.14) return ['toon-win-press'];
    if (t < b(C.sell) + 0.24) return ['toon-win-press', 'toon-sold', (t - b(C.sell) - 0.14) / 0.1];
    return ['toon-sold'];
  }
  return [sh.skin + '-' + sh.plate];
}
// any: up on the first downbeat, down and up again for the pixel phone, up once through the montage (the skin swaps on
// every cut), gone for the end card
function anyRaise(t) {
  const sh = shotAt(t);
  if (sh.stayUp) return 0;
  if (sh.from === 0) { // up on beat 1, down just before the hard cut
    const r = spring(t - (b(C.raise) - FIRST_HIT)), lowerAt = b(sh.to) - 0.13;
    return t > lowerAt ? r * (1 - eIn((t - lowerAt) / 0.13)) : r;
  }
  // the pixel phone comes up on the cut and stays up: the montage swaps the phone in the same hand on every cut
  const r = spring(t - b(C.cut2)), lowerAt = b(C.endcard) - 0.16;
  return t > lowerAt ? r * (1 - eIn((t - lowerAt) / 0.16)) : r;
}
function anyPlate(t) {
  const sh = shotAt(t);
  // the keypad sheet: the pressed button, then real in-between frames of the slide, stepped (a dissolve between two
  // positions of the same sheet ghosts; three frames each at 60 fps reads as the slide itself)
  const sheetUp = (t0, press, frames, open) => {
    const su = t - t0 - 0.08;
    if (su < 0) return [press];
    if (su < 0.05) return [frames[0]];
    if (su < 0.1) return [frames[1]];
    return su < 0.12 ? [open] : null;
  };
  const sheetDown = (t0, press, dn, after) => {
    if (t < t0 + 0.1) return [press];
    return [t < t0 + 0.15 ? dn : after];
  };
  if (sh.from === 0) {
    if (t < b(C.sizetap)) return ['list'];
    if (t < b(C.keys[0])) return sheetUp(b(C.sizetap), 'size-press', ['kp-up1', 'kp-up2'], 'kp-sel') || ['kp-sel'];
    if (t < b(C.keys[1])) return ['kp-0'];
    if (t < b(C.keys[2])) return ['kp-0d'];
    if (t < b(C.keys[3])) return ['kp-06'];
    if (t < b(C.go)) return ['kp-069'];
    if (t < b(C.buy)) return sheetDown(b(C.go), 'kp-go', 'kp-dn1', 'list-069');
    const bu = t - b(C.buy);
    if (bu < 0.05) return ['buy1'];
    if (bu < 0.12) return ['buy2'];
    if (bu < 0.22) return ['buy3'];
    if (bu < 0.32) return ['buy3', 'bought', (bu - 0.22) / 0.1];
    if (t < b(C.run)) return ['bought'];
    if (t < b(C.run) + 0.12) return ['bought', 'running', (t - b(C.run)) / 0.12];
    return ['running'];
  }
  if (sh.from === C.cut2) {
    if (t < b(C.anytap)) return ['b-win'];
    if (t < b(C.keys2[0])) return sheetUp(b(C.anytap), 'b-any-press', ['b-kp-up1', 'b-kp-up2'], 'b-kp') || ['b-kp'];
    if (t < b(C.keys2[1])) return ['b-kp-5'];
    if (t < b(C.go2)) return ['b-kp-50'];
    return sheetDown(b(C.go2), 'b-go', 'b-kp-dn1', 'b-sold');
  }
  return [sh.skin + '-' + sh.plate];
}
// any: the captions, two lines that slam in on the beat (the second line half a beat later, or two for the montage)
function drawAnyCaps(t) {
  if (story !== 'any') return;
  const CAPS = [
    [C.cap1, C.sizetap - 0.1, 'COPYCATS?', 'ONE ROW.', 0.5],
    [C.cap2, C.go + 0.6, 'TYPE ANY', 'AMOUNT.', 0.5],
    [C.buy, C.cut2 - 0.2, 'ONE TAP.', (meta.taps.runPct || '+45%') + '.', C.run - C.buy, '#2BE07A'],
    [C.cap3, C.passed - 0.12, 'SELL', 'ANY %.', 0.5],
    [C.cap4, C.endcard - 0.36, 'ONE PHONE.', 'EVERY GAME.', 2], // gone before the cut to the end card
  ];
  for (const [inB, outB, l1, l2, d2, c2] of CAPS) {
    const t0 = b(inB), t1 = b(outB);
    if (t < t0 || t > t1 + 0.16) continue;
    const out = eIn(clamp((t - t1) / 0.16));
    const line = (str, at, y, fill) => {
      const u = t - at; if (u < 0) return;
      const s = u < 0.1 ? 1.28 - 0.31 * eOut(u / 0.1) : u < 0.2 ? 0.97 + 0.03 * eOut((u - 0.1) / 0.1) : 1;
      g.save();
      g.translate(110 - out * 40, y); g.scale(s, s); g.translate(-110, -y);
      text(str, 110, y, { font: '900 168px "Big Shoulders Display"', fill, stroke: '#0B0A09', sw: 8, shadow: 'rgba(0,0,0,.5)', sh: 9, align: 'left', ls: '4px', alpha: clamp(u / 0.05) * (1 - out) });
      g.restore();
    };
    line(l1, t0, 470, '#FFF4E6');
    line(l2, t0 + d2 * spb(story), 632, c2 || '#FF5A1F');
  }
  // the burst callout: a big "×12" beside the phone, joined to the row it folded
  const P = lastPose, bt = meta.taps.burst;
  if (P && bt && meta.taps.burstN && t >= b(C.rings[0]) && t < b(C.sizetap) + 0.12) {
    const u = t - b(C.rings[0]), out = clamp((t - b(C.sizetap)) / 0.12);
    const k = eBack(clamp(u / 0.3)), a = clamp(u / 0.08) * (1 - out);
    const tx = P.x + (bt[0] - 26) * meta.view.dpr * P.k, ty = P.y + bt[1] * meta.view.dpr * P.k; // the tag's left end
    const label = '×' + meta.taps.burstN;
    g.save(); g.globalAlpha = a;
    g.font = '900 76px "Big Shoulders Display"'; g.letterSpacing = '2px';
    const w = g.measureText(label).width + 44, h = 84, cx = P.x - 30 - w / 2 + 60, cy = ty; // just left of the phone's edge
    g.strokeStyle = '#FF5A1F'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx + w / 2 * k, cy); g.lineTo(tx, ty); g.stroke();
    g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy);
    g.fillStyle = '#FF5A1F'; g.shadowColor = 'rgba(255,90,31,.6)'; g.shadowBlur = 30;
    g.beginPath(); g.roundRect(cx - w / 2, cy - h / 2, w, h, 16); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#170700'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, cx, cy + 4);
    g.restore();
  }
}
let lastPose = null;
// games: a small label for each world on every cut (our own world names)
function drawCaption(t) {
  if (!(story === 'games') || t >= b(C.endcard) - 0.2) return;
  const sh = shotAt(t), u = t - b(sh.from);
  const w = WORLDS.find((x) => x.id === sh.world);
  if (!w) return;
  const a = eOut(u / 0.12) * (1 - clamp((t - (b(sh.to) - 0.1)) / 0.1));
  g.save(); g.globalAlpha = a; g.font = '700 28px Geist'; g.letterSpacing = '1px';
  const label = w.label.toUpperCase(), tw = g.measureText(label).width;
  const x = 64 - (1 - eOut(u / 0.16)) * 30, y = H - 92;
  g.fillStyle = 'rgba(11,10,9,.72)'; g.beginPath(); g.roundRect(x, y - 30, tw + 44, 48, 8); g.fill();
  g.fillStyle = '#FF5A1F'; g.fillRect(x, y - 30, 6, 48);
  g.fillStyle = '#FFF4E6'; g.textBaseline = 'middle'; g.fillText(label, x + 24, y - 6);
  g.restore();
}

function drawWasted(t) {
  const tw = b(C.wasted);
  if ((story !== 'city' && story !== 'games') || t < tw || t >= b(C.cut2)) return;
  const u = t - tw;
  const s = u < 0.11 ? 1.45 - 0.48 * eOut(u / 0.11) : u < 0.22 ? 0.97 + 0.03 * eOut((u - 0.11) / 0.11) : 1;
  g.save();
  g.translate(BX, 500); g.scale(s, s); g.translate(-BX, -500);
  if (story === 'games') {
    // the blocky skin's banner: pixel type, a hard drop shadow, no stroke
    text('WASTED', BX + 12, 552, { font: '700 216px "Pixelify Sans"', fill: '#3a0008', ls: '6px' });
    text('WASTED', BX, 540, { font: '700 216px "Pixelify Sans"', fill: '#E8233A', ls: '6px' });
  } else text('WASTED', BX, 540, { font: '900 232px "Big Shoulders Display"', fill: '#E8233A', stroke: '#120204', sw: 10, shadow: '#3a0008', sh: 10, ls: '7px', alpha: 1 }); // full strength from the slam frame on
  g.restore();
  if (u > 0.28) pill('$??? rugged · -1.90 SOL', BX, 640, { font: '600 34px Geist', alpha: eOut((u - 0.28) / 0.25) });
}
function drawPassed(t) {
  const tp = b(C.passed), te = story === 'any' ? b(C.cut3) : b(C.endcard);
  if (t < tp || t > te + 0.05) return;
  const u = t - tp, fade = 1 - clamp((t - (te - 0.25)) / 0.3); // clear before the wordmark lands
  const pix = story === 'blocky' || story === 'any', toon = story === 'games';
  const sold = story === 'any' ? meta.taps.sold : null; // the plate run's real paper sell
  const profit = sold ? sold.got - sold.cost : pix ? 1.2 : toon ? 3.05 : 3.0, x = sold ? sold.x : pix ? 3.4 : toon ? 4.05 : 4.0;
  const sym = sold ? '$' + sold.sym : pix ? '$Milo' : '$ConConAI';
  // warm glow
  g.save(); g.globalAlpha = 0.5 * eOut(u / 0.4) * fade;
  const rg = g.createRadialGradient(BX, 500, 10, BX, 500, 620); rg.addColorStop(0, 'rgba(255,194,61,.45)'); rg.addColorStop(1, 'rgba(255,194,61,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H); g.restore();
  // gold wipe, left to right
  const font = pix ? '700 124px "Pixelify Sans"' : toon ? '400 124px "Lilita One"' : '900 160px "Big Shoulders Display"';
  g.save(); g.font = font; g.letterSpacing = pix ? '4px' : '5px';
  const tw = g.measureText('MISSION PASSED').width;
  g.beginPath(); g.rect(BX - tw / 2 - 30, 300, (tw + 60) * eOut(u / 0.45), 320); g.clip();
  text('MISSION PASSED', BX, 520, toon ? { font, fill: '#FFC23D', stroke: '#1a1033', sw: 16, shadow: '#1a1033', sh: 10, ls: '2px', alpha: fade } : pix ? { font, fill: '#FFC23D', shadow: '#4a2f00', sh: 9, ls: '4px', alpha: fade } : { font, fill: '#FFC23D', stroke: '#1a1000', sw: 9, shadow: '#4a2f00', sh: 9, ls: '5px', alpha: fade });
  g.restore();
  if (u > 0.3) {
    const v = profit * eOut((u - 0.3) / 0.9);
    text('+' + v.toFixed(2) + ' SOL', BX, 640, toon ? { font: '400 92px "Lilita One"', fill: '#FFF4E6', stroke: '#1a1033', sw: 11, shadow: '#1a1033', sh: 8, alpha: fade } : pix ? { font: '700 96px "Pixelify Sans"', fill: '#FFF4E6', shadow: '#4a2f00', sh: 7, alpha: fade } : { font: '900 110px "Big Shoulders Display"', fill: '#FFF4E6', stroke: '#1a1000', sw: 6, shadow: '#4a2f00', sh: 6, ls: '2px', alpha: fade });
  }
  if (u > 0.7) pill(sold?.part ? `sold 50% of ${sym} at ${x.toFixed(1)}x` : `sold ${sym} at ${toon ? x.toFixed(2) : x.toFixed(1)}x`, BX, 726, { font: '600 30px Geist', alpha: eOut((u - 0.7) / 0.3) * fade });
}
function drawAchievement(t) {
  if (story !== 'blocky') return;
  const ta = b(C.ach), tout = b(C.sell) + 0.4;
  if (t < ta || t > tout + 0.4) return;
  const inK = eBack((t - ta) / 0.42), outK = eIn((t - tout) / 0.35);
  const bw = 640, bh = 132, x = W - 48 - bw;
  const y = lerp(-bh - 20, 44, inK) - (t > tout ? outK * (bh + 80) : 0);
  g.save();
  g.fillStyle = '#212121'; g.fillRect(x, y, bw, bh);
  g.strokeStyle = '#5a5a5a'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, bw - 6, bh - 6);
  g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(x + 7.5, y + 7.5, bw - 15, bh - 15);
  g.fillStyle = '#ffd43b'; g.fillRect(x + 26, y + 34, 64, 64);
  g.fillStyle = '#fff3a8'; g.fillRect(x + 26, y + 34, 64, 8); g.fillRect(x + 26, y + 34, 8, 64);
  g.fillStyle = '#c99a00'; g.fillRect(x + 26, y + 90, 64, 8); g.fillRect(x + 82, y + 34, 8, 64);
  g.restore();
  text('Achievement get!', x + 112, y + 60, { font: '600 34px "Pixelify Sans"', fill: '#ffd43b', align: 'left' });
  text('Diamond hands: held $Milo through -52%', x + 112, y + 102, { font: '600 25px "Pixelify Sans"', fill: '#fff', align: 'left' });
}
function drawEnd(t) {
  const te = b(C.endcard);
  if (t < te) return;
  const u = t - te;
  const pop = (d) => clamp((u - d) / 0.35);
  const k0 = pop(0.18);
  if (k0 > 0) {
    g.save();
    const sc = lerp(1.08, 1, eOut(k0));
    const base = story === 'any' ? 492 : 560;
    g.translate(W / 2, base - 40); g.scale(sc, sc); g.translate(-W / 2, -(base - 40));
    // BURNERPHONE: "BURNER" in paper, "PHONE" in burn orange; shrinks to stay inside ~84% of the frame width
    let px = story === 'any' ? 228 : 250;
    const fnt = () => '900 ' + px + 'px "Big Shoulders Display"', ls = () => Math.round(px * 0.048) + 'px';
    g.font = fnt(); g.letterSpacing = ls();
    while (g.measureText('BURNERPHONE').width > W * 0.84 && px > 120) { px -= 6; g.font = fnt(); g.letterSpacing = ls(); }
    const wA = g.measureText('BURNER').width, wAll = g.measureText('BURNERPHONE').width;
    const x0 = W / 2 - wAll / 2;
    text('BURNER', x0, base, { font: fnt(), fill: '#FFF4E6', align: 'left', ls: ls(), alpha: eOut(k0), shadow: 'rgba(0,0,0,.35)', sh: 8 });
    text('PHONE', x0 + wA, base, { font: fnt(), fill: '#FF5A1F', align: 'left', ls: ls(), alpha: eOut(k0), shadow: 'rgba(0,0,0,.35)', sh: 8 });
    g.restore();
  }
  if (story === 'any') {
    text('a burner phone for your bags', W / 2, 572, { font: '600 40px Geist', fill: '#FFF4E6', alpha: eOut(pop(0.3)) });
    // the download button: pops in, then a thumb presses it once
    const kb = pop(0.44);
    if (kb > 0) {
      const pressU = u - 1.45, press = pressU > 0 && pressU < 0.16 ? 1 - Math.sin((pressU / 0.16) * Math.PI) * 0.045 : 1;
      g.save(); g.font = '900 54px "Big Shoulders Display"'; g.letterSpacing = '2px';
      const tw = g.measureText('DOWNLOAD FOR WINDOWS').width; g.restore();
      const logoW = 46, padX = 44, gapL = 24, bw = padX * 2 + logoW + gapL + tw; // sized to its words
      const sc = eBack(kb) * press, bh = 104, cx = W / 2, cy = 676;
      g.save();
      g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
      g.globalAlpha = clamp(kb * 3);
      g.shadowColor = 'rgba(255,90,31,.55)'; g.shadowBlur = 40;
      g.fillStyle = '#FF5A1F'; g.beginPath(); g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 20); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.roundRect(cx - bw / 2 + 3, cy - bh / 2 + 3, bw - 6, bh / 2 - 6, 17); g.fill();
      // the four-pane window mark
      const lx = cx - bw / 2 + padX, ly = cy - 23, sq = 21, gap = 4;
      g.fillStyle = '#170700';
      g.fillRect(lx, ly, sq, sq); g.fillRect(lx + sq + gap, ly, sq, sq); g.fillRect(lx, ly + sq + gap, sq, sq); g.fillRect(lx + sq + gap, ly + sq + gap, sq, sq);
      text('DOWNLOAD FOR WINDOWS', lx + logoW + gapL, cy + 19, { font: '900 54px "Big Shoulders Display"', fill: '#170700', ls: '2px', align: 'left', alpha: clamp(kb * 3) });
      g.restore();
      if (pressU > 0 && pressU < 0.45) { g.save(); g.beginPath(); g.arc(cx + 150, cy + 6, 14 + eOut(pressU / 0.45) * 60, 0, Math.PI * 2); g.fillStyle = `rgba(255,255,255,${0.45 * (1 - pressU / 0.45)})`; g.fill(); g.restore(); }
    }
    text('free · open source · built by github', W / 2, 784, { font: '600 30px Geist', fill: 'rgba(255,244,230,.8)', alpha: eOut(pop(0.62)) });
    text('github.com/burnerphonefun', W / 2, 838, { font: '600 27px Geist', fill: '#FF5A1F', ls: '1px', alpha: eOut(pop(0.76)) });
    return;
  }
  if (story === 'games') {
    text('one phone. every game.', W / 2, 664, { font: '600 52px Geist', fill: '#FFF4E6', alpha: eOut(pop(0.34)) });
    text('open source on github', W / 2, 726, { font: '500 30px Geist', fill: 'rgba(255,244,230,.72)', alpha: eOut(pop(0.5)) });
    text('burnerphone.fun', W / 2, 786, { font: '600 28px Geist', fill: '#FF5A1F', ls: '1px', alpha: eOut(pop(0.64)) });
    return;
  }
  text('a burner phone for your bags', W / 2, 660, { font: '600 46px Geist', fill: '#FFF4E6', alpha: eOut(pop(0.36)) });
  text('trade pump.fun without leaving the game', W / 2, 716, { font: '500 32px Geist', fill: 'rgba(255,244,230,.8)', alpha: eOut(pop(0.5)) });
  text('paper SOL · free for windows', W / 2, 772, { font: '500 24px Geist', fill: 'rgba(255,244,230,.55)', alpha: eOut(pop(0.64)) });
  text('burnerphone.fun', W / 2, 822, { font: '600 28px Geist', fill: '#FF5A1F', ls: '1px', alpha: eOut(pop(0.76)) });
}

// ---------- the frame ----------
function drawWorld(t, push, shake) {
  const wt = worldTime(t);
  const gray = story === 'city' || story === 'games' ? (t < b(C.cut2) ? smooth(b(C.tapestop), b(C.wasted), t) : 0) : 0;
  world.fx({ gray, slow: 0, push: 0 });
  // two sub-frames averaged = a little real motion blur
  const sub = [wt - (1 / 120) * (1 - 0.88 * slowAmt(t)), wt];
  g.save();
  g.translate(W / 2 + shake[0], H / 2 + shake[1]); g.scale(push, push); g.translate(-W / 2, -H / 2);
  for (let i = 0; i < sub.length; i++) {
    world.renderAt(sub[i]);
    g.globalAlpha = i === 0 ? 1 : 0.5;
    g.drawImage(gl, 0, 0, W, H);
  }
  g.restore();
  g.globalAlpha = 1;
}

function grade(t) {
  g.save();
  g.globalCompositeOperation = 'soft-light';
  const wid = shotAt(t).world;
  g.fillStyle = { city: 'rgba(255,150,80,.16)', blocky: 'rgba(70,90,170,.16)', toon: 'rgba(255,200,130,.08)', tactical: 'rgba(255,190,120,.1)', obby: 'rgba(160,200,255,.08)', survival: 'rgba(255,120,150,.12)' }[wid] || 'rgba(70,90,170,.16)';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  const vg = g.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, wid === 'city' ? 'rgba(20,4,10,.5)' : wid === 'blocky' ? 'rgba(0,0,10,.6)' : 'rgba(10,6,20,.38)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  // grain, a fresh offset every frame
  const f = Math.round(t * 60), ox = (f * 197) % 512, oy = (f * 331) % 512;
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.07;
  for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) g.drawImage(grain, x, y);
  g.restore();
}

function letterbox(t) {
  const open = b(C.raise);
  let h;
  if (story === 'games' || story === 'any') h = t < 0.42 ? 540 * (1 - eOut(t / 0.42)) : 0;
  else if (story === 'city' && t < open) h = 0;
  else if (t < 1.1) h = lerp(540, 128, eOut(t / 1.1));
  else if (t < open - 0.35) h = 128;
  else if (t < open) h = 128 * (1 - eInOut((t - (open - 0.35)) / 0.35));
  else h = 0;
  const te = b(C.endcard);
  if (t > te) h = 128 * eOut((t - te) / 0.4);
  if (t > dur(story) - 0.3) h = lerp(h, 540, eIn((t - (dur(story) - 0.3)) / 0.3));
  if (h <= 0) return;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, h); g.fillRect(0, H - h, W, h);
}

function flash(t, at, a = 0.5, len = 0.22) { const u = t - at; if (u >= 0 && u < len) { g.fillStyle = `rgba(255,255,255,${a * (1 - u / len)})`; g.fillRect(0, 0, W, H); } }

let curWorld = null;
window.renderFrame = async (t) => {
  const sh = shotAt(t);
  if (sh.world !== curWorld) { await world.setWorld(sh.world); curWorld = sh.world; }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  // push-in and slam shake (city WASTED)
  let push = 1, shake = [0, 0];
  if ((story === 'city' || story === 'games') && t >= b(C.tapestop) && t < b(C.cut2)) push = 1 + 0.075 * eInOut((t - b(C.tapestop)) / (b(C.cut2) - b(C.tapestop)));
  if (story === 'city' || story === 'games') { const u = t - b(C.wasted); if (u >= 0 && u < 0.45) { const a = 12 * Math.exp(-u * 9); shake = [Math.sin(u * 95) * a, Math.cos(u * 77) * a * 0.6]; } }
  if (story === 'games' && sh.from > 0 && sh.from !== C.cut2) push *= 1 + 0.05 * (1 - eOut((t - b(sh.from)) / 0.28));
  if (story === 'any' && sh.from > 0 && !sh.stayUp) push *= 1 + 0.06 * (1 - eOut((t - b(sh.from)) / 0.3));
  drawWorld(t, push, shake);
  // any: the world steps back while the phone is close
  if (story === 'any') { const f = anyFocus(t); if (f > 0) { g.fillStyle = `rgba(6,4,12,${(0.52 * f).toFixed(3)})`; g.fillRect(0, 0, W, H); } }
  // end card: the world sinks back behind the words
  const te = b(C.endcard);
  if (t > te) {
    const k = eOut((t - te) / 0.45);
    sg.drawImage(out, 0, 0, 240, 135);
    g.save(); g.globalAlpha = k; g.imageSmoothingQuality = 'high'; g.drawImage(small, 0, 0, W, H); g.restore();
    g.fillStyle = `rgba(11,10,9,${0.58 * k})`; g.fillRect(0, 0, W, H);
  }
  // the hiss: a red edge creeps in while the bag bleeds (blocky)
  if (story === 'blocky' && t > b(C.hiss[0]) && t < b(C.up)) {
    const k = smooth(b(C.hiss[0]), b(C.up), t);
    const rg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.75);
    rg.addColorStop(0, 'rgba(120,0,0,0)'); rg.addColorStop(1, `rgba(150,10,10,${0.45 * k})`);
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }
  drawPhone(t);
  drawWasted(t);
  drawPassed(t);
  drawAchievement(t);
  grade(t);
  if (story === 'city') { flash(t, b(C.wasted), 0.3, 0.2); flash(t, b(C.cut2), 0.55, 0.12); }
  if (story === 'blocky') flash(t, b(C.up), 0.25, 0.2);
  if (story === 'games') { for (const s of S.shots) if (s.from > 0) flash(t, b(s.from), s.from === C.cut2 ? 0.5 : 0.16, s.from === C.cut2 ? 0.12 : 0.08); flash(t, b(C.wasted), 0.3, 0.2); }
  if (story === 'any') { flash(t, b(C.cut2), 0.45, 0.12); for (const s of S.shots) if (s.plate) flash(t, b(s.from), 0.2, 0.08); flash(t, b(C.passed), 0.22, 0.2); flash(t, b(C.endcard), 0.32, 0.14); }
  drawAnyCaps(t);
  drawCaption(t);
  drawEnd(t);
  letterbox(t);
  return out.toDataURL('image/jpeg', 0.93);
};

window.teaser = { story, dur: dur(story), fps: S.fps };
window.ready = init();
