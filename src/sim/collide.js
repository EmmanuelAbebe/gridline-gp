// Car-to-car contact. Each car is a rounded rectangle along its heading (CONTACT: from `rear` + radius behind the car's
// origin to `front` + radius ahead of it, `radius` either side, corners rounded by `corner`), about the size of the
// bodywork, so cars can run side by side a car's width apart. Overlapping cars are pushed apart, and closing speed along
// the contact normal is exchanged as an impulse (equal masses, rigid-body impulse at the contact point, a little
// bounce): nose-to-tail the rear car slows and the front one is shoved, a side swipe pushes both sideways, and an
// off-centre hit turns the car (`spin`). EV.CONTACT fires once per touch with `impact` = closing speed (m/s).
// (Until 2026-10-28 the cars were capsules, fully round ends 2.1 m across: a hit from behind on a rear corner met the
// round ends at an angle and shoved the car ~25° sideways, so a tap in a braking zone spun it. User: "why does the car
// spin out the moment it touches another car?")
import { CONTACT, EV, CHASSIS, ELEVATION } from './tuning.js';
import { afterMove } from './motion.js';
import { addDamage } from './pit.js';
import { emit } from './events.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

const { rear: REAR, front: FRONT, radius: RADIUS, corner: R, restitution: E, spin: SPIN } = CONTACT;
const K2 = CHASSIS.gyration * CHASSIS.gyration;
// the core rectangle (the body less its rounded corners), in the car's frame: along x from −BACK to AHEAD, ±HALF across
const BACK = REAR + RADIUS - R, AHEAD = FRONT + RADIUS - R, HALF = RADIUS - R;

// the core rectangle's corners in world space, counter-clockwise: [x0, z0, x1, z1, …]
/** @param {Car} c */
function corners(c) {
  const fx = Math.cos(c.h), fz = Math.sin(c.h), out = [];
  for (const [a, b] of [[-BACK, -HALF], [AHEAD, -HALF], [AHEAD, HALF], [-BACK, HALF]]) out.push(c.x + fx * a - fz * b, c.z + fz * a + fx * b);
  return out;
}
// closest point to (px, pz) on the segment a–b
function onSegment(px, pz, ax, az, bx, bz) {
  const ux = bx - ax, uz = bz - az, t = Math.min(1, Math.max(0, ((px - ax) * ux + (pz - az) * uz) / (ux * ux + uz * uz)));
  return [ax + ux * t, az + uz * t];
}
// The contact between two core rectangles: { pen (m the bodies overlap; < 0 = clearance), nx, nz (normal from A to B),
// mx, mz (contact point) }. Apart: the closest pair of points (a corner of one against an edge of the other). Cores
// overlapping (a deep hit): the separating axis that overlaps least.
function contact(A, B) {
  let best = Infinity, p = null, q = null;
  for (const [P, Q, flip] of [[A, B, false], [B, A, true]]) for (let i = 0; i < 8; i += 2) for (let j = 0; j < 8; j += 2) {
    const k = (j + 2) % 8, [cx, cz] = onSegment(P[i], P[i + 1], Q[j], Q[j + 1], Q[k], Q[k + 1]);
    const d = (P[i] - cx) ** 2 + (P[i + 1] - cz) ** 2;
    if (d < best) { best = d; p = flip ? [cx, cz] : [P[i], P[i + 1]]; q = flip ? [P[i], P[i + 1]] : [cx, cz]; }
  }
  // overlap on each rectangle's two axes (separating axis test)
  let least = Infinity, ax = 0, az = 0;
  for (const P of [A, B]) for (const i of [0, 2]) {
    let ex = P[i + 2] - P[i], ez = P[i + 3] - P[i + 1]; const l = Math.hypot(ex, ez); ex /= l; ez /= l;
    const nx = -ez, nz = ex;            // the edge's normal
    for (const [ux, uz] of [[ex, ez], [nx, nz]]) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let v = 0; v < 8; v += 2) { const a = A[v] * ux + A[v + 1] * uz, b = B[v] * ux + B[v + 1] * uz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o < 0) { least = -1; break; }
      if (o < least) { least = o; const s = (b0 + b1) - (a0 + a1) >= 0 ? 1 : -1; ax = ux * s; az = uz * s; }
    }
    if (least < 0) break;
  }
  const d = Math.sqrt(best);
  if (least < 0 && d > 1e-6) {          // the cores are apart: the rounded corners meet across the gap
    return { pen: 2 * R - d, nx: (q[0] - p[0]) / d, nz: (q[1] - p[1]) / d, mx: (p[0] + q[0]) / 2, mz: (p[1] + q[1]) / 2 };
  }
  return { pen: least + 2 * R, nx: ax, nz: az, mx: (p[0] + q[0]) / 2, mz: (p[1] + q[1]) / 2 };
}
// clearance between two cars' bodies (m); < 0 = overlapping
/** @param {Car} a @param {Car} b */
export const carGap = (a, b) => -contact(corners(a), corners(b)).pen;

/** @param {Car} c */
const velocity = c => [Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy, Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy];
// velocity of the point (px, pz) of car c: the centre's plus the yaw rate's (ω × r)
/** @param {Car} c */
const pointVelocity = (c, px, pz) => { const [vx, vz] = velocity(c); return [vx - c.yawRate * (pz - c.z), vz + c.yawRate * (px - c.x)]; };
// add a world-space velocity change (jx, jz) applied at (px, pz) to car c
/** @param {Car} c */
function kick(c, jx, jz, px, pz) {
  const fx = Math.cos(c.h), fz = Math.sin(c.h);
  c.v += jx * fx + jz * fz;
  c.vy += -jx * fz + jz * fx;
  c.yawRate += SPIN * ((px - c.x) * jz - (pz - c.z) * jx) / K2;
}

/** @param {Race} race */
export function collide(race) {
  const cars = race.cars, reach = Math.max(REAR, FRONT) * 2 + 2 * RADIUS, elev = race.track.elev;
  for (const c of cars) { c.wasTouching = c.touching; c.touching = false; }
  for (let i = 0; i < cars.length; i++) for (let j = i+1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if ((a.pit && !a.pit.drive) || (b.pit && !b.pit.drive)) continue;   // AI cars on their pit-lane path (pit.js) don't touch
    if (Math.abs(b.x - a.x) > reach || Math.abs(b.z - a.z) > reach) continue;
    if (elev && Math.abs(elev.Y[a.idx] - elev.Y[b.idx]) > ELEVATION.apart) continue;   // one on a bridge, the other under it
    const { pen, nx, nz, mx, mz } = contact(corners(a), corners(b));
    if (pen <= 0) continue;
    const [vax, vaz] = pointVelocity(a, mx, mz), [vbx, vbz] = pointVelocity(b, mx, mz);
    const closing = Math.max(0, (vax - vbx) * nx + (vaz - vbz) * nz);
    for (const c of [a, b]) { if (!c.wasTouching && !c.touching) emit(c, EV.CONTACT, { impact: closing, with: c === a ? b.code : a.code }); c.touching = true; }
    const push = pen / 2;
    a.x -= nx*push; a.z -= nz*push; b.x += nx*push; b.z += nz*push;
    if (closing > 0) {
      // rigid-body impulse (per unit mass, equal masses): an off-centre hit spends part of itself turning the cars,
      // so it shoves less and the turn it gives is what the inertia allows (before 2026-10-18 the impulse ignored
      // rotation: a 15 m/s tap at the corner of a gearbox yawed the car at 3.6 rad/s; user: "too violent")
      const ca = (mx - a.x) * nz - (mz - a.z) * nx, cb = (mx - b.x) * nz - (mz - b.z) * nx;
      const jn = (1 + E) * closing / (2 + SPIN * (ca * ca + cb * cb) / K2);
      kick(a, -nx*jn, -nz*jn, mx, mz); kick(b, nx*jn, nz*jn, mx, mz);
      // damage: a hit ahead of the cockpit takes the front wing
      if (!a.wasTouching || !b.wasTouching) for (const c of [a, b]) {
        const fwd = (mx - c.x) * Math.cos(c.h) + (mz - c.z) * Math.sin(c.h);
        addDamage(race, c, closing, fwd > CONTACT.nose ? 1 : 0, CONTACT.damageHard);
      }
    }
    afterMove(race, a); afterMove(race, b);
  }
}
