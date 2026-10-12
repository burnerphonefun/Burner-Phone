// One renderer, every world. Owns the loop, the WASTED post pass, snapshots and the env tint.
import * as THREE from 'three';
import { buildCity } from './city.js';
import { buildBlocky } from './blocky.js';
import { buildToon } from './toon.js';
import { buildTactical } from './tactical.js';
import { buildObby } from './obby.js';
import { buildSurvival } from './survival.js';
import { clamp } from './util.js';

const BUILDERS = { city: buildCity, blocky: buildBlocky, toon: buildToon, tactical: buildTactical, obby: buildObby, survival: buildSurvival };

// the game switcher reads this (order = the order on the site)
export const WORLDS = [
  { id: 'blocky', label: 'blocky night', blurb: 'a voxel survival world under a square moon: torches, a cave, a lava ravine' },
  { id: 'toon', label: 'toon island', blurb: 'a cartoon battle-royale island: loot glowing, the storm closing in' },
  { id: 'tactical', label: 'bomb site', blurb: 'a dusty tactical bomb site at noon: peek the corner, the device blinking' },
  { id: 'obby', label: 'obby', blurb: 'a floating parkour course in plastic blocks, hop by hop over the clouds' },
  { id: 'survival', label: 'survival', blurb: 'a survival island at dusk: rusty shacks, a campfire, the sea going dark' },
  { id: 'city', label: 'sunny city', blurb: 'a golden-hour crime city: palms, traffic, a cruiser on your tail' },
].filter((w) => BUILDERS[w.id]);

export function createWorld(canvas, { world = 'city', seed = 7, manual = false, pixelRatio } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatio ?? 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // LESSONS: PCFSoft silently recompiles on the first shadow pass

  // WASTED post pass: only used while gray > 0 (scene -> half-float target -> desaturate + vignette -> screen)
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
  const postMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: rt.texture }, gray: { value: 0 }, aspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tex; uniform float gray; uniform float aspect; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tex, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 g = vec3(l);
        g = (g - 0.18) * 1.18 + 0.18;                       // a bit more contrast in grey
        c = mix(c, max(g, 0.0) * 0.86, gray);
        vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
        c *= 1.0 - gray * 0.55 * smoothstep(0.35, 1.05, length(q));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  quad.frustumCulled = false; postScene.add(quad);

  let W = 0, H = 0;
  let cur = null, curName = null;
  let simT = 0, last = 0, raf = 0;
  let wantRun = false, visible = true, hiddenDoc = document.hidden, disposed = false;
  const fxT = { gray: 0, slow: 0, push: 0 }, fxC = { gray: 0, slow: 0, push: 0 };
  let fpsN = 0, fpsT = 0, fps = 0, cpu = 0;
  const env = [200, 140, 110]; let envAt = 0;
  const envCv = document.createElement('canvas'); envCv.width = envCv.height = 6;
  const envCtx = envCv.getContext('2d', { willReadFrequently: true });

  function resize() {
    const w = Math.max(2, canvas.clientWidth | 0), h = Math.max(2, canvas.clientHeight | 0);
    if (w === W && h === H) return;
    W = w; H = h;
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    rt.setSize(Math.round(w * pr), Math.round(h * pr));
    postMat.uniforms.aspect.value = w / h;
    if (cur) { cur.camera.aspect = w / h; cur.camera.updateProjectionMatrix(); }
  }

  function draw() {
    if (!cur) return;
    if (fxC.gray > 0.002) {
      postMat.uniforms.gray.value = fxC.gray;
      renderer.setRenderTarget(rt);
      renderer.render(cur.scene, cur.camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    } else {
      renderer.render(cur.scene, cur.camera);
    }
  }

  function sampleEnv(now) {
    if (now - envAt < 500) return;
    envAt = now;
    const c = renderer.domElement, cw = c.width, ch = c.height;
    try {
      envCtx.drawImage(c, cw * 2 / 3, ch / 3, cw / 3, ch * 2 / 3, 0, 0, 6, 6);
      const d = envCtx.getImageData(0, 0, 6, 6).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      env[0] = Math.round(r / n); env[1] = Math.round(g / n); env[2] = Math.round(b / n);
    } catch { /* keep last */ }
  }

  // reading clientWidth every frame forces a layout whenever the page just changed text (the phone does, all the time):
  // only re-measure when the canvas actually changed size
  let sizeDirty = true;
  const ro = new ResizeObserver(() => { sizeDirty = true; });
  ro.observe(canvas);
  function frame(tSec) {
    if (sizeDirty) { sizeDirty = false; resize(); }
    cur.update(tSec, fxC);
    draw();
  }

  function tick(nowMs) {
    raf = 0;
    if (!running()) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (nowMs - last) / 1000) : 1 / 60;
    last = nowMs;
    // ease fx: gray/slow in ~0.35 s, push ramps over ~2 s, everything releases in ~0.6 s
    for (const k of ['gray', 'slow', 'push']) {
      const up = fxT[k] > fxC[k];
      const rate = k === 'push' ? (up ? 0.5 : 1.8) : up ? 3.2 : 1.8;
      fxC[k] = up ? Math.min(fxT[k], fxC[k] + rate * dt) : Math.max(fxT[k], fxC[k] - rate * dt);
    }
    simT += dt * (1 - 0.85 * fxC.slow);
    const c0 = performance.now();
    frame(simT);
    cpu = cpu * 0.95 + (performance.now() - c0) * 0.05;
    sampleEnv(nowMs);
    fpsN++;
    if (nowMs - fpsT >= 1000) { fps = Math.round((fpsN * 1000) / (nowMs - fpsT)); fpsN = 0; fpsT = nowMs; }
  }

  const running = () => wantRun && visible && !hiddenDoc && !disposed && !!cur && !manual;
  function kick() { if (running() && !raf) { last = 0; fpsT = performance.now(); fpsN = 0; raf = requestAnimationFrame(tick); } }

  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; kick(); }, { threshold: 0 });
  io.observe(canvas);
  const onVis = () => { hiddenDoc = document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => { resize(); if (!running() && cur && !manual) draw(); };
  window.addEventListener('resize', onResize);

  // built worlds stay cached, so switching back is instant (the blocky one takes ~0.7 s to generate the first time)
  const built = {}, building = {}, buildMs = {};
  function prepare(name) {
    if (!BUILDERS[name]) return Promise.reject(new Error('unknown world ' + name));
    if (built[name]) return Promise.resolve(built[name]);
    if (!building[name]) building[name] = (async () => {
      resize();
      const b0 = performance.now();
      const w = BUILDERS[name]({ seed, aspect: W / H });
      buildMs[name] = Math.round(performance.now() - b0);
      w.camera.aspect = W / H; w.camera.updateProjectionMatrix();
      w.update(simT, fxC);
      await renderer.compileAsync(w.scene, w.camera);
      if (disposed) { w.dispose(); return null; }
      built[name] = w; delete building[name];
      return w;
    })();
    return building[name];
  }
  async function setWorld(name) {
    const next = await prepare(name);
    if (!next || disposed) return;
    cur = next; curName = name;
    cur.camera.aspect = W / H; cur.camera.updateProjectionMatrix();
    renderer.setClearColor(next.clear || 0x000000);
    frame(simT); sampleEnv(performance.now() + 1000);
    kick();
  }

  resize();
  renderer.compile(postScene, postCam);
  const ready = setWorld(world);

  return {
    ready,
    setWorld,
    prepare(name) { return prepare(name).then(() => undefined); },
    start() { wantRun = true; kick(); },
    stop() { wantRun = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    resize() { resize(); },
    renderAt(tSec) {
      if (!cur) return;
      simT = tSec;
      frame(tSec);
      sampleEnv(performance.now() + 1000);
    },
    snapshot(w, h) {
      w = w || W; h = h || H;
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      if (!cur) return out;
      frame(simT);
      const c = renderer.domElement, s = Math.max(w / c.width, h / c.height);
      const sw = w / s, sh = h / s;
      out.getContext('2d').drawImage(c, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, 0, 0, w, h);
      return out;
    },
    envColor() { return env.slice(); },
    fx(o = {}) {
      for (const k of ['gray', 'slow', 'push']) if (o[k] !== undefined) {
        fxT[k] = clamp(+o[k] || 0, 0, 1);
        if (manual) fxC[k] = fxT[k];
      }
    },
    heading() { return cur ? cur.heading() : 0; },
    info() { return { fps, cpuMs: +cpu.toFixed(2), world: curName, t: simT, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, buildMs: { ...buildMs } }; },
    renderer,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      for (const w of Object.values(built)) w.dispose();
      rt.dispose(); postMat.dispose(); quad.geometry.dispose();
      renderer.dispose();
    },
  };
}
