// Our own voxel world at night: a first-person walk past a cave mouth, torches and a ravine under a square moon.
// Procedural 16x16 textures, face-culled mesh with baked ambient occlusion. Pure in t.
import * as THREE from 'three';
import { mulberry, clamp, lerp, smooth, canvasTex, disposeTree } from './util.js';
import domeVert from './shaders/dome.vert.glsl?raw';
import blockySkyFrag from './shaders/blocky-sky.frag.glsl?raw';

const SX = 160, SY = 34, SZ = 160, OX = SX / 2, OZ = SZ / 2;
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, LOG = 4, LEAF = 5, ORE = 6, GRAVEL = 7, SNOW = 8, LAVA = 9, GLOW = 10, PLANK = 11, WINDOW = 12;
const NIGHT = new THREE.Color('#0a0f2c'), HAZE = new THREE.Color('#1a2152');

export function buildBlocky({ seed = 7, aspect = 16 / 9 } = {}) {
  const rnd = mulberry(seed * 13 + 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE, 22, 96);
  const own = [];

  // ---------- textures ----------
  const shade = (hex, v) => { const c = new THREE.Color(hex); c.offsetHSL(0, 0, v); return '#' + c.getHexString(); };
  const px = (x, i, j, c) => { x.fillStyle = c; x.fillRect(i, j, 1, 1); };
  const T = (draw) => {
    const t = canvasTex(16, 16, draw, { nearest: true });
    t.generateMipmaps = true; t.minFilter = THREE.NearestMipmapLinearFilter; t.magFilter = THREE.NearestFilter;
    own.push(t); return t;
  };
  const noisy = (x, base, vary) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(x, i, j, shade(base, (rnd() - 0.5) * vary)); };
  const tex = {
    grassTop: T((x) => { noisy(x, '#4e9a3a', 0.12); for (let k = 0; k < 18; k++) px(x, rnd() * 16 | 0, rnd() * 16 | 0, shade('#62b048', (rnd() - 0.5) * 0.06)); }),
    grassSide: T((x) => { noisy(x, '#79563a', 0.1); for (let i = 0; i < 16; i++) { const d = 2 + (rnd() * 3 | 0); for (let j = 0; j < d; j++) px(x, i, j, shade('#4e9a3a', (rnd() - 0.5) * 0.1)); } }),
    dirt: T((x) => { noisy(x, '#79563a', 0.11); for (let k = 0; k < 10; k++) px(x, rnd() * 16 | 0, rnd() * 16 | 0, '#5c3f28'); }),
    stone: T((x) => { noisy(x, '#7e7e86', 0.09); for (let k = 0; k < 7; k++) { const i = rnd() * 14 | 0, j = rnd() * 15 | 0; px(x, i, j, '#5f5f67'); px(x, i + 1, j, '#5f5f67'); } }),
    logSide: T((x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(x, i, j, shade(i % 4 === 0 || (i + j * 3) % 11 === 0 ? '#4a3220' : '#6b4a2c', (rnd() - 0.5) * 0.06)); }),
    logTop: T((x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const d = Math.max(Math.abs(i - 7.5), Math.abs(j - 7.5)); px(x, i, j, d > 6.6 ? '#4a3220' : shade(Math.floor(d) % 2 ? '#9a7a4e' : '#b08d5a', (rnd() - 0.5) * 0.05)); } }),
    leaves: T((x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { if (rnd() < 0.13) continue; px(x, i, j, rnd() < 0.18 ? '#1e4a1c' : shade('#2f7a2a', (rnd() - 0.5) * 0.14)); } }),
    ore: T((x) => { noisy(x, '#7e7e86', 0.09); for (let k = 0; k < 5; k++) { const i = 2 + (rnd() * 11 | 0), j = 2 + (rnd() * 11 | 0); const c = rnd() < 0.5 ? '#e8c84a' : '#46d6c8'; px(x, i, j, c); px(x, i + 1, j, shade(c, -0.15)); px(x, i, j + 1, shade(c, -0.1)); } }),
    snowTop: T((x) => { noisy(x, '#e8eef8', 0.05); for (let k = 0; k < 10; k++) px(x, rnd() * 16 | 0, rnd() * 16 | 0, '#cdd8ea'); }),
    snowSide: T((x) => { noisy(x, '#7e7e86', 0.09); for (let i = 0; i < 16; i++) { const d = 3 + (rnd() * 3 | 0); for (let j = 0; j < d; j++) px(x, i, j, shade('#e8eef8', (rnd() - 0.5) * 0.06)); } }),
    lava: T((x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const v = Math.sin(i * 0.9 + Math.sin(j * 0.7) * 2) + Math.cos(j * 0.6 + i * 0.3); px(x, i, j, v > 0.9 ? '#fff0a0' : v > 0.1 ? '#ff9a1f' : v > -0.8 ? '#e8560f' : '#b5320a'); } }),
    plank: T((x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(x, i, j, shade(j % 4 === 3 ? '#6e5230' : (i + (j >> 2) * 5) % 16 === 0 ? '#7a5c36' : '#a07a48', (rnd() - 0.5) * 0.06)); }),
    window: T((x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(x, i, j, i < 2 || i > 13 || j < 2 || j > 13 || i === 7 || i === 8 || j === 7 || j === 8 ? '#5a4024' : shade('#ffc96a', (rnd() - 0.5) * 0.08)); }),
    gravel: T((x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(x, i, j, shade(rnd() < 0.5 ? '#8a8480' : '#6a6460', (rnd() - 0.5) * 0.1)); }),
  };
  const lam = (map, extra) => { const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra }); own.push(m); return m; };
  const MAT = {
    grassTop: lam(tex.grassTop), grassSide: lam(tex.grassSide), dirt: lam(tex.dirt), stone: lam(tex.stone),
    logSide: lam(tex.logSide), logTop: lam(tex.logTop), leaves: lam(tex.leaves, { alphaTest: 0.5 }), ore: lam(tex.ore, { emissive: '#1a1a10' }), gravel: lam(tex.gravel),
    snowTop: lam(tex.snowTop), snowSide: lam(tex.snowSide), lava: lam(tex.lava, { emissive: '#ffffff', emissiveMap: tex.lava, emissiveIntensity: 1.6 }),
    glow: lam(tex.ore, { emissive: '#ffffff', emissiveMap: tex.ore, emissiveIntensity: 0.9 }),
    plank: lam(tex.plank), window: lam(tex.window, { emissive: '#ffffff', emissiveMap: tex.window, emissiveIntensity: 1.2 }),
  };
  // which texture each face of each block uses: [top, bottom, side]
  const FACES = {
    [GRASS]: ['grassTop', 'dirt', 'grassSide'], [DIRT]: ['dirt', 'dirt', 'dirt'], [STONE]: ['stone', 'stone', 'stone'],
    [LOG]: ['logTop', 'logTop', 'logSide'], [LEAF]: ['leaves', 'leaves', 'leaves'], [ORE]: ['ore', 'ore', 'ore'], [GRAVEL]: ['gravel', 'gravel', 'gravel'], [SNOW]: ['snowTop', 'stone', 'snowSide'], [LAVA]: ['lava', 'lava', 'lava'], [GLOW]: ['glow', 'glow', 'glow'], [PLANK]: ['plank', 'plank', 'plank'], [WINDOW]: ['window', 'window', 'window'],
  };

  // ---------- the walk (closed curve, arc-length parameterised) ----------
  // starts heading north at the cave hill, runs down the ravine's edge (ravine on the left), loops back through the woods
  const ravineX = (z) => 36.6 + 2.5 * Math.sin(z / 9), ravW = (z) => 3.3 + 1.0 * Math.sin(z / 7);
  const lip = (z) => [ravineX(z) - ravW(z) - 2.5, z];
  const WP = [[0, 12], [3, 0], [9, -12], [19, -16], lip(-8), lip(0), lip(8), lip(16), [lip(24)[0] - 1, 25], [14, 32], [0, 32], [-15, 28], [-22, 18], [-12, 15]];
  const curve = new THREE.CatmullRomCurve3(WP.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const LEN = curve.getLength(), SPEED = 1.35;
  const pathPts = Array.from({ length: 260 }, (_, i) => curve.getPointAt(i / 260));
  const pathDist = (wx, wz) => { let d = 1e9; for (const p of pathPts) { const e = (p.x - wx) * (p.x - wx) + (p.z - wz) * (p.z - wz); if (e < d) d = e; } return Math.sqrt(d); };
  const nearPath = (wx, wz, r) => pathDist(wx, wz) < r;

  // ---------- terrain ----------
  const V = new Uint8Array(SX * SY * SZ);
  const idx = (x, y, z) => x + SX * (z + SZ * y);
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ ? AIR : V[idx(x, y, z)]);
  const set = (x, y, z, v) => { if (x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ) V[idx(x, y, z)] = v; };
  const G = 64, grid = new Float32Array(G * G).map(() => rnd());
  const vn = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const g = (i, j) => grid[(((i % G) + G) % G) + G * (((j % G) + G) % G)];
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(g(xi, zi), g(xi + 1, zi), u), lerp(g(xi, zi + 1), g(xi + 1, zi + 1), u), v);
  };
  const HILL = { x: -21, z: -15 };                                // the cave hill, left of the start
  const MOUTH = { x: -12, z: -7 };                                 // cave mouth, opening towards the start
  const heightAtCol = (wx, wz) => {
    let h = 6 + vn(wx / 24 + 7, wz / 24 + 3) * 7 + vn(wx / 8, wz / 8) * 2.5;
    // a ridge of mountains to the north (snow on top), lower hills to the west and south
    const pk = vn(wx / 13 + 2, wz / 13);
    const ridge = smooth((-36 - wz) / 20) * (6 + 20 * pk * pk) * (0.75 + 0.5 * vn(wx / 6 + 9, wz / 6));
    const west = smooth((-40 - wx) / 20) * (6 + 6 * vn(wx / 10, wz / 10 + 5));
    h += ridge + west;
    const dh = Math.hypot(wx - HILL.x, wz - HILL.z);
    h += 12 * Math.exp(-(dh * dh) / 120);
    if (wz > -30) h = Math.min(h, 21);                              // no snow on the near hills
    // the walk stays gentle: blend towards a soft base near the path
    const pd = pathDist(wx, wz);
    if (pd < 7) h = lerp(7 + vn(wx / 30, wz / 30) * 2.5, h, smooth((pd - 2) / 5));
    return Math.round(clamp(h, 3, SY - 3));
  };
  const H = new Int16Array(SX * SZ);
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    const wx = x - OX, wz = z - OZ, h = heightAtCol(wx, wz);
    H[x + SX * z] = h;
    for (let y = 0; y <= h; y++) set(x, y, z, y === h ? (h >= 24 ? SNOW : GRASS) : y > h - 3 ? DIRT : rnd() < 0.035 ? ORE : STONE);
  }
  // steep sides show stone (cliffs), snow keeps its cap
  for (let x = 1; x < SX - 1; x++) for (let z = 1; z < SZ - 1; z++) {
    const h = H[x + SX * z];
    const lo = Math.min(H[x - 1 + SX * z], H[x + 1 + SX * z], H[x + SX * (z - 1)], H[x + SX * (z + 1)]);
    if (h - lo >= 3) for (let y = lo; y <= h; y++) { if (y === h && get(x, y, z) === SNOW) continue; set(x, y, z, rnd() < 0.05 ? ORE : STONE); }
  }
  // the ravine: a winding trench with lava at the bottom
  for (let z = 0; z < SZ; z++) {
    const wz = z - OZ, xc = ravineX(wz) + OX, w = ravW(wz);
    for (let x = Math.floor(xc - w - 1); x <= Math.ceil(xc + w + 1); x++) {
      const d = Math.abs(x - xc);
      if (d > w + 0.6) continue;
      const floor = 2 + Math.round(Math.max(0, d - 1) * 0.9);
      for (let y = floor + 1; y < SY; y++) set(x, y, z, AIR);
      set(x, floor, z, d < w * 0.55 ? LAVA : GRAVEL);
      for (let y = 0; y < floor; y++) set(x, y, z, rnd() < 0.06 ? ORE : STONE);
    }
    for (let x = Math.floor(xc - w - 2); x <= Math.ceil(xc + w + 2); x++) for (let y = 2; y < SY; y++) if (get(x, y, z) === DIRT) set(x, y, z, rnd() < 0.06 ? ORE : STONE);
  }
  // the cave: a stone cliff on the hill's face with a tunnel into it, sloping down
  const cave = { x: MOUTH.x + OX, z: MOUTH.z + OZ };
  const dirC = new THREE.Vector2(HILL.x - MOUTH.x, HILL.z - MOUTH.z).normalize();   // into the hill
  const perp = new THREE.Vector2(-dirC.y, dirC.x);
  const outX = Math.round(cave.x - dirC.x * 3), outZ = Math.round(cave.z - dirC.y * 3);
  const caveY = H[outX + SX * outZ] + 1;                                             // floor = ground outside
  const at = (s, a) => [Math.round(cave.x + dirC.x * s + perp.x * a), Math.round(cave.z + dirC.y * s + perp.y * a)];
  // a flat clearing in front of the mouth
  for (let s = -7; s < 0.5; s += 0.5) for (let a = -6; a <= 6; a += 0.5) {
    const [x, z] = at(s, a);
    if (x < 0 || z < 0 || x >= SX || z >= SZ) continue;
    const want = caveY - 1;
    for (let y = want + 1; y < SY; y++) set(x, y, z, AIR);
    for (let y = H[x + SX * z]; y < want; y++) set(x, y, z, DIRT);
    set(x, want, z, GRASS);
    H[x + SX * z] = want;
  }
  // raise a cliff face so the tunnel has rock above it
  for (let s = 0.5; s <= 7; s += 0.5) for (let a = -6; a <= 6; a += 0.5) {
    const [x, z] = at(s, a);
    if (x < 0 || z < 0 || x >= SX || z >= SZ) continue;
    const want = Math.round(caveY + 6.5 - Math.abs(a) * 0.45 + s * 0.4);
    const h = H[x + SX * z];
    if (want <= h) continue;
    for (let y = h; y < want; y++) set(x, y, z, rnd() < 0.07 ? ORE : STONE);
    set(x, want, z, GRASS);
    H[x + SX * z] = want;
  }
  // face of the cliff is bare stone
  for (let a = -6; a <= 6; a += 0.5) for (let s = 0; s <= 1.5; s += 0.5) {
    const [x, z] = at(s, a);
    for (let y = caveY - 1; y < H[x + SX * z]; y++) if (get(x, y, z) !== AIR) set(x, y, z, rnd() < 0.07 ? ORE : STONE);
  }
  for (let s = -1; s < 18; s += 0.5) {
    const drop = Math.max(0, Math.floor((s - 4) / 3));
    for (let a = -2; a <= 2; a += 0.5) for (let yy = 0; yy < 4; yy++) {
      if (yy === 3 && Math.abs(a) > 1.4) continue;
      const [x, z] = at(s, a), y = caveY + yy - drop;
      set(x, y, z, AIR);
      if (yy === 0 && s > 0) set(x, y - 1, z, s > 7 && rnd() < 0.25 ? ORE : rnd() < 0.3 ? GRAVEL : STONE);
    }
  }

  // a plank hut with a lit window by the woods, on the walk back
  const HUT = { x: -8 + OX, z: 23 + OZ };
  {
    let base = 0; for (let x = HUT.x - 3; x <= HUT.x + 3; x++) for (let z = HUT.z - 3; z <= HUT.z + 3; z++) base = Math.max(base, H[x + SX * z]);
    for (let x = HUT.x - 3; x <= HUT.x + 3; x++) for (let z = HUT.z - 3; z <= HUT.z + 3; z++) { for (let y = H[x + SX * z] + 1; y <= base; y++) set(x, y, z, DIRT); set(x, base, z, GRASS); for (let y = base + 1; y < SY; y++) set(x, y, z, AIR); H[x + SX * z] = base; }
    for (let x = HUT.x - 2; x <= HUT.x + 2; x++) for (let z = HUT.z - 2; z <= HUT.z + 2; z++) for (let y = base + 1; y <= base + 4; y++) {
      const edge = x === HUT.x - 2 || x === HUT.x + 2 || z === HUT.z - 2 || z === HUT.z + 2;
      const corner = (x === HUT.x - 2 || x === HUT.x + 2) && (z === HUT.z - 2 || z === HUT.z + 2);
      if (y === base + 4) set(x, y, z, PLANK); else if (corner) set(x, y, z, LOG); else if (edge) set(x, y, z, PLANK);
    }
    for (let x = HUT.x - 3; x <= HUT.x + 3; x++) for (let z = HUT.z - 3; z <= HUT.z + 3; z++) set(x, base + 5, z, LOG);
    set(HUT.x, base + 1, HUT.z + 2, AIR); set(HUT.x, base + 2, HUT.z + 2, AIR);                  // door, facing the walk
    set(HUT.x - 2, base + 2, HUT.z, WINDOW); set(HUT.x + 2, base + 2, HUT.z, WINDOW); set(HUT.x + 1, base + 2, HUT.z + 2, WINDOW);
  }

  // inside the cave: a lava pool deep in and glowing ore on the tunnel walls, so the mouth reads from outside
  for (let s = 9; s <= 12; s += 0.5) for (let a = -1.5; a <= 1.5; a += 0.5) { const [x, z] = at(s, a), y = caveY - Math.max(0, Math.floor((s - 4) / 3)) - 1; set(x, y, z, LAVA); }
  for (let s = 2; s < 14; s += 1.5) for (const a of [-2.5, 2.5]) { if (rnd() < 0.45) continue; const [x, z] = at(s, a), y = caveY + 1 + (rnd() * 2 | 0) - Math.max(0, Math.floor((s - 4) / 3)); if (get(x, y, z) !== AIR) set(x, y, z, GLOW); }

  // trees (kept off the path, the ravine and the cave mouth), denser in the south-west woods
  const leafAt = (x, y, z) => { if (get(x, y, z) === AIR) set(x, y, z, LEAF); };
  let trees = 0;
  for (let k = 0; k < 900 && trees < 120; k++) {
    const x = 4 + (rnd() * (SX - 8) | 0), z = 4 + (rnd() * (SZ - 8) | 0), wx = x - OX, wz = z - OZ;
    const woods = wx < 10 && wz > 10;
    if (!woods && rnd() < 0.45) continue;
    if (Math.abs(wx - ravineX(wz)) < 6) continue;
    if (Math.hypot(wx - MOUTH.x, wz - MOUTH.z) < 7) continue;
    if (Math.hypot(x - HUT.x, z - HUT.z) < 5) continue;
    if (nearPath(wx, wz, 3.4)) continue;
    const h0 = H[x + SX * z]; if (get(x, h0, z) !== GRASS || h0 > 20) continue;
    const th = 4 + (rnd() * 3 | 0);
    for (let y = 1; y <= th; y++) set(x, h0 + y, z, LOG);
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy >= th ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === th + 1 || rnd() < 0.5)) continue;
        leafAt(x + dx, h0 + dy, z + dz);
      }
    }
    leafAt(x, h0 + th + 2, z);
    trees++;
  }

  // ---------- mesher: visible faces only, AO baked into vertex colours ----------
  const DIRS = [
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: 0.8, f: 2 },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: 0.8, f: 2 },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1.0, f: 0 },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: 0.5, f: 1 },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: 0.66, f: 2 },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: 0.66, f: 2 },
  ];
  const AO = [0.42, 0.62, 0.8, 1.0];
  const buf = {};
  for (const k of Object.keys(MAT)) buf[k] = { p: [], n: [], u: [], c: [], i: [] };
  const solid = (x, y, z) => { const v = get(x, y, z); return v !== AIR ? 1 : 0; };
  const roof = new Int16Array(SX * SZ).fill(-1), canopy = new Int16Array(SX * SZ).fill(-1);
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) for (let y = SY - 1; y >= 0; y--) {
    const v = V[idx(x, y, z)];
    if (v === LEAF) { if (canopy[x + SX * z] < 0) canopy[x + SX * z] = y; }
    else if (v !== AIR) { roof[x + SX * z] = y; break; }
  }
  const sky = (x, y, z) => { if (x < 0 || z < 0 || x >= SX || z >= SZ) return 1; const i = x + SX * z; return y < roof[i] ? 0.22 : y < canopy[i] ? 0.62 : 1; };
  for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
    const id = V[idx(x, y, z)]; if (id === AIR) continue;
    for (const D of DIRS) {
      const [nx, ny, nz] = D.n;
      const nb = get(x + nx, y + ny, z + nz);
      if (nb !== AIR && !(nb === LEAF && id !== LEAF)) continue;
      if (ny === -1 && y === 0) continue;
      const key = FACES[id][D.f];
      const sk = id === LAVA ? 1 : sky(x + nx, y + ny, z + nz);
      const B = buf[key], base = B.p.length / 3;
      const ao = [];
      for (const [cx, cy, cz] of D.c) {
        // AO: the three blocks in front of this face that touch the corner
        const ux = nx === 0 ? (cx ? 1 : -1) : 0, uy = ny === 0 ? (cy ? 1 : -1) : 0, uz = nz === 0 ? (cz ? 1 : -1) : 0;
        const fx = x + nx, fy = y + ny, fz = z + nz;
        let s1, s2, cr;
        if (nx !== 0) { s1 = solid(fx, fy + uy, fz); s2 = solid(fx, fy, fz + uz); cr = solid(fx, fy + uy, fz + uz); }
        else if (ny !== 0) { s1 = solid(fx + ux, fy, fz); s2 = solid(fx, fy, fz + uz); cr = solid(fx + ux, fy, fz + uz); }
        else { s1 = solid(fx + ux, fy, fz); s2 = solid(fx, fy + uy, fz); cr = solid(fx + ux, fy + uy, fz); }
        const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
        ao.push(a);
        B.p.push(x - OX + cx - 0.5, y + cy, z - OZ + cz - 0.5);
        B.n.push(nx, ny, nz);
        const l = D.s * AO[a] * sk;
        B.c.push(l, l, l);
      }
      B.u.push(0, 0, 1, 0, 1, 1, 0, 1);
      if (ao[0] + ao[2] > ao[1] + ao[3]) B.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else B.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }
  const terrain = new THREE.Group();
  for (const [k, B] of Object.entries(buf)) {
    if (!B.i.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    g.setIndex(B.i);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, MAT[k]); m.matrixAutoUpdate = false;
    terrain.add(m);
  }
  scene.add(terrain);

  // ground height for the walker: bilinear over column tops, then a small blur so steps become slopes
  const topAt = (wx, wz) => {
    const x = Math.floor(wx + OX + 0.5), z = Math.floor(wz + OZ + 0.5);
    for (let y = SY - 1; y >= 0; y--) { const v = get(x, y, z); if (v !== AIR && v !== LEAF && v !== LOG) return y + 1; }
    return 0;
  };
  const groundAt = (wx, wz) => {
    let s = 0, n = 0;
    for (const [dx, dz, w] of [[0, 0, 2], [0.6, 0, 1], [-0.6, 0, 1], [0, 0.6, 1], [0, -0.6, 1]]) {
      const x = wx + dx, z = wz + dz, x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
      const h = lerp(lerp(topAt(x0, z0), topAt(x0 + 1, z0), fx), lerp(topAt(x0, z0 + 1), topAt(x0 + 1, z0 + 1), fx), fz);
      s += h * w; n += w;
    }
    return s / n;
  };

  // ---------- flowers + tufts (crossed quads) ----------
  const fl = canvasTex(64, 16, (x) => {
    x.clearRect(0, 0, 64, 16);
    const stem = (o) => { x.fillStyle = '#2f7a2a'; x.fillRect(o + 7, 6, 2, 10); x.fillRect(o + 5, 11, 2, 1); };
    stem(0); x.fillStyle = '#e8343a'; x.fillRect(5, 2, 6, 5); x.fillStyle = '#ffd84a'; x.fillRect(7, 4, 2, 2);
    stem(16); x.fillStyle = '#ffd23a'; x.fillRect(21, 3, 6, 4); x.fillStyle = '#fff2a8'; x.fillRect(23, 4, 2, 2);
    for (let i = 0; i < 9; i++) { x.fillStyle = i % 2 ? '#3f8f33' : '#58a845'; x.fillRect(33 + i * 1.6, 6 + (i % 3) * 2, 1, 10); }
    x.fillStyle = '#9b6bff'; x.fillRect(53, 3, 6, 5); stem(48);
  }, { nearest: true, repeat: false });
  own.push(fl);
  const flp = [], flu = [];
  for (let k = 0; k < 520; k++) {
    const x = 2 + (rnd() * (SX - 4) | 0), z = 2 + (rnd() * (SZ - 4) | 0);
    const h = H[x + SX * z]; if (get(x, h, z) !== GRASS || get(x, h + 1, z) !== AIR) continue;
    const wx = x - OX, wz = z - OZ, kind = rnd() < 0.8 ? 2 : rnd() < 0.4 ? 3 : rnd() < 0.5 ? 0 : 1;
    const u0 = kind / 4, u1 = u0 + 0.25, y0 = h + 1, y1 = h + (kind === 2 ? 1.7 : 1.55);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const dx = Math.cos(a) * 0.45, dz = Math.sin(a) * 0.45;
      flp.push(wx - dx, y0, wz - dz, wx + dx, y0, wz + dz, wx + dx, y1, wz + dz, wx - dx, y0, wz - dz, wx + dx, y1, wz + dz, wx - dx, y1, wz - dz);
      flu.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    }
  }
  const flg = new THREE.BufferGeometry();
  flg.setAttribute('position', new THREE.Float32BufferAttribute(flp, 3));
  flg.setAttribute('uv', new THREE.Float32BufferAttribute(flu, 2));
  flg.computeVertexNormals();
  const flMat = new THREE.MeshLambertMaterial({ map: fl, alphaTest: 0.5, side: THREE.DoubleSide });
  own.push(flMat);
  scene.add(new THREE.Mesh(flg, flMat));

  // ---------- torches (fixed number of lights; only intensity changes) ----------
  const torchSpots = [
    [Math.round(MOUTH.x - dirC.x * 1.6 - dirC.y * 2.8), Math.round(MOUTH.z - dirC.y * 1.6 + dirC.x * 2.8)],
    [Math.round(MOUTH.x - dirC.x * 1.6 + dirC.y * 2.8), Math.round(MOUTH.z - dirC.y * 1.6 - dirC.x * 2.8)],
    [-4, -2], [33, 6], [-17, 23], [12, -20],
  ];
  const stickMat = new THREE.MeshLambertMaterial({ color: '#6b4a2c' });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc65a').multiplyScalar(1.6), toneMapped: false });
  const glowTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,200,110,1)'); g.addColorStop(0.35, 'rgba(255,150,60,.35)'); g.addColorStop(1, 'rgba(255,120,40,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, { repeat: false });
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
  own.push(stickMat, flameMat, glowTex, glowMat);
  const stickG = new THREE.BoxGeometry(0.14, 0.62, 0.14), flameG = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  own.push(stickG, flameG);
  const torches = torchSpots.map(([wx, wz], i) => {
    const y = topAt(wx, wz);
    const g = new THREE.Group(); g.position.set(wx, y, wz);
    const st = new THREE.Mesh(stickG, stickMat); st.position.y = 0.31; g.add(st);
    const fm = new THREE.Mesh(flameG, flameMat); fm.position.y = 0.68; g.add(fm);
    const sp = new THREE.Sprite(glowMat); sp.position.y = 0.72; sp.scale.setScalar(1.6); g.add(sp);
    const pl = new THREE.PointLight('#ffa448', 14, 13, 1.5); pl.position.y = 1.0; g.add(pl);
    scene.add(g);
    return { pl, sp, ph: i * 1.7 };
  });
  // more torch posts along the quiet part of the walk: flame + glow only, no lights (lights cost every lit pixel)
  const posts = [];
  for (let k = 0; k < 14; k++) {
    const p = curve.getPointAt(((k + 0.5) / 14 + 0.31) % 1), tn = curve.getTangentAt(((k + 0.5) / 14 + 0.31) % 1), side = k % 2 ? 1 : -1;
    const wx = Math.round(p.x + tn.z * 2.6 * side), wz = Math.round(p.z - tn.x * 2.6 * side);
    if (Math.abs(wx - ravineX(wz)) < 8 || torchSpots.some(([a, b]) => Math.hypot(a - wx, b - wz) < 9)) continue;
    const y = topAt(wx, wz);
    const g = new THREE.Group(); g.position.set(wx, y, wz);
    const st = new THREE.Mesh(stickG, stickMat); st.position.y = 0.31; g.add(st);
    const fm = new THREE.Mesh(flameG, flameMat); fm.position.y = 0.68; g.add(fm);
    const sp = new THREE.Sprite(glowMat); sp.position.y = 0.72; sp.scale.setScalar(2.2); g.add(sp);
    scene.add(g); posts.push({ sp, ph: k * 2.3 });
  }
  const flyTex = canvasTex(32, 32, (x) => { const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(230,255,150,1)'); g.addColorStop(0.3, 'rgba(190,255,90,.45)'); g.addColorStop(1, 'rgba(160,255,60,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); }, { repeat: false });
  const flyMat = new THREE.SpriteMaterial({ map: flyTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  own.push(flyTex, flyMat);
  const flies = [];
  const fr = mulberry(seed + 61);
  for (let k = 0; k < 110; k++) {
    const p = pathPts[(fr() * pathPts.length) | 0], a = fr() * 6.28, r = 2.5 + fr() * 9;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (Math.abs(x - ravineX(z)) < 5) continue;
    const sp = new THREE.Sprite(flyMat); scene.add(sp);
    flies.push({ sp, x, z, y: topAt(Math.round(x), Math.round(z)) + 0.5 + fr() * 1.8, ph: fr() * 20, sp2: 0.4 + fr() * 0.6 });
  }

  // lava glow inside the ravine (two fixed lights)
  const lavaLights = [0, 14].map((wz) => { const pl = new THREE.PointLight('#ff7a2a', 26, 18, 1.5); pl.position.set(ravineX(wz), 4.2, wz); scene.add(pl); return pl; });
  const caveIn = at(7.5, 0), caveLight = new THREE.PointLight('#ff8a3a', 22, 14, 1.4);
  caveLight.position.set(caveIn[0] - OX, caveY + 1.2 - 1, caveIn[1] - OZ); scene.add(caveLight);
  // soft glow over the lava (sprites, no bloom pass)
  const lavaGlowTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,170,70,.9)'); g.addColorStop(0.4, 'rgba(255,100,30,.3)'); g.addColorStop(1, 'rgba(255,60,10,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, { repeat: false });
  const lavaGlowMat = new THREE.SpriteMaterial({ map: lavaGlowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
  own.push(lavaGlowTex, lavaGlowMat);
  const lavaGlows = [];
  for (let wz = -30; wz <= 30; wz += 5) { const sp = new THREE.Sprite(lavaGlowMat); sp.position.set(ravineX(wz), 4.2, wz); sp.scale.setScalar(8); scene.add(sp); lavaGlows.push(sp); }
  const caveGlow = new THREE.Sprite(lavaGlowMat); caveGlow.position.copy(caveLight.position); caveGlow.scale.setScalar(6); scene.add(caveGlow);

  // ---------- sky: stars, square moon, slow blocky clouds ----------
  const sp = [], sc = [];
  const sr = mulberry(seed + 99);
  for (let i = 0; i < 900; i++) {
    const a = sr() * Math.PI * 2, e = 0.08 + Math.pow(sr(), 0.7) * 1.4;
    sp.push(Math.cos(a) * 200 * Math.cos(e), 200 * Math.sin(e), Math.sin(a) * 200 * Math.cos(e));
    const b = 0.55 + sr() * 0.45, tint = sr();
    sc.push(b * (tint < 0.15 ? 0.8 : 1), b * (tint > 0.85 ? 0.85 : 1), b);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const starMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, toneMapped: false });
  const stars = new THREE.Points(sg, starMat); stars.frustumCulled = false;
  own.push(starMat);
  const moonTex = canvasTex(16, 16, (x) => {
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(x, i, j, (i * 7 + j * 3) % 9 === 0 ? '#d9d4b8' : '#f6f2dc');
    for (const [i, j, s] of [[4, 4, 3], [10, 9, 2], [6, 11, 2], [11, 3, 1]]) { x.fillStyle = '#cfc9aa'; x.fillRect(i, j, s, s); }
  }, { nearest: true, repeat: false });
  const moonMat = new THREE.MeshBasicMaterial({ map: moonTex, fog: false, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.1) });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), moonMat);
  const haloTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 6, 32, 32, 32); g.addColorStop(0, 'rgba(190,200,255,.5)'); g.addColorStop(1, 'rgba(120,140,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, { repeat: false });
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.55 });
  const halo = new THREE.Sprite(haloMat); halo.scale.setScalar(60);
  own.push(moonTex, moonMat, moon.geometry, haloTex, haloMat);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: NIGHT }, hor: { value: HAZE } },
    vertexShader: domeVert,
    fragmentShader: blockySkyFrag,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 12), domeMat); dome.renderOrder = -2; dome.frustumCulled = false;
  own.push(domeMat, dome.geometry);
  const skyG = new THREE.Group(); skyG.add(dome, stars, moon, halo);
  const MOON_DIR = new THREE.Vector3(0.2, 0.46, -0.86).normalize();
  moon.position.copy(MOON_DIR).multiplyScalar(170); moon.lookAt(0, 0, 0);
  halo.position.copy(MOON_DIR).multiplyScalar(175);
  scene.add(skyG);
  // clouds: a tile of flat slabs drifting east
  const cl = [], CT = 260;
  const cg = new THREE.BoxGeometry(1, 1, 1);
  for (let k = 0; k < 46; k++) {
    const w = 8 + sr() * 26, d = 6 + sr() * 18, x = (sr() - 0.5) * CT, z = (sr() - 0.5) * CT;
    const m = cg.clone(); m.scale(w, 1, d); m.translate(x, 0, z); cl.push(m);
  }
  const cloudG = mergeBoxes(cl);
  cg.dispose();
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#1c2452', fog: false });
  own.push(cloudMat);
  const clouds = new THREE.Group();
  for (const ox of [-1, 0, 1]) for (const oz of [-1, 0, 1]) { const m = new THREE.Mesh(cloudG, cloudMat); m.position.set(ox * CT, 0, oz * CT); clouds.add(m); }
  clouds.position.y = 92;
  scene.add(clouds);

  // ---------- light ----------
  scene.add(new THREE.AmbientLight('#6a78c0', 1.1));
  scene.add(new THREE.HemisphereLight('#4a5aa8', '#140f0c', 0.5));
  const moonL = new THREE.DirectionalLight('#aebcff', 1.6);
  moonL.position.set(-30, 45, 40);   // lit from behind-left of the walk's start (the visible moon is a cheat, like the city sun)
  scene.add(moonL);

  // ---------- camera ----------
  const camera = new THREE.PerspectiveCamera(72, aspect, 0.05, 320);
  const pos = new THREE.Vector3(), tan = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3();
  let headingNow = 0;
  const T_OFF = 36; // t = 0 lands just before the lava ravine: the best first ten seconds
  const POI = [
    { x: MOUTH.x, z: MOUTH.z, r: 22, w: 0.7, pitch: 0.02 },
    { x: ravineX(4), z: 4, r: 11, w: 0.85, pitch: -0.42 },
  ];
  const bump = (x, a, b) => smooth((x - a) / 1.6) * (1 - smooth((x - b) / 1.6));

  function update(t0, fx) {
    const t = t0 + T_OFF;
    const u = ((((t * SPEED) / LEN) % 1) + 1) % 1;
    curve.getPointAt(u, pos);
    curve.getTangentAt(u, tan);
    // look-around: slow drift, plus a long glance every ~37 s
    const cyc = t % 37;
    let yawOff = 0.22 * Math.sin(0.13 * t - 1.6) + 0.14 * Math.sin(0.071 * t + 2) + 0.6 * bump(cyc, 19, 23.5) * (Math.floor(t / 37) % 2 ? 1 : -1);
    let pitch = -0.035 + 0.04 * Math.sin(0.11 * t) - 0.1 * bump(cyc, 19, 23.5);
    // points of interest pull the gaze: the cave mouth, then down into the lava
    const pathYaw = Math.atan2(tan.x, -tan.z);
    for (const p of POI) {
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
      const w = smooth((p.r - d) / 6) * p.w;
      if (w <= 0) continue;
      let da = Math.atan2(dx, -dz) - pathYaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 1.7) continue;
      yawOff = lerp(yawOff, da * 0.8, w);
      pitch = lerp(pitch, p.pitch, w);
    }
    const step = t * SPEED * 1.45;
    const bob = Math.abs(Math.sin(step * Math.PI)) * 0.055;
    const sway = Math.sin(step * Math.PI) * 0.025;
    const gy = groundAt(pos.x, pos.z);
    const yaw = pathYaw + yawOff;   // clockwise from -z
    headingNow = yaw;
    const push = fx ? fx.push : 0;
    camera.position.set(pos.x + Math.cos(yaw) * sway, gy + 1.62 + bob, pos.z + Math.sin(yaw) * sway);
    tmp.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    camera.position.addScaledVector(tmp, push * 1.2);
    look.copy(camera.position).add(tmp);
    camera.lookAt(look);
    camera.rotateZ(Math.sin(step * Math.PI * 0.5) * 0.006);
    const fov = 72 + clamp(1 - camera.aspect, 0, 0.6) * 22 - push * 10;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    skyG.position.copy(camera.position);
    clouds.position.x = (t * 0.9) % CT;
    tex.lava.offset.set((t * 0.03) % 1, (t * 0.05) % 1);
    lavaLights[0].intensity = 26 * (0.9 + 0.1 * Math.sin(t * 1.7));
    lavaLights[1].intensity = 26 * (0.9 + 0.1 * Math.sin(t * 1.3 + 2));
    caveLight.intensity = 22 * (0.88 + 0.12 * Math.sin(t * 2.3));
    for (let i = 0; i < lavaGlows.length; i++) lavaGlows[i].scale.setScalar(7.5 + Math.sin(t * 1.1 + i * 1.7) * 1.2);
    for (const p of posts) p.sp.scale.setScalar(2 + 0.3 * Math.sin(t * 9.7 + p.ph) + 0.15 * Math.sin(t * 23 + p.ph));
    for (const f of flies) {
      const blink = Math.max(0, Math.sin(t * f.sp2 * 2.2 + f.ph)) ** 3;
      f.sp.position.set(f.x + Math.sin(t * 0.31 * f.sp2 + f.ph) * 1.6, f.y + Math.sin(t * 0.53 + f.ph * 2) * 0.5, f.z + Math.cos(t * 0.27 * f.sp2 + f.ph) * 1.6);
      f.sp.scale.setScalar(0.06 + blink * 0.28);
    }
    for (const tc of torches) {
      const f = 0.82 + 0.1 * Math.sin(t * 9.1 + tc.ph) + 0.06 * Math.sin(t * 23.7 + tc.ph * 2) + 0.04 * Math.sin(t * 3.3 + tc.ph);
      tc.pl.intensity = 14 * f;
      tc.sp.scale.setScalar(1.5 + 0.25 * f);
    }
  }

  function dispose() { disposeTree(scene); for (const o of own) o.dispose?.(); cloudG.dispose(); }

  return { scene, camera, update, heading: () => headingNow, dispose, clear: NIGHT };
}

function mergeBoxes(list) {
  let n = 0; for (const g of list) n += g.index ? g.index.count : g.attributes.position.count;
  const p = new Float32Array(n * 3);
  let o = 0;
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; p.set(g.attributes.position.array, o); o += g.attributes.position.array.length; if (g !== g0) g.dispose(); g0.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return out;
}
