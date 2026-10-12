// Our own sunny crime city at golden hour: a chase cam behind the player's red car on an endless palm avenue.
// Everything is a pure function of time t (seconds): renderAt(t) gives the same frame every time.
import * as THREE from 'three';
import { mulberry, hash, clamp, lerp, smooth, bake, merge, canvasTex, disposeTree } from './util.js';

const L = 96;            // block length along the avenue (m)
const SLOTS = 5;         // block groups recycled ahead of the car
const V = 21;            // player speed (m/s)
const LANE_IN = 2.0, LANE_OUT = 5.5, PARK_X = 8.9, CURB = 10.5, FRONT = 16;
const SEG = 7;           // lane-change rhythm (s)
const CHASE_EVERY = 75, CHASE_LEN = 18;
const HORIZON = new THREE.Color('#ffb27a');

// ---------- the player's path (pure) ----------
const zAt = (t) => -(V * t + 9 * Math.sin(0.07 * t));
const speedAt = (t) => V + 0.63 * Math.cos(0.07 * t);

function makePath(seed) {
  const chaseStart = (k) => k * CHASE_EVERY + 26 + hash(seed, 900, k) * 22;
  const chaseAt = (t) => {
    const k = Math.floor((t - 26) / CHASE_EVERY);
    for (let kk = k; kk >= k - 1; kk--) { if (kk < 0) continue; const s = chaseStart(kk); if (t >= s && t < s + CHASE_LEN) return { k: kk, s, u: (t - s) / CHASE_LEN }; }
    return null;
  };
  // a segment that touches a chase window keeps the outer lane (police come up on the left)
  const segInChase = (i) => {
    const a = i * SEG - 2, b = (i + 1) * SEG + 2;
    const k = Math.floor((a - 26) / CHASE_EVERY);
    for (let kk = k - 1; kk <= k + 1; kk++) { if (kk < 0) continue; const s = chaseStart(kk); if (s < b && s + CHASE_LEN > a) return true; }
    return false;
  };
  const laneOf = (i) => (segInChase(i) ? LANE_OUT : hash(seed, 7, i) < 0.5 ? LANE_IN : LANE_OUT);
  const xAt = (t) => {
    const i = Math.floor(t / SEG);
    const u = smooth((t - i * SEG) / 1.6);
    return lerp(laneOf(i - 1), laneOf(i), u) + 0.07 * Math.sin(1.3 * t) + 0.04 * Math.sin(3.1 * t + 1);
  };
  return { xAt, laneOf, chaseAt, segInChase };
}

// time the player reaches world z (z decreasing), Newton on the monotonic path
function timeAtZ(z) {
  let t = -z / V;
  for (let i = 0; i < 6; i++) t -= (zAt(t) - z) / -speedAt(t);
  return t;
}

// ---------- textures ----------
function windowTex() {
  return canvasTex(64, 64, (x) => {
    x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(0, 58, 64, 6);          // floor band
    x.fillStyle = '#2b3446'; x.fillRect(14, 12, 36, 36);                 // glass
    const g = x.createLinearGradient(14, 12, 50, 48); g.addColorStop(0, 'rgba(255,214,170,.55)'); g.addColorStop(0.45, 'rgba(255,190,150,.08)'); g.addColorStop(1, 'rgba(120,90,160,.25)');
    x.fillStyle = g; x.fillRect(14, 12, 36, 36);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(31, 12, 2, 36);           // mullion
    x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(12, 48, 40, 3);      // sill
  });
}
function litTex(rnd) {
  return canvasTex(512, 512, (x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      if (rnd() > 0.22) continue;
      const g = x.createLinearGradient(0, j * 64 + 12, 0, j * 64 + 48);
      const warm = rnd() < 0.8;
      g.addColorStop(0, warm ? '#ffd9a0' : '#bfe6ff'); g.addColorStop(1, warm ? '#ff9a4a' : '#6fa8ff');
      x.fillStyle = g; x.fillRect(i * 64 + 14, j * 64 + 12, 36, 36);
    }
  });
}
function shopTex(rnd) {
  return canvasTex(256, 64, (x) => {
    x.fillStyle = '#1c1820'; x.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 4; i++) {
      const g = x.createLinearGradient(0, 8, 0, 60);
      const hue = ['#ffcf8a', '#ffe9c0', '#ffb070', '#c8f0ff'][Math.floor(rnd() * 4)];
      g.addColorStop(0, hue); g.addColorStop(1, '#3a2a28');
      x.fillStyle = g; x.fillRect(i * 64 + 4, 10, 56, 54);
      x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(i * 64 + 4, 30, 56, 2);
    }
  });
}
function roadTex() {
  // 21 m wide x 12 m long per repeat
  return canvasTex(512, 292, (x, w, h) => {
    const r = mulberry(3);
    x.fillStyle = '#6e6563'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 80 + r() * 50; x.fillStyle = `rgba(${v},${v - 6},${v - 8},.35)`; x.fillRect(r() * w, r() * h, 2, 2); }
    const X = (m) => (m / 21 + 0.5) * w;              // metres from centre -> px
    const Y = (m) => (m / 12) * h;
    x.fillStyle = '#f0c54a'; x.fillRect(X(-0.28), 0, X(-0.12) - X(-0.28), h); x.fillRect(X(0.12), 0, X(0.28) - X(0.12), h);
    x.fillStyle = '#e8e2d6';
    for (const s of [-1, 1]) {
      x.fillRect(X(s * 3.75) - 2.5, Y(0), 5, Y(3.2));            // lane dash
      x.fillRect(X(s * 7.45) - 2, 0, 4, h);                      // parking edge line
    }
    x.fillStyle = 'rgba(30,26,28,.35)'; x.fillRect(X(-1.4) - 18, 0, 36, h); x.fillRect(X(1.4) - 18, 0, 36, h); // oil streaks
  });
}

// ---------- car shapes (front faces -z) ----------
const GLASS = new THREE.Color('#3b3550'), TIRE = new THREE.Color('#141416'), TRIM = new THREE.Color('#26262b');
const TAIL = new THREE.Color('#ff1f2e'), HEAD = new THREE.Color('#fff1cf');
function carShape(kind) {
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const paint = [], detail = [], lights = [];
  // lower body (bumper line), a narrower shoulder on top, a glass house with raked ends, a roof slab
  const S = {
    sedan: { w: 1.9, l: 4.5, bh: 0.5, by: 0.52, sh: 0.18, cw: 1.56, ch: 0.5, cl: 2.1, cz: 0.15, rake: 0.38, wr: 0.36 },
    suv: { w: 2.0, l: 4.6, bh: 0.62, by: 0.66, sh: 0.22, cw: 1.8, ch: 0.66, cl: 2.9, cz: 0.4, rake: 0.18, wr: 0.42 },
    hatch: { w: 1.8, l: 3.9, bh: 0.5, by: 0.5, sh: 0.18, cw: 1.58, ch: 0.56, cl: 2.1, cz: 0.5, rake: 0.2, wr: 0.34 },
    coupe: { w: 1.98, l: 4.5, bh: 0.42, by: 0.44, sh: 0.16, cw: 1.5, ch: 0.42, cl: 1.75, cz: 0.45, rake: 0.55, wr: 0.36 },
  }[kind];
  const { w, l, bh, by, sh, cw, ch, cl, cz, rake, wr } = S;
  const top = by + bh / 2;                       // top of the lower body
  paint.push(bake(box, { y: by, sx: w, sy: bh, sz: l }));
  paint.push(bake(box, { y: top + sh / 2, sx: w - 0.12, sy: sh, sz: l - 0.3 }));                               // shoulder
  const gy = top + sh + ch / 2;
  detail.push(bake(box, { y: gy, z: cz, sx: cw, sy: ch, sz: cl - rake * 2 * ch, color: GLASS }));                  // side glass
  detail.push(bake(box, { y: gy, z: cz - cl / 2 + rake * ch, sx: cw - 0.04, sy: ch / Math.cos(Math.atan(rake * 2)), sz: 0.08, rx: Math.atan(rake * 2), color: GLASS })); // windscreen
  detail.push(bake(box, { y: gy, z: cz + cl / 2 - rake * ch, sx: cw - 0.04, sy: ch / Math.cos(Math.atan(rake * 2)), sz: 0.08, rx: -Math.atan(rake * 2), color: GLASS }));  // rear window
  paint.push(bake(box, { y: top + sh + ch + 0.035, z: cz, sx: cw - 0.06, sy: 0.07, sz: Math.max(0.6, cl - rake * 2.6 * ch) }));   // roof
  for (const s of [-1, 1]) paint.push(bake(box, { x: s * (cw / 2 - 0.04), y: gy, z: cz, sx: 0.08, sy: ch, sz: 0.12 }));      // pillars
  if (kind === 'coupe') {
    paint.push(bake(box, { y: top + sh + 0.2, z: l / 2 - 0.22, sx: w - 0.24, sy: 0.05, sz: 0.34 }));                       // spoiler
    for (const s of [-1, 1]) paint.push(bake(box, { x: s * 0.62, y: top + sh + 0.1, z: l / 2 - 0.22, sx: 0.06, sy: 0.18, sz: 0.1 }));
    for (const s of [-1, 1]) detail.push(bake(cyl, { x: s * 0.45, y: by - bh / 2 + 0.12, z: l / 2 + 0.06, rx: Math.PI / 2, sx: 0.06, sy: 0.14, sz: 0.06, color: '#9a9aa2' })); // exhausts
  }
  for (const s of [-1, 1]) detail.push(bake(box, { x: s * (w / 2 + 0.06), y: top + sh + 0.08, z: cz - cl / 2 + 0.25, sx: 0.12, sy: 0.1, sz: 0.18, color: TRIM })); // mirrors
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    detail.push(bake(cyl, { x: sx * (w / 2 - 0.08), y: wr, z: sz * (l / 2 - 0.82), rz: Math.PI / 2, sx: wr, sy: 0.32, sz: wr, color: TIRE }));
    detail.push(bake(cyl, { x: sx * (w / 2 + 0.085), y: wr, z: sz * (l / 2 - 0.82), rz: Math.PI / 2, sx: wr * 0.55, sy: 0.02, sz: wr * 0.55, color: '#8d8d96' }));
  }
  detail.push(bake(box, { y: by - bh / 2 + 0.1, z: -l / 2 - 0.03, sx: w + 0.02, sy: 0.2, sz: 0.12, color: TRIM }));
  detail.push(bake(box, { y: by - bh / 2 + 0.1, z: l / 2 + 0.03, sx: w + 0.02, sy: 0.2, sz: 0.12, color: TRIM }));
  for (const s of [-1, 1]) {
    lights.push(bake(box, { x: s * (w / 2 - 0.28), y: top - 0.1, z: l / 2 + 0.01, sx: 0.46, sy: 0.12, sz: 0.06, color: TAIL }));
    lights.push(bake(box, { x: s * (w / 2 - 0.3), y: top - 0.12, z: -l / 2 - 0.01, sx: 0.42, sy: 0.1, sz: 0.06, color: HEAD }));
  }
  if (kind === 'coupe') lights.push(bake(box, { y: top - 0.1, z: l / 2 + 0.012, sx: w - 1.0, sy: 0.04, sz: 0.05, color: TAIL }));
  box.dispose(); cyl.dispose();
  return { paint: merge(paint), detail: merge(detail), lights: merge(lights), wheelR: wr, size: S };
}

const PAINTS = ['#f2efe8', '#bfc3c8', '#1d1d22', '#2a6fdb', '#5ac8a8', '#f7c64a', '#7a1f2b', '#d9c7a6', '#e86a2b', '#36384a'].map((c) => new THREE.Color(c));

export function buildCity({ seed = 7, aspect = 16 / 9 } = {}) {
  const rnd = mulberry(seed);
  const path = makePath(seed);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 45, 255);
  const own = [];   // textures and materials made here (disposed with the scene)

  // ---------- sky ----------
  const sunSky = new THREE.Vector3(-0.1, 0.055, -1).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunSky } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 sunDir;
      vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y, -0.1, 1.0);
        vec3 top = lin(vec3(0.24,0.16,0.44)); vec3 mid = lin(vec3(0.99,0.47,0.36)); vec3 low = lin(vec3(1.0,0.72,0.42));
        vec3 c = mix(low, mid, smoothstep(0.0, 0.16, h)); c = mix(c, top, smoothstep(0.16, 0.7, h));
        float s = clamp(dot(d, sunDir), 0.0, 1.0);
        c += vec3(1.0,0.78,0.5) * pow(s, 900.0) * 6.0 + vec3(1.0,0.66,0.32) * pow(s, 40.0) * 1.1 + vec3(1.0,0.5,0.25) * pow(s, 5.0) * 0.3;
        // a few long thin clouds lit from below
        float band = smoothstep(0.035, 0.0, abs(h - 0.11 - 0.02*sin(d.x*7.0))) * (0.5 + 0.5*sin(d.x*23.0 + d.z*5.0));
        c = mix(c, vec3(1.0,0.66,0.52), band * 0.35);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);

  // ---------- light ----------
  scene.add(new THREE.HemisphereLight('#ffe0c4', '#6a4a62', 1.2));
  const sun = new THREE.DirectionalLight('#ffc48c', 3.3);
  const SUN_OFF = new THREE.Vector3(-70, 36, 46);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 220 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const sunD = SUN_OFF.clone().normalize();
  const sunR = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunD).normalize();
  const sunU = new THREE.Vector3().crossVectors(sunD, sunR);
  const TEXEL = 96 / 2048;

  // ---------- materials (shared by every block) ----------
  const winMap = windowTex(), lit = litTex(rnd), shop = shopTex(rnd), road = roadTex();
  lit.repeat.set(1 / 8, 1 / 8);
  own.push(winMap, lit, shop, road);
  const M = {
    walls: new THREE.MeshStandardMaterial({ vertexColors: true, map: winMap, emissive: '#ffcf8a', emissiveMap: lit, emissiveIntensity: 0.55, roughness: 0.85 }),
    shops: new THREE.MeshStandardMaterial({ vertexColors: true, map: shop, emissive: '#ffffff', emissiveMap: shop, emissiveIntensity: 0.55, roughness: 0.4 }),
    props: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }),
    neon: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    trunk: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    frond: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    road: new THREE.MeshStandardMaterial({ map: road, roughness: 0.62, metalness: 0.05 }),
    lot: new THREE.MeshStandardMaterial({ color: '#8c7563', roughness: 1 }),
    paint: new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.18 }),
    detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.3, emissive: '#2a2038', emissiveIntensity: 0.5 }),
    lights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    far: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
  };
  own.push(...Object.values(M));

  // ---------- block templates ----------
  const box = new THREE.BoxGeometry(1, 1, 1);
  const pastel = ['#f4c9a8', '#e8a3a0', '#9fd3c7', '#f2e2c4', '#c9b6e4', '#f7d08a', '#a9c5e8', '#e9b5c9', '#dcd0bd', '#e7b38a', '#bcd9a8'].map((c) => new THREE.Color(c));
  const neonC = ['#ff4fa3', '#38e8ff', '#ffe14d', '#ff6a2b', '#9b6bff', '#4dff9a'].map((c) => new THREE.Color(c).multiplyScalar(1.4));
  const awnC = ['#e8233a', '#1f8a70', '#ff9a3d', '#2f5fd0', '#f2efe8'].map((c) => new THREE.Color(c));
  const templates = [];
  for (let j = 0; j < SLOTS; j++) templates.push(buildBlock(j));

  function bakeBuilding(parts, x, y, z, d, h, w, color) {
    // box with window UVs that follow each face's real size (3.4 m per window column, 3.6 m per floor)
    const g = box.toNonIndexed();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(d, h, w));
    g.applyMatrix4(m);
    const uv = g.attributes.uv, nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
      const span = nx > 0.5 ? w : d;
      if (ny > 0.5) uv.setXY(i, 0.02, 0.97);
      else uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(span / 3.4)), uv.getY(i) * Math.max(1, Math.round((h - 4) / 3.6)));
    }
    const n = uv.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }

  function buildBlock(j) {
    const r = mulberry(seed * 31 + j * 977 + 5);
    const P = { walls: [], shops: [], props: [], neon: [], trunk: [], frond: [], ground: [] };
    const inter = j === 0 || j === 3;
    const start = inter ? -16 : 0;
    const parked = [], walkers = [];
    // sidewalks and curbs
    for (const s of [-1, 1]) {
      const z0 = start, len = L + start;
      P.ground.push(bake(box, { x: s * (CURB + 3), y: 0.09, z: z0 - len / 2, sx: 6, sy: 0.18, sz: len, color: '#cdb8a6' }));
      P.ground.push(bake(box, { x: s * (CURB + 0.12), y: 0.1, z: z0 - len / 2, sx: 0.24, sy: 0.2, sz: len, color: '#e9e0d4' }));
      P.ground.push(bake(box, { x: s * (CURB + 8.5), y: 0.04, z: z0 - len / 2, sx: 5, sy: 0.08, sz: len, color: '#a99583' }));
    }
    if (inter) {
      P.ground.push(bake(box, { x: 0, y: 0.008, z: -8, sx: 360, sy: 0.016, sz: 14, color: '#4d4646' }));
      for (const zc of [-0.9, -15.1]) for (let k = -9; k <= 9; k++) P.ground.push(bake(box, { x: k * 1.1, y: 0.02, z: zc, sx: 0.55, sy: 0.01, sz: 1.6, color: '#e8e2d6' }));
      // traffic light poles on the near corners with an arm over the avenue
      for (const s of [-1, 1]) {
        P.props.push(bake(box, { x: s * (CURB + 0.6), y: 3, z: -0.4, sx: 0.18, sy: 6, sz: 0.18, color: '#2b2b30' }));
        P.props.push(bake(box, { x: s * (CURB - 3.2), y: 5.9, z: -0.4, sx: 7.6, sy: 0.14, sz: 0.14, color: '#2b2b30' }));
        for (const lx of [3.5, 7.2]) {
          P.props.push(bake(box, { x: s * (CURB - lx), y: 5.35, z: -0.4, sx: 0.36, sy: 1.0, sz: 0.3, color: '#1c1c20' }));
          P.neon.push(bake(box, { x: s * (CURB - lx), y: 5.05, z: -0.24, sx: 0.2, sy: 0.2, sz: 0.04, color: new THREE.Color('#3dff8a').multiplyScalar(1.6) }));
        }
      }
      // a few buildings down the cross street, both ways
      for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
        const w = 14 + r() * 12, h = 7 + r() * 22, x = s * (FRONT + 14 + k * 22 + r() * 6);
        for (const zs of [-1, 1]) bakeBuilding(P.walls, x, h / 2, -8 + zs * (13 + r() * 4), w, h, 10 + r() * 6, pastel[Math.floor(r() * pastel.length)]);
      }
    }
    for (const s of [-1, 1]) {
      let z = start - 0.5;
      while (z > -L + 4) {
        const left = s < 0;
        let w = 10 + r() * 14; if (z - w < -L + 1) w = z + L - 1; if (w < 6) break;
        const d = 10 + r() * 10;
        const tall = r() < (left ? 0.05 : 0.22);
        const h = left ? (tall ? 16 + r() * 6 : 5.5 + r() * 7) : (tall ? 30 + r() * 26 : 7 + r() * 19);
        const fx = FRONT + r() * 1.4;
        const cx = s * (fx + d / 2), cz = z - w / 2;
        const color = pastel[Math.floor(r() * pastel.length)];
        bakeBuilding(P.walls, cx, h / 2, cz, d, h, w, color);
        P.props.push(bake(box, { x: cx, y: h + 0.25, z: cz, sx: d + 0.4, sy: 0.5, sz: w + 0.4, color: color.clone().lerp(new THREE.Color('#fff6ea'), 0.6) }));
        // storefront band
        if (r() < 0.75) {
          const sw = w - 1.2;
          const sg = bake(box, { x: s * (fx - 0.15), y: 2.1, z: cz, sx: 0.3, sy: 3.6, sz: sw, uvScale: [Math.max(1, Math.round(sw / 4)), 1], color: '#ffffff' });
          P.shops.push(sg);
          P.props.push(bake(box, { x: s * (fx - 1.1), y: 4.1, z: cz, sx: 2.0, sy: 0.12, sz: sw * 0.9, rz: s * 0.28, color: awnC[Math.floor(r() * awnC.length)] }));
          if (r() < 0.45) P.neon.push(bake(box, { x: s * (fx - 0.35), y: 4.9, z: cz, sx: 0.12, sy: 0.7, sz: Math.min(6, sw * 0.6), color: neonC[Math.floor(r() * neonC.length)] }));
        }
        if (r() < 0.4) {
          const ny = 5 + r() * Math.min(10, h - 7);
          P.neon.push(bake(box, { x: s * (fx - 0.8), y: ny, z: cz + (r() - 0.5) * w * 0.5, sx: 1.2, sy: 2.4 + r() * 2, sz: 0.18, color: neonC[Math.floor(r() * neonC.length)] }));
        }
        if (h > 16 && r() < 0.35) { // rooftop water tank / ac boxes
          P.props.push(bake(box, { x: cx + (r() - 0.5) * d * 0.5, y: h + 1.4, z: cz + (r() - 0.5) * w * 0.4, sx: 2.2, sy: 2.4, sz: 2.2, color: '#8a6f5a' }));
        }
        z -= w + (r() < 0.15 ? 5 + r() * 3 : 0.4 + r() * 1.2);
      }
      // palms
      for (let pz = start - 6 - (s > 0 ? 7 : 0) - r() * 3; pz > -L + 2; pz -= 14 + r() * 4) addPalm(P, r, s * (CURB + 1.4), pz);
      // street lights
      for (let lz = start - 12; lz > -L + 4; lz -= 32) {
        P.props.push(bake(box, { x: s * (CURB + 0.7), y: 3.6, z: lz, sx: 0.16, sy: 7.2, sz: 0.16, color: '#2b2b30' }));
        P.props.push(bake(box, { x: s * (CURB - 0.5), y: 7.1, z: lz, sx: 2.4, sy: 0.1, sz: 0.1, color: '#2b2b30' }));
        P.neon.push(bake(box, { x: s * (CURB - 1.5), y: 6.98, z: lz, sx: 0.7, sy: 0.12, sz: 0.32, color: new THREE.Color('#ffe2a8').multiplyScalar(1.3) }));
      }
      // parked cars
      for (let cz = start - 4; cz > -L + 5; cz -= 6.2) {
        if (r() < 0.45) parked.push({ x: s * PARK_X, z: cz - r() * 0.8, ry: s > 0 ? 0 : Math.PI, shape: Math.floor(r() * 3), color: Math.floor(r() * PAINTS.length) });
      }
      // people on the sidewalk
      for (let k = 0; k < 4; k++) walkers.push({ x: s * (CURB + 1.6 + r() * 3.6), z0: r() * L, v: (r() < 0.5 ? -1 : 1) * (1.0 + r() * 0.7), shirt: pastel[Math.floor(r() * pastel.length)].clone().offsetHSL(0, 0.2, -0.15), ph: r() * 6 });
    }
    const g = new THREE.Group();
    const add = (geos, mat, cast, recv) => {
      if (!geos.length) return;
      const mesh = new THREE.Mesh(merge(geos), mat);
      mesh.castShadow = cast; mesh.receiveShadow = recv; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      g.add(mesh);
    };
    add(P.ground, M.ground, false, true);
    add(P.walls, M.walls, true, true);
    add(P.shops, M.shops, false, true);
    add(P.props, M.props, true, true);
    add(P.neon, M.neon, false, false);
    add(P.trunk, M.trunk, true, false);
    add(P.frond, M.frond, true, false);
    scene.add(g);
    return { group: g, inter, parked, walkers };
  }

  function addPalm(P, r, x, z) {
    const H = 9 + r() * 5, lean = (r() - 0.5) * 0.3, segs = 8;
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 7);
    let y = 0.18, px = x;
    for (let i = 0; i < segs; i++) {
      const rad = 0.2 - i * 0.009;
      px += lean * 0.16 * i;
      P.trunk.push(bake(cyl, { x: px, y: y + H / segs / 2, z, sx: rad, sy: H / segs, sz: rad, color: i % 2 ? '#7a5a3d' : '#6c4f36' }));
      y += H / segs;
    }
    cyl.dispose();
    const pl = new THREE.PlaneGeometry(0.95, 4.4, 1, 4);
    const pos = pl.attributes.position;
    for (let k = 0; k < pos.count; k++) { const yy = pos.getY(k); pos.setZ(k, -Math.pow((yy + 2.2) / 4.4, 2) * 1.7); }
    pl.translate(0, 2.2, 0);
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Color('#5a9a44').offsetHSL((r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.1);
      P.frond.push(bake(pl, { x: px, y, z, rx: -1.05 - r() * 0.35, ry: (i / 10) * Math.PI * 2 + r() * 0.3, color: c }));
    }
    pl.dispose();
  }

  // ---------- global strips that follow the car ----------
  const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(21, 600), M.road);
  roadMesh.rotation.x = -Math.PI / 2; roadMesh.receiveShadow = true;
  road.repeat.set(1, 600 / 12);
  scene.add(roadMesh);
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), M.lot);
  lot.rotation.x = -Math.PI / 2; lot.position.y = -0.02; lot.receiveShadow = true;
  scene.add(lot);

  // far skyline + hills (fixed distance from the car, pre-hazed, no fog)
  const farParts = [];
  const hazeTo = (c, a) => new THREE.Color(c).lerp(new THREE.Color('#e9a07a'), a);
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * 1700, z = -1250 - rnd() * 500, w = 30 + rnd() * 60, h = 60 + rnd() * (Math.abs(x) < 300 ? 260 : 120);
    farParts.push(bake(box, { x, y: h / 2, z, sx: w, sy: h, sz: w, color: hazeTo('#6a4a78', 0.45 + rnd() * 0.15) }));
  }
  const cone = new THREE.ConeGeometry(1, 1, 6);
  for (let i = 0; i < 14; i++) {
    const x = -1600 + i * 240 + rnd() * 100, rr = 260 + rnd() * 260, h = 120 + rnd() * 140;
    farParts.push(bake(cone, { x, y: h / 2 - 10, z: -1900 - rnd() * 200, sx: rr, sy: h, sz: rr, color: hazeTo('#8b5a6e', 0.55) }));
  }
  cone.dispose();
  const far = new THREE.Mesh(merge(farParts), M.far);
  far.frustumCulled = false;
  scene.add(far);

  // ---------- cars ----------
  const shapes = ['sedan', 'suv', 'hatch'].map(carShape);
  const CAP = 48;
  const pools = shapes.map((sh) => {
    const paint = new THREE.InstancedMesh(sh.paint, M.paint, CAP);
    const detail = new THREE.InstancedMesh(sh.detail, M.detail, CAP);
    const lights = new THREE.InstancedMesh(sh.lights, M.lights, CAP);
    paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    for (const m of [paint, detail, lights]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
    paint.castShadow = detail.castShadow = true; paint.receiveShadow = true;
    return { paint, detail, lights, all: [paint, detail, lights], n: 0 };
  });
  own.push(...shapes.flatMap((s) => [s.paint, s.detail, s.lights]));
  const _m = new THREE.Matrix4();
  function putCar(shape, x, z, ry, color) {
    const p = pools[shape]; if (p.n >= CAP) return;
    _m.makeRotationY(ry); _m.setPosition(x, 0, z);
    p.paint.setMatrixAt(p.n, _m); p.detail.setMatrixAt(p.n, _m); p.lights.setMatrixAt(p.n, _m);
    p.paint.setColorAt(p.n, PAINTS[color]);
    p.n++;
  }

  // the player's car
  const hero = new THREE.Group();
  const hs = carShape('coupe');
  const heroPaint = new THREE.MeshStandardMaterial({ color: '#e8233a', roughness: 0.26, metalness: 0.25 });
  own.push(heroPaint, hs.paint, hs.detail, hs.lights);
  const hp = new THREE.Mesh(hs.paint, heroPaint), hd = new THREE.Mesh(hs.detail, M.detail), hl = new THREE.Mesh(hs.lights, M.lights);
  hp.castShadow = hd.castShadow = true;
  hero.add(hp, hd, hl);
  scene.add(hero);

  // the police cruiser (generic black-and-white, light bar, no text)
  const cop = new THREE.Group();
  const cs = carShape('sedan');
  const copBlack = new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.3, metalness: 0.2 });
  const copWhite = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.35 });
  const red = new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }), blue = new THREE.MeshBasicMaterial({ color: '#2a5cff', toneMapped: false });
  own.push(copBlack, copWhite, red, blue, cs.paint, cs.detail, cs.lights);
  cop.add(new THREE.Mesh(cs.paint, copBlack), new THREE.Mesh(cs.detail, M.detail), new THREE.Mesh(cs.lights, M.lights));
  const doors = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.42, 1.9), copWhite); doors.position.set(0, 0.66, 0.15); cop.add(doors);
  const barL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.34), red); barL.position.set(-0.36, 1.46, 0.3);
  const barR = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.34), blue); barR.position.set(0.36, 1.46, 0.3);
  cop.add(barL, barR);
  const glowTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, { repeat: false });
  own.push(glowTex);
  const copGlow = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), new THREE.MeshBasicMaterial({ map: glowTex, color: '#ff2030', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  copGlow.rotation.x = -Math.PI / 2; copGlow.position.y = 0.05; cop.add(copGlow);
  own.push(doors.geometry, barL.geometry, barR.geometry, copGlow.geometry, copGlow.material);
  cop.traverse((o) => { if (o.isMesh && o !== copGlow) o.castShadow = true; });
  cop.visible = true; cop.position.set(0, -50, 0);
  scene.add(cop);

  // people: one instanced low-poly walker (legs, torso, head)
  const ped = merge([
    bake(box, { x: -0.09, y: 0.42, sx: 0.14, sy: 0.84, sz: 0.16, color: '#2c3550' }),
    bake(box, { x: 0.09, y: 0.42, sx: 0.14, sy: 0.84, sz: 0.16, color: '#2c3550' }),
    bake(box, { y: 1.13, sx: 0.4, sy: 0.6, sz: 0.22, color: '#ffffff' }),
    bake(box, { x: -0.26, y: 1.1, sx: 0.1, sy: 0.56, sz: 0.12, color: '#ffffff' }),
    bake(box, { x: 0.26, y: 1.1, sx: 0.1, sy: 0.56, sz: 0.12, color: '#ffffff' }),
    bake(box, { y: 1.58, sx: 0.22, sy: 0.24, sz: 0.22, color: '#c99a78' }),
    bake(box, { y: 1.72, sx: 0.24, sy: 0.07, sz: 0.24, color: '#2a1e18' }),
  ]);
  const PEDCAP = 48;
  const people = new THREE.InstancedMesh(ped, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), PEDCAP);
  people.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PEDCAP * 3), 3);
  people.castShadow = true; people.frustumCulled = false; people.count = 0;
  own.push(ped, people.material);
  scene.add(people);

  const camera = new THREE.PerspectiveCamera(56, aspect, 0.2, 2600);
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let headingNow = 0;

  // ---------- one frame, pure in t ----------
  function update(t, fx) {
    const zp = zAt(t), xp = path.xAt(t);
    const vx = (path.xAt(t + 0.05) - path.xAt(t - 0.05)) / 0.1;
    const yaw = Math.atan2(-vx, speedAt(t));
    headingNow = -yaw;                 // clockwise from -z, like a north-up minimap

    // blocks
    const b0 = Math.floor(-zp / L) - 1;
    for (let b = b0; b < b0 + SLOTS; b++) {
      const j = ((b % SLOTS) + SLOTS) % SLOTS;
      const tp = templates[j];
      tp.group.position.z = -b * L; tp.group.updateMatrixWorld();
      tp.b = b;
    }
    roadMesh.position.set(0, 0.0, Math.floor(zp / 12) * 12 - 220);
    lot.position.set(0, -0.02, Math.round(zp / 50) * 50);
    far.position.set(0, 0, zp);

    // hero
    hero.position.set(xp, 0, zp);
    hero.rotation.set(0, yaw, 0);
    hp.position.y = 0.012 * Math.sin(t * 17) + 0.008 * Math.sin(t * 29.3);
    hd.position.y = hp.position.y; hl.position.y = hp.position.y;

    for (const p of pools) p.n = 0;

    // same-direction traffic: one car per lane-change segment, always in the lane the player isn't in when passing
    const U1 = 6.2, iNow = Math.floor(t / SEG);
    for (let i = iNow - 2; i <= iNow + 8; i++) {
      for (let extra = 0; extra < 2; extra++) {
        if (extra && hash(seed, 41, i) > 0.35) continue;
        const tn = i * SEG + 2.4 + hash(seed, 11, i) * 3.6 + extra * 1.25;
        if (path.segInChase(i)) continue;
        const rel = U1 * (t - tn);             // + behind the player, - ahead
        if (rel > 30 || rel < -270) continue;
        const lane = path.laneOf(i) === LANE_IN ? LANE_OUT : LANE_IN;
        const shape = Math.floor(hash(seed, 13, i, extra) * 3);
        putCar(shape, lane + 0.05 * Math.sin(t * 0.9 + i), zp + rel, 0, Math.floor(hash(seed, 17, i, extra) * PAINTS.length));
      }
    }
    // oncoming traffic
    const U2 = V + 15.5, S2 = 38;
    const nA = Math.floor((U2 * t - 40) / S2) - 1, nB = Math.ceil((U2 * t + 280) / S2) + 1;
    for (let n = nA; n <= nB; n++) {
      const rel = -n * S2 + U2 * t + hash(seed, 21, n) * 14;
      if (rel > 40 || rel < -270) continue;
      if (hash(seed, 22, n) < 0.18) continue;
      const lane = hash(seed, 23, n) < 0.5 ? -LANE_IN : -LANE_OUT;
      putCar(Math.floor(hash(seed, 24, n) * 3), lane, zp + rel, Math.PI, Math.floor(hash(seed, 25, n) * PAINTS.length));
    }
    // parked cars, cross traffic, people
    let pc = 0;
    for (const tp of templates) {
      const bz = -tp.b * L;
      for (const c of tp.parked) { const z = bz + c.z; if (z - zp < 60 && zp - z < 300) putCar(c.shape, c.x, z, c.ry, c.color); }
      if (tp.inter) {
        const zc = bz - 8;
        if (zc - zp < 40 && zp - zc < 320) {
          const T = timeAtZ(zc);
          const xa = 11 * (t - (T - 2.7)); if (Math.abs(xa) < 90) putCar(Math.floor(hash(seed, 31, tp.b) * 3), xa, zc - 1.9, -Math.PI / 2, Math.floor(hash(seed, 32, tp.b) * PAINTS.length));
          const xb = -11 * (t - (T - 6.2)); if (Math.abs(xb) < 90) putCar(Math.floor(hash(seed, 33, tp.b) * 3), xb, zc + 1.9, Math.PI / 2, Math.floor(hash(seed, 34, tp.b) * PAINTS.length));
          const go = Math.max(0, t - T - 1.2);
          putCar(Math.floor(hash(seed, 35, tp.b) * 3), -13.2 + go * go * 2.2, zc - 1.9, -Math.PI / 2, Math.floor(hash(seed, 36, tp.b) * PAINTS.length));
          putCar(Math.floor(hash(seed, 37, tp.b) * 3), 13.2 - go * go * 2.2, zc + 1.9, Math.PI / 2, Math.floor(hash(seed, 38, tp.b) * PAINTS.length));
        }
      }
      for (const w of tp.walkers) {
        if (pc >= PEDCAP) break;
        const zl = (((w.z0 + w.v * t) % L) + L) % L;
        const z = bz - zl;
        if (z - zp > 30 || zp - z > 200) continue;
        const edge = Math.min(zl, L - zl);
        const sc = clamp(edge / 2.5, 0, 1);
        if (sc <= 0.01) continue;
        if (tp.inter && zl < 17) continue;
        _q.setFromEuler(_e.set(0, w.v > 0 ? Math.PI : 0, 0));
        _v.set(w.x, 0.18 + Math.abs(Math.sin(t * 5.2 * Math.abs(w.v) + w.ph)) * 0.05, z);
        _s.set(sc, sc, sc);
        _m.compose(_v, _q, _s);
        people.setMatrixAt(pc, _m); people.setColorAt(pc, w.shirt); pc++;
      }
    }
    people.count = pc; people.instanceMatrix.needsUpdate = true; if (people.instanceColor) people.instanceColor.needsUpdate = true;
    for (const p of pools) {
      for (const m of p.all) { m.count = p.n; m.instanceMatrix.needsUpdate = true; }
      if (p.paint.instanceColor) p.paint.instanceColor.needsUpdate = true;
    }

    // police chase
    const ch = path.chaseAt(t);
    let shake = 0;
    if (ch) {
      const u = ch.u;
      // closes in from behind the camera, rides alongside-behind on the left, then drops back
      const relIn = lerp(34, 3.2, smooth(u / 0.22));
      const relOut = lerp(3.2, 46, smooth((u - 0.8) / 0.2));
      const rel = u < 0.8 ? relIn + Math.sin(t * 1.7) * 1.2 * smooth((u - 0.2) / 0.1) : relOut;
      cop.position.set(LANE_IN + 0.25 * Math.sin(t * 1.3), 0, zp + rel);
      cop.rotation.set(0, 0.04 * Math.sin(t * 1.3 + 1), 0);
      const flash = Math.sin(t * 2 * Math.PI * 3.2) > 0;
      red.color.setRGB(flash ? 2.2 : 0.25, flash ? 0.15 : 0.02, flash ? 0.2 : 0.03);
      blue.color.setRGB(flash ? 0.03 : 0.2, flash ? 0.06 : 0.45, flash ? 0.3 : 2.4);
      copGlow.material.color.set(flash ? '#ff2030' : '#2a5cff');
      copGlow.material.opacity = 0.35 * smooth(u / 0.1) * (1 - smooth((u - 0.9) / 0.1));
      shake = 0.5 * smooth(u / 0.2) * (1 - smooth((u - 0.8) / 0.2));
    } else {
      cop.position.set(LANE_IN, 0, zp + 400);
    }

    // sun + shadow camera follow the car, snapped to shadow texels so edges don't swim
    _v.set(xp * 0.5, 0, zp - 22);
    const a = Math.round(_v.dot(sunR) / TEXEL) * TEXEL, bq = Math.round(_v.dot(sunU) / TEXEL) * TEXEL, c = _v.dot(sunD);
    sun.target.position.copy(sunR).multiplyScalar(a).addScaledVector(sunU, bq).addScaledVector(sunD, c);
    sun.position.copy(sun.target.position).add(SUN_OFF);
    sun.target.updateMatrixWorld();

    // chase cam: lateral lag + bank on lane changes, a little road buzz; portrait screens get a wider, higher cam
    const asp = camera.aspect, portrait = clamp(1 - asp, 0, 0.6);
    const baseFov = 56 + portrait * 34, baseDist = 7.1 + portrait * 3.2, baseH = 2.25 + portrait * 1.2;
    const xl = path.xAt(t - 0.38);
    const vl = (path.xAt(t - 0.2) - path.xAt(t - 0.3)) / 0.1;
    const push = fx ? fx.push : 0;
    const dist = baseDist - push * 1.3 + shake * 0.6, hgt = baseH - push * 0.25 + shake * 0.15;
    camPos.set(xl * 0.82 + xp * 0.18 + 0.15, hgt + 0.02 * Math.sin(t * 11.3) * (1 - push), zp + dist);
    camLook.set(xp * 0.6 + xl * 0.4 - 0.25, 1.05, zp - 14);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.rotateZ(-vl * 0.014 + shake * 0.004 * Math.sin(t * 23));
    const fov = baseFov - push * 11;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    sky.position.copy(camera.position);
  }

  function dispose() {
    box.dispose();
    disposeTree(scene);
    for (const o of own) o.dispose?.();
  }

  return { scene, camera, update, heading: () => headingNow, dispose, clear: HORIZON };
}
