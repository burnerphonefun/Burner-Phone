// Shared pieces for the game worlds: noise, closed paths, toon gradients, glow sprites, sky domes, cheap particles.
import * as THREE from 'three';
import { mulberry, lerp, clamp, canvasTex } from './util.js';
import domeVert from './shaders/dome.vert.glsl?raw';
import skyFrag from './shaders/sky.frag.glsl?raw';

// value noise on a seeded grid (smooth, tileable every G cells)
export function makeNoise(seed, G = 64) {
  const r = mulberry(seed), grid = new Float32Array(G * G).map(() => r());
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const g = (i, j) => grid[(((i % G) + G) % G) + G * (((j % G) + G) % G)];
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(g(xi, zi), g(xi + 1, zi), u), lerp(g(xi, zi + 1), g(xi + 1, zi + 1), u), v);
  };
}

// a closed path through [x, z] (or [x, y, z]) points, sampled by distance: at(d) wraps around
export function loopPath(points, y = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p.length > 2 ? p[1] : y, p.length > 2 ? p[2] : p[1])), true, 'centripetal');
  const len = curve.getLength();
  return {
    len,
    pos(d, out) { return curve.getPointAt((((d / len) % 1) + 1) % 1, out); },
    tan(d, out) { return curve.getTangentAt((((d / len) % 1) + 1) % 1, out); },
    curve,
  };
}

// toon shading: an N-step gradient map (NearestFilter)
export function toonRamp(steps = [0.35, 0.7, 1]) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => { const c = Math.round(v * 255); data.set([c, c, c, 255], i * 4); });
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

// a soft radial glow for additive sprites
export function glowTexture(inner = 'rgba(255,210,130,1)', mid = 'rgba(255,150,60,.35)', outer = 'rgba(255,120,40,0)') {
  return canvasTex(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner); g.addColorStop(0.35, mid); g.addColorStop(1, outer);
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  }, { repeat: false });
}
export function glowSprite(tex, color = '#ffffff', opacity = 0.8) {
  return new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false });
}

// a sky dome: vertical gradient + optional sun glow, follows the camera (set .position each frame)
export function skyDome({ top, mid, low, sunDir = null, sunColor = '#ffd9a0', sunPow = 48, glow = 0.35, radius = 300 }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, low: { value: new THREE.Color(low) },
      sunDir: { value: sunDir ? sunDir.clone().normalize() : new THREE.Vector3(0, -1, 0) }, sunC: { value: new THREE.Color(sunColor) },
      sunPow: { value: sunPow }, glow: { value: sunDir ? glow : 0 },
    },
    vertexShader: domeVert,
    fragmentShader: skyFrag,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.renderOrder = -2; mesh.frustumCulled = false;
  return mesh;
}

// a camera that trails a target point, as a pure function of the target's path (no frame-to-frame state)
export function chaseCamera(camera, target, ahead, { back = 5.5, up = 2.4, lookUp = 1.2, side = 0 } = {}, tmp = new THREE.Vector3()) {
  tmp.copy(ahead).sub(target).setY(0).normalize();
  camera.position.set(target.x - tmp.x * back + tmp.z * side, target.y + up, target.z - tmp.z * back - tmp.x * side);
  camera.lookAt(target.x + tmp.x * 3, target.y + lookUp, target.z + tmp.z * 3);
}

// sprites cycling along a loop (smoke, embers, dust): each one's state is a function of t
export function cycleSprites(group, mat, n, place) {
  const list = [];
  for (let i = 0; i < n; i++) { const s = new THREE.Sprite(typeof mat === 'function' ? mat(i) : mat); group.add(s); list.push(s); }
  return (t) => { for (let i = 0; i < n; i++) place(list[i], i, t); };
}

export { clamp, lerp };
