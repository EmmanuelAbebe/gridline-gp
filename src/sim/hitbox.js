// A hitbox (HITBOX's form, collide.js) made from any car's shape seen from above (2026-10-28: the classic car, whose
// shape the design tools change; the 2026 car's is measured by hand in tuning.js). points = [x forward, z right] of the
// bodywork in the car's frame (the wheels left out), wheels = their footprints { x0, x1, z0, z1 }. The bodywork's
// half-width every `bin` m along the car is covered by symmetric trapezoids (convex), each as long as it stays within
// `tol` m of the shape (each bin first widened to its neighbours': thin rods); the ones ahead of the front wheels are the
// front wing (halves that can break off), the ones reaching back past the rear wheels a ramp a front wheel can climb
// (AIR). Pure: no DOM, no Three.js.
export const HITBOX_FIT = Object.freeze({ bin: 0.05, tol: 0.1, min: 0.05 });

export function hitboxFrom(points, wheels, { bin = HITBOX_FIT.bin, tol = HITBOX_FIT.tol } = {}) {
  // half-width per bin (a point beside a wheel, inside its length, belongs to the wheel and its suspension)
  const inner = x => Math.min(Infinity, ...wheels.filter(w => x >= w.x0 && x <= w.x1).map(w => Math.min(Math.abs(w.z0), Math.abs(w.z1))));
  const width = new Map();
  for (const [x, z] of points) {
    if (Math.abs(z) >= inner(x) - 0.02) continue;
    const k = Math.round(x / bin);
    width.set(k, Math.max(width.get(k) || 0, Math.abs(z)));
  }
  // (thin parts: suspension rods, mirror stalks: their bins' widths jump; each bin takes the widest of its neighbours)
  const raw = new Map(width);
  for (const k of raw.keys()) width.set(k, Math.max(raw.get(k), raw.get(k - 1) ?? 0, raw.get(k + 1) ?? 0));
  const keys = [...width.keys()].sort((a, b) => b - a);          // front to back
  const parts = [], frontWheel = Math.max(...wheels.map(w => w.x1)), rearWheel = Math.min(...wheels.map(w => w.x0));
  let i = 0;
  while (i < keys.length) {
    // grow the segment while a straight edge (lifted to cover every bin) stays within tol of the shape
    let j = i;
    for (let n = i + 1; n < keys.length && keys[n] === keys[n - 1] - 1; n++) {
      const fit = trapezoid(keys, width, i, n);
      if (fit.excess > tol) break;
      j = n;
    }
    const { w0, w1 } = trapezoid(keys, width, i, j), x0 = (keys[i] + 0.5) * bin, x1 = (keys[j] - 0.5) * bin;
    const a = Math.max(HITBOX_FIT.min, w0), b = Math.max(HITBOX_FIT.min, w1);
    const wing = x1 >= frontWheel - bin, ramp = x1 < rearWheel;   // (ramp: reaching back past the rear wheels)
    parts.push(wing
      ? { name: 'front wing', kind: 'wing', mirror: true, pts: [[x1, 0], [x0, 0], [x0, a], [x1, b]] }
      : { name: 'body', kind: 'body', ...(ramp ? { ramp: true } : {}), pts: [[x1, -b], [x0, -a], [x0, a], [x1, b]] });
    i = j + 1;
  }
  for (const w of wheels) parts.push({ name: 'tyre', kind: 'tyre', pts: [[w.x0, w.z0], [w.x1, w.z0], [w.x1, w.z1], [w.x0, w.z1]] });
  return parts;
}
// the straight edge from bin i to bin j (front to back), lifted to cover them all: its widths at the ends and how far
// it sits outside the shape at worst
function trapezoid(keys, width, i, j) {
  const wi = width.get(keys[i]), wj = width.get(keys[j]), line = k => i === j ? wi : wi + (wj - wi) * (k - i) / (j - i);
  let lift = 0;
  for (let k = i; k <= j; k++) lift = Math.max(lift, width.get(keys[k]) - line(k));
  let excess = 0;
  for (let k = i; k <= j; k++) excess = Math.max(excess, line(k) + lift - width.get(keys[k]));
  // (the ends reach half a bin past the first and last bins' centres)
  const slope = i === j ? 0 : (wj - wi) / (j - i);
  return { w0: wi + lift - slope * 0.5, w1: wj + lift + slope * 0.5, excess };
}
