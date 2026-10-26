// The car's performance: grip and downforce, drag, engine and gearbox, brakes, slipstream.
// One model for every car, with the car's own numbers from its spec (spec.js: STOCK for the AI, the garage setup for
// the player; every function takes it, default STOCK); the tyres and chassis are in chassis.js, the drivers in driving.js.
// Everything is per unit mass (m/s²) so it reads as accelerations.
import { TUNING, CAR, CHASSIS, SLIP, EV, ACTIVE_AERO, ERS } from './tuning.js';
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
// Tyre grip (m/s², per mass) under a load n (per mass; G = the car's weight at rest): friction × load, the friction
// falling as the load rises above the static one (load sensitivity, CAR.loadSens per g of extra load; real slicks lose
// ~10–20 % at 2× their static load), never below CAR.muMin of it. So downforce gives less than its share and the
// outer tyre in a corner gains less than the inner one loses (chassis.js: per wheel). `ns` = the static load.
/** @param {number} n @param {Spec} [s] */
export const tyreGrip = (n, s = STOCK, ns = G) => s.grip * n * Math.max(CAR.muMin, 1 - CAR.loadSens * (n / ns - 1));
// Sideways load transfer costs grip: cornering at a moves a·cgHeight/track of load to the outer wheels (rollFront of it
// on the front axle), and with load sensitivity the outer tyre gains less than the inner loses: the car's grip falls
// by LAT_LOSS·a² (per axle 2·μ·loadSens·d² / its static wheel load, summed: the steady skidpad, chassis.js per wheel).
const latLoss = s => { const h = CHASSIS.cgHeight / CHASSIS.track, fw = CHASSIS.frontWeight, rf = s.rollFront ?? CHASSIS.rollFront;
  return 4 * s.grip * CAR.loadSens * h * h / G * (rf * rf / fw + (1 - rf) * (1 - rf) / (1 - fw)); };
// Cornering limit (m/s²) at speed v: the tyres' grip under weight + downforce, less the sideways transfer's cost
// (a = grip − k·a², solved for a).
/** @param {number} v @param {Spec} [s] */
export const lateralGrip = (v, s = STOCK) => { const g = tyreGrip(G + s.dfK * v * v, s), k = latLoss(s); return (Math.sqrt(1 + 4 * k * g) - 1) / (2 * k); };
// Straight-line braking limit of the tyres (ABS at the peak): longitudinal grip under weight + downforce, up to what the
// brake system can ask for. The AI's speed profile brakes at a share of this.
/** @param {number} v @param {Spec} [s] */
export const brakeLimit = (v, s = STOCK) => Math.min(s.brakeSystem, CHASSIS.longGrip * tyreGrip(G + s.dfK * v * v, s));
// The speed² u where the cornering asked, a·u − b, reaches what the tyres give under the load c + d·u with `share` of
// their grip (load sensitivity makes it a quadratic: f(u) = A2·u² + B·u + C, its first positive root); Infinity when
// the grip always outgrows the corner (flat out). Flat ground: a = |k|, b = 0, c = G, d = dfK; elevation.js for hills.
export function cornerU(a, b, c, d, share, s = STOCK) {
  const mu = s.grip * share, ls = CAR.loadSens, p = mu * ls / G, k = latLoss(s) * share;
  // (+ the sideways transfer's cost k·(a·u − b)²: lateralGrip)
  const A2 = p * d * d + k * a * a, B = a - mu * (1 + ls) * d + 2 * p * c * d - 2 * k * a * b, C = -b - mu * (1 + ls) * c + p * c * c + k * b * b;
  if (C >= 0) return 0;                                   // (nothing to give even standing still)
  if (A2 < 1e-12) return B > 1e-9 ? -C / B : Infinity;
  const disc = B * B - 4 * A2 * C;
  return (-B + Math.sqrt(disc)) / (2 * A2);
}
// Deceleration asked for at full pedal: as on a real car the pedal sets the brake pressure, the same at any speed
// (2026-10-24; it used to follow the grip): at 300 km/h full pedal is about where the tyres lock, at 100 km/h a third of
// it is, so a driver without ABS bleeds the pedal off as the car slows and the downforce goes.
/** @param {number} v @param {Spec} [s] */
export const brakeMax = (v, s = STOCK) => CHASSIS.brakeFull * s.brakeSystem / CHASSIS.brakeSystem;   // (the brakes mod scales it)

// Fastest steady speed through curvature |k| using `share` of the grip: v² = R·a(v) solved for v (V_CAP when the
// downforce outgrows the corner, i.e. it is flat out).
/** @param {number} absK @param {number} [share] @param {Spec} [s] */
export function cornerSpeed(absK, share = 1, s = STOCK) {
  const u = cornerU(Math.max(absK, 1e-6), 0, G, s.dfK, share, s);
  return u >= TUNING.V_CAP * TUNING.V_CAP ? TUNING.V_CAP : Math.sqrt(u);
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
  // reverse (TUNING.REVERSE_HOLD): stopped (not sliding sideways), brake + gas held together selects it once the car
  // has driven off; rolling forward, or stopped on the brake alone, leaves it
  const stopped = Math.hypot(v, c.vy || 0) <= 0.3;
  if (v > 5) c.movedOff = true;
  if (c.gear === -1) { if (v > 0.5 || (stopped && brk > 0.1 && thr < 0.02)) c.gear = 1; }
  else {
    c.revT = stopped && c.movedOff && brk > 0.1 && thr > 0.1 ? c.revT + dt : 0;
    if (c.revT >= TUNING.REVERSE_HOLD) { c.gear = -1; c.revT = 0; }
  }
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

// ---------- the 2026 power unit's electrical side (ERS) ----------
// c.soc: battery charge (J), c.harvested: J harvested this lap (capped at ERS.perLap), c.ersKw: + deploying / − harvesting.
// Returns the drive it adds and the resistance its harvesting adds (per mass). Braking harvest is free (brake-by-wire:
// the rear brakes do less, the car brakes the same).
/** @param {Car} c */
function ers(c, thr, brk, v, dt, room = 1, iceKw = 0, pedal = thr) {
  const s = c.spec, m = s.mass, sp = Math.max(v, 0);
  if (!(dt > 0)) return { drive: 0, resist: 0 };            // (a step of no time: nothing flows; it would divide by 0)
  if (c.ersLap !== c.lap) { c.ersLap = c.lap; c.harvested = 0; }
  const charge = j => { const room = Math.min(ERS.store - c.soc, ERS.perLap - c.harvested), got = Math.max(0, Math.min(j, room)); c.soc += got; c.harvested += got; return got; };
  const from = c.boostOn ? ERS.taperFromBoost : ERS.taperFrom, taper = clamp((ERS.taperTo - sp) / (ERS.taperTo - from), 0, 1);
  let drive = 0, resist = 0, kw = 0;
  if (pedal >= 0.05 && sp > 0.5) {
    const full = clamp((c.soc / ERS.store) / ERS.low, 0, 1) || (c.boostOn && c.soc > 0 ? 1 : 0);
    let p = ERS.kw * 1000 * s.power * thr * taper * full * room * (c.boostOn ? 1 : c.deploy ?? 1);
    p = Math.min(p, c.soc / dt);
    if (p > 0) { c.soc -= p * dt; drive = p / (m * Math.max(sp, ERS.minSpeed)); kw = p / 1000; }
    // super clipping: past the taper with the battery low, the MGU-K charges from the engine instead
    if (taper < 1 && thr > 0.9 && c.soc < ERS.clipBelow * ERS.store && !c.boostOn) {
      const got = charge(ERS.clipKw * 1000 * (1 - taper) * dt) / dt; resist += got / (m * sp); kw -= got / 1000;
    }
    // part throttle: the engine runs harder than the wheels ask and the MGU-K stores the rest (the drive is the same)
    if (thr < ERS.partBelow) { const got = charge(Math.min(ERS.partKw * 1000, iceKw * 1000 * (1 - thr)) * dt) / dt; kw -= got / 1000; }
  } else if (sp > 0.5) {
    // braking: as much as the rear brakes ask (their share ~43 %), up to harvestKw; lifting: coastKw of engine braking
    const brakeP = brk > 0 ? brakeMax(sp, s) * brk * m * sp * 0.43 : 0;
    const want = brk > 0 ? Math.min(ERS.harvestKw * 1000, brakeP) : Math.min(ERS.coastKw * 1000, ERS.coastMax * m * sp);
    const got = charge(want * dt) / dt; kw = -got / 1000;
    if (!brk) resist += got / (m * sp);
  }
  c.ersKw = kw;
  return { drive, resist };
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
  if (c.gear === -1) { c.rpm = engine.idle + thr * 3000; c.drive = 0; return { drive: 0, resist, reverse: true }; }
  const rpm = engineRpm(v, c.gear, thr, c.spec);
  c.rpm = rpm;
  const tq = thr ** engine.pedalMap;                // the torque the pedal asks for (torque map)
  let drive = driveAccel(rpm, c.gear, c.spec) * tq;
  // the MGU-K and the battery (ERS): deployment on the throttle, harvesting under braking and lifting
  // (the motor fades out from 300 to 50 rpm before the limiter, so the car never overshoots it)
  const e = ers(c, tq, brk, v, dt, clamp((engine.limiter - 50 - rpm) / 250, 0, 1) * Math.min(1, rpm / ERS.fullRpm), powerKw(rpm) * c.spec.power * engine.efficiency, thr);
  drive += e.drive;
  if (c.shiftT > 0) drive *= gearbox.shiftCut;
  if (thr < 0.05 && v > 0.5) resist += engine.engineBrake * Math.min(1, rpm / engine.redline);
  resist += e.resist;
  c.drive = drive;
  return { drive, resist, reverse: false };
}

export const VEHICLE_INFO = Object.freeze({ redline: engine.redline, limiter: engine.limiter, idle: engine.idle,
  autoUp: gearbox.autoUp, gears: GEARS });
