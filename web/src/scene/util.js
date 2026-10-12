// Small helpers shared by the two worlds: seeded randomness, geometry baking, canvas textures.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// stateless hash -> 0..1, for things indexed by an integer (traffic car n, block b)
export function hash(...n) {
  let h = 2166136261;
  for (const v of n) { h = Math.imul(h ^ (v | 0), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// bake a transform + a flat colour into a geometry (non-indexed copy) so many parts merge into one draw
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function bake(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color, uvScale } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  if (uvScale && g.attributes.uv) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
  }
  if (color !== undefined) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

// merge baked parts; every part must have the same attribute set
export function merge(parts) {
  if (!parts.length) return null;
  const want = Object.keys(parts[0].attributes);
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (!want.includes(k)) p.deleteAttribute(k);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

export function canvasTex(w, h, draw, { nearest = false, repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  draw(x, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  else t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function disposeTree(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue; seen.add(m);
      for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap']) if (m[k] && !seen.has(m[k])) { seen.add(m[k]); m[k].dispose(); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture && !seen.has(u.value)) { seen.add(u.value); u.value.dispose(); }
      m.dispose();
    }
  });
}
