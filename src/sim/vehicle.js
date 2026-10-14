// The car's performance: grip and downforce, drag, engine and gearbox, brakes, slipstream.
// One model for every car; the tyres and chassis are in chassis.js, the drivers (player and AI) in driving.js.
// Everything is per unit mass (m/s²) so it reads as accelerations.
import { TUNING, CAR, CHASSIS, SLIP, EV } from './tuning.js';
import { clamp } from './math.js';

const G = 9.81, TAU = 2 * Math.PI;
const { aero, engine, gearbox } = CAR;
const R_WHEEL = TUNING.WHEEL_RADIUS;
export const DOWNFORCE_K = 0.5 * aero.rho * aero.liftArea / CAR.mass;   // downforce / mass = K·v²
export const DRAG_K = 0.5 * aero.rho * aero.dragArea / CAR.mass;        // drag / mass = K·v²
export const GEARS = gearbox.top.length - 1;

// ---------- grip ----------
// Cornering limit (m/s²): tyre friction × (weight + downforce). Grows with v², so fast corners open up.
export const lateralGrip = v => CAR.grip * (G + DOWNFORCE_K * v * v);
// Straight-line braking limit of the tyres (ABS at the peak): longitudinal grip × (weight + downforce), up to what the
// brake system can ask for. The AI's speed profile brakes at a share of this.
export const brakeLimit = v => Math.min(CHASSIS.brakeSystem, CAR.grip * CHASSIS.longGrip * (G + DOWNFORCE_K * v * v));

// Fastest steady speed through curvature |k| using `share` of the grip: v² = R·a(v) solved for v (V_CAP when the
// downforce outgrows the corner, i.e. it is flat out).
export function cornerSpeed(absK, share = 1) {
  const R = 1 / Math.max(absK, 1e-6), mu = CAR.grip * share, den = 1 - R * mu * DOWNFORCE_K;
  return den <= 0.02 ? TUNING.V_CAP : Math.min(TUNING.V_CAP, Math.sqrt(R * mu * G / den));
}

// ---------- engine + gearbox ----------
// overall ratio per gear, from the speed each gear reaches at the redline
const RATIO = gearbox.top.map(kmh => kmh ? (engine.redline * TAU / 60) / (kmh / 3.6 / R_WHEEL) : 0);
export const rpmAt = (v, gear) => gear > 0 ? Math.abs(v) / R_WHEEL * RATIO[gear] * 60 / TAU : 0;

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
function engineRpm(v, gear, thr) {
  const r = rpmAt(v, gear);
  return Math.max(r, engine.idle, gear === 1 ? engine.idle + thr * (engine.launch - engine.idle) : 0);
}
// Wheel force per mass at full throttle in a gear (before the traction limit).
function driveAccel(rpm, gear) {
  if (rpm >= engine.limiter) return 0;
  const torque = powerKw(rpm) * 1000 / (rpm * TAU / 60);
  return torque * RATIO[gear] * engine.efficiency / R_WHEEL / CAR.mass;
}

// Gear changes. Auto: shift up at autoUp; on the throttle shift down only when revs fall below autoDown, off it (lifting,
// braking) shift down as soon as the next gear stays under autoBrakeDown, the way a driver goes down the box into a
// corner, so the gear always matches the speed. Manual: `shift` = +1/-1
// from the paddles; a downshift that would over-rev is refused (EV.SHIFT_DENIED). Gear -1 = reverse.
function updateGear(c, thr, brk, shift, dt) {
  if (c.shiftT > 0) c.shiftT -= dt;
  const v = c.v, before = c.gear;
  // reverse: brake held at a standstill engages it, gas or rolling forward leaves it
  if (c.gear === -1) { if (v > 0.5 || (thr > 0.02 && v > -0.3)) c.gear = 1; }
  else if (v <= 0.3 && brk > 0.1 && thr < 0.02) c.gear = -1;
  if (c.gear > 0) {
    if (c.autoShift) {
      if (c.gear < GEARS && rpmAt(v, c.gear) > gearbox.autoUp) c.gear++;
      else if (c.gear > 1 && (thr < 0.05
        ? rpmAt(v, c.gear - 1) < gearbox.autoBrakeDown
        : rpmAt(v, c.gear) < gearbox.autoDown && rpmAt(v, c.gear - 1) < gearbox.autoUp - 400)) c.gear--;
      else if (v < 2) c.gear = 1;
    } else if (shift > 0 && c.gear < GEARS) c.gear++;
    else if (shift < 0 && c.gear > 1) {
      if (rpmAt(v, c.gear - 1) <= engine.limiter) c.gear--;
      else c.events.push(EV.SHIFT_DENIED);
    }
  }
  if (c.gear !== before) { if (before > 0 && c.gear > 0) c.shiftT = gearbox.shiftTime; c.events.push(EV.SHIFT); }
}

// ---------- slipstream ----------
// Half-width of a wake `gap` metres behind the car, shared with the renderer so the drawn wake is the real one.
export const wakeHalfWidth = gap => SLIP.width + SLIP.spread * gap;

// Strength 0..1 of the strongest wake this car sits in. Uses each car's trail (its lateral offset when it last
// passed each track sample), so the wake bends with the line the car ahead drove.
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
export function drivetrain(c, { thr, brk, shift = 0 }, dt) {
  updateGear(c, thr, brk, shift, dt);
  const v = c.v, dragK = DRAG_K * (1 - SLIP.drag * (c.slip || 0));
  let resist = dragK * v * Math.abs(v) + Math.sign(v) * aero.rolling;
  if (c.gear === -1) { c.rpm = engine.idle + brk * 3000; c.drive = 0; return { drive: 0, resist, reverse: true }; }
  const rpm = engineRpm(v, c.gear, thr);
  c.rpm = rpm;
  let drive = driveAccel(rpm, c.gear) * thr;
  if (c.shiftT > 0) drive *= gearbox.shiftCut;
  if (thr < 0.05 && v > 0.5) resist += engine.engineBrake * Math.min(1, rpm / engine.redline);
  c.drive = drive;
  return { drive, resist, reverse: false };
}

export const VEHICLE_INFO = Object.freeze({ redline: engine.redline, limiter: engine.limiter, idle: engine.idle,
  autoUp: gearbox.autoUp, gears: GEARS });
