// What a spec does, in numbers the garage shows next to the setup (and the tests check): straight-line speed and
// acceleration (full throttle from standstill, automatic gearbox, traction-limited), steady cornering speed at a few
// radii, braking distance, and the balance in slow and fast corners. Quick (a 60 s straight at 120 Hz, no track).
import { TUNING, CAR, CHASSIS as CH, ASSISTS } from './tuning.js';
import { drivetrain, cornerSpeed, brakeLimit } from './vehicle.js';
/** @typedef {import('./spec.js').Spec} Spec */

const G = 9.81, DT = 1 / 120, KMH = 3.6;

// front grip per front load over rear grip per rear load at speed v: 1 = neutral, > 1 the front has more to give
// (turns in, the rear lets go first: oversteer), < 1 understeer
/** @param {Spec} s */
export function balanceAt(s, v) {
  const fw = CH.frontWeight, df = s.dfK * v * v;
  const front = s.frontGrip * (G * fw + df * s.aeroFront) / fw, rear = s.rearGrip * (G * (1 - fw) + df * (1 - s.aeroFront)) / (1 - fw);
  return front / rear;
}

/** @param {Spec} s */
export function specStats(s) {
  const c = { spec: s, v: 0, gear: 1, rpm: 0, shiftT: 0, autoShift: true, autoDown: false, downQueue: 0, slip: 0, drive: 0, aeroOpen: 0, boostOn: false,
    assists: ASSISTS.medium, events: [] };
  let v = 0, t = 0, t100 = null, t200 = null, top = 0, steady = 0;
  while (t < 60 && steady < 2) {
    const d = drivetrain(/** @type {any} */ (c), { thr: 1, brk: 0 }, DT);
    const traction = s.grip * s.rearGrip * CH.longGrip * (G * (1 - CH.frontWeight) + s.dfK * v * v * (1 - s.aeroFront));
    const a = Math.min(d.drive, traction) - d.resist;
    v = Math.min(TUNING.V_CAP, Math.max(0, v + a * DT)); c.v = v; t += DT;
    if (t100 === null && v * KMH >= 100) t100 = t;
    if (t200 === null && v * KMH >= 200) t200 = t;
    if (v > top + 0.001) { top = v; steady = 0; } else steady += DT;
    c.events.length = 0;
  }
  // braking from 300 km/h (or the top speed) to 100: tyres at the ABS limit + drag + rolling
  let bv = Math.min(300 / KMH, top), dist = 0;
  const from = bv;
  while (bv > 100 / KMH) { const a = brakeLimit(bv, s) + s.dragK * bv * bv + CAR.aero.rolling; dist += bv * DT; bv -= a * DT; }
  return {
    top: top * KMH, t100, t200,
    corner: Object.fromEntries([30, 80, 200].map(R => [R, cornerSpeed(1 / R, 1, s) * KMH])),   // km/h, steady, at the grip limit
    brake: { from: from * KMH, dist },          // m from `from` km/h to 100 km/h
    balance: { slow: balanceAt(s, 80 / KMH), fast: balanceAt(s, 250 / KMH) },
  };
}
