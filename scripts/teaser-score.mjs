// node scripts/teaser-score.mjs [city|blocky] [out.wav] — synthesized scores for the teasers, on the shared timeline.
// City: laid-back west-coast g-funk (96 BPM): swung drums, sub bass, FM Rhodes, a portamento sine lead whine,
//       a tape stop into the WASTED hit, a bright re-entry and a cash register for MISSION PASSED.
// Blocky: night chiptune (120 BPM): square/triangle arps, noise hats, a hiss riser, the achievement jingle.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORIES, sec, dur } from '../web/src/teaser/timeline.js';

const SR = 48000;
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = (n) => { const m = /^([A-G])(#|b)?(-?\d)$/.exec(n); const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]; return 12 * (+m[3] + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- buses ----------
class Bus { constructor(n) { this.L = new Float32Array(n); this.R = new Float32Array(n); } }
function add(bus, i, v, pan = 0) { if (i < 0 || i >= bus.L.length) return; bus.L[i] += v * Math.min(1, 1 - pan); bus.R[i] += v * Math.min(1, 1 + pan); }

// ---------- DSP bits ----------
function biquad(type, f, q = 0.707) {
  const w = TAU * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
  else { b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; } // bp
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function bq(st, x) { const y = st.b0 * x + st.b1 * st.x1 + st.b2 * st.x2 - st.a1 * st.y1 - st.a2 * st.y2; st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y; return y; }
// a filter whose cutoff moves: recompute coefficients every 64 samples
function sweepFilter(buf, type, fAt, q = 0.707) {
  let st = biquad(type, fAt(0), q);
  for (let i = 0; i < buf.length; i++) {
    if ((i & 63) === 0) { const n = biquad(type, fAt(i / SR), q); st.b0 = n.b0; st.b1 = n.b1; st.b2 = n.b2; st.a1 = n.a1; st.a2 = n.a2; }
    buf[i] = bq(st, buf[i]);
  }
}
function reverb(bus, mix = 0.25, size = 0.84, damp = 0.3, pre = 0.012) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((d) => Math.round(d * SR / 44100));
  const aps = [556, 441, 341, 225].map((d) => Math.round(d * SR / 44100));
  const preN = Math.round(pre * SR);
  for (const [ch, off] of [[bus.L, 0], [bus.R, 23]]) {
    const n = ch.length, wet = new Float32Array(n);
    for (const d0 of combs) {
      const d = d0 + off, line = new Float32Array(d); let idx = 0, lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i >= preN ? ch[i - preN] : 0;
        const y = line[idx]; lp = y * (1 - damp) + lp * damp;
        line[idx] = x + lp * size; idx = (idx + 1) % d;
        wet[i] += y * 0.125;
      }
    }
    for (const d0 of aps) {
      const d = d0 + off, line = new Float32Array(d); let idx = 0;
      for (let i = 0; i < n; i++) { const b = line[idx], x = wet[i]; const y = -x + b; line[idx] = x + b * 0.5; idx = (idx + 1) % d; wet[i] = y; }
    }
    for (let i = 0; i < n; i++) ch[i] = ch[i] * (1 - mix * 0.5) + wet[i] * mix;
  }
}
function delay(bus, time, fb = 0.35, mix = 0.3) {
  const d = Math.round(time * SR);
  const L = bus.L, R = bus.R, n = L.length;
  const dl = new Float32Array(n), dr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i >= d ? dr[i - d] : 0, c = i >= d ? dl[i - d] : 0; // ping-pong
    dl[i] = L[i] + a * fb; dr[i] = R[i] + c * fb;
  }
  for (let i = 0; i < n; i++) { L[i] += (dl[i] - L[i]) * mix; R[i] += (dr[i] - R[i]) * mix; }
}

// ---------- voices ----------
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
const adsr = (t, len, a, d, s, r) => (t < a ? t / a : t < a + d ? 1 - (1 - s) * ((t - a) / d) : t < len ? s : Math.max(0, s * (1 - (t - len) / r)));

function kick(bus, t0, gain = 1, f0 = 120, f1 = 42) {
  const n = Math.round(0.45 * SR), i0 = Math.round(t0 * SR); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const f = f1 + (f0 - f1) * Math.exp(-t * 28); ph += TAU * f / SR; const e = Math.exp(-t * 7.5) * (t < 0.002 ? t / 0.002 : 1); const click = i < 90 ? (1 - i / 90) * 0.35 : 0; add(bus, i0 + i, (Math.sin(ph) * e + click) * gain * 0.95); }
}
function snare(bus, t0, gain = 1, r) {
  const n = Math.round(0.32 * SR), i0 = Math.round(t0 * SR); const hp = biquad('hp', 1200), bp = biquad('bp', 3200, 0.8); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += TAU * (190 - 30 * Math.min(1, t * 20)) / SR; const tone = Math.sin(ph) * Math.exp(-t * 25) * 0.5; const nz = r() * 2 - 1; const sn = bq(bp, bq(hp, nz)) * Math.exp(-t * 14) * 1.3; add(bus, i0 + i, (tone + sn) * gain * 0.6, -0.05); }
}
function clap(bus, t0, gain = 1, r) {
  const n = Math.round(0.25 * SR), i0 = Math.round(t0 * SR); const bp = biquad('bp', 1400, 1.2);
  for (let i = 0; i < n; i++) { const t = i / SR; const env = (t < 0.01 ? 1 : t < 0.02 ? 0.6 : t < 0.03 ? 0.9 : 1) * Math.exp(-t * 18); add(bus, i0 + i, bq(bp, r() * 2 - 1) * env * gain * 0.7, 0.08); }
}
function hat(bus, t0, gain = 1, r, open = false) {
  const len = open ? 0.28 : 0.05, n = Math.round(len * SR), i0 = Math.round(t0 * SR); const hp = biquad('hp', 7500);
  for (let i = 0; i < n; i++) { const t = i / SR; add(bus, i0 + i, bq(hp, r() * 2 - 1) * Math.exp(-t * (open ? 9 : 70)) * gain * 0.32, 0.25); }
}
function crash(bus, t0, gain, r) {
  const n = Math.round(2.2 * SR), i0 = Math.round(t0 * SR); const hp = biquad('hp', 4500);
  for (let i = 0; i < n; i++) { const t = i / SR; add(bus, i0 + i, bq(hp, r() * 2 - 1) * Math.exp(-t * 2.2) * gain * 0.28, (r() - 0.5) * 0.6); }
}
// FM Rhodes-ish electric piano
function rhodes(bus, t0, len, midi, gain = 1, pan = 0) {
  const f = mtof(midi), n = Math.round((len + 1.2) * SR), i0 = Math.round(t0 * SR); let pc = 0, pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; pm += TAU * f / SR; pc += TAU * f / SR;
    const idx = 1.6 * Math.exp(-t * 6) + 0.25;
    const v = Math.sin(pc + idx * Math.sin(pm)) * 0.8 + Math.sin(2 * pc) * 0.08 * Math.exp(-t * 3);
    const env = adsr(t, len, 0.004, 0.6, 0.55, 0.9) * (1 + 0.12 * Math.sin(TAU * 4.2 * t));
    add(bus, i0 + i, v * env * gain * 0.16, pan + 0.35 * Math.sin(TAU * 1.1 * t));
  }
}
// the g-funk lead: a sine with glide and vibrato (notes: [startBeat, lenBeats, midi])
function whine(bus, notes, b, gain = 1, octave = 0) {
  if (!notes.length) return;
  const start = b(notes[0][0]), end = b(notes[notes.length - 1][0] + notes[notes.length - 1][1]) + 0.6;
  const i0 = Math.round(start * SR), n = Math.round((end - start) * SR);
  let ph = 0, f = mtof(notes[0][2] + octave);
  for (let i = 0; i < n; i++) {
    const t = start + i / SR;
    let cur = null; for (const nt of notes) if (t >= b(nt[0]) && t < b(nt[0] + nt[1])) cur = nt;
    const target = cur ? mtof(cur[2] + octave) : f;
    f += (target - f) * (1 - Math.exp(-1 / (SR * 0.055)));
    const vib = 1 + 0.009 * Math.sin(TAU * 5.6 * t) * Math.min(1, cur ? (t - b(cur[0])) * 3 : 1);
    ph += TAU * f * vib / SR;
    let g = 0; for (const nt of notes) { const u = t - b(nt[0]), L = b(nt[0] + nt[1]) - b(nt[0]); if (u >= 0 && u < L + 0.25) g = Math.max(g, adsr(u, L, 0.03, 0.1, 0.85, 0.25)); }
    add(bus, i0 + i, (Math.sin(ph) + 0.12 * Math.sin(2 * ph)) * g * gain * 0.13, 0.1);
  }
}
function sub(bus, t0, len, midi, gain = 1, glideFrom = null) {
  const n = Math.round((len + 0.15) * SR), i0 = Math.round(t0 * SR); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; const m = glideFrom != null ? midi + (glideFrom - midi) * Math.exp(-t * 30) : midi;
    ph += TAU * mtof(m) / SR;
    const env = adsr(t, len, 0.006, 0.12, 0.8, 0.12);
    add(bus, i0 + i, (Math.sin(ph) * 0.9 + Math.sin(2 * ph) * 0.18) * env * gain * 0.5);
  }
}
function pulse(bus, t0, len, midi, gain = 1, pw = 0.25, pan = 0, slideTo = null) {
  const n = Math.round((len + 0.05) * SR), i0 = Math.round(t0 * SR); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; const m = slideTo != null ? midi + (slideTo - midi) * Math.min(1, t / len) : midi;
    const f = mtof(m), dt = f / SR; ph += dt; if (ph >= 1) ph -= 1;
    let v = ph < pw ? 1 : -1; v += blep(ph, dt); let p2 = ph - pw; if (p2 < 0) p2 += 1; v -= blep(p2, dt);
    const env = adsr(t, len, 0.002, 0.05, 0.7, 0.04);
    add(bus, i0 + i, v * env * gain * 0.09, pan);
  }
}
function tri(bus, t0, len, midi, gain = 1, pan = 0) {
  const n = Math.round((len + 0.05) * SR), i0 = Math.round(t0 * SR); let ph = 0; const f = mtof(midi);
  for (let i = 0; i < n; i++) { const t = i / SR; ph = (ph + f / SR) % 1; const v = 4 * Math.abs(ph - 0.5) - 1; add(bus, i0 + i, v * adsr(t, len, 0.003, 0.05, 0.85, 0.05) * gain * 0.22, pan); }
}
function noiseSweep(bus, t0, len, f0, f1, gain, r, q = 2, type = 'bp') {
  const n = Math.round(len * SR), i0 = Math.round(t0 * SR), buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = r() * 2 - 1;
  sweepFilter(buf, type, (t) => f0 * Math.pow(f1 / f0, t / len), q);
  for (let i = 0; i < n; i++) { const t = i / SR; add(bus, i0 + i, buf[i] * gain * Math.pow(t / len, 1.6), Math.sin(t * 3) * 0.3); }
}
// ---------- phone sounds (the product's own, from shared/phone/sound.js, at film level) ----------
function buzz(bus, t0, gain = 1) {
  for (const dt of [0, 0.16]) {
    const n = Math.round(0.12 * SR), i0 = Math.round((t0 + dt) * SR); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; const f = 150 + 40 * Math.sin(TAU * 38 * t); ph = (ph + f / SR) % 1; const saw = 2 * ph - 1; add(bus, i0 + i, saw * Math.min(1, t / 0.005) * Math.max(0, 1 - t / 0.12) * gain * 0.22); }
  }
}
function tap(bus, t0, gain = 1, r) {
  const n = Math.round(0.04 * SR), i0 = Math.round(t0 * SR); const bp = biquad('bp', 3800, 2); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += TAU * 1200 / SR; add(bus, i0 + i, (bq(bp, r() * 2 - 1) * 0.5 + Math.sin(ph) * 0.3) * Math.exp(-t * 90) * gain * 0.7); }
}
function ringtone(bus, t0, t1, gain = 1) {
  for (let k = 0; t0 + k * 0.8 < t1; k++) for (let j = 0; j < 8; j++) {
    const ts = t0 + k * 0.8 + j * 0.05; if (ts >= t1) break;
    const f = j % 2 ? 1400 : 1100, n = Math.round(0.045 * SR), i0 = Math.round(ts * SR); let ph = 0;
    for (let i = 0; i < n; i++) { ph = (ph + f / SR) % 1; add(bus, i0 + i, (ph < 0.5 ? 1 : -1) * (1 - i / n) * gain * 0.07, 0.15); }
  }
}
function cashRegister(bus, t0, gain, r) {
  noiseSweep(bus, t0, 0.07, 900, 700, gain * 1.4, r, 1.2);
  noiseSweep(bus, t0 + 0.09, 0.05, 2400, 2400, gain, r, 2);
  for (const [f, d] of [[2093, 0], [2637, 0.11], [3136, 0.22], [4186, 0.33]]) {
    const n = Math.round(1.1 * SR), i0 = Math.round((t0 + 0.12 + d) * SR); let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; p1 += TAU * f / SR; p2 += TAU * f * 2.76 / SR; add(bus, i0 + i, (Math.sin(p1) + 0.3 * Math.sin(p2) * Math.exp(-t * 8)) * Math.exp(-t * 3.2) * gain * 0.11, (d - 0.15) * 1.5); }
  }
}
function boom(bus, t0, gain, r) { // the WASTED hit: falling sub + low noise
  const n = Math.round(2.6 * SR), i0 = Math.round(t0 * SR); let ph = 0; const lp = biquad('lp', 380);
  for (let i = 0; i < n; i++) { const t = i / SR; const f = 28 + 85 * Math.exp(-t * 3.2); ph += TAU * f / SR; const e = Math.exp(-t * 1.5) * Math.min(1, t / 0.004); add(bus, i0 + i, (Math.sin(ph) * 1.0 + bq(lp, r() * 2 - 1) * 0.6 * Math.exp(-t * 6)) * e * gain); }
}
function whoosh(bus, t0, len, gain, r, up = true) { noiseSweep(bus, t0, len, up ? 300 : 5000, up ? 6000 : 300, gain, r, 1.2); }

// ---------- master ----------
function master(buses, n, envDb, ceiling = -1.5) {
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const [bus, g] of buses) for (let i = 0; i < n; i++) { L[i] += bus.L[i] * g; R[i] += bus.R[i] * g; }
  for (let i = 0; i < n; i++) { const k = Math.pow(10, envDb(i / SR) / 20); L[i] *= k; R[i] *= k; }
  // gentle glue: soft clip
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 1.1) / 1.1; R[i] = Math.tanh(R[i] * 1.1) / 1.1; }
  // look-ahead peak limiter
  const ceil = Math.pow(10, ceiling / 20), look = Math.round(0.004 * SR), rel = Math.exp(-1 / (0.08 * SR));
  const peak = new Float32Array(n);
  for (let i = 0; i < n; i++) peak[i] = Math.max(Math.abs(L[i]), Math.abs(R[i]));
  const need = new Float32Array(n);
  for (let i = n - 1; i >= 0; i--) { let m = 0; for (let j = 0; j < look && i + j < n; j += 8) m = Math.max(m, peak[i + j]); need[i] = m > ceil ? ceil / m : 1; }
  let gcur = 1;
  for (let i = 0; i < n; i++) { const tgt = need[i]; gcur = tgt < gcur ? tgt : tgt + (gcur - tgt) * rel; L[i] *= gcur; R[i] *= gcur; }
  // fade edges
  const fi = Math.round(0.01 * SR), fo = Math.round(0.35 * SR);
  for (let i = 0; i < fi; i++) { L[i] *= i / fi; R[i] *= i / fi; }
  for (let i = 0; i < fo; i++) { const k = i / fo; L[n - 1 - i] *= k; R[n - 1 - i] *= k; }
  return [L, R];
}
function writeWav(path, L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
  writeFileSync(path, buf);
}

// ================= CITY =================
function city() {
  const S = STORIES.city, C = S.cues, b = (x) => sec('city', x), n = Math.round((dur('city') + 0.05) * SR);
  const r = rng(96);
  const drums = new Bus(n), bass = new Bus(n), keys = new Bus(n), lead = new Bus(n), fx = new Bus(n), sfx = new Bus(n), drone = new Bus(n);
  const swing = (step) => (step % 2 ? 0.58 : 0); // 16th swing
  const s16 = (beat, step) => b(beat + (step + swing(step) * 0.0 + (step % 2 ? 0.16 : 0)) / 4);
  // chords per bar (bar = 4 beats)
  const CH = { Am9: ['A3', 'C4', 'E4', 'G4', 'B4'], Dm9: ['D3', 'F3', 'C4', 'E4', 'A4'], Fmaj7: ['F3', 'A3', 'C4', 'E4'], E7: ['E3', 'G#3', 'D4', 'G4'], Amaj: ['A3', 'C#4', 'E4', 'A4', 'B4'] };
  const bars = ['Am9', 'Am9', 'Dm9', 'Fmaj7', 'Am9', 'Dm9'];
  const groove = (from, to, intensity = 1) => {
    for (let beat = from; beat < to; beat += 4) {
      for (let st = 0; st < 16; st++) {
        const t = s16(beat, st), bt = beat + st / 4;
        if (bt >= to) break;
        if ([0, 7, 10].includes(st)) kick(drums, t, st === 0 ? 1 : 0.8);
        if (st === 4 || st === 12) { snare(drums, t, 0.7, r); clap(drums, t + 0.004, 0.4, r); }
        if (st % 2 === 0) hat(drums, t, (st % 4 === 2 ? 0.75 : 0.5) * intensity, r);
        else if (r() < 0.45) hat(drums, t, 0.22 * intensity, r);
        if (st === 14) hat(drums, t, 0.4 * intensity, r, true);
      }
    }
  };
  const bassline = (from, to) => {
    const root = { Am9: 'A1', Dm9: 'D2', Fmaj7: 'F1', E7: 'E1', Amaj: 'A1' };
    for (let beat = from; beat < to; beat += 4) {
      const name = bars[Math.floor(beat / 4)] || 'Am9';
      const m = NOTE(root[name]);
      const pat = [[0, 1.4, m], [1.75, 0.4, m + 12], [2.5, 0.9, m, m + 2], [3.5, 0.45, m + 7]];
      for (const [o, l, mm, gl] of pat) if (beat + o < to) sub(bass, b(beat + o), b(l) - b(0), mm, 1, gl ?? null);
    }
  };
  const comp = (from, to, g = 1) => {
    for (let beat = from; beat < to; beat += 4) {
      const ch = CH[bars[Math.floor(beat / 4)] || 'Am9'];
      ch.forEach((nt, k) => rhodes(keys, b(beat) + k * 0.012, b(2.6) - b(0), NOTE(nt), g * 0.85, (k - 2) * 0.12));
      if (beat + 2.75 < to) ch.forEach((nt, k) => rhodes(keys, b(beat + 2.75) + k * 0.01, b(0.9) - b(0), NOTE(nt), g * 0.55, (k - 2) * 0.12));
    }
  };

  // intro (b0-4): filtered keys + vinyl + a riser into the phone
  comp(0, 4, 1.25);
  for (let i = 0; i < Math.round(b(4.2) * SR); i++) { if (r() < 0.0009) add(fx, i, (r() - 0.5) * 0.5); add(fx, i, (r() * 2 - 1) * 0.004); }
  whoosh(fx, b(2.5), b(4) - b(2.5), 0.22, r, true);
  for (const st of [8, 10, 12, 14]) hat(drums, b(st / 4), 0.35, r);
  // groove (b4-14 + into the tape stop)
  groove(4, 15.2); bassline(4, 15.2); comp(4, 15.2, 1);
  crash(drums, b(4), 0.7, r);
  whine(lead, [[6, 1.25, NOTE('E5')], [7.25, 0.25, NOTE('G5')], [7.5, 0.5, NOTE('A5')], [8, 0.5, NOTE('G5')], [8.5, 1.25, NOTE('E5')], [10, 1.25, NOTE('D5')], [11.25, 0.25, NOTE('E5')], [11.5, 0.5, NOTE('C5')], [12, 1.5, NOTE('A4')], [13.5, 0.5, NOTE('C5')], [14, 1, NOTE('B4')]], b, 1);
  // after WASTED: a low drone and a heartbeat until the cut
  for (const nt of ['A1', 'E2', 'A2']) { const i0 = Math.round(b(15) * SR), len = b(18) - b(15); let ph = 0; for (let i = 0; i < len * SR; i++) { const t = i / SR; ph += TAU * mtof(NOTE(nt)) / SR; add(drone, i0 + i, Math.sin(ph) * 0.09 * Math.min(1, t / 0.6) * (1 - t / len * 0.5)); } }
  kick(drums, b(16.5), 0.55, 90, 38); kick(drums, b(16.85), 0.4, 90, 38);
  whoosh(fx, b(17), b(18) - b(17), 0.35, r, true);
  // re-entry (b18-22): brighter, the lead an octave up, then the end
  crash(drums, b(18), 0.9, r);
  groove(18, 21.75); bassline(18, 22); comp(18, 24, 1.05);
  whine(lead, [[18, 1, NOTE('A5')], [19, 0.5, NOTE('C6')], [19.5, 0.5, NOTE('B5')], [20, 1, NOTE('A5')], [21, 0.5, NOTE('E5')], [21.5, 2.5, NOTE('A5')]], b, 1.05);
  kick(drums, b(21.75), 0.8);
  // ---- sfx ----
  for (const pb of C.peek) buzz(sfx, b(pb), 1.0);
  buzz(sfx, b(C.unlock), 0.9); tap(sfx, b(C.unlock) + 0.02, 0.6, r);
  pulse(sfx, b(C.launch), 0.06, NOTE('E6'), 0.6, 0.5); pulse(sfx, b(C.launch) + 0.07, 0.08, NOTE('A6'), 0.6, 0.5);
  tap(sfx, b(C.tap), 1.1, r); pulse(sfx, b(C.tap) + 0.02, 0.07, NOTE('E6'), 0.7, 0.5); pulse(sfx, b(C.tap) + 0.08, 0.1, NOTE('B6'), 0.7, 0.5);
  buzz(sfx, b(C.buzz), 1.1);
  noiseSweep(sfx, b(C.rugstamp), 0.12, 600, 200, 0.5, r, 1, 'lp'); kick(sfx, b(C.rugstamp), 0.5, 140, 60); // the stamp lands
  ringtone(sfx, b(C.ring), b(C.wasted) - 0.05, 1.1);
  boom(sfx, b(C.wasted), 1.25, r);
  noiseSweep(sfx, b(C.wasted), 0.5, 3000, 200, 0.35, r, 0.8, 'lp');
  tap(sfx, b(C.sell), 1.1, r);
  cashRegister(sfx, b(C.passed), 1.5, r);
  whoosh(sfx, b(C.endcard) - 0.15, 0.5, 0.25, r, false);

  // filters: the intro opens up, the keys sit back
  sweepFilter(keys.L, 'lp', (t) => (t < b(4) ? 1100 + 4900 * Math.pow(t / b(4), 3) : 6000)); sweepFilter(keys.R, 'lp', (t) => (t < b(4) ? 1100 + 4900 * Math.pow(t / b(4), 3) : 6000));
  reverb(keys, 0.28); reverb(lead, 0.3, 0.86); reverb(drums, 0.1, 0.7); reverb(drone, 0.4, 0.88); reverb(sfx, 0.18, 0.8);
  // sidechain the keys and bass to the kicks a little
  // music bus with the tape stop into WASTED
  const music = new Bus(n);
  for (const [bus, g] of [[drums, 1], [bass, 0.95], [keys, 0.9], [lead, 0.85]]) for (let i = 0; i < n; i++) { music.L[i] += bus.L[i] * g; music.R[i] += bus.R[i] * g; }
  const A = b(C.tapestop), T = b(C.wasted) - A;
  const iA = Math.round(A * SR), iB = Math.round(b(C.wasted) * SR);
  const srcL = music.L.slice(iA, iA + Math.round(T * SR)), srcR = music.R.slice(iA, iA + Math.round(T * SR));
  for (let i = iA; i < iB; i++) {
    const tau = (i - iA) / SR, pos = (tau - tau * tau / (2 * T)) * SR, j = Math.floor(pos), f = pos - j;
    const fade = 1 - Math.pow(tau / T, 3);
    music.L[i] = ((srcL[j] || 0) * (1 - f) + (srcL[j + 1] || 0) * f) * fade;
    music.R[i] = ((srcR[j] || 0) * (1 - f) + (srcR[j + 1] || 0) * f) * fade;
  }
  // silence the groove between the WASTED hit and the cut (only the drone + heartbeat live there)
  for (let i = iB; i < Math.round(b(C.cut2) * SR); i++) { music.L[i] = 0; music.R[i] = 0; }
  for (let i = Math.round(b(16.4) * SR); i < Math.round(b(17.2) * SR); i++) { music.L[i] += drums.L[i]; music.R[i] += drums.R[i]; }
  // section loudness (dB): quiet open, the drop and re-entry loudest
  const envDb = (t) => (t < b(4) ? -1 + 2 * (t / b(4)) : t < b(C.wasted) ? 0 : t < b(C.cut2) ? -2 : t < b(C.endcard) ? 0.5 : -1 - 3 * ((t - b(C.endcard)) / (dur('city') - b(C.endcard))));
  return master([[music, 0.85], [fx, 0.8], [sfx, 0.9], [drone, 1]], n, envDb);
}

// ================= BLOCKY =================
function blocky() {
  const S = STORIES.blocky, C = S.cues, b = (x) => sec('blocky', x), n = Math.round((dur('blocky') + 0.05) * SR);
  const r = rng(120);
  const arp = new Bus(n), bassB = new Bus(n), drumsB = new Bus(n), fx = new Bus(n), sfx = new Bus(n);
  const prog = [['D4', 'F4', 'A4', 'D5'], ['Bb3', 'D4', 'F4', 'Bb4'], ['F3', 'A3', 'C4', 'F4'], ['C4', 'E4', 'G4', 'C5']];
  const roots = ['D2', 'Bb1', 'F2', 'C2'];
  // night arps all the way, quiet before the phone
  for (let beat = 0; beat < 22; beat += 0.25) {
    const bar = Math.floor(beat / 4) % 4, ch = prog[bar], k = Math.round(beat * 4) % 8;
    const nt = NOTE(ch[[0, 1, 2, 3, 2, 1, 2, 3][k]]) + (beat >= C.up && beat < C.endcard ? 12 : 0);
    const g = beat < C.raise ? 0.9 : beat < C.hiss[0] ? 0.9 : beat < C.up ? 0.6 : 1.05;
    pulse(arp, b(beat), b(0.2) - b(0), nt, g, beat >= C.up ? 0.125 : 0.25, k % 2 ? 0.35 : -0.35);
  }
  // pad (triangle) under the intro
  for (let beat = 0; beat < 24; beat += 4) prog[Math.floor(beat / 4) % 4].slice(0, 3).forEach((nt, k) => tri(arp, b(beat) + k * 0.01, b(3.8) - b(0), NOTE(nt) - 12, beat < C.raise ? 0.35 : 0.22, (k - 1) * 0.3));
  // bass from the phone onwards
  for (let beat = C.raise; beat < 22; beat += 1) { const m = NOTE(roots[Math.floor(beat / 4) % 4]); tri(bassB, b(beat), b(0.42) - b(0), m, 1); tri(bassB, b(beat + 0.5), b(0.3) - b(0), m + 12, 0.7); }
  // drums: hats from the phone, full kit after the recovery
  for (let beat = C.raise; beat < C.endcard; beat += 0.5) hat(drumsB, b(beat), beat >= C.up ? 0.7 : 0.4, r);
  for (let beat = C.up; beat < C.endcard; beat += 1) { kick(drumsB, b(beat), 0.75, 160, 50); if (beat % 2 === 1) snare(drumsB, b(beat), 0.7, r); }
  for (const x of [C.up - 0.5, C.up - 0.25]) snare(drumsB, b(x), 0.5, r);
  // the hiss riser while the bag bleeds
  noiseSweep(fx, b(C.hiss[0]), b(C.hiss[1]) - b(C.hiss[0]), 1800, 9000, 0.22, r, 3, 'hp');
  for (let beat = C.hiss[0]; beat < C.hiss[1]; beat += 0.125) pulse(fx, b(beat), 0.04, NOTE('D5') + Math.floor((beat - C.hiss[0]) * 4), 0.14, 0.5);
  // sfx
  tap(sfx, b(C.tap), 1, r); pulse(sfx, b(C.tap) + 0.01, 0.06, NOTE('A5'), 0.8, 0.5); pulse(sfx, b(C.tap) + 0.07, 0.08, NOTE('D6'), 0.8, 0.5);
  buzz(sfx, b(C.dip), 0.8); pulse(sfx, b(C.dip), 0.45, NOTE('A4'), 0.7, 0.5, 0, NOTE('D3'));
  ['C5', 'E5', 'G5', 'C6'].forEach((nt, i) => pulse(sfx, b(C.ach) + i * 0.07, 0.14, NOTE(nt), 0.9, 0.5)); // achievement jingle
  tap(sfx, b(C.sell), 1, r);
  // MISSION PASSED: a major stab and a coin pickup
  ['D4', 'F#4', 'A4', 'D5'].forEach((nt) => pulse(sfx, b(C.passed), b(1.5) - b(0), NOTE(nt), 0.6, 0.25));
  pulse(sfx, b(C.passed), 0.08, NOTE('B5'), 1, 0.5); pulse(sfx, b(C.passed) + 0.08, 0.5, NOTE('E6'), 1, 0.5);
  whoosh(sfx, b(C.endcard) - 0.1, 0.4, 0.2, r, false);
  delay(arp, b(0.75) - b(0), 0.38, 0.32); reverb(arp, 0.22, 0.85); reverb(sfx, 0.15); reverb(fx, 0.2);
  const envDb = (t) => 2.5 + (t < b(C.raise) ? -2 : t < b(C.up) ? -1 : t < b(C.endcard) ? 0 : -1 - 4 * ((t - b(C.endcard)) / (dur('blocky') - b(C.endcard))));
  return master([[arp, 0.9], [bassB, 0.85], [drumsB, 0.9], [fx, 0.8], [sfx, 0.85]], n, envDb, -3); // square waves overshoot between samples after AAC
}

// ================= GAMES (drum & bass, 172) =================
function sawStack(bus, t0, len, midis, gain, cutoff, pan = 0, decay = 9) {
  const n = Math.round((len + 0.3) * SR), i0 = Math.round(t0 * SR), buf = new Float32Array(n);
  for (const m of midis) for (const det of [-0.08, 0.08]) {
    const f = mtof(m + det), dt = f / SR; let ph = Math.random();
    for (let i = 0; i < n; i++) { ph += dt; if (ph >= 1) ph -= 1; buf[i] += (2 * ph - 1 - blep(ph, dt)) * 0.5; }
  }
  sweepFilter(buf, 'lp', (t) => cutoff * (0.35 + 0.65 * Math.exp(-t * 6)), 1.1);
  for (let i = 0; i < n; i++) { const t = i / SR; add(bus, i0 + i, buf[i] * Math.exp(-t * decay) * Math.min(1, t / 0.003) * gain * 0.09, pan); }
}
function games() {
  const C = STORIES.games.cues, b = (x) => sec('games', x), n = Math.round((dur('games') + 0.05) * SR);
  const r = rng(172);
  const drums = new Bus(n), bass = new Bus(n), stabs = new Bus(n), fx = new Bus(n), sfx = new Bus(n), drone = new Bus(n);
  const roots = ['F2', 'F2', 'Db2', 'Eb2', 'F2', 'F2', 'C2', 'Eb2', 'F2', 'Db2']; // per bar (4 beats)
  const rootAt = (beat) => NOTE(roots[Math.floor(beat / 4) % roots.length]);
  // two-step breaks: kick 0 + 10, snare 4 + 12, ghosts, 8th hats, 16th shaker
  const breaks = (from, to, g = 1) => {
    for (let beat = Math.floor(from / 4) * 4; beat < to; beat += 4) for (let st = 0; st < 16; st++) {
      const bt = beat + st / 4; if (bt < from || bt >= to) continue;
      const t = b(bt);
      if (st === 0 || st === 10) kick(drums, t, st === 0 ? 1.05 * g : 0.9 * g, 150, 46);
      if (st === 4 || st === 12) { snare(drums, t, 1.0 * g, r); clap(drums, t + 0.003, 0.35 * g, r); }
      if ((st === 7 || st === 9 || st === 15) && r() < 0.8) snare(drums, t, 0.22 * g, r);
      if (st % 2 === 0) hat(drums, t, (st % 4 === 2 ? 0.8 : 0.45) * g, r);
      else hat(drums, t, 0.18 * g, r);
      if (st === 14) hat(drums, t, 0.35 * g, r, true);
    }
  };
  // reese: detuned saws through a moving low-pass, a sine sub underneath
  const reese = (from, to, g = 1, subOnly = false) => {
    const t0 = b(from), len = b(to) - t0, N = Math.round(len * SR), i0 = Math.round(t0 * SR), buf = new Float32Array(N);
    let p1 = 0, p2 = 0, p3 = 0, ps = 0;
    for (let i = 0; i < N; i++) {
      const t = t0 + i / SR, beat = t / sec('games', 1), m = rootAt(beat);
      const f = mtof(m), d1 = mtof(m - 0.16) / SR, d2 = mtof(m + 0.16) / SR, d3 = f * 2.003 / SR;
      p1 = (p1 + d1) % 1; p2 = (p2 + d2) % 1; p3 = (p3 + d3) % 1; ps += TAU * (f / 2) / SR;
      const saw = subOnly ? 0 : (2 * p1 - 1) + (2 * p2 - 1) + 0.35 * (2 * p3 - 1);
      buf[i] = saw * 0.33;
      add(bass, i0 + i, Math.sin(ps) * 0.42 * g);
    }
    if (!subOnly) {
      sweepFilter(buf, 'lp', (u) => { const beat = (t0 + u) / sec('games', 1); return 260 + 900 * (0.5 + 0.5 * Math.sin(beat * Math.PI)); }, 2.2);
      for (let i = 0; i < N; i++) add(bass, i0 + i, Math.tanh(buf[i] * 2.4) * 0.3 * g, Math.sin(i / SR * 1.7) * 0.2);
    }
  };
  // intro: a hit on frame 0, filtered breaks, a riser into the drop
  kick(drums, 0.0, 1.1, 150, 44); sawStack(stabs, 0.0, 0.5, [NOTE('F3'), NOTE('Ab3'), NOTE('C4'), NOTE('Eb4'), NOTE('G4')], 1.1, 3500);
  breaks(0.5, 4, 0.8);
  whoosh(fx, b(1.5), b(4) - b(1.5), 0.35, r, true);
  // the drop + montage: a stab and an impact on every cut, a swoosh as the hand swaps phones
  breaks(4, 17); reese(4, 14); reese(14, 17, 0.9, true);
  for (const cut of [4, 6, 8, 10, 12, 14]) {
    sawStack(stabs, b(cut), 0.35, [NOTE('F3'), NOTE('Ab3'), NOTE('C4'), NOTE('Eb4')].map((m) => m + (cut % 4 === 2 ? -2 : 0)), 1, 4200);
    crash(drums, b(cut), cut === 4 ? 0.9 : 0.35, r);
    whoosh(sfx, b(cut) - 0.16, 0.18, 0.28, r, true);
  }
  // blocky: buy tap + coin sparkle
  tap(sfx, b(C.tap), 1.1, r);
  [2637, 3136, 3951, 4699].forEach((f, i) => { const i0 = Math.round((b(C.tap) + 0.02 + i * 0.035) * SR); let ph = 0; for (let k = 0; k < 0.25 * SR; k++) { ph += TAU * f / SR; add(sfx, i0 + k, Math.sin(ph) * Math.exp(-k / SR * 16) * 0.12, (i - 1.5) * 0.3); } });
  // the rug: stamp thud, ringtone, tape stop, WASTED
  noiseSweep(sfx, b(C.rugstamp), 0.12, 600, 200, 0.5, r, 1, 'lp'); kick(sfx, b(C.rugstamp), 0.55, 140, 60);
  ringtone(sfx, b(C.ring), b(C.wasted) - 0.05, 1.1);
  boom(sfx, b(C.wasted), 1.3, r);
  noiseSweep(sfx, b(C.wasted), 0.5, 3000, 200, 0.35, r, 0.8, 'lp');
  for (const nt of ['F1', 'C2', 'F2']) { const i0 = Math.round(b(18) * SR), len = b(22) - b(18); let ph = 0; for (let i = 0; i < len * SR; i++) { const t = i / SR; ph += TAU * mtof(NOTE(nt)) / SR; add(drone, i0 + i, Math.sin(ph) * 0.08 * Math.min(1, t / 0.5)); } }
  kick(drums, b(20), 0.5, 90, 38); kick(drums, b(20.4), 0.38, 90, 38);
  whoosh(fx, b(20.5), b(22) - b(20.5), 0.4, r, true);
  for (let k = 0; k < 8; k++) snare(drums, b(21 + k / 8), 0.18 + k * 0.06, r); // roll into the re-entry
  // re-entry (toon): full energy, sell, MISSION PASSED
  breaks(22, 30); reese(22, 30, 1.05);
  crash(drums, b(22), 1, r);
  sawStack(stabs, b(22), 0.5, [NOTE('F3'), NOTE('Ab3'), NOTE('C4'), NOTE('Eb4'), NOTE('G4')], 1.1, 4800);
  tap(sfx, b(C.sell), 1.1, r);
  cashRegister(sfx, b(C.passed), 1.5, r);
  sawStack(stabs, b(C.passed), 0.9, [NOTE('F3'), NOTE('A3'), NOTE('C4'), NOTE('E4'), NOTE('G4')], 1.1, 6000, 0, 4); // a major lift for the win
  // end card: one last hit and the tail
  kick(drums, b(30), 1.05, 150, 44); crash(drums, b(30), 0.8, r);
  sawStack(stabs, b(30), 1.6, [NOTE('F3'), NOTE('Ab3'), NOTE('C4'), NOTE('Eb4'), NOTE('G4'), NOTE('C5')], 1.2, 3000, 0, 2.2);
  sawStack(stabs, b(30) + 0.05, b(37) - b(30), [NOTE('F2'), NOTE('C3'), NOTE('Ab3'), NOTE('Eb4')], 0.75, 1800, 0, 0.45); // a pad under the end card
  for (const nt of ['F1', 'F2']) { const i0 = Math.round(b(30) * SR), len = b(37) - b(30); let ph = 0; for (let i = 0; i < len * SR; i++) { ph += TAU * mtof(NOTE(nt)) / SR; add(drone, i0 + i, Math.sin(ph) * 0.07 * (1 - i / (len * SR)) * Math.min(1, i / (0.2 * SR))); } }
  whoosh(sfx, b(C.endcard) - 0.15, 0.4, 0.2, r, false);
  // intro filter, rooms
  sweepFilter(drums.L, 'lp', (t) => (t < b(4) ? 900 + 14000 * Math.pow(t / b(4), 2.5) : 16000)); sweepFilter(drums.R, 'lp', (t) => (t < b(4) ? 900 + 14000 * Math.pow(t / b(4), 2.5) : 16000));
  reverb(stabs, 0.3, 0.86); reverb(drums, 0.08, 0.7); reverb(drone, 0.4, 0.88); reverb(sfx, 0.16, 0.8);
  // music bus + tape stop into WASTED, silence until the roll
  const music = new Bus(n);
  for (const [bus, g] of [[drums, 1], [bass, 0.9], [stabs, 0.8]]) for (let i = 0; i < n; i++) { music.L[i] += bus.L[i] * g; music.R[i] += bus.R[i] * g; }
  const A = b(C.tapestop), T = b(C.wasted) - A, iA = Math.round(A * SR), iB = Math.round(b(C.wasted) * SR);
  const sL = music.L.slice(iA, iA + Math.round(T * SR)), sR = music.R.slice(iA, iA + Math.round(T * SR));
  for (let i = iA; i < iB; i++) { const tau = (i - iA) / SR, pos = (tau - tau * tau / (2 * T)) * SR, j = Math.floor(pos), f = pos - j, fade = 1 - Math.pow(tau / T, 3); music.L[i] = ((sL[j] || 0) * (1 - f) + (sL[j + 1] || 0) * f) * fade; music.R[i] = ((sR[j] || 0) * (1 - f) + (sR[j + 1] || 0) * f) * fade; }
  const i20 = Math.round(b(19.9) * SR), i22 = Math.round(b(22) * SR);
  for (let i = iB; i < i20; i++) { music.L[i] = 0; music.R[i] = 0; }
  const envDb = (t) => (t < b(4) ? -3 : t < b(14) ? 0 : t < b(C.wasted) ? -1 : t < b(22) ? -2 : t < b(C.endcard) ? 0.3 : -0.5 - 2 * ((t - b(C.endcard)) / (dur('games') - b(C.endcard))));
  void i22;
  return master([[music, 0.82], [fx, 0.8], [sfx, 0.9], [drone, 1]], n, envDb, -1.5);
}

// ================= ANY (club, 128) =================
// "type any amount": four on the floor, an offbeat sub, chord stabs; the keypad section pulls back so every digit is
// a pluck on the 8ths; the buy is the drop; the pixel act adds square arps; the montage hits every cut.
function any() {
  const C = STORIES.any.cues, b = (x) => sec('any', x), n = Math.round((dur('any') + 0.05) * SR);
  const r = rng(128);
  const drums = new Bus(n), bass = new Bus(n), chords = new Bus(n), chip = new Bus(n), fx = new Bus(n), sfx = new Bus(n), pad = new Bus(n);
  const prog = [['A3', 'C4', 'E4', 'G4'], ['F3', 'A3', 'C4', 'E4'], ['C4', 'E4', 'G4', 'B4'], ['G3', 'B3', 'D4', 'A4']]; // Am7 Fmaj7 Cmaj7 Gadd9
  const roots = ['A1', 'F1', 'C2', 'G1'];
  const bar = (beat) => Math.floor(beat / 4) % 4;
  const groove = (from, to, g = 1, sparse = false) => {
    for (let q = Math.ceil(from * 4); q < to * 4; q++) {
      const beat = q / 4, t = b(beat), st = q % 16, k = q % 4;
      if (k === 0) kick(drums, t, 1.0 * g, 130, 44);
      if (!sparse && (st === 4 || st === 12)) { clap(drums, t, 0.9 * g, r); snare(drums, t, 0.32 * g, r); }
      if (k === 2) hat(drums, t, (sparse ? 0.4 : 0.6) * g, r, true);
      else if (!sparse) hat(drums, t, (k === 0 ? 0.22 : 0.34) * g, r);
    }
  };
  const bassline = (from, to, g = 1) => { for (let beat = Math.ceil(from); beat < to; beat++) sub(bass, b(beat + 0.5), b(0.4) - b(0), NOTE(roots[bar(beat)]) + 12, g); };
  const stabs = (from, to, g = 1) => {
    for (let beat = Math.ceil(from / 4) * 4; beat < to; beat += 4) for (const o of [0, 1.5, 2.5]) {
      if (beat + o < from || beat + o >= to) continue;
      sawStack(chords, b(beat + o), b(0.3) - b(0), prog[bar(beat)].map(NOTE), (o === 0 ? 1 : 0.7) * g, 3800, 0, 11);
    }
  };
  const arps = (from, to, g = 1) => {
    for (let q = Math.ceil(from * 4); q < to * 4; q++) {
      const beat = q / 4, ch = prog[bar(beat)], k = q % 8;
      pulse(chip, b(beat), b(0.2) - b(0), NOTE(ch[[0, 1, 2, 3, 2, 1, 2, 3][k]]) + 12, 0.75 * g, 0.25, k % 2 ? 0.35 : -0.35);
    }
  };
  const pluck = (t, note, g = 1, square = false) => {
    if (square) pulse(sfx, t, 0.11, NOTE(note), 1.05 * g, 0.5);
    else { tri(sfx, t, 0.12, NOTE(note), 1.1 * g); pulse(sfx, t, 0.05, NOTE(note) + 12, 0.45 * g, 0.5); }
    tap(sfx, t, 0.55 * g, r);
  };
  const sparkle = (t, g = 1) => [2637, 3136, 3951, 4699].forEach((f, i) => { const i0 = Math.round((t + i * 0.035) * SR); let ph = 0; for (let k = 0; k < 0.25 * SR; k++) { ph += TAU * f / SR; add(sfx, i0 + k, Math.sin(ph) * Math.exp(-k / SR * 16) * 0.12 * g, (i - 1.5) * 0.3); } });
  const roll = (from, to, g = 1) => { const N = Math.round((to - from) * 4); for (let k = 0; k < N; k++) snare(drums, b(from + k / 4), (0.15 + (k / N) * 0.55) * g, r); };

  // ---- act 1 (city): a hit on frame 0, the groove under the copycats ----
  kick(drums, 0.0, 1.15, 140, 42); crash(drums, 0.0, 0.8, r);
  sawStack(chords, 0.0, 0.6, prog[0].map(NOTE), 1.15, 4200, 0, 5);
  groove(0.5, C.sizetap); bassline(1, C.sizetap); stabs(1, C.sizetap, 0.85);
  // the keypad: kick + open hats only, a low pad, every digit a pluck on the 8ths
  tap(sfx, b(C.sizetap), 1.1, r); whoosh(sfx, b(C.sizetap) + 0.02, 0.22, 0.18, r, true);
  groove(C.sizetap, C.go + 0.5, 0.8, true);
  sawStack(pad, b(C.sizetap), b(C.buy) - b(C.sizetap), ['A2', 'E3', 'C4', 'G4'].map(NOTE), 0.7, 1400, 0, 0.6);
  C.keys.forEach((kb, i) => pluck(b(kb), ['A5', 'C6', 'E6', 'A6'][i]));
  tap(sfx, b(C.go), 1.1, r); pulse(sfx, b(C.go) + 0.01, 0.06, NOTE('E6'), 0.8, 0.5); pulse(sfx, b(C.go) + 0.07, 0.1, NOTE('A6'), 0.8, 0.5);
  noiseSweep(fx, b(C.go), b(C.buy) - b(C.go), 600, 9000, 0.3, r, 1.4);
  roll(C.go + 0.5, C.buy, 0.9);
  // ---- the buy is the drop ----
  tap(sfx, b(C.buy), 1.2, r); sparkle(b(C.buy) + 0.02, 1.1);
  crash(drums, b(C.buy), 0.95, r); sawStack(chords, b(C.buy), 0.5, prog[0].map(NOTE), 1.2, 5200, 0, 5);
  groove(C.buy, C.cut2 - 0.25); bassline(C.buy, C.cut2); stabs(C.buy + 0.5, C.cut2);
  buzz(sfx, b(C.run), 0.75); ['A6', 'C7', 'E7'].forEach((nt, i) => pulse(sfx, b(C.run) + 0.05 + i * 0.06, 0.08, NOTE(nt), 0.7, 0.5));
  whoosh(fx, b(C.cut2) - 0.4, 0.4, 0.4, r, true);
  // ---- act 2 (pixel phone): square arps join; any %, 5 0, sell, MISSION PASSED ----
  crash(drums, b(C.cut2), 0.85, r); kick(drums, b(C.cut2), 1.1, 140, 42);
  groove(C.cut2, C.anytap + 0.75); bassline(C.cut2, C.anytap + 0.75); arps(C.cut2, C.go2 + 0.5, 0.9);
  tap(sfx, b(C.anytap), 1.1, r); whoosh(sfx, b(C.anytap) + 0.02, 0.22, 0.18, r, true);
  groove(C.anytap + 0.75, C.go2 + 0.5, 0.8, true);
  C.keys2.forEach((kb, i) => pluck(b(kb), ['E6', 'A6'][i], 1, true));
  tap(sfx, b(C.go2), 1.1, r); pulse(sfx, b(C.go2), 0.07, NOTE('A5'), 0.9, 0.5); pulse(sfx, b(C.go2) + 0.08, 0.1, NOTE('E6'), 0.9, 0.5);
  noiseSweep(fx, b(C.go2), b(C.passed) - b(C.go2), 700, 9000, 0.3, r, 1.4);
  roll(C.go2 + 0.5, C.passed, 1);
  cashRegister(sfx, b(C.passed), 1.4, r);
  ['A4', 'C#5', 'E5', 'A5'].forEach((nt) => pulse(sfx, b(C.passed), b(1.5) - b(0), NOTE(nt), 0.55, 0.25)); // the pixel win chord
  pulse(sfx, b(C.passed), 0.08, NOTE('B5'), 1, 0.5); pulse(sfx, b(C.passed) + 0.08, 0.5, NOTE('E6'), 1, 0.5);
  crash(drums, b(C.passed), 0.9, r);
  sawStack(chords, b(C.passed), 0.8, ['A3', 'C#4', 'E4', 'A4'].map(NOTE), 1.05, 6000, 0, 3.5);
  groove(C.passed, C.endcard); bassline(C.passed, C.endcard); arps(C.passed, C.cut3, 1); stabs(C.passed + 0.5, C.endcard, 0.9);
  // ---- the montage: a stab, a crash and a whoosh on every cut ----
  for (let cut = C.cut3; cut < C.endcard; cut++) {
    whoosh(sfx, b(cut) - 0.15, 0.16, 0.26, r, true);
    crash(drums, b(cut), cut === C.cut3 ? 0.8 : 0.4, r);
    sawStack(chords, b(cut), 0.32, prog[bar(cut)].map((m) => NOTE(m) + (cut % 2 ? 0 : 12)), 1, 4800, 0, 9);
  }
  roll(C.endcard - 1, C.endcard, 0.8);
  // ---- the end card: one big hit, a pad under the words, the button press ----
  kick(drums, b(C.endcard), 1.2, 140, 40); boom(sfx, b(C.endcard), 0.75, r); crash(drums, b(C.endcard), 0.95, r);
  sawStack(chords, b(C.endcard), 1.4, ['A3', 'C4', 'E4', 'G4', 'B4', 'E5'].map(NOTE), 1.2, 3600, 0, 2.2);
  sawStack(pad, b(C.endcard) + 0.05, dur('any') - b(C.endcard), ['A2', 'E3', 'C4', 'G4'].map(NOTE), 0.85, 1700, 0, 0.42);
  whoosh(sfx, b(C.endcard) - 0.18, 0.4, 0.22, r, false);
  const press = b(C.endcard) + 1.45; tap(sfx, press, 1.2, r); sparkle(press + 0.02, 0.8);
  // rooms, glue
  reverb(chords, 0.26, 0.84); reverb(chip, 0.18, 0.8); delay(chip, b(0.75) - b(0), 0.3, 0.22); reverb(pad, 0.4, 0.88); reverb(sfx, 0.14, 0.78); reverb(drums, 0.06, 0.7);
  // the intro opens up from a low-pass
  const open = (t) => (t < b(1) ? 700 + 15300 * Math.pow(t / b(1), 2) : 16000);
  sweepFilter(chords.L, 'lp', open); sweepFilter(chords.R, 'lp', open);
  const envDb = (t) => (t < b(C.sizetap) ? 0 : t < b(C.buy) ? -1.5 : t < b(C.endcard) ? 0.5 : -0.5 - 2.5 * ((t - b(C.endcard)) / (dur('any') - b(C.endcard))));
  return master([[drums, 0.95], [bass, 0.9], [chords, 0.75], [chip, 0.7], [pad, 0.8], [fx, 0.75], [sfx, 0.95]], n, envDb, -1.5);
}

export function renderScore(story, path) {
  const [L, R] = story === 'blocky' ? blocky() : story === 'games' ? games() : story === 'any' ? any() : city();
  writeWav(path, L, R);
  return path;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const story = process.argv[2] || 'city';
  const out = process.argv[3] || `teaser-${story}.wav`;
  const t0 = Date.now();
  renderScore(story, out);
  console.log('wrote', out, (Date.now() - t0) + 'ms');
}
