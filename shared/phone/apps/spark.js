// A sparkline built once per host node, then patched (two paths, no rebuild per tick).
export function spark(host, pts, { w = 300, h = 40, base = null } = {}) {
  let svg = host._svg;
  if (!svg) {
    host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="bp-spark"><path class="bp-spark-a"/><path class="bp-spark-l"/><line class="bp-spark-b" x1="0" x2="${w}"/></svg>`;
    svg = host._svg = host.firstChild;
    host._w = w; host._h = h;
  }
  const area = svg.children[0], line = svg.children[1], bl = svg.children[2];
  if (!pts || pts.length < 2) { line.setAttribute('d', ''); area.setAttribute('d', ''); bl.style.display = 'none'; host.dataset.dir = ''; return; }
  const n = pts.length;
  const step = Math.max(1, Math.floor(n / 90)); // ≤ ~90 points per line
  const use = [];
  for (let i = 0; i < n; i += step) use.push(pts[i]);
  if (use[use.length - 1] !== pts[n - 1]) use.push(pts[n - 1]);
  let lo = Infinity, hi = -Infinity;
  for (const [, v] of use) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (base != null) { lo = Math.min(lo, base); hi = Math.max(hi, base); }
  // log scale: memecoins move in multiples
  const L = (v) => Math.log(Math.max(v, 1e-18));
  const a = L(lo), b = L(hi), span = b - a || 1;
  const t0 = use[0][0], t1 = use[use.length - 1][0], ts = t1 - t0 || 1;
  const pad = 3;
  const X = (t) => ((t - t0) / ts) * w;
  const Y = (v) => pad + (1 - (L(v) - a) / span) * (h - pad * 2);
  let d = '';
  for (let i = 0; i < use.length; i++) d += (i ? 'L' : 'M') + X(use[i][0]).toFixed(1) + ' ' + Y(use[i][1]).toFixed(1);
  line.setAttribute('d', d);
  area.setAttribute('d', d + `L${w} ${h}L0 ${h}Z`);
  const ref = base ?? use[0][1];
  host.dataset.dir = use[use.length - 1][1] >= ref ? 'up' : 'dn';
  if (base != null) { bl.style.display = ''; const y = Y(base).toFixed(1); bl.setAttribute('y1', y); bl.setAttribute('y2', y); } else bl.style.display = 'none';
}
