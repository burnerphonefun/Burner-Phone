// stroke icons drawn for burner (24x24), plus the app icon faces for the home screen
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ic = {
  pump: s('<path d="M12 3c1 3.5 5 5.2 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.7 2.3-4.6.2 1.6 1 2.6 2 3 0-3 .2-5.6.7-8.4z"/>'),
  chart: s('<path d="M7 4v16M17 4v16"/><rect x="5" y="8" width="4" height="7" rx="1"/><rect x="15" y="6" width="4" height="9" rx="1"/><path d="M12 6v12"/><rect x="10" y="10" width="4" height="5" rx="1"/>'),
  bags: s('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  wallet: s('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/>'),
  camera: s('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  back: s('<path d="M15 5l-7 7 7 7"/>'),
  bolt: s('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', 'stroke-width="1.8"'),
  sound: s('<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: s('<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9l5 6M21 9l-5 6"/>'),
  check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="2.6"'),
  flip: s('<path d="M4 7h13l-3-3M20 17H7l3 3"/>'),
  x: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  skull: s('<path d="M12 3a7 7 0 0 0-7 7c0 2.6 1.3 4.2 3 5v3h8v-3c1.7-.8 3-2.4 3-5a7 7 0 0 0-7-7z"/><circle cx="9.3" cy="10.5" r="1.4"/><circle cx="14.7" cy="10.5" r="1.4"/><path d="M10 18v3M14 18v3"/>'),
  up: s('<path d="M5 15l7-7 7 7"/>'),
};

export function signalSvg(bars) {
  let out = '<svg viewBox="0 0 18 12" class="bp-sig">';
  for (let i = 0; i < 4; i++) out += `<rect x="${i * 4.6}" y="${9 - i * 3}" width="3.2" height="${3 + i * 3}" rx="0.8" opacity="${i < bars ? 1 : 0.28}"/>`;
  return out + '</svg>';
}
