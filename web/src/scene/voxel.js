// A small voxel mesher (same approach as blocky.js): visible faces only, ambient occlusion baked into vertex colours,
// one mesh per face material. faces: id -> [top, bottom, side] material keys. Optional sky(x,y,z) 0..1 darkens covered faces.
import * as THREE from 'three';
import { canvasTex } from './util.js';

const DIRS = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: 0.84, f: 2 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: 0.76, f: 2 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1.0, f: 0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: 0.5, f: 1 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: 0.7, f: 2 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: 0.66, f: 2 },
];
const AO = [0.45, 0.65, 0.82, 1.0];

export function meshVoxels({ SX, SY, SZ, OX = 0, OY = 0, OZ = 0, get, faces, mats, see = () => false, sky = null }) {
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ ? 0 : get(x, y, z));
  const solid = (x, y, z) => { const v = at(x, y, z); return v && !see(v) ? 1 : 0; };
  const buf = {};
  for (const k of Object.keys(mats)) buf[k] = { p: [], n: [], u: [], c: [], i: [] };
  for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
    const id = at(x, y, z); if (!id) continue;
    for (const D of DIRS) {
      const [nx, ny, nz] = D.n;
      const nb = at(x + nx, y + ny, z + nz);
      if (nb && !(see(nb) && nb !== id)) continue;
      if (ny === -1 && y === 0) continue;
      const key = faces[id][D.f];
      const B = buf[key], base = B.p.length / 3, ao = [];
      const sk = sky ? sky(x + nx, y + ny, z + nz) : 1;
      for (const [cx, cy, cz] of D.c) {
        const ux = nx === 0 ? (cx ? 1 : -1) : 0, uy = ny === 0 ? (cy ? 1 : -1) : 0, uz = nz === 0 ? (cz ? 1 : -1) : 0;
        const fx = x + nx, fy = y + ny, fz = z + nz;
        let s1, s2, cr;
        if (nx !== 0) { s1 = solid(fx, fy + uy, fz); s2 = solid(fx, fy, fz + uz); cr = solid(fx, fy + uy, fz + uz); }
        else if (ny !== 0) { s1 = solid(fx + ux, fy, fz); s2 = solid(fx, fy, fz + uz); cr = solid(fx + ux, fy, fz + uz); }
        else { s1 = solid(fx + ux, fy, fz); s2 = solid(fx, fy + uy, fz); cr = solid(fx + ux, fy + uy, fz); }
        const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
        ao.push(a);
        B.p.push(x - OX + cx, y - OY + cy, z - OZ + cz);
        B.n.push(nx, ny, nz);
        const l = D.s * AO[a] * sk;
        B.c.push(l, l, l);
      }
      B.u.push(0, 0, 1, 0, 1, 1, 0, 1);
      if (ao[0] + ao[2] > ao[1] + ao[3]) B.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else B.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }
  const group = new THREE.Group();
  for (const [k, B] of Object.entries(buf)) {
    if (!B.i.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    g.setIndex(B.i);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[k]); m.matrixAutoUpdate = false; m.updateMatrix();
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// 16x16 pixel textures: draw(px, rnd) with px(i, j, color)
export function pixelTex(rnd, draw, own) {
  const t = canvasTex(16, 16, (x) => {
    const px = (i, j, c) => { x.fillStyle = c; x.fillRect(i, j, 1, 1); };
    draw(px, x);
  }, { nearest: true });
  t.generateMipmaps = true; t.minFilter = THREE.NearestMipmapLinearFilter; t.magFilter = THREE.NearestFilter;
  own?.push(t);
  return t;
}

export function shade(hex, v) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, v); return '#' + c.getHexString(); }
