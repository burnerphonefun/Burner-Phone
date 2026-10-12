// Synthesized phone sounds (no files). The AudioContext starts only after a click/key (LESSONS).
let ctx = null, master = null, muted = false;

export function initSound(startMuted = false) {
  try { muted = localStorage.getItem('burner.mute') === '1' || startMuted; } catch { muted = startMuted; }
  const unlock = () => {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
      } catch { ctx = null; }
    }
    ctx?.resume?.();
  };
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });
}
export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('burner.mute', m ? '1' : '0'); } catch {}
  if (master) master.gain.value = m ? 0 : 0.5;
}

function ok() { return ctx && ctx.state === 'running' && !muted; }
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function osc(type, f, t, dur, peak, dest = master) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  env(g, t, 0.005, peak, dur); o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}
function noise(t, dur, peak, freq = 2000, q = 1, type = 'bandpass') {
  const len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  env(g, t, 0.003, peak, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t);
}

export const sfx = {
  tap() { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.03, 0.18, 3800, 2); osc('sine', 1200, t, 0.03, 0.05); },
  buzz() { // two short motor buzzes
    if (!ok()) return; const t = ctx.currentTime;
    for (const dt of [0, 0.16]) { const o = osc('sawtooth', 150, t + dt, 0.11, 0.08); const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 38; lg.gain.value = 40; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t + dt); lfo.stop(t + dt + 0.15); }
  },
  buy() { if (!ok()) return; const t = ctx.currentTime; osc('triangle', 660, t, 0.08, 0.12); osc('triangle', 990, t + 0.06, 0.12, 0.1); },
  sell() { if (!ok()) return; const t = ctx.currentTime; osc('triangle', 880, t, 0.08, 0.1); osc('triangle', 587, t + 0.07, 0.14, 0.1); },
  ring() { // an old-school two-tone ring, ~1.6 s
    if (!ok()) return; const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 8; j++) { const tt = t + i * 0.8 + j * 0.05; osc('square', j % 2 ? 1400 : 1100, tt, 0.045, 0.035); }
  },
  wasted() { // low hit + falling sub + air
    if (!ok()) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.4);
    env(g, t, 0.01, 0.6, 1.6); o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.8);
    noise(t, 0.5, 0.25, 400, 0.7, 'lowpass'); noise(t + 0.02, 1.2, 0.05, 1200, 0.5);
  },
  cash() { // register: drawer chunk + bell
    if (!ok()) return; const t = ctx.currentTime;
    noise(t, 0.08, 0.3, 900, 1.2); noise(t + 0.09, 0.05, 0.2, 2400, 2);
    for (const [f, d] of [[2093, 0], [2637, 0.11], [3136, 0.22]]) { osc('sine', f, t + 0.12 + d, 0.9, 0.12); osc('sine', f * 2.01, t + 0.12 + d, 0.4, 0.03); }
  },
  achieve() { if (!ok()) return; const t = ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => osc('square', f, t + i * 0.07, 0.12, 0.05)); },
  shutter() { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.04, 0.35, 5000, 1); noise(t + 0.07, 0.06, 0.25, 3000, 1); },
  swoosh() { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.22, 0.06, 1800, 0.6); },
};
