// Our own floating obby: a ring of glossy plastic platforms with studs, spinning bars and checkpoints over a sea
// of clouds, and our own blocky runner hopping platform to platform. Pure in t.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry, clamp, lerp, smooth, bake, merge, disposeTree } from './util.js';
import { skyDome } from './kit.js';

const SKY = new THREE.Color('#9fd6ff');
const PAL = ['#ff3d3d', '#2f7bff', '#ffd23a', '#2ecc71', '#ff8c1a', '#9b5cff', '#00c2d6', '#ff5fa2'];

export function buildObby({ seed = 7, aspect = 16 / 9 } = {}) {
  const rnd = mulberry(seed * 19 + 11);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#9fd2ff', 170, 420);
  const own = [];
  const plastic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.0 }); own.push(plastic);
  const box = new THREE.BoxGeometry(1, 1, 1); own.push(box);

  // ---------- the course: a closed ring of platforms rising and falling ----------
  const N = 26, RAD = 36;
  const kinds = ['pad', 'step', 'step', 'beam', 'spin', 'step', 'move', 'pad', 'step', 'kill', 'step', 'beam', 'check'];
  const plats = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const r = RAD + Math.sin(k * 1.7) * 3;
    const y = 12 + Math.sin(a * 2) * 5 + Math.sin(a * 3 + 1) * 1.5;
    const kind = k === 0 ? 'check' : kinds[k % kinds.length];
    const size = kind === 'pad' || kind === 'check' ? [6, 1.4, 6] : kind === 'spin' ? [7, 1.4, 7] : kind === 'beam' ? [2, 1.4, 7] : kind === 'kill' ? [5, 1.4, 4] : [3, 1.4, 3];
    plats.push({ k, a, x: Math.cos(a) * r, y, z: Math.sin(a) * r, kind, size, color: kind === 'kill' ? '#ff2a2a' : kind === 'check' ? '#2ecc71' : PAL[(k * 3) % PAL.length] });
  }
  const parts = [], studs = [];
  for (const p of plats) {
    if (p.kind === 'move') continue; // moving platforms are their own meshes
    const ry = -p.a + (p.kind === 'beam' ? 0 : Math.PI / 4 * (p.k % 2));
    parts.push(bake(box, { x: p.x, y: p.y - 0.7, z: p.z, sx: p.size[0], sy: p.size[1], sz: p.size[2], ry, color: p.color }));
    if (p.kind !== 'kill') {
      const c = Math.cos(ry), s = Math.sin(ry);
      for (let i = 0; i < Math.floor(p.size[0]); i++) for (let j = 0; j < Math.floor(p.size[2]); j++) {
        const lx = -p.size[0] / 2 + 0.5 + i + (p.size[0] % 1) / 2, lz = -p.size[2] / 2 + 0.5 + j + (p.size[2] % 1) / 2;
        studs.push([p.x + lx * c + lz * s, p.y + 0.06, p.z - lx * s + lz * c, p.color]);
      }
    }
  }
  // decorative floating blocks around the course and far away
  // distant floating islands: wide slabs below the course with a few stacked blocks on top
  for (let k = 0; k < 18; k++) {
    const a = rnd() * Math.PI * 2, r = 70 + rnd() * 110, s = 8 + rnd() * 12, y = -6 + rnd() * 14;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, c = PAL[k % PAL.length];
    parts.push(bake(box, { x, y, z, sx: s, sy: 2, sz: s * 0.8, ry: rnd() * 3, color: c }));
    for (let j = 0; j < 3; j++) parts.push(bake(box, { x: x + (rnd() - 0.5) * s * 0.6, y: y + 1.5 + j * 1.6, z: z + (rnd() - 0.5) * s * 0.5, sx: 1.6, sy: 1.6, sz: 1.6, color: PAL[(k + j + 2) % PAL.length] }));
  }
  // a tall tower in the middle of the ring (the goal everyone sees)
  for (let i = 0; i < 9; i++) parts.push(bake(box, { x: 0, y: 2 + i * 3.2, z: 0, sx: 6 - i * 0.35, sy: 3, sz: 6 - i * 0.35, ry: i * 0.3, color: PAL[i % PAL.length] }));
  const course = new THREE.Mesh(merge(parts), plastic); course.castShadow = true; course.receiveShadow = true;
  scene.add(course);
  const studG = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12); own.push(studG);
  const studM = new THREE.MeshStandardMaterial({ roughness: 0.3 }); own.push(studM);
  const studI = new THREE.InstancedMesh(studG, studM, studs.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  studs.forEach(([x, y, z, c], i) => { m4.makeTranslation(x, y, z); studI.setMatrixAt(i, m4); studI.setColorAt(i, col.set(c).offsetHSL(0, 0, 0.06)); });
  studI.castShadow = true;
  scene.add(studI);

  // ---------- moving platforms, spinning bars, kill-brick glow, checkpoint flags ----------
  const movers = plats.filter((p) => p.kind === 'move').map((p) => {
    const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.32 })); own.push(m.material);
    m.scale.set(...p.size); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    return { p, m };
  });
  const barM = new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff1010', emissiveIntensity: 1.4, roughness: 0.4 }); own.push(barM);
  const barG = new THREE.CylinderGeometry(0.2, 0.2, 6.4, 10); barG.rotateZ(Math.PI / 2); own.push(barG);
  const spinners = plats.filter((p) => p.kind === 'spin').map((p) => {
    const g = new THREE.Group(); g.position.set(p.x, p.y + 0.9, p.z);
    const bar = new THREE.Mesh(barG, barM); bar.castShadow = true; g.add(bar);
    const hub = new THREE.Mesh(box, barM); hub.scale.set(0.5, 1.2, 0.5); hub.position.y = -0.4; g.add(hub);
    scene.add(g); return g;
  });
  const killM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3030').multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.35 }); own.push(killM);
  for (const p of plats.filter((q) => q.kind === 'kill')) { const g = new THREE.Mesh(box, killM); g.scale.set(p.size[0] + 0.1, 0.06, p.size[2] + 0.1); g.position.set(p.x, p.y + 0.03, p.z); g.rotation.y = -p.a + Math.PI / 4 * (p.k % 2); scene.add(g); }
  const poleM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }); own.push(poleM);
  const flagM = new THREE.MeshStandardMaterial({ color: '#2ecc71', side: THREE.DoubleSide, roughness: 0.6 }); own.push(flagM);
  const flagG = new THREE.PlaneGeometry(1.4, 0.9, 6, 1); flagG.translate(0.7, 0, 0); own.push(flagG);
  const flags = plats.filter((p) => p.kind === 'check').map((p) => {
    const g = new THREE.Group(); g.position.set(p.x + 1.4, p.y, p.z + 1.4);
    const pole = new THREE.Mesh(box, poleM); pole.scale.set(0.12, 3, 0.12); pole.position.y = 1.5; pole.castShadow = true;
    const flag = new THREE.Mesh(flagG, flagM); flag.position.y = 2.5; flag.castShadow = true;
    g.add(pole, flag); scene.add(g); return flag;
  });

  // ---------- a sea of clouds below, a few above ----------
  const blob = new THREE.IcosahedronGeometry(1, 1); own.push(blob);
  const cloudParts = [];
  const cr = mulberry(seed + 41);
  for (let k = 0; k < 90; k++) {
    const a = cr() * Math.PI * 2, r = 20 + cr() * 190, s = 5 + cr() * 8;
    cloudParts.push(bake(blob, { x: Math.cos(a) * r, y: -30 + cr() * 5, z: Math.sin(a) * r, sx: s * 1.5, sy: s * 0.5, sz: s, color: '#ffffff' }));
  }
  for (let k = 0; k < 14; k++) {
    const a = cr() * Math.PI * 2, r = 70 + cr() * 120, s = 5 + cr() * 6;
    for (let j = 0; j < 4; j++) cloudParts.push(bake(blob, { x: Math.cos(a) * r + j * 4, y: 50 + cr() * 18, z: Math.sin(a) * r + cr() * 3, sx: s, sy: s * 0.6, sz: s * 0.9, color: '#ffffff' }));
  }
  const cloudM = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#9fc8f0', emissiveIntensity: 0.22 }); own.push(cloudM);
  const clouds = new THREE.Mesh(merge(cloudParts), cloudM);
  scene.add(clouds);

  // ---------- the runner (our own blocky figure: big rounded head, orange cap) ----------
  const runner = new THREE.Group();
  const M = (c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }); own.push(m); return m; };
  const headG = new RoundedBoxGeometry(0.9, 0.85, 0.85, 3, 0.18), torsoG = new RoundedBoxGeometry(0.95, 1.0, 0.5, 2, 0.08), limbG = new RoundedBoxGeometry(0.42, 1.0, 0.42, 2, 0.08);
  own.push(headG, torsoG, limbG);
  const add = (g, m, x, y, z, parent = runner) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  add(torsoG, M('#14b8a6'), 0, 1.5, 0);
  const head = add(headG, M('#ffd9b3'), 0, 2.45, 0);
  const capM = M('#ff7a1a');
  add(box, capM, 0, 2.86, 0.02).scale.set(0.94, 0.16, 0.9);
  add(box, capM, 0, 2.8, -0.55).scale.set(0.7, 0.07, 0.3);
  const eyeM = M('#1a1a2e');
  add(box, eyeM, -0.2, 2.5, -0.43).scale.set(0.1, 0.16, 0.02); add(box, eyeM, 0.2, 2.5, -0.43).scale.set(0.1, 0.16, 0.02);
  const limb = (x, y, m) => { const p = new THREE.Group(); p.position.set(x, y, 0); runner.add(p); add(limbG, m, 0, -0.5, 0, p); return p; };
  const skin = M('#ffd9b3'), legM = M('#27306b');
  const armL = limb(-0.7, 1.98, skin), armR = limb(0.7, 1.98, skin), legL = limb(-0.24, 1.0, legM), legR = limb(0.24, 1.0, legM);
  runner.scale.setScalar(0.74);
  scene.add(runner);

  // the hop schedule: run across each platform, jump to the next (precomputed, then sampled by t)
  const seg = [];
  let T = 0;
  for (let k = 0; k < N; k++) {
    const a = plats[k], b = plats[(k + 1) % N];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    seg.push({ a, b, t0: T, run: 0.6, jump: 0.5 + d * 0.04 });
    T += 0.6 + 0.5 + d * 0.04;
  }
  const LOOP = T;
  const pos = new THREE.Vector3(), fwd = new THREE.Vector3();
  function runnerAt(t, out) {
    const tt = ((t % LOOP) + LOOP) % LOOP;
    let s = seg[0]; for (const q of seg) { if (tt >= q.t0) s = q; else break; }
    const local = tt - s.t0;
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    const ay = moverY(s.a, t), by = moverY(s.b, t);
    const aoff = moverOff(s.a, t), boff = moverOff(s.b, t);
    if (local < s.run) {
      const u = local / s.run;
      out.set(s.a.x + aoff.x + ux * lerp(-1.1, 1.1, u), ay, s.a.z + aoff.z + uz * lerp(-1.1, 1.1, u));
      return { air: 0, phase: u, ux, uz };
    }
    const u = (local - s.run) / s.jump;
    const x0 = s.a.x + aoff.x + ux * 1.1, z0 = s.a.z + aoff.z + uz * 1.1, x1 = s.b.x + boff.x - ux * 1.1, z1 = s.b.z + boff.z - uz * 1.1;
    const apex = Math.max(ay, by) + 1.6;
    const y = lerp(ay, by, u) + (apex - Math.max(ay, by) + Math.abs(by - ay) * 0.5) * 4 * u * (1 - u);
    out.set(lerp(x0, x1, u), y, lerp(z0, z1, u));
    return { air: 1, phase: u, ux, uz };
  }
  const _o = { x: 0, z: 0 };
  function moverOff(p, t) { if (p.kind !== 'move') { _o.x = 0; _o.z = 0; return _o; } const s = Math.sin(t * 1.2 + p.k) * 1.6; _o.x = -Math.sin(p.a) * s; _o.z = Math.cos(p.a) * s; return _o; }
  function moverY(p) { return p.y; }

  // ---------- light ----------
  scene.add(new THREE.HemisphereLight('#d6efff', '#9ab0c8', 1.1));
  const sun = new THREE.DirectionalLight('#fff6e6', 2.4);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const SUN_OFF = new THREE.Vector3(-30, 60, 25);
  const sky = skyDome({ top: '#1f7cf0', mid: '#5fb4ff', low: '#9dd3ff', sunDir: new THREE.Vector3(-0.45, 0.75, 0.35), sunColor: '#fffbe8', sunPow: 260, glow: 0.2 });
  own.push(sky.material, sky.geometry);
  scene.add(sky);

  // ---------- camera ----------
  const camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 600);
  const look = new THREE.Vector3(), cam = new THREE.Vector3(), ahead = new THREE.Vector3();
  let headingNow = 0;
  const T_OFF = 0.3;

  function update(t0, fx) {
    const t = t0 + T_OFF;
    const st = runnerAt(t, pos);
    runner.position.copy(pos);
    runner.rotation.y = Math.atan2(-st.ux, -st.uz);
    const sw = st.air ? 0 : Math.sin(st.phase * Math.PI * 4);
    legL.rotation.x = st.air ? -0.7 : sw * 0.8; legR.rotation.x = st.air ? 0.5 : -sw * 0.8;
    armL.rotation.x = st.air ? -2.6 : -sw * 0.7; armR.rotation.x = st.air ? -2.6 : sw * 0.7;
    head.rotation.y = Math.sin(t * 0.7) * 0.15;
    // camera: behind along the ring, a little outside and above, looking ahead along the course
    const ang = Math.atan2(pos.z, pos.x);
    fwd.set(-Math.sin(ang), 0, Math.cos(ang));             // ring tangent (direction of travel)
    const push = fx ? fx.push : 0;
    const back = 11 - push * 3.5, out = 4.2;
    cam.set(pos.x - fwd.x * back + Math.cos(ang) * out, 0, pos.z - fwd.z * back + Math.sin(ang) * out);
    runnerAt(t - 0.55, ahead);                                 // the camera height trails the jump arcs
    cam.y = lerp(ahead.y, pos.y, 0.4) + 6.2;
    camera.position.copy(cam);
    look.set(pos.x + fwd.x * 7 - Math.cos(ang) * 1.6, pos.y + 0.8, pos.z + fwd.z * 7 - Math.sin(ang) * 1.6);
    camera.lookAt(look);
    headingNow = Math.atan2(fwd.x, -fwd.z);
    const fov = 62 + clamp(1 - camera.aspect, 0, 0.6) * 22 - push * 8;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    sun.position.copy(pos).add(SUN_OFF); sun.target.position.copy(pos);
    sky.position.copy(camera.position);
    for (const g of spinners) g.rotation.y = t * 2.2;
    for (const { p, m } of movers) { const o = moverOff(p, t); m.position.set(p.x + o.x, p.y - 0.7, p.z + o.z); m.rotation.y = -p.a; }
    for (const f of flags) f.rotation.y = Math.sin(t * 3) * 0.25;
    clouds.position.x = Math.sin(t * 0.03) * 6;
  }

  function dispose() { disposeTree(scene); for (const o of own) o.dispose?.(); }
  return { scene, camera, update, heading: () => headingNow, dispose, clear: SKY };
}
