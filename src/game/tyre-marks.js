// Tyre marks laid live (2026-10-20, user: "add tyre marks"): every car leaves black rubber on the road where a wheel
// locks, spins or the tyres slide, and darker ruts on grass and gravel. One ring buffer of quads for the whole field
// (the oldest marks go first), drawn as one mesh; each wheel adds a quad every `step` m while it marks, as wide as the
// tyre, its strength in the vertex alpha, the ends fading in and out.
import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { poseOf } from './pose.js';

export const MARKS = Object.freeze({
  max: 9000,            // quads kept (all cars): the oldest are overwritten
  step: 0.45,           // m between points
  from: 0.22,           // a wheel marks above this slide / lock / spin (0..1)
  alpha: [0.18, 0.7],   // alpha at `from` .. at full strength
  y: 0.048,             // above the racing line's rubber
  minSpeed: 3,          // m/s
  // colour per surface (alpha × `k`): rubber on tarmac and kerbs, ruts on grass and gravel
  surface: Object.freeze({ track: [0x050505, 1], tarmac: [0x050505, 1], kerb: [0x0b0b0b, 0.8], sausage: [0x0b0b0b, 0.7],
    grass: [0x2a2a12, 0.9], turf: [0x1d2412, 0.8], gravel: [0x4a3d2e, 0.8] }),
});

export function createTyreMarks(scene) {
  const M = MARKS, n = M.max;
  const pos = new Float32Array(n * 4 * 3), col = new Float32Array(n * 4 * 4), idx = new Uint32Array(n * 6);
  for (let q = 0; q < n; q++) idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3), ca = new THREE.BufferAttribute(col, 4);
  pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('color', ca); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 1;
  scene.add(mesh);
  let next = 0, used = 0, dirty = false;
  const wheels = new WeakMap(), c3 = new THREE.Color();

  // the four contact patches of a car (design wheels: pos [x forward, y, z right], width) and how hard each marks
  function strengths(c) {
    const lockR = c.brake > 0.9 && !c.assists?.abs ? c.slideR : 0;
    return [Math.max(c.slideF, c.lockF ? 1 : 0), Math.max(c.slideF, c.lockF ? 1 : 0),
      Math.max(c.slideR, c.spinR ? 1 : 0, lockR), Math.max(c.slideR, c.spinR ? 1 : 0, lockR)];
  }
  function quad(a, b, s, surf) {
    const q = next, [hex, k] = M.surface[surf] || M.surface.track, A = (M.alpha[0] + (M.alpha[1] - M.alpha[0]) * s) * k;
    c3.setHex(hex);
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    const wa = a.w / 2, wb = b.w / 2;
    const ya = M.y + a.y, yb = M.y + b.y;
    pos.set([a.x - nx * wa, ya, a.z - nz * wa, a.x + nx * wa, ya, a.z + nz * wa, b.x - nx * wb, yb, b.z - nz * wb, b.x + nx * wb, yb, b.z + nz * wb], q * 12);
    const aa = a.fresh ? 0 : A;                                  // the first quad of a mark fades in
    col.set([c3.r, c3.g, c3.b, aa, c3.r, c3.g, c3.b, aa, c3.r, c3.g, c3.b, A, c3.r, c3.g, c3.b, A], q * 16);
    dirty = true;
    next = (next + 1) % n; used = Math.min(n, used + 1);
  }

  return {
    // wheels: the design's wheels (car space); every frame for every car in the race
    update(race, design) {
      const W = design.wheels;
      for (const c of race.cars) {
        if (c.pit || SIM.speedOf(c) < M.minSpeed) { wheels.delete(c); continue; }
        const p = poseOf(c), ch = Math.cos(p.h), sh = Math.sin(p.h), st = strengths(c), tp = Math.tan(p.pitch), tr = Math.tan(p.roll);
        let last = wheels.get(c); if (!last) { last = W.map(() => null); wheels.set(c, last); }
        W.forEach((w, k) => {
          const x = p.x + ch * w.pos[0] - sh * w.pos[2], z = p.z + sh * w.pos[0] + ch * w.pos[2];
          const s = st[k] ?? 0, on = s > M.from || (c.offTrack && c.surface !== 'tarmac');
          if (!on) { last[k] = null; return; }
          const here = { x, z, y: p.y + w.pos[0] * tp - w.pos[2] * tr, w: w.width * 0.9, fresh: false };   // (y: on a hill, pose.js)
          const prev = last[k];
          if (!prev) { last[k] = { ...here, fresh: true }; return; }
          if (Math.hypot(x - prev.x, z - prev.z) < M.step) return;
          quad(prev, here, Math.min(1, (Math.max(s, c.offTrack ? 0.5 : 0) - M.from) / (1 - M.from)), c.surface);
          last[k] = here;
        });
      }
      if (dirty) { pa.needsUpdate = ca.needsUpdate = true; dirty = false; g.setDrawRange(0, used * 6); }
    },
    clear() { next = used = 0; g.setDrawRange(0, 0); },
    dispose() { scene.remove(mesh); g.dispose(); mat.dispose(); },
  };
}
