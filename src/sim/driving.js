// The player's and the AI's driving. Every car is the same car (vehicle.js engine/gearbox/aero, chassis.js tyres);
// the player and the AI only decide steering, throttle, brake and shifts.
import { axleTempGrip } from './tyre-temp.js';
import { AI, ASSISTS, CHASSIS, TUNING, SPEED_STEER, CAR, COMPOUNDS } from './tuning.js';
import { STOCK } from './spec.js';
import { clamp, wrapA, wrapIdx } from './math.js';
import { progress } from './race.js';
import { afterMove } from './motion.js';
import { stepChassis, steerLock, driftAngle } from './chassis.js';
import { G, slipstream, cornerSpeed, brakeLimit, brakeMax, lateralGrip } from './vehicle.js';
import { brakeLimitAt } from './elevation.js';
import { checkPitEntry, stepPit, updateWear, aiWantsPit, drivePitLane, pitLimit } from './pit.js';
import { updateActiveAero } from './active-aero.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

// inp: steer -1..1 (+ = right), thr 0..1, brk 0..1, analog = from a wheel/pad (faster steering response),
// steerRate = how fast analog steering may move (full lock per second; Infinity = no smoothing, the game's default
// for controllers), shift = -1/0/+1 (paddles; used with the manual gearbox). The car itself is the tyre model in chassis.js.
// calm = 0..1 (analog only): at speed, small tilts turn the car about as gently as the original game (CHASSIS
// calmLateral), full tilt still reaches the grip limit; 0 = steering in proportion to the grip (the default here).
/** @param {Race} race @param {Car} c */
export function drivePlayer(race, c, inp, dt) {
  updateActiveAero(race, c, inp, dt);
  const held = drivePitLane(race, c);                // the pit lane: you drive it; held in your box during the stop
  const rate = inp.analog ? inp.steerRate ?? 14 : 5;
  c.steerIn ??= c.steer;
  c.steerIn += clamp(clamp(inp.steer, -1, 1) - c.steerIn, -dt*rate, dt*rate);
  c.steer = inp.analog && inp.calm ? calmSteer(c.steerIn, c.v, inp.calm, c.spec) : c.steerIn;
  if (inp.speedSteer) c.steer = speedSteer(c.steer, c.v, inp.speedSteer, (c.assists || ASSISTS.medium).steer, c.spec);
  c.brake = inp.brk; c.thr = inp.thr;
  if (held) { afterMove(race, c); return; }
  updateWear(race, c, inp.thr, dt);
  slipstream(race, c, progress);
  stepChassis(race, c, inp, dt);
  pitLimit(c);
  afterMove(race, c);
}

// Speed-sensitive steering (SPEED_STEER): the controller's share s → the share of the car's own lock (steerLock with
// its assist) that gives the angle of a lock shrunk by `k` (up to catchFrom of the travel), then on to the full lock.
/** @param {number} s @param {number} v @param {number} k @param {number} assist @param {import('./spec.js').Spec} [spec] */
export function speedSteer(s, v, k, assist, spec = STOCK) {
  if (!(k > assist)) return s;
  const own = steerLock(v, assist, spec), mapped = steerLock(v, k, spec), a = Math.abs(s), knee = SPEED_STEER.catchFrom;
  const angle = a <= knee ? a / knee * mapped : mapped + (a - knee) / (1 - knee) * (own - mapped);
  return Math.sign(s) * angle / own;
}

// s' = k·s + (1 − k)·s³: slope k at the centre, 1 at full tilt
/** @param {number} s @param {number} v @param {number} calm @param {import('./spec.js').Spec} [spec] */
export function calmSteer(s, v, calm, spec = STOCK) {
  const slope = clamp(CHASSIS.calmLateral / lateralGrip(Math.abs(v), spec), CHASSIS.calmMinSlope, 1), k = 1 - (1 - slope) * calm;
  return k * s + (1 - k) * s * s * s;
}

// The AI drives the same car as the player (chassis.js), only through steering, throttle and brake.
// Line: track.RO, a blend of the stored time-optimal line and a minimum-curvature one (track.js), + the driver's own
// bias; the car moves toward it at a limited rate (lineSlope / lineSpeed), so every car drives a slightly different,
// smoothed version of it: that variety is what makes passing possible (2026-10-19: following the line exactly turned
// the field into a train, ~1/5 of the passes).
// Steering: aim at a point on that path ahead (pure pursuit: the arc through it gives the curvature), plus a correction
// toward the turn rate that arc needs, turned into a wheel position for the car's steering lock.
// Speed: the profile VP × skill; brake as hard as reaching the profile a few metres ahead needs, else throttle.
// Skill = the driver's own × the race's AI pace (difficulty). Racecraft (AI.craft, the driver's traits):
//  - passing: a car ahead in our lane → go round it on the side our line is heading (kept once chosen), holding back
//    until there is room; side by side, keep a car's width from where it is and where it is heading
//  - defending: a real threat (close behind, in our slipstream, at least as fast) before a braking zone → one move to
//    cover the inside, held to the apex; decided once per corner, never with a car alongside or in the braking zone
//  - mistakes: now and then a late brake; weaker drivers more often, nervy ones more with a car right behind
// skillOverride (0 = the car's own skill) slows finished cars and lets tests drive the player car; no mistakes then.
// (Tried and measured worse in AI races, so left out: slipstream tuck-and-pull-out, inside dives with later braking,
// clean-air lines when following, the car behind yielding in a squeeze: more contacts or fewer passes.)
// ALIEN (race.aiAlien, AI.alien; 2026-10-20, user: "a car that overtakes me even if I drive well"): its own line
// (track.alien: racing-lines.js ALIEN_LINES, closer to the edges) and profile (braking on the friction circle), on it
// exactly and with the lap-optimum bot's pedals in clean air at its own pace per circuit (AI.alien.pace: ~1 s a lap
// faster than the user's best on Northfold), no mistakes; in traffic it eases to `chase` / `traffic` × that pace and
// the regular pedals (full pace in dirty air ran it wide); attack: on a straight it sits in the tow of the car ahead
// and pulls out late, to the inside of the next corner.
const TRAITS = Object.freeze({ defend: 0.5, nerves: 0.5 });
const traitOf = (c, k) => c.traits?.[k] ?? TRAITS[k];

// An AI driver in a car without ABS / traction control drives by feel (AI.feel), as a racing driver does: it never
// asks for more brake than it has learnt the front tyres take in a straight line, and holds back further for a moment
// after a lock-up (front or rear: turning in on the brakes locks sooner); the same with the throttle, per gear, from
// wheel spin and the rear sliding. It reacts to what the tyres did on the last step, so it still locks or spins now
// and then. The pedals it would have used with the assists come in; what its feet can do goes out.
/** @param {Car} c */
function feelPedals(c, thr, brk, dt) {
  const F = AI.feel;
  if (!c.assists.abs) {
    // (feelBrake: the share of the tyres' straight-line limit it dares; the pedal for that falls with the speed)
    const straight = Math.abs(c.steer) < 0.1, learning = c.surface === 'track' && c.v > 25;   // (a lock on the grass says nothing)
    const sp = Math.max(c.v, 1), toPedal = brakeLimit(sp, c.spec) / brakeMax(sp, c.spec), share = c.brake / toPedal;
    if (c.lockF || c.lockR || (c.brake > 0 && c.slideR > F.slide)) {             // (braking with the rear sliding: off it)
      if (c.lockF && !c.lockR && straight && learning) c.feelBrake = Math.max(F.brakeMin, c.feelBrake * F.cut, Math.min(c.feelBrake, share) * F.cut);
      c.feelBrakeNow = Math.max(F.floor, Math.min(1, share / c.feelBrake) * F.nowCut);
    } else {
      if (brk > 0 && share >= c.feelBrake * c.feelBrakeNow * 0.98) c.feelBrake = Math.min(F.brakeMax, c.feelBrake + F.learn * dt);
      c.feelBrakeNow = Math.min(1, c.feelBrakeNow + F.recover * dt);
    }
    // trail braking: the more it turns, the less brake (what the tyres give to the corner they can't give to stopping)
    brk = Math.min(brk, c.feelBrake * c.feelBrakeNow * toPedal * (1 - F.trail * Math.min(1, Math.abs(c.steer))));
  }
  if (!c.assists.tc) {
    const T = (c.feelThr ||= new Array(10).fill(F.thr)), g = Math.max(0, c.gear);
    if (c.spinR || (c.slideR > F.slide && c.thr > F.floor)) {
      if (c.spinR && c.surface === 'track') T[g] = Math.max(F.floor, T[g] * F.thrCut, Math.min(T[g], c.thr) * F.thrCut);
      c.feelThrNow = Math.max(F.floor, Math.min(1, c.thr / T[g]) * F.nowCut);
    } else {
      if (thr > 0 && c.thr >= T[g] * c.feelThrNow * 0.98) T[g] = Math.min(1, T[g] + F.thrLearn * dt);
      c.feelThrNow = Math.min(1, c.feelThrNow + F.recover * dt);
    }
    // (cold or overheated rears: it feeds the power in far more carefully than the grip they lost, AI.feel.coldThr,
    // as a driver on cold tyres without traction control)
    const rk = c.tyreT ? axleTempGrip(c.tyreT).r : 1;
    thr = Math.min(thr, rk < 1 ? T[g] * c.feelThrNow * rk ** F.coldThr : T[g] * c.feelThrNow);
    // sliding: only a touch of throttle until the car points where it goes again
    const drift = Math.abs(driftAngle(c));
    if (drift > F.slideDrift) thr = Math.min(thr, F.floor * clamp(1 - (drift - F.slideDrift) / F.slideDrift, 0, 1));
  }
  return [thr, brk];
}
/** @param {Race} race @param {Car} c */
export function driveAI(race, c, dt, skillOverride = 0) {
  const T = race.track, { N, HW, ds, PX, PZ, NX, NZ } = T, C = AI.craft;
  const alien = !!(race.aiAlien && T.alien);
  const { VP, RO, LK, BRK, APEX } = alien ? T.alien : T;      // ALIEN: its own line and profile
  c.assists = c.assists || ASSISTS[AI.assists];
  c.aiT = race.t;
  // pit stops: decided once a lap before the entry road (fuel, tyres, damage: pit.js), then the lane drives the car
  const pitLane = T.pit;
  if (pitLane && !c.pit && !c.finished) { const d = wrapIdx(pitLane.entry - c.idx, N); if (d > 5 && d < 150) c.pitRequest = aiWantsPit(race, c); }
  if (checkPitEntry(race, c)) { updateActiveAero(race, c, { thr: 0, brk: 0 }, dt); stepPit(race, c, dt); afterMove(race, c); return; }
  const sp = Math.max(c.v, 0);
  // mistakes: a late brake, decided when a braking zone starts, lasting through the corner
  if (c.mistakeEnd >= 0 && wrapIdx(c.idx - c.mistakeEnd, N) < N / 2) { c.mistake = 0; c.mistakeEnd = -1; }
  if (c.defendTo >= 0 && wrapIdx(c.idx - c.defendTo, N) < N / 2) c.defendTo = -1;           // past the apex: defence over
  // (ALIEN: its full pace only in clean air on its line; in traffic eased to alienK, see the end of the racecraft)
  // (ALIEN: the drivers' gaps to the fastest one × (1 + spread): a hunter or two, the rest about a great lap)
  const own = alien ? c.skill - AI.alien.spread * ((race.aiTop ?? c.skill) - c.skill) : c.skill;
  const skill = (skillOverride || own * (race.aiPace || 1) * (alien ? c.alienK : 1)) * (1 + c.mistake);
  const ti = (c.idx + Math.round((AI.look + sp * AI.lookTime) / ds)) % N;
  // the next corner: samples to its braking zone, its apex and which side its inside is (+1 = right)
  const toBrake = BRK[c.idx], apex = APEX[c.idx], inside = Math.sign(LK[apex]) || 1;
  const bias = alien ? 0 : c.bias;                           // (ALIEN: exactly on its line)
  let off = RO[ti] + bias;
  // in another car's dirty air the downforce drops (chassis.js): take the corners that much slower (not the straights)
  // (smoothed over AI.dirtyTime s: the wake comes and goes, the speed shouldn't)
  const wantDirty = Math.sqrt(1 - CHASSIS.dirtyAir * (c.slip || 0) * (1 - c.spec.grip * 9.81 / lateralGrip(Math.max(sp, 1), c.spec)));
  c.dirtyK += (wantDirty - c.dirtyK) * Math.min(1, dt / AI.dirtyTime);
  // tyre temperatures (tyre-temp.js) and the compound (COMPOUNDS): it feels its tyres like a driver, cornering on the
  // grip they have now
  const tempK = race.tyreTemp && c.tyreT ? Math.min(...Object.values(axleTempGrip(c.tyreT))) : 1, compK = COMPOUNDS[c.compound].grip, tyreK = tempK * compK;
  const dirty = tyreK !== 1 ? c.dirtyK * Math.sqrt(tyreK) : c.dirtyK;
  const vp = j => VP[j] < TUNING.V_CAP * 0.97 ? VP[j] * dirty : VP[j];
  let targetV = Math.min(vp((c.idx+2)%N), vp((c.idx+6)%N)) * skill;
  // the cars around: ahead in our lane (follow / pass), alongside (keep room), close behind (pressure, defending)
  const myP = progress(race, c), edge = HW - (alien ? AI.alien.edge : 2.5);   // (ALIEN: its line runs closer to the edges)
  let lane = null, lo = -edge, hi = edge, behind = null, hunting = false, followCap = Infinity;
  for (const o of race.cars) {
    if (o === c || o.pit) continue;
    const gap = (progress(race, o) - myP) * ds, dlat = o.lat - c.lat;
    // ALIEN hunts the player: close ahead or alongside it, it keeps its full attack (against AI cars it races calmer)
    if (alien && o.player && gap > -AI.alongside && gap < AI.alien.attack.towRange && Math.abs(dlat) < AI.alien.attack.huntLat) hunting = true;
    if (gap < 0 && gap > -C.behindRange && Math.abs(dlat) < AI.sideGap * 1.5 && (!behind || gap > behind.gap)) behind = { o, gap };
    // close ahead, also where it is heading: an AI car's target line (it may be about to cut across)
    const heading = race.t - o.aiT < 0.05, toward = gap < AI.cutRange && heading ? o.offset - c.offset : dlat;
    const near = Math.min(Math.abs(dlat), Math.abs(toward));
    if (gap < -AI.alongside || gap > AI.followRange || near >= AI.sideGap) continue;
    if (gap > 0 && near < AI.followLat) followCap = Math.min(followCap, o.v + (gap - (alien ? AI.alien.attack.followGap : AI.followGap)) * AI.followGain);
    if (gap > AI.alongside) { if (!lane || gap < lane.gap) lane = { o, gap }; }
    else if (Math.abs(dlat) >= AI.sideGap) continue;
    // side by side: keep room from where it is and, for an AI car, where it is heading
    else if (dlat > 0) hi = Math.min(hi, o.lat - AI.sideGap, heading ? o.offset - AI.sideGap : Infinity);
    else lo = Math.max(lo, o.lat + AI.sideGap, heading ? o.offset + AI.sideGap : -Infinity);
  }
  targetV = Math.min(targetV, followCap);
  // side by side or passing it is off its line, so a corner is tighter than its plan (on real grip a fast corner is only
  // flat on the line): it gives a little, as drivers do (2026-10-24)
  if (!alien && (lo !== -edge || hi !== edge || lane)) targetV *= C.squeeze;
  // pressure 0..1: a car close behind (more mistakes)
  const press = behind ? clamp(1 - (-behind.gap) / C.behindRange, 0, 1) : 0;
  c.pressure += (press - c.pressure) * Math.min(1, dt * 2);
  if (lane) {
    const { o } = lane, A = AI.alien.attack;
    if (c.passBy !== o) {
      const fits = side => Math.abs(o.lat + side * AI.sideGap) <= edge;
      const pref = alien && fits(inside) ? inside : Math.sign(off - o.lat) || 1;   // ALIEN: for the inside of the next corner
      c.passBy = o; c.passSide = fits(pref) ? pref : -pref;
    }
    off = o.lat + c.passSide * AI.sideGap;
    // ALIEN: on a straight, sit in its wake (the tow) and pull out late
    if (alien && toBrake * ds > A.straight && lane.gap > A.pullOut && lane.gap < A.towRange) off = o.lat;
  } else c.passBy = null;
  // defend: one move to the inside before the braking zone, held to the apex (only against a real threat: close,
  // in our slipstream and at least as fast; not with a car already alongside)
  if (behind && c.defendTo < 0 && !skillOverride && toBrake * ds < C.defendFrom && toBrake * ds > C.defendLate
      && -behind.gap < C.defendRange && behind.o.slipBy === c && behind.o.v > c.v - 1 && lo === -edge && hi === edge && c.defendZone !== apex) {
    c.defendZone = apex;                                     // decided once per corner
    if (race.rng() < traitOf(c, 'defend') * C.defendChance) { c.defendTo = apex; c.defendSide = inside; }
  }
  if (c.defendTo >= 0 && !lane) off = c.defendSide * (HW - C.defendMargin);
  off = lo <= hi ? clamp(off, lo, hi) : (lo + hi) / 2;
  off = clamp(off, -edge, edge);
  // (race.aiFollow > 1, ALIEN: the line followed that much more tightly, in clean air only: in traffic like the others)
  // (in clean air everyone follows its line AI.cleanFollow times as tightly: on real grip a corner taken 2–3 m off the
  // line's apex runs wide on the exit; in traffic the loose follow stays, it is what makes passing possible)
  const f = !lane && lo === -edge && hi === edge ? Math.max(race.aiFollow || 1, AI.cleanFollow) : 1;
  const slope = Math.min(AI.lineSlope * f * sp + 0.3, AI.lineSpeed * f) * dt;   // never cut across faster than this
  if (alien && f > 1 && Math.abs(off - c.offset) < AI.alien.snap) c.offset = off;   // ALIEN in clean air: on the line itself
  else c.offset += clamp((off - c.offset) * Math.min(1, dt * AI.lineRate * f), -slope, slope);
  if (alien) {                                               // ALIEN: clean air = full pace, else the traffic pace
    const A = AI.alien, clean = f > 1 && (c.slip || 0) < A.cleanSlip;
    const side = lo !== -edge || hi !== edge;                // a car alongside
    const want = clean ? 1 : hunting ? A.hunt : side || (c.slip || 0) > A.wakeSlip ? A.traffic : A.chase;
    c.alienK += (want - c.alienK) * Math.min(1, dt / (want < c.alienK ? A.trafficDrop : A.trafficTime));   // backs off fast, picks up slowly
  }
  if (lo <= hi) c.offset = clamp(c.offset, lo, hi);          // the room left by cars alongside, at once
  // steering (target behind, e.g. after a spin: full lock toward it, slowly)
  const tx = PX[ti] + NX[ti]*c.offset - c.x, tz = PZ[ti] + NZ[ti]*c.offset - c.z;
  const alpha = wrapA(Math.atan2(tz, tx) - c.h - driftAngle(c)), dist = Math.max(Math.hypot(tx, tz), 4);
  const lost = Math.abs(alpha) > Math.PI / 2;
  const kappa = 2 * (lost ? Math.sign(alpha) : Math.sin(alpha)) / dist, v5 = Math.max(sp, 5);
  let delta = CHASSIS.wheelbase * kappa + AI.yawGain * (sp * kappa - c.yawRate) * CHASSIS.wheelbase / v5;
  // without the stability assist the driver catches a sliding rear itself: opposite lock, the front wheels turned
  // toward where the car is going (AI.feel.counter), for as much of the assist as it lacks
  const stab = ASSISTS[AI.assists].stability;                 // (its usual assists: then nothing changes)
  if (c.assists.stability < stab && c.slideR > 0.15 && !lost) delta += AI.feel.counter * (1 - c.assists.stability / stab) * clamp((c.slideR - 0.15) / 0.3, 0, 1) * driftAngle(c);
  const want = clamp(delta / steerLock(c.v, c.assists.steer, c.spec), -1, 1);
  const rate = alien ? AI.alien.steerRate : AI.steerRate;
  c.steer += clamp(want - c.steer, -dt * rate, dt * rate);
  if (lost) targetV = Math.min(targetV, AI.recoverSpeed);
  // speed: the hardest deceleration the profile asks for ahead. Off the racing line (passing, defending) a corner is
  // tighter on the inside, so the profile there is scaled by the corner speed of the offset path.
  const offLine = j => {
    const d = c.offset - RO[j] - bias, k = LK[j];
    if (Math.abs(d) < 1 || Math.abs(k) < 1e-4) return 1;
    return Math.min(1, cornerSpeed(Math.abs(k / Math.max(0.2, 1 - k * d)), AI.grip) / cornerSpeed(Math.abs(k), AI.grip));
  };
  // Far ahead, brake only once the deceleration needed reaches what the profile plans with (brake late, not long).
  let need = 0, vmin = sp;
  // (on a hill: the braking it has there, gravity included; elevation.js)
  const E = T.elev, late = E ? AI.brake * brakeLimitAt(E, c.idx, sp, c.spec) * 0.9 : AI.brake * brakeLimit(sp, c.spec) * 0.9;
  for (let k = 2; k <= AI.brakeLook; k += k < 12 ? 2 : 6) {
    const j = (c.idx+k)%N, vt = Math.min(vp(j) * skill * offLine(j), targetV + k * 0.5);
    if (k <= 6) targetV = Math.min(targetV, vt);
    vmin = Math.min(vmin, vt);
    const n = (sp*sp - vt*vt) / (2 * k * ds);
    if (k <= 12 || n > late) need = Math.max(need, n);
  }
  const over = sp - targetV;
  let thr = 0, brk = 0;
  if (alien && (c.alienK > 0.99 || hunting)) {
    // ALIEN in clean air or hunting the player: the lap-optimum bot's pedals on its own profile: flat out until
    // over the target, brake once the hardest deceleration ahead passes brakeAt × the limit (late and hard); in
    // traffic with AI cars it drives like the others (a whole ALIEN field braking that late: 4× the hard contacts)
    // (cold tyres: it takes their whole grip loss as margin when properly cold, only the square root once nearly warm)
    const A = AI.alien, tk = tempK ** (0.5 + 0.5 * clamp((0.97 - tempK) / 0.03, 0, 1)) * Math.sqrt(compK), vt = j => VP[j] >= TUNING.V_CAP - 1e-3 ? TUNING.V_CAP : tyreK !== 1 ? VP[j] * skill * offLine(j) * tk : VP[j] * skill * offLine(j);
    const target = lost ? AI.recoverSpeed : Math.min(vt((c.idx + 2) % N), vt((c.idx + 5) % N), followCap);   // (never into the car ahead)
    let need2 = 0;
    for (let k = 2; k <= A.brakeLook; k += k < 12 ? 2 : 4) { const w = vt((c.idx + k) % N); need2 = Math.max(need2, (sp * sp - w * w) / (2 * k * ds)); }
    // (without ABS: what its feet can do, the pedal it has learnt the fronts take × the full pedal's force)
    const lim0 = (E ? brakeLimitAt(E, c.idx, sp, c.spec) : brakeLimit(sp, c.spec)) * (c.assists.abs ? 0.97 : Math.min(0.97, c.feelBrake)), o2 = sp - target;
    const lim = tyreK !== 1 ? lim0 * tyreK : lim0;                // (cold or hot tyres: it brakes earlier)
    if (need2 > lim * A.brakeAt || o2 > A.overBrake) brk = clamp(need2 / (lim * A.brakeScale) + Math.max(0, o2) * A.brakeGain, 0, 1);
    else thr = o2 > 0 ? clamp(1 - o2 * A.thrGain, 0, 1) : 1;
  }
  else {
    // (downhill the brakes do more of it: gravity takes G·SX off the deceleration)
    if (need > 2 || over > 1) brk = clamp((E ? need - G * E.SX[c.idx] : need) / brakeMax(sp, c.spec) + Math.max(0, over) * AI.brakeGain, 0, 1);
    else if (need <= 0) thr = clamp(0.5 - over * AI.thrGain, 0, 1);
    // no throttle while asking the front tyres for more than they have (it would only push the car wide)
    if (!lost && sp > AI.recoverSpeed && (Math.abs(want) > 0.95 || c.slideF > 0.3)) thr = Math.min(thr, AI.lockThrottle);
  }
  // running out of road on the way out (2026-10-24, real grip: under power the car runs a little wide of its line):
  // where it will be in `look` s; past the kerb's end, ease the throttle, as a driver lifts before the limits. Only as
  // far as it is already wider than the line it means to drive (`off` m = all of it): a chicane's line crosses the road
  // at speed (2026-10-25: the lift cut the throttle to `min` out of both of Hautvale's last corners)
  { const E2 = AI.edge, hd = wrapA(c.h - Math.atan2(T.TZ[c.idx], T.TX[c.idx])), vlat = c.v * Math.sin(hd) + c.vy * Math.cos(hd);
    const ahead = c.lat + vlat * E2.look, limit = HW + T.KERB + E2.room, out = (c.lat - RO[c.idx] - bias) * Math.sign(ahead);
    if (thr > 0 && Math.abs(ahead) > limit && Math.sign(vlat) === Math.sign(ahead) && out > 0)
      thr *= clamp(1 - (Math.abs(ahead) - limit) / E2.fade * Math.min(1, out / E2.off), E2.min, 1); }
  // mistakes: weaker drivers more often; nervy ones more with a car right behind
  const chance = AI.mistakes.chance * (1 - c.skill) * 10 * (1 + C.pressureMistakes * traitOf(c, 'nerves') * c.pressure);
  if (brk > 0 && c.brake === 0 && !skillOverride && !alien && !c.mistake && sp - vmin > AI.mistakes.minDrop && race.rng() < chance) {
    const [lo2, hi2] = AI.mistakes.over;
    c.mistake = lo2 + race.rng() * (hi2 - lo2);
    c.mistakeEnd = (c.idx + Math.round(AI.mistakes.length / ds)) % N;
    brk = 0;
  }
  if (!c.assists.abs || !c.assists.tc) [thr, brk] = feelPedals(c, thr, brk, dt);
  // (everything above asks for a share of the torque; the pedal that gives it, through the torque map: vehicle.js)
  if (thr > 0) thr **= 1 / CAR.engine.pedalMap;
  c.brake = brk; c.thr = thr;
  updateActiveAero(race, c, { thr, brk }, dt);
  updateWear(race, c, thr, dt);
  slipstream(race, c, progress);
  stepChassis(race, c, { thr, brk, steer: c.steer, shift: 0 }, dt);
  afterMove(race, c);
}
