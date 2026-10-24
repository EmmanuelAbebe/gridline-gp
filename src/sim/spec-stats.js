// What a spec does, in numbers the garage shows next to the setup (and the tests check): straight-line speed and
// acceleration (full throttle from standstill, automatic gearbox, traction-limited), steady cornering speed at a few
// radii, braking distance, and the balance in slow and fast corners. Quick (a 60 s straight at 120 Hz, no track).
import { TUNING, CAR, CHASSIS as CH, ASSISTS, ERS } from './tuning.js';
import { drivetrain, cornerSpeed, brakeLimit, tyreGrip, lateralGrip } from './vehicle.js';
/** @typedef {import('./spec.js').Spec} Spec */

const G = 9.81, DT = 1 / 120, KMH = 3.6;

// front grip per front load over rear grip per rear load at speed v: 1 = neutral, > 1 the front has more to give
// (turns in, the rear lets go first: oversteer), < 1 understeer
/** @param {Spec} s */
export function balanceAt(s, v) {
  // (at the cornering limit, with the sideways load transfer split by the anti-roll bars: rollFront, chassis.js)
  const fw = CH.frontWeight, df = s.dfK * v * v, a = lateralGrip(v, s), d = a * CH.cgHeight / CH.track;
  const axle = (load, dd, ns) => tyreGrip(load / 2 + dd, s, ns / 2) + tyreGrip(Math.max(0, load / 2 - dd), s, ns / 2);
  const front = s.frontGrip * axle(G * fw + df * s.aeroFront, d * s.rollFront, G * fw) / fw;
  const rear = s.rearGrip * axle(G * (1 - fw) + df * (1 - s.aeroFront), d * (1 - s.rollFront), G * (1 - fw)) / (1 - fw);
  return front / rear;
}

/** @param {Spec} s */
export function specStats(s) {
  const c = { spec: s, v: 0, gear: 1, rpm: 0, shiftT: 0, autoShift: true, autoDown: false, downQueue: 0, slip: 0, drive: 0, aeroOpen: 0, boostOn: false,
    assists: ASSISTS.medium, events: [], soc: ERS.store, harvested: 0, ersLap: 0, ersKw: 0, lap: 0 };
  let v = 0, t = 0, t100 = null, t200 = null, top = 0, steady = 0;
  while (t < 60 && steady < 2) {
    const d = drivetrain(/** @type {any} */ (c), { thr: 1, brk: 0 }, DT);
    const traction = s.rearGrip * CH.longGrip * tyreGrip(G * (1 - CH.frontWeight) + s.dfK * v * v * (1 - s.aeroFront), s, G * (1 - CH.frontWeight));
    const a = Math.min(d.drive, traction) - d.resist;
    v = Math.min(TUNING.V_CAP, Math.max(0, v + a * DT)); c.v = v; t += DT;
    if (t100 === null && v * KMH >= 100) t100 = t;
    if (t200 === null && v * KMH >= 200) t200 = t;
    if (v > top + 0.001) { top = v; steady = 0; } else steady += DT;
    c.events.length = 0;
  }
  // the top speed as on a real straight (as tools/car-bench.mjs measures it): from 200 km/h with a charged battery, 1.2 km
  Object.assign(c, { v: 200 / KMH, gear: 6, soc: ERS.store, harvested: 0 }); v = c.v; top = v;
  for (let dist = 0; dist < 1200;) {
    const d = drivetrain(/** @type {any} */ (c), { thr: 1, brk: 0 }, DT);
    v = Math.min(TUNING.V_CAP, Math.max(0, v + (d.drive - d.resist) * DT)); c.v = v; dist += v * DT; top = Math.max(top, v); c.events.length = 0;
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
