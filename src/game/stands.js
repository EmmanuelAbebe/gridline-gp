import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { COLORS, BRANDS } from './config.js';
import { Models } from './models.js';

// Grandstands from the Blender modules (tools/blender/stands.py → Models.stands): a run of 8 m bays along the track,
// each at its own place on the offset curve (so a corner stand follows the corner and a stand on a slope steps with
// it), closed by the stepped end walls, every bay with an advert on its parapet and a crowd in its seats.
// The seats come from the bays' glTF extras (the layout Blender used), the fans are instanced per kind and part
// (shirt / skin / legs, each tinted per fan), listed in a random order so `setCrowd(share)` shows a random share.
export const STANDS = Object.freeze({
  cheer: 0.15,                                     // share of fans with their arms up
  skin: [0xf1c7a5, 0xe0ac85, 0xc68863, 0xa86f4c, 0x8d5a3c, 0x5c3a24],
  legs: [0x2b3a55, 0x1f1f22, 0x4b4f57, 0x6b5a45, 0x2d4a3a, 0x3b3f6b],
  seats: { main: 0x1f5fbf, small: 0xc8302a },      // seat colour per kind of stand
});

const signs = new Map();   // advert textures, one per brand (made once, shared by every stand)
function sign(k) {
  const [name, bg, fg] = BRANDS[k % BRANDS.length];
  if (!signs.has(name)) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 48; const x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 512, 48); x.fillStyle = fg; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, 256, 25);
    const t = new THREE.CanvasTexture(cv); t.flipY = false;                 // (glTF uvs: v runs down the image)
    signs.set(name, new THREE.MeshLambertMaterial({ map: t }));
  }
  return signs.get(name);
}

// where `n` bays of width w stand at `lat` m from the centre line round sample `at`: walking the offset curve from
// there, each bay's centre and heading (−1: before the sample, +1: after)
function bayFrames(track, at, lat, n, w, hy) {
  const { N, PX, PZ, NX, NZ } = track, P = i => { const j = SIM.wrapIdx(i, N); return [PX[j] + NX[j] * lat, PZ[j] + NZ[j] * lat]; };
  const out = [];
  for (let k = 0; k < n; k++) {
    const d = (k - (n - 1) / 2) * w, dir = Math.sign(d) || 1;
    let i = at, walked = 0, [x, z] = P(at);
    while (walked < Math.abs(d)) { const [x2, z2] = P(i + dir), step = Math.hypot(x2 - x, z2 - z);
      if (walked + step >= Math.abs(d)) { const f = (Math.abs(d) - walked) / step; x += (x2 - x) * f; z += (z2 - z) * f; walked = Math.abs(d); break; }
      walked += step; x = x2; z = z2; i += dir; }
    const [a, b] = P(i - 1), [c, e] = P(i + 1);
    out.push({ x, z, y: hy(SIM.wrapIdx(i, N), lat), h: Math.atan2(e - b, c - a), i: SIM.wrapIdx(i, N) });
  }
  return out;
}

/**
 * A grandstand: `kind` 'main' | 'small', `n` bays round sample `at`, on `side` (−1 left of the track, +1 right), its
 * front `front` m from the centre line. Returns { group, crowd: [{ mesh, max }] } (the caller adds the group).
 */
export function buildStand(track, { kind, at, side, front, n, hy, brand = 0 }) {
  const M = Models.stands, mod = M[kind], info = mod.solid.userData, lat = side * front, group = new THREE.Group();
  const frames = bayFrames(track, at, lat, n, info.width, hy);
  // a bay's matrix: at its frame, facing the track (model z = away from it: the left side turns round)
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const bayMatrix = f => new THREE.Matrix4().compose(new THREE.Vector3(f.x, f.y, f.z), q.setFromAxisAngle(up, -f.h + (side < 0 ? Math.PI : 0)), one);
  const mats = frames.map(bayMatrix);
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true }), seat = new THREE.MeshLambertMaterial({ vertexColors: true, color: STANDS.seats[kind] });
  const instanced = (geo, mat, list) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((x, k) => m.setMatrixAt(k, x)); group.add(m); return m; };
  instanced(mod.solid, solid, mats); instanced(mod.seat, seat, mats);
  mats.forEach((x, k) => { const p = new THREE.Mesh(mod.panel, sign(brand + k)); p.matrixAutoUpdate = false; p.matrix.copy(x); group.add(p); });
  // the end walls: _a closes the bay at the model's +x end (the last along the track on the right side, the first on the left)
  const last = side > 0 ? n - 1 : 0;
  instanced(M[`${kind}_end_a`].solid, solid, [mats[last]]); instanced(M[`${kind}_end_b`].solid, solid, [mats[n - 1 - last]]);
  // the crowd: a fan on every seat, in a random order, a share of them cheering
  const seats = [], { rows, rowDepth, riser, y0, seats: per, seatX0, seatPitch, panZ, panY } = info, p = new THREE.Vector3();
  for (const bm of mats) for (let r = 0; r < rows; r++) for (let s = 0; s < per; s++) {
    p.set(seatX0 + s * seatPitch, y0 + r * riser + panY, r * rowDepth + panZ);
    const yaw = (Math.random() - 0.5) * 0.3, sc = 0.94 + Math.random() * 0.12;
    seats.push(new THREE.Matrix4().compose(p, q.setFromAxisAngle(up, yaw), new THREE.Vector3(sc, sc, sc)).premultiply(bm));
  }
  for (let k = seats.length - 1; k > 0; k--) { const j = (Math.random() * (k + 1)) | 0; [seats[k], seats[j]] = [seats[j], seats[k]]; }
  const crowd = [], col = new THREE.Color(), shirts = [...COLORS.crowd];
  for (const [fan, list] of [['fan_cheer', seats.slice(0, Math.round(seats.length * STANDS.cheer))], ['fan_sit', seats.slice(Math.round(seats.length * STANDS.cheer))]]) {
    const parts = { shirt: shirts, skin: STANDS.skin, legs: STANDS.legs };
    for (const [role, pal] of Object.entries(parts)) {
      const mesh = instanced(M[fan][role], new THREE.MeshLambertMaterial({ vertexColors: true }), list);
      list.forEach((_, k) => mesh.setColorAt(k, col.setHex(pal[(Math.random() * pal.length) | 0])));
      crowd.push({ mesh, max: list.length });
    }
  }
  return { group, crowd };
}
