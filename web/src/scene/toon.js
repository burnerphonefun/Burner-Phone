// Our own cartoon battle-royale island in daylight: a third-person runner past loot and houses,
// a purple storm wall closing in at the edge, a bus-under-a-balloon drifting overhead. Pure in t.
import * as THREE from 'three';
import { mulberry, clamp, lerp, smooth, bake, merge, canvasTex, disposeTree } from './util.js';
import { makeNoise, loopPath, toonRamp, glowTexture, glowSprite, skyDome } from './kit.js';
import stormVert from './shaders/storm.vert.glsl?raw';
import stormFrag from './shaders/storm.frag.glsl?raw';

const SKY = new THREE.Color('#8fd0ff');

export function buildToon({ seed = 7, aspect = 16 / 9 } = {}) {
  const rnd = mulberry(seed * 31 + 5);
  const vn = makeNoise(seed * 7 + 2);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#a8dcff', 110, 340);
  const own = [];
  const ramp = toonRamp([0.42, 0.74, 1]); own.push(ramp);
  const toon = (opts) => { const m = new THREE.MeshToonMaterial({ gradientMap: ramp, ...opts }); own.push(m); return m; };

  // ---------- island ----------
  const R = 56;
  const heightAt = (x, z) => {
    const r = Math.hypot(x, z) + (vn(x / 18 + 4, z / 18) - 0.5) * 16;
    const mask = smooth((R - r) / 22);
    let h = -3 + mask * (5.2 + vn(x / 22, z / 22 + 9) * 5 + Math.pow(vn(x / 11 + 3, z / 11), 2) * 4);
    h += 9 * Math.exp(-((x + 14) ** 2 + (z + 18) ** 2) / 260);            // the hill
    return h;
  };
  // ---------- the run (closed loop over the island) ----------
  const path = loopPath([[-6, 20], [10, 22], [24, 12], [28, -4], [20, -18], [6, -26], [-8, -30], [-24, -26], [-32, -10], [-30, 6], [-20, 16]]);
  const SPEED = 5.4;
  const pts = Array.from({ length: 200 }, (_, i) => path.pos((i / 200) * path.len, new THREE.Vector3()));
  const nearPath = (x, z, r) => pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);

  const pathD = (x, z) => { let d = 1e9; for (const p of pts) { const e = (p.x - x) ** 2 + (p.z - z) ** 2; if (e < d) d = e; } return Math.sqrt(d); };
  const N = 112, SIZE = 170;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
  tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heightAt(tp.getX(i), tp.getZ(i)));
  const terrainG = tg.toNonIndexed(); tg.dispose();
  terrainG.computeVertexNormals();
  {
    const p = terrainG.attributes.position, nrm = terrainG.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, ny = nrm.getY(i);
      const x = p.getX(i), z = p.getZ(i), v = vn(x / 6, z / 6);
      const pd = pathD(x, z);
      if (y < -0.6) c.set('#5fd8d0');
      else if (y < 0.55) c.set(v > 0.55 ? '#ffe7a8' : '#f4d488');
      else if (ny < 0.8) c.set('#a8937c');
      else if (pd < 1.9) c.set(v > 0.5 ? '#d9a865' : '#c99656');
      else if (y > 8) c.set('#2f9c3c');
      else c.setHSL(0.30 + (v - 0.5) * 0.05, 0.72, 0.4 + (v - 0.5) * 0.1 + (vn(x / 2.5, z / 2.5) > 0.7 ? 0.05 : 0));
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    terrainG.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const terrain = new THREE.Mesh(terrainG, toon({ vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), toon({ color: '#26bfe6', transparent: true, opacity: 0.8 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = 0.05; own.push(sea.geometry);
  scene.add(sea);

  // ---------- props, merged by material ----------
  const parts = { wood: [], leaf: [], wall: [], roof: [], dark: [], rock: [], white: [] };
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 8), cone = new THREE.ConeGeometry(1, 1, 4), blob = new THREE.IcosahedronGeometry(1, 1), rockG = new THREE.DodecahedronGeometry(1, 0);
  own.push(box, cyl, cone, blob, rockG);
  // trees: chunky trunks + two or three round canopy blobs
  let trees = 0;
  for (let k = 0; k < 600 && trees < 95; k++) {
    const x = (rnd() - 0.5) * 2 * R, z = (rnd() - 0.5) * 2 * R, y = heightAt(x, z);
    if (y < 1 || nearPath(x, z, 4.5) || Math.hypot(x - 2, z + 2) < 9) continue;
    const s = 0.8 + rnd() * 0.7, hue = 0.28 + rnd() * 0.08;
    parts.wood.push(bake(cyl, { x, y: y + 1.3 * s, z, sx: 0.28 * s, sy: 2.6 * s, sz: 0.28 * s, color: '#9a6a3c' }));
    const n = rnd() < 0.5 ? 2 : 3;
    for (let j = 0; j < n; j++) {
      const c = new THREE.Color().setHSL(hue, 0.6, 0.38 + j * 0.06);
      parts.leaf.push(bake(blob, { x: x + (rnd() - 0.5) * 0.8 * s, y: y + (2.8 + j * 1.15) * s, z: z + (rnd() - 0.5) * 0.8 * s, sx: (1.7 - j * 0.35) * s, sy: (1.25 - j * 0.2) * s, sz: (1.7 - j * 0.35) * s, color: c }));
    }
    trees++;
  }
  // rocks
  for (let k = 0; k < 40; k++) {
    const x = (rnd() - 0.5) * 2 * R, z = (rnd() - 0.5) * 2 * R, y = heightAt(x, z);
    if (y < 0.3 || nearPath(x, z, 3)) continue;
    const s = 0.5 + rnd() * 1.4;
    parts.rock.push(bake(rockG, { x, y: y + s * 0.3, z, sx: s, sy: s * 0.7, sz: s * 1.1, ry: rnd() * 6, color: new THREE.Color().setHSL(0.08, 0.12, 0.62 + rnd() * 0.1) }));
  }
  // houses: pastel walls, pointy roofs, dark windows; a little town on the east side
  const houses = [[14, 2, 0.4, '#ffd0e4', '#ff5a7a'], [22, -8, 1.9, '#fff0b8', '#3f8cff'], [8, -14, 0.9, '#c9f1ff', '#ff9a2e'], [-18, 0, 2.6, '#e3d6ff', '#2ec27e'], [-4, -12, 0.2, '#fff6e6', '#9b5cff']];
  for (const [x, z, ry, wall, roof] of houses) {
    const y = heightAt(x, z), w = 5 + rnd() * 2, d = 4.5 + rnd() * 1.5, h = 3.2;
    parts.wall.push(bake(box, { x, y: y + h / 2 - 0.3, z, sx: w, sy: h, sz: d, ry, color: wall }));
    parts.roof.push(bake(cone, { x, y: y + h + 1.1, z, sx: w * 0.78, sy: 2.4, sz: d * 0.78, ry: ry + Math.PI / 4, color: roof }));
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const at = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    for (const lx of [-w * 0.28, w * 0.28]) { const [wx, wz] = at(lx, d / 2 + 0.02); parts.dark.push(bake(box, { x: wx, y: y + h * 0.55, z: wz, sx: 0.9, sy: 0.9, sz: 0.06, ry, color: '#2b3a55' })); }
    const [dx, dz] = at(0, -d / 2 - 0.02); parts.dark.push(bake(box, { x: dx, y: y + 0.75, z: dz, sx: 1.0, sy: 1.9, sz: 0.06, ry, color: '#6b3f22' }));
    parts.white.push(bake(box, { x, y: y + h - 0.2, z, sx: w + 0.2, sy: 0.3, sz: d + 0.2, ry, color: '#ffffff' }));
  }
  const pm = {
    wood: toon({ vertexColors: true }), leaf: toon({ vertexColors: true }), wall: toon({ vertexColors: true }), roof: toon({ vertexColors: true }),
    dark: toon({ vertexColors: true }), rock: toon({ vertexColors: true }), white: toon({ vertexColors: true }),
  };
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(merge(list), pm[k]); m.castShadow = true; m.receiveShadow = true; scene.add(m);
  }

  // ---------- loot chests: gold, glowing, sparkling ----------
  const goldM = toon({ color: '#ffc531', emissive: '#a86a00', emissiveIntensity: 0.6 });
  const trimM = toon({ color: '#7a4a12' });
  const glowT = glowTexture('rgba(255,236,150,1)', 'rgba(255,200,60,.45)', 'rgba(255,170,30,0)'); own.push(glowT);
  const glowM = glowSprite(glowT, '#ffe28a', 0.42); own.push(glowM);
  const beamT = canvasTex(16, 128, (x) => { const g = x.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, 'rgba(255,230,140,.32)'); g.addColorStop(1, 'rgba(255,230,140,0)'); x.fillStyle = g; x.fillRect(4, 0, 8, 128); }, { repeat: false }); own.push(beamT);
  const beamM = new THREE.MeshBasicMaterial({ map: beamT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }); own.push(beamM);
  const beamG = new THREE.PlaneGeometry(0.9, 7); beamG.translate(0, 3.5, 0); own.push(beamG);
  const chests = [];
  for (const d of [0.08, 0.27, 0.45, 0.63, 0.82]) {
    const p = path.pos(d * path.len, new THREE.Vector3()), tn = path.tan(d * path.len, new THREE.Vector3());
    const side = chests.length % 2 ? 1 : -1;
    const x = p.x + tn.z * 2.6 * side, z = p.z - tn.x * 2.6 * side, y = heightAt(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(tn.x, tn.z);
    const body = new THREE.Mesh(box, goldM); body.scale.set(1.2, 0.7, 0.8); body.position.y = 0.35; body.castShadow = true;
    const lid = new THREE.Mesh(box, goldM); lid.scale.set(1.24, 0.3, 0.84); lid.position.y = 0.85;
    const band = new THREE.Mesh(box, trimM); band.scale.set(1.26, 0.12, 0.86); band.position.y = 0.7;
    const sp = new THREE.Sprite(glowM); sp.position.y = 0.8; sp.scale.setScalar(3.4);
    const b1 = new THREE.Mesh(beamG, beamM), b2 = new THREE.Mesh(beamG, beamM); b2.rotation.y = Math.PI / 2;
    g.add(body, lid, band, sp, b1, b2);
    scene.add(g);
    chests.push({ g, sp, lid, ph: chests.length * 1.3 });
  }

  // ---------- the storm: a purple wall at the edge, closing in slowly ----------
  const stormM = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { t: { value: 0 } },
    vertexShader: stormVert,
    fragmentShader: stormFrag,
  });
  own.push(stormM);
  const storm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true, 0.6, Math.PI * 1.25), stormM);
  storm.scale.set(78, 46, 78); storm.position.set(18, 16, -10); own.push(storm.geometry);
  scene.add(storm);

  // ---------- the bus under a balloon ----------
  const balloon = new THREE.Group();
  const stripeT = canvasTex(64, 16, (x) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#ff4f8b'; x.fillRect(i * 8, 0, 8, 16); } }, { nearest: true }); own.push(stripeT);
  const env = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), toon({ map: stripeT })); env.scale.set(5.2, 6, 5.2); env.position.y = 8.5; own.push(env.geometry);
  const busM = toon({ color: '#3f6cff' }), busTrim = toon({ color: '#ffd23a' }), glassM = toon({ color: '#cfefff' });
  const bus = new THREE.Mesh(box, busM); bus.scale.set(7, 2.4, 2.6);
  const stripe = new THREE.Mesh(box, busTrim); stripe.scale.set(7.05, 0.4, 2.65); stripe.position.y = -0.3;
  const win = new THREE.Mesh(box, glassM); win.scale.set(6, 0.9, 2.66); win.position.y = 0.55;
  const ropeM = new THREE.LineBasicMaterial({ color: '#5a4a3a' }); own.push(ropeM);
  const ropeG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-3, 1.2, -1), new THREE.Vector3(-2.5, 5, -2), new THREE.Vector3(3, 1.2, -1), new THREE.Vector3(2.5, 5, -2), new THREE.Vector3(-3, 1.2, 1), new THREE.Vector3(-2.5, 5, 2), new THREE.Vector3(3, 1.2, 1), new THREE.Vector3(2.5, 5, 2)]); own.push(ropeG);
  balloon.add(env, bus, stripe, win, new THREE.LineSegments(ropeG, ropeM));
  balloon.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(balloon);

  // ---------- puffy clouds ----------
  const cloudParts = [];
  const cr = mulberry(seed + 77);
  for (let k = 0; k < 16; k++) {
    const a = cr() * Math.PI * 2, rr = 60 + cr() * 140, cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, cy = 48 + cr() * 26;
    for (let j = 0; j < 5; j++) cloudParts.push(bake(blob, { x: cx + (j - 2) * 4 + cr() * 2, y: cy + Math.sin(j) * 1.2, z: cz + cr() * 3, sx: 4 + cr() * 3, sy: 2.6 + cr() * 1.5, sz: 4 + cr() * 2, color: '#ffffff' }));
  }
  const clouds = new THREE.Mesh(merge(cloudParts), toon({ vertexColors: true, fog: false }));
  scene.add(clouds);

  // ---------- the runner (our own toon character) ----------
  const runner = new THREE.Group();
  // rounded cartoon proportions (capsules, a big head with hair, a glider pack) so it reads "toon shooter", not a block avatar
  const skin = toon({ color: '#ffc896' }), hoodie = toon({ color: '#ff7a1a' }), pants = toon({ color: '#2d3a7a' }), hair = toon({ color: '#5a2f1a' }), shoe = toon({ color: '#ffffff' }), pack = toon({ color: '#8a44ff' }), wing = toon({ color: '#ffd23a' });
  const cap = (r, len) => { const g = new THREE.CapsuleGeometry(r, len, 4, 10); own.push(g); return g; };
  const mk = (geo, mat, sx, sy, sz, x, y, z, parent = runner) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const rTorso = mk(cap(0.3, 0.42), hoodie, 1, 1, 0.72, 0, 1.2, 0);
  mk(cap(0.18, 0.22), pack, 1.1, 1, 0.8, 0, 1.28, 0.24);
  mk(box, wing, 0.95, 0.06, 0.3, 0, 1.52, 0.3).rotation.x = -0.3;
  const headG = new THREE.SphereGeometry(0.3, 18, 14); own.push(headG);
  const head = mk(headG, skin, 1, 1.02, 1, 0, 1.86, 0);
  const hairG = new THREE.SphereGeometry(0.32, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62); own.push(hairG);
  mk(hairG, hair, 1, 0.95, 1.04, 0, 1.9, 0.02).rotation.x = 0.35;
  const limb = (x, y, mat, len, r) => { const p = new THREE.Group(); p.position.set(x, y, 0); runner.add(p); mk(cap(r, len), mat, 1, 1, 1, 0, -len / 2 - r * 0.4, 0, p); return p; };
  const armL = limb(-0.42, 1.48, hoodie, 0.46, 0.1), armR = limb(0.42, 1.48, hoodie, 0.46, 0.1);
  const legL = limb(-0.15, 0.86, pants, 0.56, 0.13), legR = limb(0.15, 0.86, pants, 0.56, 0.13);
  mk(box, shoe, 0.26, 0.14, 0.4, 0, -0.84, -0.05, legL); mk(box, shoe, 0.26, 0.14, 0.4, 0, -0.84, -0.05, legR);
  scene.add(runner);

  // ---------- light ----------
  scene.add(new THREE.HemisphereLight('#bfe4ff', '#4f9a45', 0.75));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const SUN_OFF = new THREE.Vector3(-40, 70, 30);
  const sky = skyDome({ top: '#1f6fe8', mid: '#5fb4ff', low: '#c6ecff', sunDir: new THREE.Vector3(-0.4, 0.7, 0.3), sunColor: '#fff6d8', sunPow: 220, glow: 0.18 });
  own.push(sky.material, sky.geometry);
  scene.add(sky);

  // ---------- camera ----------
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 900);
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3(), tan = new THREE.Vector3(), cam = new THREE.Vector3(), look = new THREE.Vector3(), dir = new THREE.Vector3();
  let headingNow = 0;
  const T_OFF = 8;

  function update(t0, fx) {
    const t = t0 + T_OFF;
    const d = t * SPEED;
    path.pos(d, pos); path.tan(d, tan);
    pos.y = heightAt(pos.x, pos.z);
    // a hop every ~6.5 s
    const jp = (t % 6.5) / 0.75;
    const hop = jp < 1 ? Math.sin(jp * Math.PI) * 1.1 : 0;
    runner.position.set(pos.x, pos.y + hop, pos.z);
    runner.rotation.y = Math.atan2(-tan.x, -tan.z);
    const ph = t * 10.5;
    const air = jp < 1 ? 1 : 0;
    legL.rotation.x = air ? -0.5 : Math.sin(ph) * 0.9; legR.rotation.x = air ? 0.3 : -Math.sin(ph) * 0.9;
    armL.rotation.x = air ? -2.2 : -Math.sin(ph) * 0.8; armR.rotation.x = air ? -2.2 : Math.sin(ph) * 0.8;
    rTorso.rotation.x = -0.12; head.position.y = 1.86 + Math.abs(Math.sin(ph)) * 0.03;
    // chase cam: behind and a bit right, so the runner sits left of the phone corner
    path.pos(d + 6, ahead);
    dir.copy(ahead).sub(pos).setY(0).normalize();
    const push = fx ? fx.push : 0;
    const back = 6.4 - push * 2.2, side = 1.5, up = 2.7;
    cam.set(pos.x - dir.x * back - dir.z * side, 0, pos.z - dir.z * back + dir.x * side);
    cam.y = Math.max(pos.y + up, heightAt(cam.x, cam.z) + 1.4);
    camera.position.copy(cam);
    look.set(pos.x + dir.x * 4 - dir.z * 0.6, pos.y + 1.6 + hop * 0.4, pos.z + dir.z * 4 + dir.x * 0.6);
    camera.lookAt(look);
    headingNow = Math.atan2(dir.x, -dir.z);
    const fov = 60 + clamp(1 - camera.aspect, 0, 0.6) * 24 - push * 8;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // world motion
    sun.position.copy(pos).add(SUN_OFF); sun.target.position.copy(pos);
    sky.position.copy(camera.position);
    const sr = 78 - 6 * (0.5 + 0.5 * Math.sin(t * 0.05));
    storm.scale.set(sr, 46, sr);
    stormM.uniforms.t.value = t;
    const ba = t * 0.035;
    balloon.position.set(Math.cos(ba) * 46, 44 + Math.sin(t * 0.4) * 1.2, Math.sin(ba) * 46);
    balloon.rotation.y = -ba;
    clouds.position.x = (t * 0.6) % 40;
    for (const c of chests) {
      const f = 0.5 + 0.5 * Math.sin(t * 3 + c.ph);
      c.sp.scale.setScalar(2.2 + f * 0.6);
      c.lid.position.y = 0.85 + f * 0.04;
    }
  }

  function dispose() { disposeTree(scene); for (const o of own) o.dispose?.(); }
  return { scene, camera, update, heading: () => headingNow, dispose, clear: SKY };
}
