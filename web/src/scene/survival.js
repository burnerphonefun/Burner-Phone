// Our own survival island at dusk: a first-person walk around a camp of rusty corrugated shacks and a log wall,
// a campfire crackling, the sun going down into the sea. Pure in t.
import * as THREE from 'three';
import { mulberry, clamp, lerp, smooth, bake, merge, canvasTex, disposeTree } from './util.js';
import { makeNoise, loopPath, glowTexture, glowSprite, skyDome, cycleSprites } from './kit.js';

const DUSK = new THREE.Color('#2a2440');

export function buildSurvival({ seed = 7, aspect = 16 / 9 } = {}) {
  const rnd = mulberry(seed * 23 + 9);
  const vn = makeNoise(seed * 5 + 3);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#8c6a8c', 45, 240);
  const own = [];
  const lam = (o) => { const m = new THREE.MeshLambertMaterial(o); own.push(m); return m; };

  // ---------- terrain: a beach sloping into the sea to the south (-z), hills inland ----------
  const shoreZ = (x) => -24 + (vn(x / 20 + 3, 1.7) - 0.5) * 10;
  const heightAt = (x, z) => {
    let h = clamp((z - shoreZ(x)) * 0.14, -3, 2.2);
    h += smooth((z - 18) / 30) * (4 + vn(x / 16, z / 16 + 5) * 10);
    h += (vn(x / 7, z / 7) - 0.5) * 0.8;
    const dc = Math.hypot(x, z - 2);
    if (dc < 16) h = lerp(1.3 + (vn(x / 9, z / 9) - 0.5) * 0.3, h, smooth((dc - 9) / 7));   // the flat camp
    return h;
  };
  const N = 120, SIZE = 240;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, N, N); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heightAt(tp.getX(i), tp.getZ(i)));
  const terrainG = tg.toNonIndexed(); tg.dispose(); terrainG.computeVertexNormals();
  {
    const p = terrainG.attributes.position, nrm = terrainG.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, ny = nrm.getY(i), x = p.getX(i), z = p.getZ(i), v = vn(x / 5, z / 5);
      if (y < 0.15) c.set('#7c6a4e');
      else if (y < 0.9) c.set(v > 0.5 ? '#c9ad7f' : '#bba072');
      else if (ny < 0.82) c.set('#6d665c');
      else if (Math.hypot(x, z - 2) < 7.5) c.set(v > 0.5 ? '#6b5640' : '#5e4b37');              // trampled dirt round the fire
      else c.setHSL(0.2 + (v - 0.5) * 0.05, 0.36, 0.3 + (v - 0.5) * 0.08);
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    terrainG.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const terrain = new THREE.Mesh(terrainG, lam({ vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- the sea: glossy, a scrolling normal map catches the low sun ----------
  const NS = 128, hgt = new Float32Array(NS * NS), nr = mulberry(seed + 3);
  const wn = makeNoise(seed + 13, 32);
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) hgt[i + NS * j] = wn((i / NS) * 32, (j / NS) * 32) * 0.7 + wn((i / NS) * 32 * 3 % 32, (j / NS) * 32 * 3 % 32) * 0.3 + nr() * 0.02;
  const nd = new Uint8Array(NS * NS * 4);
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const hx = hgt[((i + 1) % NS) + NS * j] - hgt[((i - 1 + NS) % NS) + NS * j], hz = hgt[i + NS * ((j + 1) % NS)] - hgt[i + NS * ((j - 1 + NS) % NS)];
    const n = new THREE.Vector3(-hx * 6, 1, -hz * 6).normalize();
    nd.set([(n.x * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, n.y * 255, 255], (i + NS * j) * 4);
  }
  const normalT = new THREE.DataTexture(nd, NS, NS, THREE.RGBAFormat); normalT.wrapS = normalT.wrapT = THREE.RepeatWrapping; normalT.repeat.set(14, 14); normalT.needsUpdate = true; own.push(normalT);
  const seaM = new THREE.MeshStandardMaterial({ color: '#1c3b55', roughness: 0.32, metalness: 0.05, normalMap: normalT, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.94 }); own.push(seaM);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), seaM); sea.rotation.x = -Math.PI / 2; sea.position.y = 0.02; own.push(sea.geometry);
  scene.add(sea);

  // ---------- the camp ----------
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 8), cone = new THREE.ConeGeometry(1, 1, 8), rockG = new THREE.DodecahedronGeometry(1, 0);
  own.push(box, cyl, cone, rockG);
  // corrugated rusty metal
  const corrT = canvasTex(64, 64, (x) => {
    for (let i = 0; i < 64; i++) { const v = 0.5 + 0.5 * Math.sin((i / 64) * Math.PI * 2 * 10); x.fillStyle = `rgb(${Math.round(110 + v * 40)},${Math.round(104 + v * 34)},${Math.round(96 + v * 30)})`; x.fillRect(i, 0, 1, 64); }
    for (let k = 0; k < 26; k++) { const r = 2 + rnd() * 9; const g = x.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, 'rgba(150,70,25,.75)'); g.addColorStop(1, 'rgba(120,60,20,0)'); x.save(); x.translate(rnd() * 64, rnd() * 64); x.scale(1, 1.8); x.fillStyle = g; x.fillRect(-r, -r, r * 2, r * 2); x.restore(); }
    for (let k = 0; k < 4; k++) { x.fillStyle = 'rgba(90,40,15,.6)'; x.fillRect(rnd() * 64, 0, 1.5, 64); }
  });
  own.push(corrT);
  const metalM = lam({ map: corrT });
  const woodT = canvasTex(32, 32, (x) => { for (let j = 0; j < 32; j++) { x.fillStyle = j % 8 === 0 ? '#3a2818' : `rgb(${100 + (rnd() * 20 | 0)},${72 + (rnd() * 14 | 0)},${46 + (rnd() * 10 | 0)})`; x.fillRect(0, j, 32, 1); } }, { nearest: true });
  own.push(woodT);
  const woodM = lam({ map: woodT });
  const darkM = lam({ color: '#141210' });
  const shack = (x, z, ry, w, d, h) => {
    const y = heightAt(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
    const wallM = metalM;
    const walls = new THREE.Mesh(box, wallM); walls.scale.set(w, h, d); walls.position.y = h / 2; walls.castShadow = walls.receiveShadow = true;
    const roof = new THREE.Mesh(box, wallM); roof.scale.set(w + 0.6, 0.12, d + 0.8); roof.position.y = h + 0.25; roof.rotation.x = 0.16; roof.castShadow = true;
    const door = new THREE.Mesh(box, darkM); door.scale.set(1.1, 2.0, 0.08); door.position.set(-w * 0.2, 1.0, d / 2 + 0.03);
    const win = new THREE.Mesh(box, darkM); win.scale.set(0.8, 0.5, 0.08); win.position.set(w * 0.25, h * 0.62, d / 2 + 0.03);
    const plank = new THREE.Mesh(box, woodM); plank.scale.set(1.1, 0.16, 0.12); plank.position.set(w * 0.25, h * 0.62, d / 2 + 0.08); plank.rotation.z = 0.5;
    g.add(walls, roof, door, win, plank);
    scene.add(g);
  };
  shack(-8.5, -1.5, 0.5, 4.2, 3.6, 2.8);
  shack(7.5, 4.5, -0.9, 3.6, 3.4, 2.6);
  shack(-2.5, 10.5, 3.0, 5, 3.8, 3.0);
  // a log wall round the back of the camp, sharpened tops
  const logParts = [];
  for (let k = 0; k < 34; k++) {
    const a = 0.25 * Math.PI + (k / 33) * 1.25 * Math.PI, x = Math.cos(a) * 15.5, z = 3 + Math.sin(a) * 15.5, y = heightAt(x, z);
    const h = 3.2 + (k % 3) * 0.25, c = new THREE.Color('#6b4f34').offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
    logParts.push(bake(cyl, { x, y: y + h / 2, z, sx: 0.26, sy: h, sz: 0.26, color: c }));
    logParts.push(bake(cone, { x, y: y + h + 0.3, z, sx: 0.26, sy: 0.6, sz: 0.26, color: c }));
  }
  const logs = new THREE.Mesh(merge(logParts), lam({ vertexColors: true })); logs.castShadow = true; logs.receiveShadow = true;
  scene.add(logs);
  // rocks, a stone node with ore flecks, barrels, crates, pines on the hills
  const rockParts = [], propParts = [], pineParts = [];
  for (let k = 0; k < 70; k++) {
    const x = (rnd() - 0.5) * 140, z = -30 + rnd() * 110, y = heightAt(x, z);
    if (Math.hypot(x, z - 2) < 17 || y < -0.5) continue;
    const s = 0.4 + rnd() * 1.6;
    rockParts.push(bake(rockG, { x, y: y + s * 0.25, z, sx: s * 1.2, sy: s * 0.7, sz: s, ry: rnd() * 6, color: new THREE.Color().setHSL(0.07, 0.06, 0.38 + rnd() * 0.12) }));
  }
  rockParts.push(bake(rockG, { x: 11.5, y: heightAt(11.5, -3) + 0.6, z: -3, sx: 1.6, sy: 1.2, sz: 1.4, ry: 0.7, color: '#6f6a64' }));
  for (const [x, z] of [[-6.2, 4.4], [-5.6, 5.1], [9.6, 8.4], [3.5, -6.4]]) propParts.push(bake(cyl, { x, y: heightAt(x, z) + 0.5, z, sx: 0.33, sy: 1, sz: 0.33, color: rnd() < 0.5 ? '#7a3a1e' : '#3e5a3a' }));
  for (const [x, z, s] of [[5.2, -5.6, 0.8], [5.9, -5.0, 0.6], [-10.5, 2.6, 0.9]]) propParts.push(bake(box, { x, y: heightAt(x, z) + s / 2, z, sx: s, sy: s, sz: s, ry: x, color: '#7a5a38' }));
  for (let k = 0; k < 120; k++) {
    const x = (rnd() - 0.5) * 220, z = 20 + rnd() * 100, y = heightAt(x, z);
    if (Math.hypot(x, z - 2) < 20) continue;
    const s = 0.8 + rnd() * 0.9, c = new THREE.Color().setHSL(0.3, 0.28, 0.16 + rnd() * 0.06);
    pineParts.push(bake(cyl, { x, y: y + 1 * s, z, sx: 0.18 * s, sy: 2 * s, sz: 0.18 * s, color: '#3a2a1c' }));
    for (let j = 0; j < 3; j++) pineParts.push(bake(cone, { x, y: y + (2 + j * 1.3) * s, z, sx: (1.7 - j * 0.45) * s, sy: 2 * s, sz: (1.7 - j * 0.45) * s, color: c }));
  }
  for (const [list, cast] of [[rockParts, true], [propParts, true], [pineParts, true]]) {
    const m = new THREE.Mesh(merge(list), lam({ vertexColors: true })); m.castShadow = cast; m.receiveShadow = true; scene.add(m);
  }
  // flecks of ore on the node
  const oreM = new THREE.MeshBasicMaterial({ color: '#e6c76a' }); own.push(oreM);
  for (let k = 0; k < 22; k++) { const o = new THREE.Mesh(box, oreM); o.scale.set(0.07 + rnd() * 0.05, 0.05, 0.07 + rnd() * 0.05); const a = rnd() * 6.28, e = rnd() * 1.2; o.position.set(11.5 + Math.cos(a) * 1.35 * Math.cos(e), heightAt(11.5, -3) + 0.6 + Math.sin(e) * 0.75, -3 + Math.sin(a) * 1.15 * Math.cos(e)); o.rotation.set(rnd(), rnd(), rnd()); scene.add(o); }

  // ---------- the campfire: stones, logs, flames, embers, smoke, flickering light ----------
  const FIRE = new THREE.Vector3(0, heightAt(0, 2), 2);
  const fireParts = [];
  for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; fireParts.push(bake(rockG, { x: FIRE.x + Math.cos(a) * 0.75, y: FIRE.y + 0.12, z: FIRE.z + Math.sin(a) * 0.75, sx: 0.25, sy: 0.2, sz: 0.22, ry: a, color: '#5a5550' })); }
  fireParts.push(bake(cyl, { x: FIRE.x, y: FIRE.y + 0.15, z: FIRE.z, sx: 0.1, sy: 1.1, sz: 0.1, rz: Math.PI / 2, ry: 0.4, color: '#3a2414' }));
  fireParts.push(bake(cyl, { x: FIRE.x, y: FIRE.y + 0.2, z: FIRE.z, sx: 0.1, sy: 1.1, sz: 0.1, rz: Math.PI / 2, ry: 2.1, color: '#3a2414' }));
  scene.add(new THREE.Mesh(merge(fireParts), lam({ vertexColors: true })));
  const flameT = canvasTex(64, 128, (x) => {
    const g = x.createRadialGradient(32, 92, 2, 32, 80, 52);
    g.addColorStop(0, 'rgba(255,250,210,1)'); g.addColorStop(0.25, 'rgba(255,200,90,.95)'); g.addColorStop(0.55, 'rgba(255,110,30,.6)'); g.addColorStop(1, 'rgba(200,40,10,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(32, 4); x.bezierCurveTo(60, 60, 58, 120, 32, 124); x.bezierCurveTo(6, 120, 4, 60, 32, 4); x.fill();
  }, { repeat: false });
  own.push(flameT);
  const flameMats = Array.from({ length: 5 }, () => { const m = new THREE.SpriteMaterial({ map: flameT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }); own.push(m); return m; });
  const fireG = new THREE.Group(); scene.add(fireG);
  const flames = cycleSprites(fireG, (i) => flameMats[i], 5, (s, i, t) => {
    const f = 0.7 + 0.3 * Math.sin(t * (9 + i * 2.3) + i * 1.7) * Math.sin(t * (5.1 + i) + i);
    s.position.set(FIRE.x + Math.sin(i * 2.1 + t * 1.5) * 0.18, FIRE.y + 0.45 + f * 0.25 + i * 0.04, FIRE.z + Math.cos(i * 1.7 + t * 1.2) * 0.18);
    s.scale.set(0.55 + 0.25 * f, 1.0 + 0.6 * f, 1);
    s.material.opacity = 0.65 + 0.3 * f;
  });
  const emberT = glowTexture('rgba(255,210,120,1)', 'rgba(255,140,40,.5)', 'rgba(255,90,20,0)'); own.push(emberT);
  const emberM = glowSprite(emberT, '#ffb050', 0.9); own.push(emberM);
  const embers = cycleSprites(fireG, emberM, 14, (s, i, t) => {
    const life = 2.6, u = ((t + i * (life / 14)) % life) / life, ph = i * 1.31;
    s.position.set(FIRE.x + Math.sin(ph + u * 4) * (0.2 + u * 0.6), FIRE.y + 0.5 + u * 3.2, FIRE.z + Math.cos(ph * 1.3 + u * 3) * (0.2 + u * 0.5));
    s.scale.setScalar(0.09 * (1 - u) + 0.02);
  });
  const smokeT = glowTexture('rgba(90,85,95,.55)', 'rgba(80,75,85,.25)', 'rgba(70,70,80,0)'); own.push(smokeT);
  const smokeMats = Array.from({ length: 10 }, () => { const m = new THREE.SpriteMaterial({ map: smokeT, transparent: true, depthWrite: false, opacity: 0.5 }); own.push(m); return m; });
  const smoke = cycleSprites(fireG, (i) => smokeMats[i], 10, (s, i, t) => {
    const life = 7, u = ((t + i * (life / 10)) % life) / life;
    s.position.set(FIRE.x + u * 2.2 + Math.sin(i + u * 3) * 0.4, FIRE.y + 1.2 + u * 7.5, FIRE.z - u * 1.2);
    s.scale.setScalar(0.8 + u * 4.2);
    s.material.opacity = 0.42 * Math.sin(u * Math.PI);
  });
  const fireLight = new THREE.PointLight('#ff8a3a', 26, 18, 1.4); fireLight.position.copy(FIRE).add(new THREE.Vector3(0, 1.0, 0));
  scene.add(fireLight);
  const fireGlow = new THREE.Sprite(glowSprite(glowTexture('rgba(255,170,80,.9)', 'rgba(255,110,40,.3)', 'rgba(255,80,20,0)'), '#ff9a4a', 0.55)); own.push(fireGlow.material, fireGlow.material.map);
  fireGlow.position.copy(FIRE).add(new THREE.Vector3(0, 0.7, 0)); fireGlow.scale.setScalar(4.5); fireG.add(fireGlow);

  // ---------- dusk light + sky ----------
  const SUN_DIR = new THREE.Vector3(0.18, 0.06, -1).normalize();
  scene.add(new THREE.HemisphereLight('#7a74b0', '#2a2a20', 0.9));
  const sun = new THREE.DirectionalLight('#ffa860', 2.3);
  sun.position.copy(SUN_DIR).multiplyScalar(80).add(new THREE.Vector3(0, 12, 0)); sun.target.position.set(0, 0, 4);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  const sky = skyDome({ top: '#1d2148', mid: '#8a4d78', low: '#ff9455', sunDir: SUN_DIR, sunColor: '#ffbf70', sunPow: 120, glow: 0.9 });
  own.push(sky.material, sky.geometry);
  scene.add(sky);
  const sunDisc = new THREE.Sprite(glowSprite(glowTexture('rgba(255,236,190,1)', 'rgba(255,170,90,.55)', 'rgba(255,120,60,0)'), '#ffd29a', 1)); own.push(sunDisc.material, sunDisc.material.map);
  sunDisc.scale.setScalar(36); scene.add(sunDisc);

  // ---------- the walk: round the camp, the fire pulls the eye, the sea and the sunset on the south side ----------
  const path = loopPath([[2.5, 8.5], [-3.5, 5], [-4.2, -4.5], [0, -7.5], [6, -6.5], [10, -1], [11.6, 6], [6, 10.5]]);
  const SPEED = 1.3;
  const POI = [{ x: FIRE.x, z: FIRE.z, w: 0.75, pitch: -0.12 }, { x: 0, z: -60, w: 0.35, pitch: 0.02 }];
  const camera = new THREE.PerspectiveCamera(72, aspect, 0.05, 900);
  const pos = new THREE.Vector3(), tan = new THREE.Vector3(), dir = new THREE.Vector3(), look = new THREE.Vector3();
  let headingNow = 0;
  const T_OFF = 2;

  function update(t0, fx) {
    const t = t0 + T_OFF;
    const d = t * SPEED;
    path.pos(d, pos); path.tan(d, tan);
    const pathYaw = Math.atan2(tan.x, -tan.z);
    let yawOff = 0.16 * Math.sin(t * 0.17), pitch = -0.05 + 0.03 * Math.sin(t * 0.13);
    for (const p of POI) {
      const dx = p.x - pos.x, dz = p.z - pos.z;
      let da = Math.atan2(dx, -dz) - pathYaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 2.0) continue;
      const w = p.w * (1 - Math.abs(da) / 2.0);
      yawOff = lerp(yawOff, da * 0.85, w);
      pitch = lerp(pitch, p.pitch, w * 0.8);
    }
    const yaw = pathYaw + yawOff;
    headingNow = yaw;
    const step = t * SPEED * 1.5 * Math.PI;
    const bob = Math.abs(Math.sin(step)) * 0.05, sway = Math.sin(step) * 0.025;
    const push = fx ? fx.push : 0;
    camera.position.set(pos.x + Math.cos(yaw) * sway, heightAt(pos.x, pos.z) + 1.65 + bob, pos.z + Math.sin(yaw) * sway);
    dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    camera.position.addScaledVector(dir, push * 1.0);
    look.copy(camera.position).add(dir);
    camera.lookAt(look);
    const fov = 72 + clamp(1 - camera.aspect, 0, 0.6) * 22 - push * 10;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    sky.position.copy(camera.position);
    sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, 400);
    normalT.offset.set((t * 0.004) % 1, (t * 0.006) % 1);
    const f = 0.82 + 0.1 * Math.sin(t * 8.3) + 0.06 * Math.sin(t * 21.7) + 0.05 * Math.sin(t * 3.1);
    fireLight.intensity = 26 * f;
    fireGlow.scale.setScalar(4.2 + f * 0.8);
    flames(t); embers(t); smoke(t);
  }

  function dispose() { disposeTree(scene); for (const o of own) o.dispose?.(); }
  return { scene, camera, update, heading: () => headingNow, dispose, clear: DUSK };
}
