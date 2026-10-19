// The car's performance: grip and downforce, drag, engine and gearbox, brakes, slipstream.
// One model for every car, with the car's own numbers from its spec (spec.js: STOCK for the AI, the garage setup for
// the player; every function takes it, default STOCK); the tyres and chassis are in chassis.js, the drivers in driving.js.
// Everything is per unit mass (m/s²) so it reads as accelerations.
import { TUNING, CAR, CHASSIS, SLIP, EV, ACTIVE_AERO, OVERTAKE } from './tuning.js';
import { clamp } from './math.js';
import { emit } from './events.js';
import { STOCK } from './spec.js';
/** @typedef {import('./spec.js').Spec} Spec */
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

export const G = 9.81; const TAU = 2 * Math.PI;
const { aero, engine, gearbox } = CAR;
const R_WHEEL = TUNING.WHEEL_RADIUS;
export const DOWNFORCE_K = STOCK.dfK;   // stock downforce / mass = K·v²
export const GEARS = gearbox.top.length - 1;

// ---------- grip ----------
// Cornering limit (m/s²): tyre friction × (weight + downforce). Grows with v², so fast corners open up.
/** @param {number} v @param {Spec} [s] */
export const lateralGrip = (v, s = STOCK) => s.grip * (G + s.dfK * v * v);
// Straight-line braking limit of the tyres (ABS at the peak): longitudinal grip × (weight + downforce), up to what the
// brake system can ask for. The AI's speed profile brakes at a share of this.
/** @param {number} v @param {Spec} [s] */
export const brakeLimit = (v, s = STOCK) => Math.min(s.brakeSystem, s.grip * CHASSIS.longGrip * (G + s.dfK * v * v));
// Deceleration asked for at full pedal: brake pressure follows the grip (like a real car's brakes set up for its
// downforce), a little past the limit so a stamp on the pedal still locks without ABS.
/** @param {number} v @param {Spec} [s] */
export const brakeMax = (v, s = STOCK) => Math.min(s.brakeSystem, CHASSIS.brakePedal * s.grip * CHASSIS.longGrip * (G + s.dfK * v * v));

// Fastest steady speed through curvature |k| using `share` of the grip: v² = R·a(v) solved for v (V_CAP when the
// downforce outgrows the corner, i.e. it is flat out).
/** @param {number} absK @param {number} [share] @param {Spec} [s] */
export function cornerSpeed(absK, share = 1, s = STOCK) {
  const R = 1 / Math.max(absK, 1e-6), mu = s.grip * share, den = 1 - R * mu * s.dfK;
  return den <= 0.02 ? TUNING.V_CAP : Math.min(TUNING.V_CAP, Math.sqrt(R * mu * G / den));
}

// ---------- engine + gearbox ----------
// overall ratio per gear (spec.ratio), from the speed each gear reaches at the redline
/** @param {number} v @param {number} gear @param {Spec} [s] */
export const rpmAt = (v, gear, s = STOCK) => gear > 0 ? Math.abs(v) / R_WHEEL * s.ratio[gear] * 60 / TAU : 0;

function powerKw(rpm) {
  const P = engine.power;
  if (rpm <= P[0][0]) return P[0][1] * rpm / P[0][0];
  for (let i = 1; i < P.length; i++) if (rpm <= P[i][0]) {
    const [r0, p0] = P[i - 1], [r1, p1] = P[i];
    return p0 + (p1 - p0) * (rpm - r0) / (r1 - r0);
  }
  return P[P.length - 1][1];
}
// Engine rpm in a gear, with clutch slip pulling away (never below idle; up to `launch` on the throttle in 1st).
function engineRpm(v, gear, thr, s) {
  const r = rpmAt(v, gear, s);
  return Math.max(r, engine.idle, gear === 1 ? engine.idle + thr * (engine.launch - engine.idle) : 0);
}
// Wheel force per mass at full throttle in a gear (before the traction limit).
/** @param {Spec} s */
export function driveAccel(rpm, gear, s = STOCK) {
  if (rpm >= engine.limiter) return 0;
  const torque = powerKw(rpm) * s.power * 1000 / (rpm * TAU / 60);
  return torque * s.ratio[gear] * engine.efficiency / R_WHEEL / s.mass;
}

// Gear changes. Auto: shift up at autoUp; on the throttle shift down only when revs fall below autoDown, off it (lifting,
// braking) shift down as soon as the next gear stays under autoBrakeDown, the way a driver goes down the box into a
// corner, so the gear always matches the speed. Manual: `shift` = +1/-1
// from the paddles; a downshift that would over-rev is refused (EV.SHIFT_DENIED). Gear -1 = reverse.
// Automatic downshift: off the throttle as soon as the lower gear is under autoBrakeDown (engine braking into the
// corner), on it only when the revs have fallen below autoDown and the lower gear has room.
// Without full traction control a part-throttle kick-down (e.g. into 1st at 90 km/h) would spin the rears, so then
// the box only kicks down on (nearly) full throttle or when the revs are really low (autoLug).
/** @param {Car} c */
const autoDown = (c, v, thr) => c.gear > 1 && (thr < 0.05
  ? rpmAt(v, c.gear - 1, c.spec) < gearbox.autoBrakeDown
  : rpmAt(v, c.gear, c.spec) < ((c.assists?.tc ?? 1) >= 1 || thr > 0.9 ? gearbox.autoDown : gearbox.autoLug) && rpmAt(v, c.gear - 1, c.spec) < gearbox.autoUp - 400);

// c.autoShift: automatic gearbox. Otherwise paddles (shift -1/+1); c.autoDown = semi-automatic: the player shifts up,
// the car also shifts down by itself (the player can still click down earlier).
/** @param {Car} c */
function updateGear(c, thr, brk, shift, dt) {
  if (c.shiftT > 0) c.shiftT -= dt;
  const v = c.v, before = c.gear;
  // reverse: brake held at a standstill engages it, gas or rolling forward leaves it
  if (c.gear === -1) { if (v > 0.5 || (thr > 0.02 && v > -0.3)) c.gear = 1; }
  else if (Math.hypot(v, c.vy || 0) <= 0.3 && brk > 0.1 && thr < 0.02) c.gear = -1;   // stopped, not sliding sideways
  if (c.gear > 0) {
    if (c.autoShift) {
      if (c.gear < GEARS && rpmAt(v, c.gear, c.spec) > gearbox.autoUp) c.gear++;
      else if (autoDown(c, v, thr)) c.gear--;
      else if (v < 2) c.gear = 1;
    } else {
      // manual: an upshift cancels waiting downshifts. A downshift that would over-rev is not lost: it waits
      // (c.downQueue) and goes in as soon as the lower gear is under the limiter, so the player can click down
      // early while braking. Stopped: back to 1st, ready to pull away.
      if (shift > 0) { c.downQueue = 0; if (c.gear < GEARS) c.gear++; }
      else if (shift < 0 && c.gear - (c.downQueue || 0) > 1) {
        if (!c.downQueue && rpmAt(v, c.gear - 1, c.spec) <= engine.limiter) c.gear--;
        else { c.downQueue = (c.downQueue || 0) + 1; emit(c, EV.SHIFT_DENIED); }
      }
      if (c.downQueue > 0 && rpmAt(v, c.gear - 1, c.spec) <= engine.limiter) { c.gear--; c.downQueue--; }
      else if (c.autoDown && shift <= 0 && autoDown(c, v, thr)) { c.gear--; c.downQueue = Math.max(0, c.downQueue - 1); }
      if (v < 2 && thr < 0.05) { c.gear = 1; c.downQueue = 0; }
    }
  }
  if (c.gear !== before) { if (before > 0 && c.gear > 0) c.shiftT = gearbox.shiftTime; emit(c, EV.SHIFT, { from: before, to: c.gear }); }
}

// ---------- slipstream ----------
// Half-width of a wake `gap` metres behind the car, shared with the renderer so the drawn wake is the real one.
export const wakeHalfWidth = gap => SLIP.width + SLIP.spread * gap;

// Strength 0..1 of the strongest wake this car sits in. Uses each car's trail (its lateral offset when it last
// passed each track sample), so the wake bends with the line the car ahead drove.
/** @param {Race} race @param {Car} c */
export function slipstream(race, c, progressOf) {
  const { N, ds } = race.track, mine = progressOf(race, c);
  let best = 0, by = null;
  for (const o of race.cars) {
    if (o === c || !o.trailT || o.trailT[c.idx] < 0) continue;
    const gap = (progressOf(race, o) - mine) * ds;
    if (gap <= SLIP.minGap || gap >= SLIP.range || gap >= N * ds / 2) continue;
    const off = Math.abs(o.trailLat[c.idx] - c.lat), hw = wakeHalfWidth(gap);
    const side = clamp(1 - (off - hw) / SLIP.edge, 0, 1);
    if (side <= 0) continue;
    const s = side * (1 - gap / SLIP.range) * clamp(o.v / SLIP.minSpeed, 0, 1);
    if (s > best) { best = s; by = o; }
  }
  c.slip = best; c.slipBy = by;
  return best;
}

// ---------- one step of the drivetrain ----------
// Engine side: gear and rpm, the engine's drive at the rear wheels (per mass, before any tyre limit) and the
// resistances (drag with slipstream, rolling, engine braking), signed so that `-resist` opposes the motion.
// inp: thr 0..1, brk 0..1, shift -1/0/+1.
/** @param {Car} c */
export function drivetrain(c, { thr, brk, shift = 0 }, dt) {
  updateGear(c, thr, brk, shift, dt);
  // drag: less in a slipstream and with the wings open (active-aero.js; aeroOpen 0 multiplies by exactly 1)
  const v = c.v, dragK = c.spec.dragK * (1 - SLIP.drag * (c.slip || 0)) * (1 - ACTIVE_AERO.dragCut * c.aeroOpen);
  let resist = dragK * v * Math.abs(v) + Math.sign(v) * aero.rolling;
  if (c.gear === -1) { c.rpm = engine.idle + brk * 3000; c.drive = 0; return { drive: 0, resist, reverse: true }; }
  const rpm = engineRpm(v, c.gear, thr, c.spec);
  c.rpm = rpm;
  let drive = driveAccel(rpm, c.gear, c.spec) * thr;
  if (c.shiftT > 0) drive *= gearbox.shiftCut;
  if (c.boostOn) drive *= 1 + OVERTAKE.power;       // overtake mode: extra electrical power
  if (thr < 0.05 && v > 0.5) resist += engine.engineBrake * Math.min(1, rpm / engine.redline);
  c.drive = drive;
  return { drive, resist, reverse: false };
}

export const VEHICLE_INFO = Object.freeze({ redline: engine.redline, limiter: engine.limiter, idle: engine.idle,
  autoUp: gearbox.autoUp, gears: GEARS });
