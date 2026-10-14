// The player's car as a two-axle ("bicycle") model with tyres. Each axle makes cornering force from its slip angle
// (the angle between where the tyre points and where it is going), up to its grip = friction × load. Load comes from
// weight, downforce and longitudinal load transfer (braking loads the front, accelerating the rear). Braking and
// drive use the same grip (friction circle): ask for too much and the tyre locks (front: the car goes straight on)
// or spins (rear: the tail steps out). Assists (ASSISTS) shape the steering and catch slides, wheel spin, lock-ups.
//
// State on the car: v (forward speed), vy (sideways speed, + = right), yawRate (rad/s, + = turning right), ax.
// Everything is per unit mass, so forces read as accelerations (m/s²).
import { TUNING, CAR, CHASSIS as CH, SURFACES, ASSISTS } from './tuning.js';
import { clamp } from './math.js';
import { DOWNFORCE_K, lateralGrip, drivetrain } from './vehicle.js';

const G = 9.81, L = CH.wheelbase;
const A_FRONT = L * (1 - CH.frontWeight), B_REAR = L * CH.frontWeight;   // CG to front / rear axle
const K2 = CH.gyration * CH.gyration;
// tyre curve: sin(C·atan(B·α)), peaking at the axle's peak slip angle
const C_SHAPE = CH.falloff, B_UNIT = Math.tan(Math.PI / (2 * C_SHAPE));
export const tyreCurve = (alpha, peak = CH.peakSlip) => Math.sin(C_SHAPE * Math.atan(B_UNIT / peak * alpha));

// Road-wheel angle at full lock. With the steering assist the lock shrinks with speed toward the angle of the
// tightest steady turn the tyres can hold (bicycle geometry: wheelbase / radius + front − rear slip at the limit),
// so a full tilt or a held key at 300 km/h asks for exactly the grip there is, not more.
export function steerLock(v, assist) {
  const sp = Math.max(Math.abs(v), 1);
  const useful = Math.min(CH.maxSteer, L * lateralGrip(sp) / (sp * sp) + CH.peakSlip - CH.rearPeakSlip + CH.steerMargin);
  return CH.maxSteer + (useful - CH.maxSteer) * assist;
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
export function stepChassis(race, c, inp, dt) {
  const A = c.assists || ASSISTS.medium, surf = SURFACES[c.surface] || SURFACES.track;
  const d = drivetrain(c, inp, dt);
  const n = CH.substeps, h = dt / n;
  let slideF = 0, slideR = 0, lockF = false, spinR = false;
  for (let s = 0; s < n; s++) {
    const v = c.v, sp = Math.abs(v), vy = c.vy, w = c.yawRate;
    const delta = c.steer * steerLock(v, A.steer);
    // reverse and crawling: plain kinematic steering
    if (d.reverse || v < CH.lowSpeed) {
      let a = -d.resist - surf.drag * v;
      if (d.reverse) { a += v > 0 ? -CH.brakeSystem * 0.4 * inp.brk : -TUNING.REVERSE_ACC * inp.brk; if (inp.thr > 0 && v < 0) a += 20 * inp.thr; }
      else { a += Math.min(d.drive, CAR.grip * G * (1 - CH.frontWeight) * CH.longGrip); if (v > 0) a -= 20 * inp.brk; }
      const v0 = c.v; c.v = clamp(c.v + a * h, -TUNING.REVERSE_MAX, TUNING.V_CAP);
      if (!d.reverse && v0 >= 0 && c.v < 0) c.v = 0;
      c.yawRate = c.v * Math.tan(delta) / L; c.vy = 0;
      c.h += c.yawRate * h;
      c.x += Math.cos(c.h) * c.v * h; c.z += Math.sin(c.h) * c.v * h;
      continue;
    }
    // axle loads (per mass): weight + downforce (less in dirty air) ± load transfer from the last acceleration
    const df = DOWNFORCE_K * v * v * (1 - CH.dirtyAir * (c.slip || 0));
    const transfer = c.ax * CH.cgHeight / L;
    const mu = CAR.grip * surf.grip;
    const Df = mu * Math.max(0.5, G * CH.frontWeight + df * CH.aeroFront - transfer);
    const Dr = mu * CH.rearGrip * Math.max(0.5, G * (1 - CH.frontWeight) + df * (1 - CH.aeroFront) + transfer);
    // slip angles (velocity at each axle vs where its wheels point)
    const alphaF = Math.atan2(vy + A_FRONT * w, Math.max(sp, 1)) - delta;
    const alphaR = Math.atan2(vy - B_REAR * w, Math.max(sp, 1));
    // brakes split by axle load (+ a front bias), drive on the rear
    const brake = CH.brakeSystem * inp.brk * (v > 0 ? 1 : 0);
    const bias = clamp(Df / (Df + Dr) + CH.brakeBias, 0.3, 0.8);
    const absLimit = A.abs > 0 ? 0.97 + 0.15 * (1 - A.abs) : null, tcLimit = A.tc > 0 ? 0.97 + 0.25 * (1 - A.tc) : null;
    const front = axle(Df, alphaF, CH.peakSlip, -brake * bias, absLimit);
    const rearLong = d.drive - brake * (1 - bias);
    // rear braking: ABS, and (stability assist) a margin kept for cornering, like brake-force distribution
    const rearBrakeLimit = absLimit === null ? null : absLimit * (1 - CH.rearBrakeMargin * A.stability);
    const rear = axle(Dr, alphaR, CH.rearPeakSlip, rearLong, rearLong >= 0 ? tcLimit : rearBrakeLimit);
    // how far past the grip limit each axle is: 0 = gripping, 1 = fully sliding (locked, spinning or past peak slip)
    slideF = Math.max(slideF, front.over - 1, Math.abs(alphaF) / CH.peakSlip - 1);
    slideR = Math.max(slideR, rear.over - 1, Math.abs(alphaR) / CH.rearPeakSlip - 1);
    if (front.over > 1 && brake > 0) lockF = true;
    if (rear.over > 1 && rearLong > 0) spinR = true;
    // equations of motion in the car's frame
    const cosD = Math.cos(delta), sinD = Math.sin(delta);
    const ax = rear.fx + front.fx * cosD - front.fy * sinD - d.resist - surf.drag * v;
    const ay = front.fy * cosD + front.fx * sinD + rear.fy;
    let dw = (A_FRONT * (front.fy * cosD + front.fx * sinD) - B_REAR * rear.fy) / K2;
    // stability assist: when the rear slides, pull the yaw rate back toward what the steering asks for
    // damping assist: always, gently, toward that same yaw rate
    if (A.stability > 0 || A.damping > 0) {
      const wGrip = lateralGrip(sp) / sp, wRef = clamp(v * Math.tan(delta) / L, -wGrip, wGrip);
      const rearSliding = clamp((Math.abs(alphaR) - 0.4 * CH.rearPeakSlip) / (0.6 * CH.rearPeakSlip), 0, 1);
      dw -= (A.stability * CH.stabilityGain * rearSliding + (A.damping || 0) * CH.dampingGain) * (w - wRef);
    }
    c.ax = ax;
    const v0 = c.v;
    c.v += (ax + vy * w) * h;
    c.vy += (ay - v * w) * h;
    c.yawRate += dw * h;
    if (v0 > 0 && c.v < 0) c.v = 0;
    c.v = Math.min(c.v, TUNING.V_CAP);
    // below blendSpeed fade toward kinematic steering, which is stable at walking pace
    const k = clamp((c.v - CH.lowSpeed) / (CH.blendSpeed - CH.lowSpeed), 0, 1);
    if (k < 1) { c.yawRate = k * c.yawRate + (1 - k) * c.v * Math.tan(delta) / L; c.vy *= k; }
    c.h += c.yawRate * h;
    c.x += (Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy) * h;
    c.z += (Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy) * h;
  }
  c.slideF = clamp(slideF, 0, 1); c.slideR = clamp(slideR, 0, 1); c.lockF = lockF; c.spinR = spinR;
  c.roll += c.v * dt / TUNING.WHEEL_RADIUS;
}

// Angle between where the car points and where it is going (rad, + = sliding to the right).
export const driftAngle = c => Math.atan2(c.vy, Math.max(Math.abs(c.v), 1));
