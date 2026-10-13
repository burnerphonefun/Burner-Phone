// The BurnerPhone mark, as on the X profile picture (x.com/burnerphonefun): an orange outline phone with side keys and
// the island, an up-and-to-the-right chart arrow on its screen, on black. Drawn on the picture's own 400 grid
// (measured from it), so every use (favicon, site, app icon, link preview, logo kit, banners) is the same shape.
export const ORANGE = '#FF5A1F', KEYS = '#B83A0E', ISLAND = '#1B1715', BLACK = '#000000';

// bold = heavier lines for tiny sizes (favicon, tray), where the picture's 16 px outline would go faint
export function markInner({ bold = false, island = true } = {}) {
  const sw = bold ? 24 : 16, aw = bold ? 20 : 13;
  const line = `fill="none" stroke="${ORANGE}" stroke-width="${aw}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<rect x="113" y="125" width="10" height="25" rx="3" fill="${KEYS}"/><rect x="113" y="162" width="10" height="25" rx="3" fill="${KEYS}"/>
    <rect x="277" y="137" width="10" height="36" rx="3" fill="${KEYS}"/>
    <rect x="127" y="66" width="146" height="268" rx="26" fill="none" stroke="${ORANGE}" stroke-width="${sw}"/>
    ${island ? `<rect x="182" y="88" width="36" height="10" rx="5" fill="${ISLAND}"/>` : ''}
    <polyline points="158,234 186,206 202,222 242,168" ${line}/><polyline points="216,167 243,166 243,193" ${line}/>`;
}

// the mark alone, square, transparent (crop = how tight around the phone: 1 = the picture's framing)
export function markSvg({ bold = false, crop = 1, island = true } = {}) {
  const s = 400 * crop, o = (400 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o} ${o} ${s} ${s}">${markInner({ bold, island })}</svg>`;
}

// the mark on black, like the profile picture (radius: 0 = square, 0.5 = circle)
export function tileSvg({ bold = false, crop = 1, radius = 0.22, island = true } = {}) {
  const s = 400 * crop, o = (400 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o} ${o} ${s} ${s}"><rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${s * radius}" fill="${BLACK}"/>${markInner({ bold, island })}</svg>`;
}

// the X logo, for links to the account
export const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
export const X_URL = 'https://x.com/burnerphonefun';
