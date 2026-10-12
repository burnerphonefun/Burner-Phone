// Camera: a viewfinder of the game behind the phone; the shot gets your trade stamped on it,
// saved as a PNG and copied to the clipboard. The share loop.
import { el, tick, sol, usd, mult, pct } from '../fmt.js';
import { every } from '../motion.js';
import { sfx } from '../sound.js';
import { ic } from '../icons.js';
import { WORDS } from '../banners.js';

const OW = 1600, OH = 900; // the shared picture (16:9)

// each game stamps the shot in its own type: banner font, the line under it, colours, and how the big word is inked
const LOOK = {
  city: { head: '900 132px "Big Shoulders Display", Impact, sans-serif', body: 'Geist, system-ui, sans-serif', up: '#FFC23D', dn: '#E8233A', ink: '#FFF4E6', mark: '#FF5A1F', edge: '#0b0a09', ew: 10 },
  blocky: { head: '700 112px "Pixelify Sans", "Courier New", monospace', body: '"Pixelify Sans", "Courier New", monospace', up: '#FFFF55', dn: '#FF5555', ink: '#FFFFFF', mark: '#FFFF55', drop: '#3F3F15', dropDn: '#3F1515', px: 8 },
  toon: { head: '400 128px "Lilita One", "Arial Rounded MT Bold", sans-serif', body: 'Fredoka, system-ui, sans-serif', up: '#FFD23F', dn: '#FF4D6D', ink: '#FFFFFF', mark: '#FFD23F', edge: '#1a1033', ew: 16, lift: 9 },
  tactical: { head: '400 104px "Share Tech Mono", Consolas, monospace', body: '"Share Tech Mono", Consolas, monospace', up: '#9DFFBC', dn: '#FF5A4A', ink: '#E6FFE9', mark: '#9DFFBC', glow: 26, frame: true },
  obby: { head: '700 120px Fredoka, Nunito, system-ui, sans-serif', body: 'Fredoka, system-ui, sans-serif', up: '#FFD23F', dn: '#FF3B4F', ink: '#FFFFFF', mark: '#2F7BFF', edge: '#14286E', ew: 14, lift: 8, white: true },
  survival: { head: '700 124px Oswald, "Arial Narrow", sans-serif', body: 'Oswald, "Arial Narrow", sans-serif', up: '#FFCF7A', dn: '#D63A2A', ink: '#F4E6D2', mark: '#D8752B', edge: '#1a0d03', ew: 8, track: 6 },
};

export function cameraApp(ctx) {
  const { wallet, net } = ctx;
  const vf = el('canvas.bp-cam-vf');
  const stampPrev = el('div.bp-cam-stamp');
  const result = el('div.bp-cam-result');
  const modeBtn = el('button.bp-cam-side', { html: ic.flip, title: 'change stamp', on: { click: () => { sfx.tap(); mode = (mode + 1) % 3; paintStamp(); } } });
  const thumb = el('button.bp-cam-side.bp-cam-thumb', { title: 'last shot', on: { click: () => { if (lastUrl) showResult(lastUrl); } } });
  const shutter = el('button.bp-cam-shutter', { title: 'take the shot', on: { click: () => shoot() } });
  const close = el('button.bp-cam-close', { html: ic.x, on: { click: () => { sfx.tap(); ctx.back(); } } });
  const v = el('section.bp-camera', null, vf,
    el('div.bp-cam-top', null, close, el('span', { text: 'PHOTO' })),
    el('div.bp-cam-reticle'), stampPrev, result,
    el('div.bp-cam-bar', null, thumb, shutter, modeBtn));
  let stop = null, mode = 0, lastUrl = null, busy = false;

  function subject() {
    // 0: your last trade (or best bag), 1: best open bag, 2: the whole burner
    const last = wallet.state.hist[0];
    const best = wallet.bags()[0];
    if (mode === 0 && last && Date.now() - last.closed < 60 * 60e3) return { kind: 'trade', t: last };
    if ((mode === 0 || mode === 1) && best) return { kind: 'bag', b: best };
    if (mode === 0 && last) return { kind: 'trade', t: last };
    return { kind: 'worth' };
  }
  function words(s) {
    const [lost, won] = WORDS[ctx.skin?.()] || WORDS.city;
    if (s.kind === 'trade') {
      const t = s.t, known = t.got != null && t.cost != null, pnl = known ? t.got - t.cost : 0;
      const dead = t.rugged || (t.x != null && t.x < 0.35);
      return {
        banner: dead ? lost : t.x >= 2 ? won : pnl >= 0 ? 'SOLD' : 'CUT', tone: dead || pnl < 0 ? 'dn' : 'gold',
        big: tick(t.sym), line: [known ? (pnl >= 0 ? '+' : '') + sol(pnl) + ' SOL' : null, t.x != null ? mult(t.x) : null].filter(Boolean).join(' · '),
        sub: t.entryMc && t.exitMc ? 'in at ' + usd(t.entryMc) + ' → out at ' + usd(t.exitMc) : t.cost != null ? sol(t.cost) + ' SOL in' : '',
        mint: t.mint,
      };
    }
    if (s.kind === 'bag') {
      const b = s.b;
      return { banner: b.x >= 2 ? 'BAG UP ' + mult(b.x) : b.x >= 0.85 ? 'HOLDING' : 'DOWN BAD', tone: b.x >= 1 ? 'gold' : 'dn', big: tick(b.p.sym), line: (b.pnl >= 0 ? '+' : '') + sol(b.pnl) + ' SOL · ' + pct(b.x - 1), sub: 'in at ' + usd(b.p.entryMc) + ' · now ' + usd(b.mc), mint: b.p.mint };
    }
    const st = wallet.state.stats, w = wallet.worth();
    // paper starts at 10 SOL; a real wallet has no start line, so it goes by what's been realized
    const d = wallet.kind === 'real' ? st.realized || 0 : w - 10;
    return { banner: d >= 0 ? 'BURNER UP' : 'BURNER DOWN', tone: d >= 0 ? 'gold' : 'dn', big: sol(w) + ' SOL', line: (d >= 0 ? '+' : '') + sol(d) + ' SOL ' + (wallet.kind === 'real' ? 'realized' : 'all time'), sub: st.buys + ' buys · ' + (st.rugs || 0) + ' rugs', mint: null };
  }
  function paintStamp() {
    const w = words(subject());
    stampPrev.dataset.tone = w.tone;
    stampPrev.replaceChildren(el('b', { text: w.banner }), el('strong', { text: w.big }), el('span', { text: w.line }), el('small', { text: w.sub }));
  }

  let lastDraw = 0;
  function startFinder() {
    if (stop || !ctx.grab) return;
    const g = vf.getContext('2d');
    stop = every((dt, t) => {
      if (t - lastDraw < 110) return; // ~9 fps is plenty for a viewfinder
      lastDraw = t;
      const src = ctx.grab(480, 300);
      if (!src) return;
      const dpr = 1;
      if (vf.width !== 360 * dpr) { vf.width = 360 * dpr; vf.height = 780 * dpr; }
      cover(g, src, 0, 0, vf.width, vf.height);
    });
  }
  function stopFinder() { stop?.(); stop = null; }

  async function shoot() {
    if (busy) return;
    busy = true;
    sfx.shutter();
    ctx.shot?.();
    v.classList.remove('bp-cam-flash'); void v.offsetWidth; v.classList.add('bp-cam-flash');
    try {
      const src = await ctx.grab?.(OW, OH, true);
      const out = document.createElement('canvas'); out.width = OW; out.height = OH;
      const g = out.getContext('2d');
      if (src) cover(g, src, 0, 0, OW, OH); else { g.fillStyle = '#1a1118'; g.fillRect(0, 0, OW, OH); }
      await stamp(g, words(subject()));
      const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
      const url = URL.createObjectURL(blob);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      thumb.style.backgroundImage = `url(${url})`;
      let copied = false;
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; } catch {}
      const a = document.createElement('a'); a.href = url; a.download = 'burner-' + Date.now() + '.png'; document.body.append(a); a.click(); a.remove();
      showResult(url, copied);
      if (wallet.award('camera')) ctx.phone?.achieve('camera', 'Proof', 'stamped a trade on a screenshot');
    } catch (e) { console.error(e); ctx.say('shot failed', 'try again', 'dn'); }
    busy = false;
  }
  function showResult(url, copied) {
    result.replaceChildren(el('img', { src: url, alt: 'your shot' }), el('span', { text: copied === undefined ? 'last shot' : copied ? 'saved · copied, paste it anywhere' : 'saved to downloads' }),
      el('button', { text: 'back to camera', on: { click: () => result.classList.remove('bp-on') } }));
    result.classList.add('bp-on');
  }

  async function stamp(g, w) {
    const L = LOOK[ctx.skin?.()] || LOOK.city;
    const tone = w.tone === 'dn' ? L.dn : L.up;
    const grd = g.createLinearGradient(0, OH * 0.35, 0, OH);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, L.frame ? 'rgba(0,12,4,.8)' : 'rgba(0,0,0,.72)');
    g.fillStyle = grd; g.fillRect(0, 0, OW, OH);
    await Promise.all([L.head, '700 60px ' + L.body].map((f) => document.fonts?.load?.(f).catch(() => {})));
    const x = 80, by = OH - 300;
    g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    if ('letterSpacing' in g) g.letterSpacing = (L.track || 0) + 'px';
    // banner word, inked the way that game inks its own
    g.font = L.head;
    if (L.px) { g.fillStyle = w.tone === 'dn' ? L.dropDn : L.drop; g.fillText(w.banner, x + L.px, by + L.px); }
    if (L.lift) { g.fillStyle = L.edge; g.fillText(w.banner, x, by + L.lift); }
    if (L.white) { g.lineWidth = L.ew + 10; g.strokeStyle = '#fff'; g.strokeText(w.banner, x, by); }
    if (L.ew) { g.lineWidth = L.ew; g.strokeStyle = L.edge; g.strokeText(w.banner, x, by); }
    if (L.glow) { g.shadowColor = tone; g.shadowBlur = L.glow; }
    g.fillStyle = tone; g.fillText(w.banner, x, by);
    g.shadowBlur = 0;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    if (L.frame) {
      // a HUD bracket around the shot, like the PDA's own frame
      g.strokeStyle = L.up; g.globalAlpha = 0.7; g.lineWidth = 4;
      for (const [cx, cy, sx, sy] of [[40, 40, 1, 1], [OW - 40, 40, -1, 1], [40, OH - 40, 1, -1], [OW - 40, OH - 40, -1, -1]]) {
        g.beginPath(); g.moveTo(cx, cy + sy * 70); g.lineTo(cx, cy); g.lineTo(cx + sx * 70, cy); g.stroke();
      }
      g.globalAlpha = 1;
    }
    // pfp + ticker
    let tx = x;
    if (w.mint) {
      const img = await loadImg(net.img(w.mint));
      if (img) { g.save(); roundClip(g, x, OH - 262, 110, 110, L.px || L.frame ? 4 : 24); g.drawImage(img, x, OH - 262, 110, 110); g.restore(); tx = x + 134; }
    }
    const txt = (s, font, color, px, py) => {
      g.font = font;
      if (L.px) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillText(s, px + 5, py + 5); }
      else { g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 10; g.shadowOffsetY = 2; }
      g.fillStyle = color; g.fillText(s, px, py);
      g.shadowBlur = 0; g.shadowOffsetY = 0;
    };
    txt(w.big, '800 72px ' + L.body, L.ink, tx, OH - 196);
    txt(w.line, '700 52px ' + L.body, tone, tx, OH - 142);
    txt(w.sub, '500 30px ' + L.body, 'rgba(255,255,255,.8)', x, OH - 70);
    // watermark in the game's own display type
    g.textAlign = 'right';
    txt('BURNERPHONE', L.head.replace(/\d+px/, '44px'), L.mark, OW - 60, OH - 70);
    txt((wallet.kind === 'real' ? 'real SOL' : 'paper SOL') + ' · traded from inside the game', '500 22px ' + L.body, 'rgba(255,255,255,.7)', OW - 60, OH - 40);
    g.textAlign = 'left';
  }

  return {
    el: v,
    enter() { result.classList.remove('bp-on'); paintStamp(); startFinder(); },
    leave() { stopFinder(); },
    onWallet() { if (ctx.phone?.view() === 'camera') paintStamp(); },
  };
}

function cover(g, src, x, y, w, h) {
  const sw = src.width, sh = src.height;
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh);
  const cw = w / s, ch = h / s;
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
}
function roundClip(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.clip(); }
function loadImg(src) {
  return new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; setTimeout(() => res(null), 2500); });
}
