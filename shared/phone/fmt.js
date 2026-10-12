// number + text formatting shared by every screen

export function usd(n) {
  if (n == null || !isFinite(n)) return '–';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a < 1000) return s + '$' + Math.round(a);
  if (a < 1e5) return s + '$' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  if (a < 1e6) return s + '$' + Math.round(a / 1e3) + 'K';
  if (a < 1e9) return s + '$' + (a / 1e6).toFixed(a < 1e7 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
  return s + '$' + (a / 1e9).toFixed(2) + 'B';
}

export function money(n) { // the HUD cash counter: $1,204,330
  if (n == null || !isFinite(n)) return '$0';
  return (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
}

export function sol(n, sign = false) {
  if (n == null || !isFinite(n)) return '–';
  const a = Math.abs(n);
  const d = a >= 100 ? 1 : a >= 0.1 || a === 0 ? 2 : 3;
  const t = a.toFixed(d);
  return (n < 0 ? '-' : sign ? '+' : '') + t;
}

export function pct(x, sign = true) { // x = 0.42 -> +42%
  if (x == null || !isFinite(x)) return '–';
  const v = x * 100, a = Math.abs(v);
  const t = a >= 1000 ? Math.round(a).toLocaleString('en-US') : a >= 10 ? Math.round(a) + '' : a.toFixed(1).replace(/\.0$/, '');
  return (v < 0 ? '-' : sign && v > 0 ? '+' : '') + t + '%';
}

export function mult(x) { return (x >= 10 ? Math.round(x) : x.toFixed(x >= 2 ? 1 : 2)) + 'x'; }

export function age(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

// coins put "$" in their own symbols; one helper everywhere (LESSONS)
export function tick(sym) {
  const s = String(sym || '').trim();
  let i = 0;
  while (s[i] === '$') i++;
  return '$' + (s.slice(i) || '???');
}

export function clock(d = new Date()) {
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function dateLine(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();
}

export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// tiny DOM helper: el('div.a.b', {text, html, on:{click}}, ...children)
export function el(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const e = document.createElement(tag || 'div');
  if (cls.length) e.className = cls.join(' ');
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
      else if (k === 'style') Object.assign(e.style, v);
      else if (k === 'data') Object.assign(e.dataset, v);
      else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

// write text only when it changed: identical textContent writes still replace the text node and restyle
export function setText(node, t) { t = String(t ?? ''); if (node && node.textContent !== t) node.textContent = t; }
