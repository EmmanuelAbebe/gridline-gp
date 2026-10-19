// The player's car as a two-axle ("bicycle") model with tyres. Each axle makes cornering force from its slip angle
// (the angle between where the tyre points and where it is going), up to its grip = friction × load. Load comes from
// weight, downforce and longitudinal load transfer (braking loads the front, accelerating the rear). Braking and
// drive use the same grip (friction circle): ask for too much and the tyre locks (front: the car goes straight on)
// or spins (rear: the tail steps out). Assists (ASSISTS) shape the steering and catch slides, wheel spin, lock-ups.
//
// State on the car: v (forward speed), vy (sideways speed, + = right), yawRate (rad/s, + = turning right), ax.
// Everything is per unit mass, so forces read as accelerations (m/s²).
import { TUNING, CHASSIS as CH, SURFACES, ASSISTS, ROUGH, OFFTRACK as OT } from './tuning.js';
import { clamp, speedOf } from './math.js';
import { lateralGrip, brakeMax, drivetrain } from './vehicle.js';
import { STOCK } from './spec.js';
import { carCondition } from './pit.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

const G = 9.81, L = CH.wheelbase;
const A_FRONT = L * (1 - CH.frontWeight), B_REAR = L * CH.frontWeight;   // CG to front / rear axle
const K2 = CH.gyration * CH.gyration;
// extra deceleration from the surface (signed to oppose the motion): rolling + the gravel's bite (full from biteFrom,
// fading above biteTo to `skim` of it: a fast car skims over gravel, a slow one digs in)
export function surfaceDrag(surf, v) {
  const sp = Math.abs(v); if (!surf.rolling && !surf.bite) return 0;
  const fade = sp <= surf.biteTo ? 1 : Math.max(surf.skim, 1 - (1 - surf.skim) * (sp - surf.biteTo) / surf.biteFade);
  return Math.sign(v) * (surf.rolling + surf.bite * Math.min(1, sp / surf.biteFrom) * fade);
}
// tyre curve: sin(C·atan(B·α)), peaking at the axle's peak slip angle
const C_SHAPE = CH.falloff, B_UNIT = Math.tan(Math.PI / (2 * C_SHAPE));
export const tyreCurve = (alpha, peak = CH.peakSlip) => Math.sin(C_SHAPE * Math.atan(B_UNIT / peak * alpha));

// Road-wheel angle at full lock. With the steering assist the lock shrinks with speed toward the angle of the
// tightest steady turn the tyres can hold (wheelbase / radius, plus the tyres' slip, measured: limitTurn, steerMargin),
// so a full tilt or a held key at 300 km/h asks for the grip there is, not more, and half tilt is about half the
// cornering. Less assist mixes back the raw lock (squared, so medium stays close to the grip limit).
/** @param {number} v @param {number} assist @param {import('./spec.js').Spec} [spec] */
export function steerLock(v, assist, spec = STOCK) {
  const sp = Math.max(Math.abs(v), 1);
  const useful = Math.min(CH.maxSteer, L * lateralGrip(sp, spec) / (sp * sp) * CH.limitTurn + CH.steerMargin);
  return useful + (CH.maxSteer - useful) * (1 - assist) ** 2;
}

// One axle's forces. D = grip (per mass), alpha = slip angle, long = braking (−) or drive (+) asked of it.
// Returns lateral force, longitudinal force actually delivered, and how far past the grip limit it is (0..1+).
function axle(D, alpha, peak, long, limit) {
  let fy = -D * tyreCurve(alpha, peak);
  const longMax = D * CH.longGrip;
  // what is left for braking / drive after cornering (friction circle)
  const avail = Math.sqrt(Math.max(longMax * longMax * 0.1, longMax * longMax - fy * fy * CH.longGrip * CH.longGrip));
  let fx = long;
  if (limit !== null) fx = clamp(fx, -avail * limit, avail * limit);        // ABS / traction control
  let over = Math.abs(fx) / avail;
  if (over > 1) {                                                         // locked or spinning: sliding friction
    fx = Math.sign(fx) * avail * CH.slideLong;
    fy *= Math.max(CH.lockLateral, 1 - (over - 1) * 2);
  } else {
    const room = Math.sqrt(Math.max(0, D * D - fx * fx));                 // cornering left after braking / drive
    if (Math.abs(fy) > room) fy = Math.sign(fy) * room;
  }
  return { fy, fx, over };
}

// One player step: steering, drivetrain, tyres, assists, integration. Moves c.x/c.z/c.h; the caller runs afterMove.
/** @param {Race} race @param {Car} c */
export function stepChassis(race, c, inp, dt) {
  const A = c.assists || ASSISTS.medium, surf = SURFACES[c.surface] || SURFACES.track, S = c.spec;   // S: the car's own numbers (spec.js)
  const d = drivetrain(c, inp, dt);
  // the car's condition (pit.js): worn tyres, damage, empty tank (limp)
  const cond = carCondition(c);
  d.drive *= cond.power; d.resist *= cond.drag;
  const n = CH.substeps, h = dt / n;
  // dirty tyres after an off: picked up on grass / gravel / turf, worn off on a hard surface
  if (c.surface in ROUGH) c.dirt = Math.max(c.dirt || 0, ROUGH[c.surface]);
  else if (c.dirt) c.dirt = Math.max(0, c.dirt - dt / OT.clean);
  const dirt = (1 - OT.loss * (c.dirt || 0)) * cond.grip;
  if (c.beached) { c.v = c.vy = c.yawRate = 0; c.slideF = c.slideR = 0; return; }   // stuck: waiting for the marshals
  // deep in gravel at walking pace the wheels dig in
  const dug = c.surface === 'gravel' && c.gravelDepth > OT.deep && speedOf(c) < OT.digSpeed ? OT.dig : 1;
  let slideF = 0, slideR = 0, lockF = false, spinR = false;
  for (let s = 0; s < n; s++) {
    // v: along the car's heading (negative = travelling backwards, e.g. past 90° in a spin), vy: sideways
    const v = c.v, sp = Math.abs(v), vy = c.vy, w = c.yawRate, speed = Math.hypot(v, vy);
    const delta = c.steer * steerLock(v, A.steer, S) + cond.pull;
    // reverse gear and crawling (by the real speed: a car sliding sideways at 90° is not crawling): kinematic steering
    if (d.reverse || speed < CH.lowSpeed) {
      let a = -d.resist - surfaceDrag(surf, v);
      if (d.reverse) { a += v > 0 ? -CH.brakeSystem * 0.4 * inp.brk : -TUNING.REVERSE_ACC * inp.brk; if (inp.thr > 0 && v < 0) a += 20 * inp.thr; }
      else { a += Math.min(d.drive, S.grip * surf.grip * dirt * G * (1 - CH.frontWeight) * CH.longGrip) * dug; if (v > 0) a -= 20 * inp.brk * surf.grip; }
      const v0 = c.v; c.v = clamp(c.v + a * h, -TUNING.REVERSE_MAX, TUNING.V_CAP);
      if (!d.reverse && v0 >= 0 && c.v < 0) c.v = 0;
      // the rear axle rolls straight: sideways speed at the centre of mass is B_REAR × yaw rate (no tyre slip)
      c.yawRate = c.v * Math.tan(delta) / L; c.vy = B_REAR * c.yawRate;
      c.h += c.yawRate * h;
      c.x += (Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy) * h; c.z += (Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy) * h;
      continue;
    }
    // axle loads (per mass): weight + downforce (less in dirty air, and sideways or backwards the wings stall)
    // ± load transfer from the last acceleration
    const beta = Math.atan2(Math.abs(vy), v), stall = clamp((beta - OT.spinFrom) / (OT.spinTo - OT.spinFrom), 0, 1);
    // = smoothstep(stall), written out: the helper multiplies in another order (last-bit rounding: sim-trace would differ)
    const yawAero = 1 - (1 - OT.spinFloor) * stall * stall * (3 - 2 * stall);
    const df = S.dfK * v * v * (1 - CH.dirtyAir * (c.slip || 0)) * yawAero * cond.aero;
    const transfer = c.ax * CH.cgHeight / L;
    const mu = S.grip * surf.grip * dirt;
    const Df = mu * S.frontGrip * Math.max(0.5, G * CH.frontWeight + df * S.aeroFront * cond.front - transfer);
    const Dr = mu * S.rearGrip * Math.max(0.5, G * (1 - CH.frontWeight) + df * (1 - S.aeroFront) + transfer);
    // slip angles (velocity at each axle vs where its wheels point)
    // (rolling backwards the steering acts the other way round)
    const back = v / Math.max(sp, 0.5);   // +1 forwards, −1 backwards, smooth through 0 (brakes then damp v to rest)
    const alphaF = Math.atan2(vy + A_FRONT * w, Math.max(sp, 1)) - delta * Math.sign(back || 1);
    const alphaR = Math.atan2(vy - B_REAR * w, Math.max(sp, 1));
    // brakes split by axle load (+ a front bias), drive on the rear
    const brake = brakeMax(sp, S) * inp.brk;
    const bias = clamp(Df / (Df + Dr) + S.brakeBias, 0.3, 0.8);
    const absLimit = A.abs > 0 ? 0.97 + 0.15 * (1 - A.abs) : null, tcLimit = A.tc > 0 ? 0.97 + 0.25 * (1 - A.tc) : null;
    const front = axle(Df, alphaF, CH.peakSlip, -brake * bias * back, absLimit);
    const rearLong = d.drive - brake * (1 - bias) * back;
    // rear braking: ABS, and (stability assist) a margin kept for cornering, like brake-force distribution
    // any ABS keeps the rears from locking (a locked rear turning in spins the car); partial ABS only lets the fronts lock a little
    const rearBrakeLimit = absLimit === null ? null : Math.min(0.97, absLimit) * (1 - CH.rearBrakeMargin * A.stability);
    const braking = brake * (1 - bias) > d.drive;   // which limit applies: ABS while braking, traction control on the throttle
    const rear = axle(Dr, alphaR, CH.rearPeakSlip, rearLong, braking ? rearBrakeLimit : tcLimit);
    // how far past the grip limit each axle is: 0 = gripping, 1 = fully sliding (locked, spinning or past peak slip)
    slideF = Math.max(slideF, front.over - 1, Math.abs(alphaF) / CH.peakSlip - 1);
    slideR = Math.max(slideR, rear.over - 1, Math.abs(alphaR) / CH.rearPeakSlip - 1);
    if (front.over > 1 && brake > 0) lockF = true;
    if (rear.over > 1 && !braking && d.drive > 0) spinR = true;
    // equations of motion in the car's frame
    const cosD = Math.cos(delta), sinD = Math.sin(delta);
    // the surface drags against the car's whole motion (a car sliding sideways through gravel is slowed too)
    const sd = surfaceDrag(surf, speed) / speed;
    const ax = rear.fx + front.fx * cosD - front.fy * sinD - d.resist - sd * v;
    const ay = front.fy * cosD + front.fx * sinD + rear.fy - sd * vy;
    let dw = (A_FRONT * (front.fy * cosD + front.fx * sinD) - B_REAR * rear.fy) / K2;
    // stability assist: when the rear slides, pull the yaw rate back toward what the steering asks for
    // damping assist: always, gently, toward that same yaw rate
    if (A.stability > 0 || A.damping > 0) {
      const wGrip = lateralGrip(sp, S) / sp, wRef = clamp(v * Math.tan(delta) / L, -wGrip, wGrip);
      const rearSliding = clamp((Math.abs(alphaR) - 0.4 * CH.rearPeakSlip) / (0.6 * CH.rearPeakSlip), 0, 1);
      dw -= (A.stability * CH.stabilityGain * rearSliding + (A.damping || 0) * CH.dampingGain) * (w - wRef);
    }
    c.ax = ax;
    const v0 = c.v;
    c.v += (ax + vy * w) * h;
    c.vy += (ay - v * w) * h;
    c.yawRate += dw * h;
    if (v0 > 0 && c.v < 0 && speedOf(c) < CH.lowSpeed) c.v = 0;   // braking to a stop doesn't roll back
    c.v = Math.min(c.v, TUNING.V_CAP);
    // below blendSpeed (the real speed) fade toward kinematic steering, which is stable at walking pace
    const k = clamp((speedOf(c) - CH.lowSpeed) / (CH.blendSpeed - CH.lowSpeed), 0, 1);
    if (k < 1) { const w0 = c.v * Math.tan(delta) / L; c.yawRate = k * c.yawRate + (1 - k) * w0; c.vy = k * c.vy + (1 - k) * B_REAR * w0; }
    c.h += c.yawRate * h;
    c.x += (Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy) * h;
    c.z += (Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy) * h;
  }
  c.slideF = clamp(slideF, 0, 1); c.slideR = clamp(slideR, 0, 1); c.lockF = lockF; c.spinR = spinR;
  c.roll += c.v * dt / TUNING.WHEEL_RADIUS;
}

// Angle between where the car points and where it is going (rad, + = sliding to the right).
/** @param {Car} c */
export const driftAngle = c => Math.atan2(c.vy, Math.max(Math.abs(c.v), 1));
