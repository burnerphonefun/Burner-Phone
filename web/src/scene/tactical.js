// Our own dusty tactical bomb site at noon, built from blocks: walk down an alley, peek the corner,
// the site opens up (crates, a painted "A", a little device blinking), then back and around. Pure in t.
import * as THREE from 'three';
import { mulberry, clamp, lerp, smooth, canvasTex, disposeTree } from './util.js';
import { glowTexture, glowSprite, skyDome, cycleSprites } from './kit.js';
import { meshVoxels, pixelTex, shade } from './voxel.js';

const SX = 56, SY = 12, SZ = 60, OX = 20, OZ = 30;
const SAND = 1, STONE = 2, PLASTER = 3, TILE = 4, CRATE = 5, DARK = 6, METAL = 7, STONE2 = 8, BLUE = 9;
const HAZE = new THREE.Color('#e9dcc2');

export function buildTactical({ seed = 7, aspect = 16 / 9 } = {}) {
  const rnd = mulberry(seed * 17 + 3);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE, 30, 120);
  const own = [];

  // ---------- textures ----------
  const noisy = (px, base, vary) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(i, j, shade(base, (rnd() - 0.5) * vary)); };
  const tex = {
    sand: pixelTex(rnd, (px) => { noisy(px, '#d8b98a', 0.07); for (let k = 0; k < 9; k++) px(rnd() * 16 | 0, rnd() * 16 | 0, '#b99a6c'); }, own),
    stone: pixelTex(rnd, (px) => {
      noisy(px, '#d2a970', 0.06);
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const row = j >> 2, off = row % 2 ? 4 : 0; if (j % 4 === 3 || (i + off) % 8 === 7) px(i, j, shade('#a98252', (rnd() - 0.5) * 0.05)); }
    }, own),
    stone2: pixelTex(rnd, (px) => {
      noisy(px, '#c99a5e', 0.07);
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const row = j >> 3, off = row % 2 ? 6 : 0; if (j % 8 === 7 || (i + off) % 12 === 11) px(i, j, '#9a7444'); }
    }, own),
    plaster: pixelTex(rnd, (px) => { noisy(px, '#eadbbb', 0.05); for (let k = 0; k < 4; k++) { let i = rnd() * 16 | 0, j = rnd() * 16 | 0; for (let s = 0; s < 5; s++) { px(i, j, '#c9b48e'); i += rnd() < 0.5 ? 1 : 0; j += 1; } } }, own),
    tile: pixelTex(rnd, (px) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(i, j, i % 8 === 0 || j % 8 === 0 ? '#9a7b55' : shade(((i >> 3) + (j >> 3)) % 2 ? '#cfa877' : '#bf9466', (rnd() - 0.5) * 0.05)); }, own),
    crate: pixelTex(rnd, (px) => {
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
        const frame = i < 2 || i > 13 || j < 2 || j > 13, brace = Math.abs(i - j) < 1.2 || Math.abs(i - (15 - j)) < 1.2;
        px(i, j, frame ? shade('#7a5128', (rnd() - 0.5) * 0.05) : brace ? shade('#8c5e2e', (rnd() - 0.5) * 0.05) : shade(j % 4 === 0 ? '#9c6c38' : '#b07e44', (rnd() - 0.5) * 0.06));
      }
    }, own),
    dark: pixelTex(rnd, (px) => { noisy(px, '#5b3a20', 0.08); }, own),
    blue: pixelTex(rnd, (px) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(i, j, shade(i % 5 === 0 ? '#2a5f8a' : '#3a7cb0', (rnd() - 0.5) * 0.06)); }, own),
    metal: pixelTex(rnd, (px) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) px(i, j, shade(j % 3 === 0 ? '#58666e' : '#74838b', (rnd() - 0.5) * 0.04)); }, own),
  };
  const lam = (map) => { const m = new THREE.MeshLambertMaterial({ map, vertexColors: true }); own.push(m); return m; };
  const mats = { sand: lam(tex.sand), stone: lam(tex.stone), stone2: lam(tex.stone2), plaster: lam(tex.plaster), tile: lam(tex.tile), crate: lam(tex.crate), dark: lam(tex.dark), metal: lam(tex.metal), blue: lam(tex.blue) };
  const faces = {
    [SAND]: ['sand', 'sand', 'sand'], [STONE]: ['stone', 'stone', 'stone'], [PLASTER]: ['plaster', 'plaster', 'plaster'], [TILE]: ['tile', 'tile', 'tile'],
    [CRATE]: ['crate', 'crate', 'crate'], [DARK]: ['dark', 'dark', 'dark'], [METAL]: ['metal', 'metal', 'metal'], [STONE2]: ['stone2', 'stone2', 'stone2'], [BLUE]: ['blue', 'blue', 'blue'],
  };

  // ---------- the map (world coords: x right, z towards the alley start) ----------
  const V = new Uint8Array(SX * SY * SZ);
  const idx = (x, y, z) => x + SX * (z + SZ * y);
  const set = (wx, y, wz, v) => { const x = wx + OX, z = wz + OZ; if (x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ) V[idx(x, y, z)] = v; };
  const fill = (x0, x1, y0, y1, z0, z1, v) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, v); };
  const wall = (x0, x1, z0, z1, h, v = STONE) => fill(x0, x1, 1, h, z0, z1, v);
  fill(-OX, SX - OX - 1, 0, 0, -OZ, SZ - OZ - 1, SAND);
  fill(4, 23, 0, 0, -22, -2, TILE);                                      // site floor
  // the alley: walls on both sides, a plaster block on the left, a dead end at z = -8
  wall(-5, -3, -8, 26, 4); fill(-5, -3, 4, 4, -8, 26, PLASTER); wall(3, 5, 0, 26, 4, STONE2);
  fill(-5, -3, 1, 4, 6, 12, PLASTER);
  wall(-3, 3, -10, -8, 4); fill(-3, 3, 4, 4, -10, -8, PLASTER);
  fill(3, 3, 1, 2, 7, 8, BLUE); fill(-3, -3, 1, 2, 15, 16, BLUE);         // blue doors in the alley
  // the site: north wall with the A, east wall, south wall with a doorway, a raised platform with steps
  wall(3, 25, -24, -22, 5);
  wall(24, 26, -24, 0, 3); fill(24, 26, 4, 5, -24, 0, PLASTER); fill(24, 24, 1, 2, -10, -9, BLUE);
  wall(6, 25, 0, 1, 4, STONE2); fill(12, 14, 1, 3, 0, 1, 0); fill(11, 11, 1, 4, 0, 1, DARK); fill(15, 15, 1, 4, 0, 1, DARK); fill(11, 15, 4, 4, 0, 1, DARK);
  fill(17, 23, 1, 2, -21, -16, STONE); for (let s = 0; s < 2; s++) fill(15 + s, 15 + s, 1, 1 + s, -20, -17, STONE);
  fill(17, 23, 3, 3, -16, -16, METAL);                                   // a rail on the platform edge
  wall(6, 9, -16, -16, 2, PLASTER);                                      // low cover wall
  // crates
  const crates = [[8, -7, 2], [9, -7, 1], [8, -6, 1], [14, -12, 3], [14, -13, 2], [15, -12, 1], [19, -7, 1], [20, -7, 2], [5, -19, 2], [6, -19, 1], [21, -12, 1]];
  for (const [x, z, h] of crates) fill(x, x, 1, h, z, z, CRATE);
  fill(18, 19, 1, 2, -4, -3, METAL);                                     // a metal box by the doorway
  // the street the alley starts from, with a far building
  wall(-12, 12, 28, 29, 6, PLASTER); fill(-2, 1, 1, 2, 28, 28, BLUE);
  const vox = meshVoxels({ SX, SY, SZ, OX, OZ, get: (x, y, z) => V[idx(x, y, z)], faces, mats });
  scene.add(vox);

  // ---------- details: the painted A, the device, awning, barrels, cables ----------
  const aTex = canvasTex(128, 128, (x) => {
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(214,68,40,.92)'; x.font = '900 120px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('A', 64, 70);
    x.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 160; k++) { x.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.5})`; x.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 1 + rnd() * 3); }
  }, { repeat: false });
  own.push(aTex);
  const aMat = new THREE.MeshLambertMaterial({ map: aTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); own.push(aMat);
  const aSign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), aMat); aSign.position.set(13.5, 3.3, -20.96); own.push(aSign.geometry);
  scene.add(aSign);
  // arrows to the site on the alley wall
  const arrowTex = canvasTex(128, 32, (x) => { x.clearRect(0, 0, 128, 32); x.fillStyle = 'rgba(214,68,40,.85)'; x.font = '900 26px Impact, "Arial Black", sans-serif'; x.fillText('A  →', 8, 26); }, { repeat: false });
  own.push(arrowTex);
  const arrowMat = new THREE.MeshLambertMaterial({ map: arrowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); own.push(arrowMat);
  const arrow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), arrowMat); arrow.position.set(-2.98, 2.2, 3); arrow.rotation.y = Math.PI / 2; own.push(arrow.geometry);
  scene.add(arrow);
  // the device: a rugged little case with an antenna, a tiny screen and a blinking light (ours)
  const dev = new THREE.Group(); dev.position.set(11.6, 1, -10.4); dev.rotation.y = 0.5;
  const caseM = new THREE.MeshLambertMaterial({ color: '#3c4a2e' }), trimM = new THREE.MeshLambertMaterial({ color: '#1e2418' });
  const screenM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5cff8a').multiplyScalar(1.2), toneMapped: false });
  const ledM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a2a').multiplyScalar(2), toneMapped: false });
  own.push(caseM, trimM, screenM, ledM);
  const bx = new THREE.BoxGeometry(1, 1, 1); own.push(bx);
  const part = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(bx, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; dev.add(o); return o; };
  part(caseM, 0.62, 0.22, 0.42, 0, 0.11, 0); part(trimM, 0.66, 0.05, 0.46, 0, 0.2, 0);
  part(screenM, 0.24, 0.02, 0.12, -0.08, 0.235, 0.06);
  part(trimM, 0.025, 0.42, 0.025, 0.25, 0.42, -0.14);
  const led = part(ledM, 0.07, 0.04, 0.07, 0.15, 0.24, -0.1);
  const ledGlowT = glowTexture('rgba(255,90,80,1)', 'rgba(255,40,40,.35)', 'rgba(255,0,0,0)'); own.push(ledGlowT);
  const ledGlowM = glowSprite(ledGlowT, '#ff5050', 0.9); own.push(ledGlowM);
  const ledGlow = new THREE.Sprite(ledGlowM); ledGlow.position.set(0.15, 0.3, -0.1); ledGlow.scale.setScalar(0.9); dev.add(ledGlow);
  scene.add(dev);
  // an awning over the site's east door and a few barrels
  const awnT = canvasTex(32, 8, (x) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#e9dfc8' : '#2f7d6d'; x.fillRect(i * 4, 0, 4, 8); } }, { nearest: true }); own.push(awnT);
  const awnM = new THREE.MeshLambertMaterial({ map: awnT, side: THREE.DoubleSide }); own.push(awnM);
  const awn = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.8), awnM); awn.position.set(23.4, 3.4, -9.5); awn.rotation.set(-Math.PI / 2 + 0.5, Math.PI / 2, 0, 'YXZ'); awn.castShadow = true; own.push(awn.geometry);
  scene.add(awn);
  const barM = new THREE.MeshLambertMaterial({ color: '#3d6f8a' }); own.push(barM);
  const barG = new THREE.CylinderGeometry(0.32, 0.32, 0.95, 12); own.push(barG);
  for (const [x, z] of [[21.5, -18.5], [22.3, -18.9], [1.6, 20.5]]) { const b = new THREE.Mesh(barG, barM); b.position.set(x, x > 10 ? 3.48 : 0.48 + 1, z); b.castShadow = true; scene.add(b); }
  // cables across the alley
  const cabM = new THREE.LineBasicMaterial({ color: '#2a2622' }); own.push(cabM);
  for (const z of [4, 12, 19]) { /* cables strung between the alley walls */
    const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(new THREE.Vector3(-2 + u * 5, 5.2 - Math.sin(u * Math.PI) * 0.6, z + (u - 0.5) * 0.6)); }
    const g = new THREE.BufferGeometry().setFromPoints(pts); own.push(g);
    scene.add(new THREE.Line(g, cabM));
  }
  // dust motes drifting in the light
  const dustT = glowTexture('rgba(255,245,220,1)', 'rgba(255,240,210,.3)', 'rgba(255,240,210,0)'); own.push(dustT);
  const dustMat = new THREE.SpriteMaterial({ map: dustT, transparent: true, depthWrite: false, opacity: 0.55 }); own.push(dustMat);
  const dustG = new THREE.Group(); scene.add(dustG);
  const dr = mulberry(seed + 5);
  const dustSeed = Array.from({ length: 40 }, () => [dr() * 26 - 2, dr() * 4 + 0.4, dr() * 40 - 22, dr() * 10]);
  const moveDust = cycleSprites(dustG, dustMat, 40, (s, i, t) => {
    const [x, y, z, ph] = dustSeed[i];
    s.position.set(x + Math.sin(t * 0.21 + ph) * 1.4, y + Math.sin(t * 0.33 + ph * 2) * 0.4, z + Math.cos(t * 0.17 + ph) * 1.4);
    s.scale.setScalar(0.07 + 0.03 * Math.sin(t + ph));
  });

  // ---------- light: high hard sun, warm bounce ----------
  scene.add(new THREE.HemisphereLight('#d9ecff', '#c79a63', 1.05));
  const sun = new THREE.DirectionalLight('#fff0d4', 3.0);
  sun.position.set(-18, 40, 12); sun.target.position.set(8, 0, -6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const sky = skyDome({ top: '#5c9be0', mid: '#a9cdeb', low: '#f1e6cf', sunDir: new THREE.Vector3(-0.35, 0.85, 0.25), sunColor: '#fff6e0', sunPow: 300, glow: 0.12 });
  own.push(sky.material, sky.geometry);
  scene.add(sky);

  // ---------- camera: keyframed walk, peek, tour, back, turn around (40 s loop) ----------
  // [time, x, z, yaw (clockwise from -z), pitch, lean]
  const K = [
    [0, 0, 19, 0, -0.02, 0], [5.5, 0.4, 3, 0, -0.02, 0], [7, 1.1, 0.4, 0.15, -0.03, 0],
    [9.5, 1.6, -0.6, 1.15, -0.05, 0.11], [11, 3.6, -3.4, 0.85, -0.06, 0.03], [14.5, 7.2, -5.2, 0.32, 0.02, 0],
    [18, 10.8, -8.2, -0.1, -0.42, 0], [21, 13.2, -7.4, 0.95, -0.04, 0], [24, 16.4, -9.6, 3.48, -0.03, 0],
    [27, 4.6, -3.2, -2.35, -0.03, 0], [29, 1.2, -1.6, -2.7, -0.02, -0.04], [31, 0.4, 2, -3.12, -0.02, 0],
    [36, 0, 18.6, -3.14, -0.01, 0], [40, 0, 19, -6.283, -0.02, 0],
  ];
  const LOOP = 40;
  const camera = new THREE.PerspectiveCamera(74, aspect, 0.05, 400);
  const look = new THREE.Vector3(), dir = new THREE.Vector3();
  let headingNow = 0;
  const unwrap = (a, ref) => { while (a - ref > Math.PI) a -= Math.PI * 2; while (a - ref < -Math.PI) a += Math.PI * 2; return a; };
  const sample = (tt, out) => {
    let i = 0; while (i < K.length - 2 && tt >= K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1], u = smooth((tt - a[0]) / (b[0] - a[0]));
    out.x = lerp(a[1], b[1], u); out.z = lerp(a[2], b[2], u);
    out.yaw = lerp(a[3], unwrap(b[3], a[3]), u); out.pitch = lerp(a[4], b[4], u); out.lean = lerp(a[5], b[5], u);
    out.speed = Math.hypot(b[1] - a[1], b[2] - a[2]) / (b[0] - a[0]) * (u > 0.02 && u < 0.98 ? 1 : 0.4);
    return out;
  };
  const S = { x: 0, z: 0, yaw: 0, pitch: 0, lean: 0, speed: 0 };
  const T_OFF = 0.5;

  function update(t0, fx) {
    const t = t0 + T_OFF;
    const tt = ((t % LOOP) + LOOP) % LOOP;
    sample(tt, S);
    const walk = clamp(S.speed / 3, 0, 1);
    const step = t * 2.1 * Math.PI;
    const bob = Math.abs(Math.sin(step)) * 0.045 * walk, sway = Math.sin(step) * 0.02 * walk;
    const yaw = S.yaw, push = fx ? fx.push : 0;
    headingNow = yaw;
    // the lean slides the eye sideways (a peek) and rolls the view
    camera.position.set(S.x + Math.cos(yaw) * (S.lean * 4 + sway), 2.68 + bob - Math.abs(S.lean) * 0.6, S.z + Math.sin(yaw) * (S.lean * 4 + sway));
    dir.set(Math.sin(yaw) * Math.cos(S.pitch), Math.sin(S.pitch), -Math.cos(yaw) * Math.cos(S.pitch));
    camera.position.addScaledVector(dir, push * 1.0);
    look.copy(camera.position).add(dir);
    camera.lookAt(look);
    camera.rotateZ(-S.lean * 0.9);
    const fov = 74 + clamp(1 - camera.aspect, 0, 0.6) * 20 - push * 10;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    sky.position.copy(camera.position);
    // the device blinks faster as time runs down, and resets every 40 s
    const rate = 1.2 + 3.5 * (tt / LOOP);
    const on = Math.sin(t * rate * Math.PI * 2) > 0.2;
    led.visible = on; ledGlow.material.opacity = on ? 0.95 : 0.12;
    moveDust(t);
  }

  function dispose() { disposeTree(scene); for (const o of own) o.dispose?.(); }
  return { scene, camera, update, heading: () => headingNow, dispose, clear: HAZE };
}
