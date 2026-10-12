// One rAF loop for every spring and per-frame job. It sleeps (0 frames) when nothing moves:
// the overlay shares the GPU with a game (LESSONS: a loop that sleeps).

const springs = new Set();
const jobs = new Set();
let raf = 0, last = 0;

function frame(t) {
  const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000));
  last = t;
  for (const s of springs) if (s._step(dt)) springs.delete(s);
  for (const j of jobs) if (j(dt, t) === false) jobs.delete(j);
  raf = springs.size || jobs.size ? requestAnimationFrame(frame) : 0;
}
function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

// run fn(dt, t) every frame until it returns false (or the returned stop() is called)
export function every(fn) { jobs.add(fn); wake(); return () => jobs.delete(fn); }
export function busy() { return springs.size + jobs.size; }

export class Spring {
  constructor(value = 0, { k = 170, d = 26, eps = 0.0005, onUpdate } = {}) {
    this.v = value; this.to = value; this.vel = 0;
    this.k = k; this.d = d; this.eps = eps; this.onUpdate = onUpdate;
  }
  set(to, opts) {
    if (opts) { if (opts.k) this.k = opts.k; if (opts.d) this.d = opts.d; if (opts.vel != null) this.vel += opts.vel; }
    this.to = to;
    springs.add(this); wake();
    return this;
  }
  snap(v) { this.v = this.to = v; this.vel = 0; springs.delete(this); this.onUpdate?.(v, 0); }
  kick(vel) { this.vel += vel; springs.add(this); wake(); }
  _step(dt) {
    // semi-implicit Euler in small steps: stable for stiff springs
    const n = Math.ceil(dt / 0.008), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.v - this.to) - this.d * this.vel;
      this.vel += a * h; this.v += this.vel * h;
    }
    const done = Math.abs(this.v - this.to) < this.eps && Math.abs(this.vel) < this.eps * 10;
    if (done) { this.v = this.to; this.vel = 0; }
    this.onUpdate?.(this.v, this.vel);
    return done;
  }
}

// a number on screen that glides to new values instead of jumping (live prices, balances)
export class Ticker {
  constructor(node, format, { k = 120, d = 22 } = {}) {
    this.node = node; this.format = format; this.shown = '';
    this.s = new Spring(0, { k, d, eps: 1e-9, onUpdate: (v) => this._paint(v) });
    this.ready = false;
  }
  set(v) {
    if (v == null || !isFinite(v)) { this.ready = false; this._text('–'); return; }
    if (!this.ready) { this.ready = true; this.s.snap(v); return; }
    const rel = Math.abs(v - this.s.to) / (Math.abs(this.s.to) || 1);
    this.s.eps = Math.max(1e-12, Math.abs(v) * 1e-5);
    if (rel > 0) this.s.set(v);
  }
  _paint(v) { this._text(this.format(v)); }
  _text(t) { if (t !== this.shown) { this.shown = t; this.node.textContent = t; } }
}

export const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

// tween a value over ms with an ease, calling fn(v). Returns a promise.
export function tween(ms, fn, e = ease.out) {
  return new Promise((res) => {
    const t0 = performance.now();
    every((dt, t) => {
      const k = Math.min(1, (t - t0) / ms);
      fn(e(k), k);
      if (k >= 1) { res(); return false; }
    });
  });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
