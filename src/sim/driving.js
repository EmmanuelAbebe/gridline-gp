// The player's and the AI's driving. Every car is the same car (vehicle.js engine/gearbox/aero, chassis.js tyres);
// the player and the AI only decide steering, throttle, brake and shifts.
import { AI, ASSISTS, CHASSIS, CAR, TUNING } from './tuning.js';
import { clamp, wrapA } from './math.js';
import { progress } from './race.js';
import { afterMove } from './motion.js';
import { stepChassis, steerLock, driftAngle } from './chassis.js';
import { slipstream, cornerSpeed, brakeLimit, brakeMax, lateralGrip } from './vehicle.js';

// inp: steer -1..1 (+ = right), thr 0..1, brk 0..1, analog = from a wheel/pad (faster steering response),
// steerRate = how fast analog steering may move (full lock per second; Infinity = no smoothing, the game's default
// for controllers), shift = -1/0/+1 (paddles; used with the manual gearbox). The car itself is the tyre model in chassis.js.
// calm = 0..1 (analog only): at speed, small tilts turn the car about as gently as the original game (CHASSIS
// calmLateral), full tilt still reaches the grip limit; 0 = steering in proportion to the grip (the default here).
export function drivePlayer(race, c, inp, dt) {
  const rate = inp.analog ? inp.steerRate ?? 14 : 5;
  c.steerIn ??= c.steer;
  c.steerIn += clamp(clamp(inp.steer, -1, 1) - c.steerIn, -dt*rate, dt*rate);
  c.steer = inp.analog && inp.calm ? calmSteer(c.steerIn, c.v, inp.calm) : c.steerIn;
  c.brake = inp.brk; c.thr = inp.thr;
  slipstream(race, c, progress);
  stepChassis(race, c, inp, dt);
  afterMove(race, c);
}

// s' = k·s + (1 − k)·s³: slope k at the centre, 1 at full tilt
export function calmSteer(s, v, calm) {
  const slope = clamp(CHASSIS.calmLateral / lateralGrip(Math.abs(v)), CHASSIS.calmMinSlope, 1), k = 1 - (1 - slope) * calm;
  return k * s + (1 - k) * s * s * s;
}

// The AI drives the same car as the player (chassis.js), only through steering, throttle and brake.
// Steering: aim at a point on the racing line ahead (pure pursuit: the arc through it gives the curvature), plus a
// correction toward the turn rate that arc needs, turned into a wheel position for the car's steering lock.
// Speed: the profile VP × skill; brake as hard as reaching the profile a few metres ahead needs, else throttle.
// Skill = the driver's own × the race's AI pace (difficulty). Now and then a driver brakes too late for a corner
// (less often the better they are) and runs wide. Simple car-ahead avoidance moves the target line.
// skillOverride (0 = the car's own skill) slows finished cars and lets tests drive the player car; no mistakes then.
export function driveAI(race, c, dt, skillOverride = 0) {
  const T = race.track, { N, HW, ds, PX, PZ, NX, NZ, VP, RO, LK } = T;
  c.assists = c.assists || ASSISTS[AI.assists];
  c.aiT = race.t;
  const sp = Math.max(c.v, 0);
  // mistakes: a late brake, decided when a braking zone starts, lasting through the corner
  if (c.mistakeEnd >= 0 && (c.idx - c.mistakeEnd + N) % N < N / 2) { c.mistake = 0; c.mistakeEnd = -1; }
  const skill = (skillOverride || c.skill * (race.aiPace || 1)) * (1 + c.mistake);
  const ti = (c.idx + Math.round((AI.look + sp * AI.lookTime) / ds)) % N;
  let off = RO[ti] + c.bias;
  // in another car's dirty air the downforce drops (chassis.js): take the corners that much slower (not the straights)
  // (smoothed over AI.dirtyTime s: the wake comes and goes, the speed shouldn't)
  const wantDirty = Math.sqrt(1 - CHASSIS.dirtyAir * (c.slip || 0) * (1 - CAR.grip * 9.81 / lateralGrip(Math.max(sp, 1))));
  c.dirtyK = (c.dirtyK ?? 1) + (wantDirty - (c.dirtyK ?? 1)) * Math.min(1, dt / AI.dirtyTime);
  const dirty = c.dirtyK;
  const vp = j => VP[j] < TUNING.V_CAP * 0.97 ? VP[j] * dirty : VP[j];
  let targetV = Math.min(vp((c.idx+2)%N), vp((c.idx+6)%N)) * skill;
  // racecraft: a car ahead in our lane → go round it on the side with room (keeping that side once chosen) and hold
  // back until there is space; a car alongside → keep a car's width from it, whatever else we wanted
  const myP = progress(race, c), edge = HW - 1.5;
  let lane = null, lo = -edge, hi = edge;
  for (const o of race.cars) {
    if (o === c) continue;
    const gap = (progress(race, o) - myP) * ds, dlat = o.lat - c.lat;
    // close ahead, also where it is heading: an AI car's target line (it may be about to cut across)
    const toward = gap < AI.cutRange && race.t - o.aiT < 0.05 ? o.offset - c.offset : dlat;
    const near = Math.min(Math.abs(dlat), Math.abs(toward));
    if (gap < -AI.alongside || gap > AI.followRange || near >= AI.sideGap) continue;
    if (gap > 0 && near < AI.followLat) targetV = Math.min(targetV, o.v + (gap - AI.followGap) * AI.followGain);
    if (gap > AI.alongside) { if (!lane || gap < lane.gap) lane = { o, gap }; }
    else if (Math.abs(dlat) >= AI.sideGap) continue;
    else if (dlat > 0) hi = Math.min(hi, o.lat - AI.sideGap);
    else lo = Math.max(lo, o.lat + AI.sideGap);
  }
  if (lane) {
    const { o } = lane;
    if (c.passBy !== o) {
      const fits = side => Math.abs(o.lat + side * AI.sideGap) <= edge;
      const pref = Math.sign(off - o.lat) || 1;
      c.passBy = o; c.passSide = fits(pref) ? pref : -pref;
    }
    off = o.lat + c.passSide * AI.sideGap;
  } else c.passBy = null;
  off = lo <= hi ? clamp(off, lo, hi) : (lo + hi) / 2;
  off = clamp(off, -edge, edge);
  const slope = Math.min(AI.lineSlope * sp + 0.3, AI.lineSpeed) * dt;   // never cut across faster than this
  c.offset += clamp((off - c.offset) * Math.min(1, dt * AI.lineRate), -slope, slope);
  if (lo <= hi) c.offset = clamp(c.offset, lo, hi);          // the room left by cars alongside, at once
  // steering (target behind, e.g. after a spin: full lock toward it, slowly)
  const tx = PX[ti] + NX[ti]*c.offset - c.x, tz = PZ[ti] + NZ[ti]*c.offset - c.z;
  const alpha = wrapA(Math.atan2(tz, tx) - c.h - driftAngle(c)), dist = Math.max(Math.hypot(tx, tz), 4);
  const lost = Math.abs(alpha) > Math.PI / 2;
  const kappa = 2 * (lost ? Math.sign(alpha) : Math.sin(alpha)) / dist, v5 = Math.max(sp, 5);
  const delta = CHASSIS.wheelbase * kappa + AI.yawGain * (sp * kappa - c.yawRate) * CHASSIS.wheelbase / v5;
  const want = clamp(delta / steerLock(c.v, c.assists.steer), -1, 1);
  c.steer += clamp(want - c.steer, -dt * AI.steerRate, dt * AI.steerRate);
  if (lost) targetV = Math.min(targetV, AI.recoverSpeed);
  // speed: the hardest deceleration the profile asks for ahead. Off the racing line (passing, defending) a corner is
  // tighter on the inside, so the profile there is scaled by the corner speed of the offset path.
  const offLine = j => {
    const d = c.offset - RO[j] - c.bias, k = LK[j];
    if (Math.abs(d) < 1 || Math.abs(k) < 1e-4) return 1;
    return Math.min(1, cornerSpeed(Math.abs(k / Math.max(0.2, 1 - k * d)), AI.grip) / cornerSpeed(Math.abs(k), AI.grip));
  };
  // Far ahead, brake only once the deceleration needed reaches what the profile plans with (brake late, not long).
  let need = 0, vmin = sp;
  const late = AI.brake * brakeLimit(sp) * 0.9;
  for (let k = 2; k <= AI.brakeLook; k += k < 12 ? 2 : 6) {
    const j = (c.idx+k)%N, vt = Math.min(vp(j) * skill * offLine(j), targetV + k * 0.5);
    if (k <= 6) targetV = Math.min(targetV, vt);
    vmin = Math.min(vmin, vt);
    const n = (sp*sp - vt*vt) / (2 * k * ds);
    if (k <= 12 || n > late) need = Math.max(need, n);
  }
  const over = sp - targetV;
  let thr = 0, brk = 0;
  if (need > 2 || over > 1) brk = clamp(need / brakeMax(sp) + Math.max(0, over) * AI.brakeGain, 0, 1);
  else if (need <= 0) thr = clamp(0.5 - over * AI.thrGain, 0, 1);
  // no throttle while asking the front tyres for more than they have (it would only push the car wide)
  if (!lost && sp > AI.recoverSpeed && (Math.abs(want) > 0.95 || c.slideF > 0.3)) thr = Math.min(thr, AI.lockThrottle);
  if (brk > 0 && c.brake === 0 && !skillOverride && !c.mistake && sp - vmin > AI.mistakes.minDrop
      && Math.random() < AI.mistakes.chance * (1 - c.skill) * 10) {
    const [lo, hi] = AI.mistakes.over;
    c.mistake = lo + Math.random() * (hi - lo);
    c.mistakeEnd = (c.idx + Math.round(AI.mistakes.length / ds)) % N;
    brk = 0;
  }
  c.brake = brk; c.thr = thr;
  slipstream(race, c, progress);
  stepChassis(race, c, { thr, brk, steer: c.steer, shift: 0 }, dt);
  afterMove(race, c);
}
