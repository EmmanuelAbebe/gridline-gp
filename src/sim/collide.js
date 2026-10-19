// Car-to-car contact. Each car is a capsule along its heading (CONTACT: a segment from `rear` to `front` metres from
// the car's origin, swept by `radius`), about the size of the bodywork, so cars can run side by side a car's width
// apart. Overlapping cars are pushed apart, and closing speed along the contact normal is exchanged as an impulse
// (equal masses, rigid-body impulse at the contact point, a little bounce): nose-to-tail the rear car slows and the front one is shoved, a side swipe pushes
// both sideways, and an off-centre hit turns the car (`spin`). EV.CONTACT fires once per touch with `impact` =
// closing speed (m/s).
import { CONTACT, EV, CHASSIS } from './tuning.js';
import { afterMove } from './motion.js';
import { addDamage } from './pit.js';
import { emit } from './events.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

const { rear: REAR, front: FRONT, radius: RADIUS, restitution: E, spin: SPIN } = CONTACT;
const K2 = CHASSIS.gyration * CHASSIS.gyration;

// the car's capsule segment in world space
/** @param {Car} c @returns {[number, number, number, number]} */
function segment(c) {
  const cx = Math.cos(c.h), sz = Math.sin(c.h);
  return [c.x - cx * REAR, c.z - sz * REAR, c.x + cx * FRONT, c.z + sz * FRONT];
}
// closest points between segments P0P1 and Q0Q1 (2D): returns [px, pz, qx, qz]
function closest([ax, az, bx, bz], [cx, cz, dx, dz]) {
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, wx = ax - cx, wz = az - cz;
  const a = ux*ux + uz*uz, b = ux*vx + uz*vz, c = vx*vx + vz*vz, d = ux*wx + uz*wz, e = vx*wx + vz*wz;
  const den = a*c - b*b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b*e - c*d) / den)) : 0;
  let t = (b*s + e) / c;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -d / a)); }
  else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - d) / a)); }
  return [ax + ux*s, az + uz*s, cx + vx*t, cz + vz*t];
}
// clearance between two cars' bodies (m); < 0 = overlapping
/** @param {Car} a @param {Car} b */
export function carGap(a, b) {
  const [px, pz, qx, qz] = closest(segment(a), segment(b));
  return Math.hypot(qx - px, qz - pz) - 2 * RADIUS;
}

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
  const cars = race.cars, reach = Math.max(REAR, FRONT) * 2 + 2 * RADIUS;
  for (const c of cars) { c.wasTouching = c.touching; c.touching = false; }
  for (let i = 0; i < cars.length; i++) for (let j = i+1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (a.pit || b.pit) continue;                                  // the pit lane is behind the pit wall
    if (Math.abs(b.x - a.x) > reach || Math.abs(b.z - a.z) > reach) continue;
    const [px, pz, qx, qz] = closest(segment(a), segment(b));
    let nx = qx - px, nz = qz - pz; const d = Math.hypot(nx, nz);
    if (d >= 2 * RADIUS) continue;
    if (d > 1e-6) { nx /= d; nz /= d; } else { nx = -Math.sin(a.h); nz = Math.cos(a.h); }   // centred on top: push sideways
    const mx = (px + qx) / 2, mz = (pz + qz) / 2;
    const [vax, vaz] = pointVelocity(a, mx, mz), [vbx, vbz] = pointVelocity(b, mx, mz);
    const closing = Math.max(0, (vax - vbx) * nx + (vaz - vbz) * nz);
    for (const c of [a, b]) { if (!c.wasTouching && !c.touching) emit(c, EV.CONTACT, { impact: closing, with: c === a ? b.code : a.code }); c.touching = true; }
    const push = (2 * RADIUS - d) / 2;
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
