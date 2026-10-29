// Car-to-car contact (2026-10-28; user: "real physics collision … a hit box relatively close to the body of the car").
// Each car is its HITBOX: the plan view as convex parts (front wing, nose, tyres, sidepods, engine cover, rear), measured
// from the car model. Every overlapping pair of parts is a contact (separating axis test: the normal and depth; the
// point = the middle of the overlap). Each pair of cars is then solved as two rigid bodies (equal masses, the real yaw
// inertia, CHASSIS.gyration): sequential impulses at every contact point, the closing speed along the normal stopped
// with a bounce, and Coulomb friction across it (rubber on rubber grips, carbon slides), so where a car is hit decides
// how much it is shoved, turned or dragged along. Overlaps are pushed apart. EV.CONTACT fires once per touch with
// `impact` = closing speed (m/s); damage goes to the part that hit (front wing; a tyre hit bends the suspension).
// (Before: one capsule per car, then a rounded box; the capsules' round ends shoved a car hit on a rear corner sideways.)
import { HITBOX, CONTACT, EV, CHASSIS, ELEVATION, AIR } from './tuning.js';
import { afterMove } from './motion.js';
import { addDamage } from './pit.js';
import { lift } from './airborne.js';
import { emit } from './events.js';
import { M as FM } from './fmath.js';   // (deterministic sin, cos, atan2, hypot …: the same race on every engine)
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

const K2 = CHASSIS.gyration * CHASSIS.gyration;
// A hitbox ready for the solver (cached per parts list: createRace `hitbox`, HITBOX.parts by default): mirrored twins
// added; each part with its side (−1 left, +1 right, 0 across the middle), a bounding circle for a quick reject, and
// `front` / `rear` for the front and rear tyres (a front tyre climbing a rear one: airborne.js); reach = the whole car's
// bounding circle about its origin
const prepared = new WeakMap();
export function prepareHitbox(parts = HITBOX.parts) {
  let H = prepared.get(parts);
  if (H) return H;
  const list = parts.flatMap(p => p.mirror ? [p, { ...p, name: p.name + ' L', pts: p.pts.map(([a, b]) => [a, -b]).reverse() }] : [p]).map(p => {
    const n = p.pts.length, ca = p.pts.reduce((s, q) => s + q[0], 0) / n, cb = p.pts.reduce((s, q) => s + q[1], 0) / n;
    return { ...p, ca, cb, side: Math.abs(cb) < 0.05 ? 0 : Math.sign(cb), r: Math.max(...p.pts.map(([a, b]) => FM.hypot(a - ca, b - cb))),
      front: p.kind === 'tyre' && ca > 0, rear: (p.kind === 'tyre' && ca < 0) || !!p.ramp };
  });
  H = { parts: list, reach: Math.max(...list.flatMap(p => p.pts.map(([a, b]) => FM.hypot(a, b)))) };
  prepared.set(parts, H);
  return H;
}
const wingIdx = p => p.side < 0 ? 0 : 1;

// world-space corners of every part of car c (the car's frame: along = heading, right = the right-hand normal); a
// front wing half that broke off is gone
/** @param {Car} c */
function world(c, H) {
  const fx = FM.cos(c.h), fz = FM.sin(c.h);
  return H.parts.filter(p => !(p.kind === 'wing' && c.wingOff?.[wingIdx(p)])).map(p => ({ part: p, cx: c.x + fx * p.ca - fz * p.cb, cz: c.z + fz * p.ca + fx * p.cb,
    pts: p.pts.map(([a, b]) => [c.x + fx * a - fz * b, c.z + fz * a + fx * b]) }));
}
const cross = (ax, az, bx, bz) => ax * bz - az * bx;
// inside a convex polygon (either winding)
function inside(P, x, z) {
  let sign = 0;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], c = cross(bx - ax, bz - az, x - ax, z - az);
    if (c !== 0) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); }
  }
  return true;
}
// two convex polygons: null if apart, else { pen, nx, nz (from A to B), mx, mz (the overlap's middle) }
function overlap(A, B) {
  let pen = Infinity, nx = 0, nz = 0;
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], l = FM.hypot(bx - ax, bz - az);
    const ux = -(bz - az) / l, uz = (bx - ax) / l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of A) { const d = x * ux + z * uz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, z] of B) { const d = x * ux + z * uz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return null;
    if (o < pen) { pen = o; const s = b0 + b1 >= a0 + a1 ? 1 : -1; nx = ux * s; nz = uz * s; }
  }
  // the overlap's middle: the corners of each inside the other and the points where their edges cross
  let sx = 0, sz = 0, n = 0;
  const add = (x, z) => { sx += x; sz += z; n++; };
  for (const [x, z] of A) if (inside(B, x, z)) add(x, z);
  for (const [x, z] of B) if (inside(A, x, z)) add(x, z);
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    const [px, pz] = A[i], [qx, qz] = A[(i + 1) % A.length], [rx, rz] = B[j], [tx, tz] = B[(j + 1) % B.length];
    const ex = qx - px, ez = qz - pz, fx = tx - rx, fz = tz - rz, den = cross(ex, ez, fx, fz);
    if (Math.abs(den) < 1e-12) continue;
    const s = cross(rx - px, rz - pz, fx, fz) / den, t = cross(rx - px, rz - pz, ex, ez) / den;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) add(px + ex * s, pz + ez * s);
  }
  return n ? { pen, nx, nz, mx: sx / n, mz: sz / n } : null;
}
// distance between two convex polygons that don't overlap (closest corner to an edge, both ways)
function apart(A, B) {
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const [x, z] of P) for (let j = 0; j < Q.length; j++) {
    const [ax, az] = Q[j], [bx, bz] = Q[(j + 1) % Q.length], ux = bx - ax, uz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz)));
    best = Math.min(best, FM.hypot(x - ax - ux * t, z - az - uz * t));
  }
  return best;
}
// every touching pair of parts between two cars
function contacts(WA, WB) {
  const out = [];
  for (const pa of WA) for (const pb of WB) {
    if (FM.hypot(pb.cx - pa.cx, pb.cz - pa.cz) > pa.part.r + pb.part.r) continue;
    const o = overlap(pa.pts, pb.pts);
    if (o) out.push({ ...o, a: pa.part, b: pb.part, closing: 0, e: 0, mu: 0, mn: 0, mt: 0, jn: 0, jt: 0 });   // (the solver's numbers: collide)
  }
  return out;
}
// clearance between two cars' bodies (m); < 0 = overlapping (by the deepest contact)
/** @param {Car} a @param {Car} b */
export function carGap(a, b, H = prepareHitbox()) {
  const WA = world(a, H), WB = world(b, H), touch = contacts(WA, WB);
  if (touch.length) return -Math.max(...touch.map(t => t.pen));
  return Math.min(...WA.flatMap(pa => WB.map(pb => apart(pa.pts, pb.pts))));
}

/** @param {Car} c */
const velocity = c => [FM.cos(c.h) * c.v - FM.sin(c.h) * c.vy, FM.sin(c.h) * c.v + FM.cos(c.h) * c.vy];
// velocity of the point (px, pz) of car c: the centre's plus the yaw rate's (ω × r)
/** @param {Car} c */
const pointVelocity = (c, px, pz) => { const [vx, vz] = velocity(c); return [vx - c.yawRate * (pz - c.z), vz + c.yawRate * (px - c.x)]; };
// add a world-space impulse (per unit mass: a velocity change) (jx, jz) at (px, pz) to car c
/** @param {Car} c */
function kick(c, jx, jz, px, pz) {
  const fx = FM.cos(c.h), fz = FM.sin(c.h);
  c.v += jx * fx + jz * fz;
  c.vy += -jx * fz + jz * fx;
  c.yawRate += cross(px - c.x, pz - c.z, jx, jz) / K2;
}
// impulse per unit closing speed along (ux, uz) at a point: 1 / (both cars' inverse mass + their inverse inertia there)
/** @param {Car} a @param {Car} b */
function effMass(a, b, mx, mz, ux, uz) {
  const ra = cross(mx - a.x, mz - a.z, ux, uz), rb = cross(mx - b.x, mz - b.z, ux, uz);
  return 1 / (2 + (ra * ra + rb * rb) / K2);
}

/** @param {Race} race */
export function collide(race) {
  const cars = race.cars, elev = race.track.elev, C = CONTACT, H = HITBOX, HB = prepareHitbox(race.hitbox);
  for (const c of cars) { c.wasTouching = c.touching; if (!c.wasTouching) { c.wingLoad = [0, 0]; c.climbed = 0; } c.touching = false; }
  for (let i = 0; i < cars.length; i++) for (let j = i+1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if ((a.pit && !a.pit.drive) || (b.pit && !b.pit.drive)) continue;   // AI cars on their pit-lane path (pit.js) don't touch
    if (FM.hypot(b.x - a.x, b.z - a.z) > 2 * HB.reach) continue;
    if (elev && Math.abs(elev.Y[a.idx] - elev.Y[b.idx]) > ELEVATION.apart) continue;   // one on a bridge, the other under it
    if (Math.abs((a.air?.y || 0) - (b.air?.y || 0)) > AIR.over) continue;               // one flying over the other
    // (a front wing half that gave way this touch passes through: HITBOX.wingStrength)
    const gone = (c, p) => c.wingLoad[wingIdx(p)] >= H.wingStrength;
    const touch = contacts(world(a, HB), world(b, HB)).filter(t => !(t.a.kind === 'wing' && gone(a, t.a)) && !(t.b.kind === 'wing' && gone(b, t.b)));
    if (!touch.length) continue;
    // the closing speed at each contact before any impulse: the bounce aims at it, the impact is the largest
    for (const t of touch) {
      const [vax, vaz] = pointVelocity(a, t.mx, t.mz), [vbx, vbz] = pointVelocity(b, t.mx, t.mz);
      t.closing = (vax - vbx) * t.nx + (vaz - vbz) * t.nz;
      t.e = Math.max(H.restitution[t.a.kind], H.restitution[t.b.kind]); t.mu = Math.sqrt(H.mu[t.a.kind] * H.mu[t.b.kind]);
      t.mn = effMass(a, b, t.mx, t.mz, t.nx, t.nz); t.mt = effMass(a, b, t.mx, t.mz, -t.nz, t.nx);
      t.jn = 0; t.jt = 0;
    }
    const impact = Math.max(0, ...touch.map(t => t.closing));
    for (const c of [a, b]) { if (!c.wasTouching && !c.touching) emit(c, EV.CONTACT, { impact, with: c === a ? b.code : a.code }); c.touching = true; }
    // sequential impulses: normal (accumulated ≥ 0, stopping the closing speed plus the bounce), then friction across
    // it (accumulated within ±mu × the normal impulse)
    for (let it = 0; it < C.iterations; it++) for (const t of touch) {
      let [vax, vaz] = pointVelocity(a, t.mx, t.mz), [vbx, vbz] = pointVelocity(b, t.mx, t.mz);
      const vn = (vax - vbx) * t.nx + (vaz - vbz) * t.nz;
      let jn = Math.max(0, t.jn + t.mn * (vn + t.e * Math.max(0, t.closing)));
      // a front wing pushes at most what it takes before it breaks off (per touch): the rest goes into the wing
      for (const [c, p] of [[a, t.a], [b, t.b]]) if (p.kind === 'wing') jn = Math.min(jn, t.jn + Math.max(0, H.wingStrength - c.wingLoad[wingIdx(p)]));
      const dn = jn - t.jn; t.jn = jn;
      for (const [c, p] of [[a, t.a], [b, t.b]]) if (p.kind === 'wing') c.wingLoad[wingIdx(p)] += dn;
      kick(a, -t.nx * dn, -t.nz * dn, t.mx, t.mz); kick(b, t.nx * dn, t.nz * dn, t.mx, t.mz);
      [vax, vaz] = pointVelocity(a, t.mx, t.mz); [vbx, vbz] = pointVelocity(b, t.mx, t.mz);
      const tx = -t.nz, tz = t.nx, vt = (vax - vbx) * tx + (vaz - vbz) * tz, lim = t.mu * t.jn;
      const jt = Math.min(lim, Math.max(-lim, t.jt + t.mt * vt)), dt = jt - t.jt; t.jt = jt;
      kick(a, -tx * dt, -tz * dt, t.mx, t.mz); kick(b, tx * dt, tz * dt, t.mx, t.mz);
    }
    // a front tyre pushing into the back of a rear tyre climbs it (airborne.js): the treads rub in opposite directions,
    // the friction of the push lifts it at the contact point
    for (const t of touch) for (const [c, p, q, s] of [[a, t.a, t.b, 1], [b, t.b, t.a, -1]]) {
      if (!p.front || !q.rear || t.jn <= 0) continue;
      const fx = FM.cos(c.h), fz = FM.sin(c.h);
      if (s * (t.nx * fx + t.nz * fz) < 0.6) continue;              // (the other car ahead of this one, roughly in line)
      const rx = t.mx - c.x, rz = t.mz - c.z, up = Math.min(t.mu * t.jn, Math.max(0, AIR.climb * t.closing - c.climbed));
      if (up > 0) { c.climbed += up; lift(c, up, rx * fx + rz * fz, -rx * fz + rz * fx); }
    }
    // front wing halves that gave way break off (with damage on: a new nose at the pit stop)
    if (race.wear?.damage) for (const c of [a, b]) for (const k of [0, 1]) if (!c.wingOff[k] && c.wingLoad[k] >= H.wingStrength) {
      c.wingOff[k] = true; c.damage.wing = Math.max(c.damage.wing, 0.5 * c.wingOff.filter(Boolean).length);
      emit(c, EV.WING_OFF, { side: k ? 'right' : 'left' });
    }
    // push apart along the deepest contact's normal, again while another pair of parts still overlaps
    for (let k = 0, left = touch; k < C.pushes && left.length; k++, left = contacts(world(a, HB), world(b, HB))) {
      const deep = left.reduce((m, t) => t.pen > m.pen ? t : m), push = (deep.pen + C.slop) / 2;
      a.x -= deep.nx * push; a.z -= deep.nz * push; b.x += deep.nx * push; b.z += deep.nz * push;
    }
    // damage (on a new touch): the parts that hit, by the closing speed there
    if (!a.wasTouching || !b.wasTouching) for (const t of touch) if (t.closing > 0) {
      for (const [c, p] of [[a, t.a], [b, t.b]]) addDamage(race, c, t.closing, p.kind === 'wing' ? (gone(c, p) ? 2 : 1) : 0, C.damageHard, p.kind === 'tyre' ? C.wheelFrom : 0);
    }
    afterMove(race, a); afterMove(race, b);
  }
}
