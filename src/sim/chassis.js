// The player's car as a two-axle ("bicycle") model with tyres. Each axle makes cornering force from its slip angle
// (the angle between where the tyre points and where it is going), up to its grip = friction × load. Load comes from
// weight, downforce and longitudinal load transfer (braking loads the front, accelerating the rear). Braking and
// drive use the same grip (friction circle): ask for too much and the tyre locks (front: the car goes straight on)
// or spins (rear: the tail steps out). Assists (ASSISTS) shape the steering and catch slides, wheel spin, lock-ups.
//
// State on the car: v (forward speed), vy (sideways speed, + = right), yawRate (rad/s, + = turning right), ax.
// Everything is per unit mass, so forces read as accelerations (m/s²).
import { TUNING, SURFACES, ASSISTS, ROUGH, OFFTRACK as OT } from './tuning.js';
import { F1_2026 } from './classes/f1-2026.js';
import { updateEcu, brakeAhead } from './ecu.js';
import { axleTempGrip, stepTyreTemps, tyreEvents } from './tyre-temp.js';
import { clamp, speedOf } from './math.js';
import { lateralGrip, brakeMax, drivetrain, tyreGrip } from './vehicle.js';
import { STOCK } from './spec.js';
import { carCondition } from './pit.js';
import { stepAir } from './airborne.js';
import { aiOf } from './ai-profile.js';
import { M as FM } from './fmath.js';   // (deterministic sin, cos, atan2, hypot …: the same race on every engine)
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

const G = 9.81;
// A car class's tables and the numbers derived from them, made once per class (Q; car classes, docs/car-classes-plan.md):
// L wheelbase, A_FRONT / B_REAR the centre of mass to the front / rear axle, K2 the yaw inertia per mass, STOCK_RIDE the
// stock ride heights (and their mean KERB_RIDE, STOCK_SUSP the stock springs), ROLL_W / PITCH_W the body's roll / pitch
// frequencies (rad/s), C_SHAPE / B_UNIT the tyre curve's shape
const bundles = new WeakMap();
/** @param {import('./types.js').CarClass} cls */
function chassisOf(cls) {
  let Q = bundles.get(cls);
  if (Q) return Q;
  const CH = cls.chassis, SU = cls.suspension, DA = cls.damper, SETUP = cls.setup, L = CH.wheelbase;
  const STOCK_RIDE = [SETUP.rideF.def, SETUP.rideR.def], C_SHAPE = CH.falloff;
  Q = Object.freeze({ CH, SU, DA, DIFF: cls.diff, ACTIVE_AERO: cls.activeAero, HANDBRAKE: cls.handbrake, ERS: cls.ers, ECU: cls.ecu, TTC: cls.tyreTemp,
    L, A_FRONT: L * (1 - CH.frontWeight), B_REAR: L * CH.frontWeight, K2: CH.gyration * CH.gyration,
    STOCK_RIDE, KERB_RIDE: (SETUP.rideF.def + SETUP.rideR.def) / 2, STOCK_SUSP: { kF: SU.kF, kR: SU.kR, rideF: STOCK_RIDE[0], rideR: STOCK_RIDE[1] },
    ROLL_W: 2 * Math.PI * DA.hz, PITCH_W: 2 * Math.PI * DA.pitchHz, C_SHAPE, B_UNIT: FM.tan(Math.PI / (2 * C_SHAPE)) });
  bundles.set(cls, Q);
  return Q;
}
/** @typedef {ReturnType<typeof chassisOf>} ChassisQ */
const F1_Q = chassisOf(F1_2026);
// the suspension off stock (spec.susp, SUSPENSION): how far each end sinks under the load beyond its weight at rest (axle
// load per mass dF / dR: downforce, dive, dips) on these springs and on the stock ones, so the floor's height at speed
// against the stock car's in the same spot: the downforce factor (ground effect, a stalling floor) and the front's share
const stallK = (SU, h) => h < SU.stallAt ? 1 - Math.min(SU.stallMax, SU.stall * (SU.stallAt - h)) : 1;
const plankK = (SU, h) => h < 0 ? Math.max(SU.plankMin, 1 + SU.plank * h) : 1;        // (the floor on the road: the plank takes load)
// the dampers off stock (DAMPER): the body's roll as a spring and damper, one sub-step (x = the load transfer the springs
// carry, per mass; v its rate), on these dampers (damping ratio zeta) and on the stock ones; returns the change to each
// axle's sideways transfer against the stock car's (signed like T)
/** @param {ChassisQ} Q */
function dampRoll(Q, D, Dm, T, rollFront, h) {
  const { DA, ROLL_W } = Q;
  const z = DA.zeta * (Dm.cF + Dm.cR) / 2;
  D.v += (ROLL_W * ROLL_W * (T - D.x) - 2 * z * ROLL_W * D.v) * h; D.x += D.v * h;
  D.v0 += (ROLL_W * ROLL_W * (T - D.x0) - 2 * DA.zeta * ROLL_W * D.v0) * h; D.x0 += D.v0 * h;
  // (what the dampers carry: 2ζ/ω × the rate, shared by the axles' damping; the springs' part by the roll stiffness)
  const shareF = Dm.cF / (Dm.cF + Dm.cR), cd = 2 * z / ROLL_W * D.v, cd0 = 2 * DA.zeta / ROLL_W * D.v0;
  return { f: rollFront * (D.x - D.x0) + shareF * cd - 0.5 * cd0, r: (1 - rollFront) * (D.x - D.x0) + (1 - shareF) * cd - 0.5 * cd0 };
}
// and its pitch (T = the lengthways transfer, − = braking: the nose going down): returns how much more of it the springs
// carry than the stock car's do (the floor's height follows that)
/** @param {ChassisQ} Q */
function dampPitch(Q, D, Dm, T, h) {
  const { DA, PITCH_W } = Q;
  const z = DA.zeta * (D.pv < 0 ? Dm.dive : Dm.rise);
  D.pv += (PITCH_W * PITCH_W * (T - D.p) - 2 * z * PITCH_W * D.pv) * h; D.p += D.pv * h;
  D.pv0 += (PITCH_W * PITCH_W * (T - D.p0) - 2 * DA.zeta * PITCH_W * D.pv0) * h; D.p0 += D.pv0 * h;
  return D.p - D.p0;
}
// (dFs / dRs: the stock car's in the same spot, when it differs: the dampers' pitch)
/** @param {ChassisQ} Q */
function suspAero(Q, P, dF, dR, mass, aF, dFs = dF, dRs = dR) {
  const { SU, STOCK_RIDE } = Q;
  const hF = P.rideF - dF * mass / P.kF, hR = P.rideR - dR * mass / P.kR;
  const sF = STOCK_RIDE[0] - dFs * mass / SU.kF, sR = STOCK_RIDE[1] - dRs * mass / SU.kR;
  const ground = 1 + SU.ground * ((sF + sR) / 2 - (hF + hR) / 2);
  const floor = aF * stallK(SU, hF) / stallK(SU, sF) + (1 - aF) * stallK(SU, hR) / stallK(SU, sR);
  return { k: ground * floor, front: SU.rake * ((hR - hF) - (sR - sF)), gripF: plankK(SU, hF) / plankK(SU, sF), gripR: plankK(SU, hR) / plankK(SU, sR) };
}
// extra deceleration from the surface (signed to oppose the motion): rolling + the gravel's bite (full from biteFrom,
// fading above biteTo to `skim` of it: a fast car skims over gravel, a slow one digs in)
export function surfaceDrag(surf, v) {
  const sp = Math.abs(v); if (!surf.rolling && !surf.bite) return 0;
  const fade = sp <= surf.biteTo ? 1 : Math.max(surf.skim, 1 - (1 - surf.skim) * (sp - surf.biteTo) / surf.biteFade);
  return Math.sign(v) * (surf.rolling + surf.bite * Math.min(1, sp / surf.biteFrom) * fade);
}
// An axle's grip (per mass) with `load` on it (static `ns`) and `d` of it moved to the outer wheel by the cornering.
const axleGrip = (load, d, ns, S) => { const half = load / 2, dd = Math.min(d, half);
  return tyreGrip(half + dd, S, ns / 2) + tyreGrip(half - dd, S, ns / 2); };
// tyre curve: sin(C·atan(B·α)), peaking at the axle's peak slip angle
/** @param {ChassisQ} [Q] the car class's (the F1's by default) */
export const tyreCurve = (alpha, peak = F1_2026.chassis.peakSlip, Q = F1_Q) => FM.sin(Q.C_SHAPE * FM.atan(Q.B_UNIT / peak * alpha));

// Road-wheel angle at full lock. With the steering assist the lock shrinks with speed toward the angle of the
// tightest steady turn the tyres can hold (wheelbase / radius, plus the tyres' slip, measured: limitTurn, steerMargin),
// so a full tilt or a held key at 300 km/h asks for the grip there is, not more, and half tilt is about half the
// cornering. Less assist mixes back the raw lock (squared, so medium stays close to the grip limit).
/** @param {number} v @param {number} assist @param {import('./spec.js').Spec} [spec] */
export function steerLock(v, assist, spec = STOCK) {
  const sp = Math.max(Math.abs(v), 1), { CH, L } = chassisOf(spec.cls);
  const useful = Math.min(CH.maxSteer, L * lateralGrip(sp, spec) / (sp * sp) * CH.limitTurn + CH.steerMargin);
  return useful + (CH.maxSteer - useful) * FM.pow(1 - assist, 2);
}

// One axle's forces. D = grip (per mass), alpha = slip angle, long = braking (−) or drive (+) asked of it.
// Returns lateral force, longitudinal force actually delivered, and how far past the grip limit it is (0..1+).
/** @param {ChassisQ} Q */
function axle(Q, D, alpha, peak, long, limit, spin = null, driveK = 1, inner = 0, longK = 1) {
  const CH = Q.CH;
  let fy = -D * tyreCurve(alpha, peak, Q);
  const lg = longK === 1 ? CH.longGrip : CH.longGrip * longK, longMax = D * lg;   // (longK: camber's cost lengthways)
  // what is left for braking / drive after cornering (friction circle)
  const avail = Math.sqrt(Math.max(longMax * longMax * 0.1, longMax * longMax - fy * fy * lg * lg));
  // (a more open diff: the inside wheel spins up and the drive goes nowhere past what it holds; the outside tyre keeps its
  // grip, the spinning inside one loses its share `inner` of the cornering)
  let fx = long;
  if (driveK !== 1 && long > avail * driveK) { fx = avail * driveK; fy *= 1 - inner * (1 - CH.lockLateral); }
  if (limit !== null) fx = clamp(fx, -avail * limit, avail * limit);        // ABS / traction control
  let over = Math.abs(fx) / avail;
  // driving rear wheels without traction control: the spin builds up and dies away (CH.spin, spinStep)
  if (spin && fx > 0 && (over > 1 || spin.s > 0)) {
    const P = CH.spin.peak, s = spinStep(CH, spin, over, avail);
    const k = s < P ? 1 : 1 - (1 - CH.slideLong) * (s - P) / (1 - P);
    fx = Math.min(fx, avail * k);
    fy *= 1 - (1 - CH.lockLateral) * Math.max(0, s - P) / (1 - P);
    const room = Math.sqrt(Math.max(0, D * D - fx * fx));
    if (Math.abs(fy) > room) fy = Math.sign(fy) * room;
    return { fy, fx, over: s > P ? 1 + (s - P) / (1 - P) : Math.min(over, 1) };
  }
  if (over > 1) {                                                         // locked or spinning: sliding friction
    fx = Math.sign(fx) * avail * CH.slideLong;
    fy *= Math.max(CH.lockLateral, 1 - (over - 1) * 2);
  } else {
    const room = Math.sqrt(Math.max(0, D * D - fx * fx));                 // cornering left after braking / drive
    if (Math.abs(fy) > room) fy = Math.sign(fy) * room;
  }
  return { fy, fx, over };
}
// One sub-step of the rear wheels' spin (spin = { s, v, h }: the state 0..1, the car's speed, the sub-step): the drive
// beyond what the tyres give (over − 1, × avail per mass) spins the wheels up through the drivetrain's inertia (the car's
// mass / CH.spin.mass, reflected at the tyre), as slip ratio per s at this speed; under the limit they slow back to grip
function spinStep(CH, spin, over, avail) {
  const S = CH.spin, rate = (over - 1) * avail * S.mass / (Math.max(spin.v, S.minSpeed) * S.full);
  spin.s = clamp(spin.s + rate * spin.h, 0, 1);
  return spin.s;
}

// One player step: steering, drivetrain, tyres, assists, integration. Moves c.x/c.z/c.h; the caller runs afterMove.
/** @param {Race} race @param {Car} c */
export function stepChassis(race, c, inp, dt) {
  const A = c.assists || ASSISTS.medium, surf = SURFACES[c.surface] || SURFACES.track, S = c.spec;   // S: the car's own numbers (spec.js)
  // its class's tables and the numbers derived from them (chassisOf)
  const Q = chassisOf(S.cls), { CH, SU, DA, DIFF, ACTIVE_AERO, HANDBRAKE, ERS, ECU, TTC, L, A_FRONT, B_REAR, K2, KERB_RIDE, STOCK_SUSP } = Q;
  // the deployment map (as the real cars' ECU, by where the car is): no electrical power in the last metres before a
  // braking zone (the energy would only go into the brakes), stopping earlier the emptier the battery (ERS.map)
  if (c.ecuMode) {
    // a car with an ECU mode (ecu.js: the player's): its map, by the braking points learnt from its own driving
    updateEcu(race, c, inp);
    const M = ECU.maps[c.ecuMap], cut = M.near + M.far * (1 - c.soc / ERS.store);
    c.deploy = clamp((brakeAhead(race, c) - cut) / M.fade, 0, 1) * M.deploy;
  } else { const M = ERS.map, T = race.track, BRK = aiOf(T, S.cls).BRK, to = BRK ? BRK[c.idx] * T.ds : Infinity, cut = M.near + M.far * (1 - c.soc / ERS.store);
    c.deploy = clamp((to - cut) / M.fade, 0, 1); }
  const d = drivetrain(c, inp, dt);
  // the car's condition (pit.js): worn tyres, damage, empty tank (limp)
  const cond = carCondition(c);
  d.drive *= cond.power; d.resist *= cond.drag; d.rear *= cond.drag;
  const n = CH.substeps, h = dt / n;
  // dirty tyres after an off: picked up on grass / gravel / turf, worn off on a hard surface
  if (c.surface in ROUGH) c.dirt = Math.max(c.dirt || 0, ROUGH[c.surface]);
  else if (c.dirt) c.dirt = Math.max(0, c.dirt - dt / OT.clean);
  const dirt = (1 - OT.loss * (c.dirt || 0)) * cond.grip;
  if (c.beached) { c.v = c.vy = c.yawRate = 0; c.slideF = c.slideR = 0; return; }   // stuck: waiting for the marshals
  if (c.air) { stepAir(race, c, d.resist, dt); return; }                       // in the air (airborne.js): no tyres
  // deep in gravel at walking pace the wheels dig in
  const dug = c.surface === 'gravel' && c.gravelDepth > OT.deep && speedOf(c) < OT.digSpeed ? OT.dig : 1;
  // hills and banking (elevation.js; null on a flat circuit: nothing below changes then): the road at this sample
  const T = race.track, E = T.elev, ei = c.idx, onRoad = Math.abs(c.lat) <= T.HW;
  const eSX = E ? E.SX[ei] : 0, eSN = E && onRoad ? E.SN[ei] : 0, eCA = E ? (onRoad ? E.CA[ei] : Math.sqrt(1 - eSX * eSX)) : 1;
  let slideF = 0, slideR = 0, lockF = false, lockR = false, spinR = false;
  // tyre temperatures (tyre-temp.js; only when the race runs them): each axle's grip × its tyres' temperature factor,
  // and the step's friction power and wheel loads back into their heat (heatF / heatR: J over the step)
  const TT = race.tyreTemp ? c.tyreT : null, tg = TT ? axleTempGrip(TT) : null;
  let heatF = 0, heatR = 0, wheelN = null, outF = 0, outR = 0;
  const spinState = { s: c.rearSpin, v: 0, h };
  for (let s = 0; s < n; s++) {
    // v: along the car's heading (negative = travelling backwards, e.g. past 90° in a spin), vy: sideways
    const v = c.v, sp = Math.abs(v), vy = c.vy, w = c.yawRate, speed = FM.hypot(v, vy);
    const delta0 = c.steer * steerLock(v, A.steer, S) + cond.pull;
    // (front toe-out over stock: small steering angles turn the car more: a sharper turn-in)
    const delta = S.susp && S.susp.toeOut ? delta0 * (1 + SU.toe.turn * S.susp.toeOut * (1 - clamp(Math.abs(delta0) / SU.toe.small, 0, 1))) : delta0;
    // on a hill: gravity in the road's plane in the car's frame (gx forward, gy right, per G), and the load on the
    // tyres per mass (gN; G on the flat): less over a crest, more in a dip and when the bank carries the cornering
    let gx = 0, gy = 0, gN = G;
    if (E) {
      const ch = FM.cos(c.h), sh = FM.sin(c.h), cd = ch * T.TX[ei] + sh * T.TZ[ei], sd = sh * T.TX[ei] - ch * T.TZ[ei];
      gx = eSX * cd + eSN * sd; gy = eSN * cd - eSX * sd;
      gN = eCA * (G + v * v * E.VK[ei] - v * w * gy);         // (below 0 over a sharp crest: the downforce has to hold it)
    }
    // reverse gear and crawling (by the real speed: a car sliding sideways at 90° is not crawling): kinematic steering
    if (d.reverse || speed < CH.lowSpeed) {
      let a = -d.resist - surfaceDrag(surf, v);
      // what the rear tyres can push on this surface (per mass); reverse goes through the same limit and dig-in
      const push = S.grip * surf.grip * dirt * gN * (1 - CH.frontWeight) * CH.longGrip;
      if (d.reverse) {
        // brake against the motion; gas backwards (asking more than the tyres give spins them, as forwards)
        const ask = TUNING.REVERSE_ACC * inp.thr;
        a += (v > 0 ? -20 : 20) * inp.brk * surf.grip - (ask > push ? push * CH.slideLong : ask) * dug;
      } else { a += Math.min(d.drive, push) * dug; if (v > 0) a -= 20 * inp.brk * surf.grip; }
      // a wheelspin from (near) rest: the rears spin on the spot, the friction heats them (tyre-temp.js)
      if (TT && d.drive > push) heatR += S.mass * push * Math.min(TTC.spinSlip.max, TTC.spinSlip.base + TTC.spinSlip.per * (d.drive / push - 1)) * h;
      if (E) a -= G * gx;
      if (inp.hb && v > 0) a -= HANDBRAKE.crawl * inp.hb;
      const v0 = c.v; c.v = clamp(c.v + a * h, -TUNING.REVERSE_MAX, TUNING.V_CAP);
      if (!d.reverse && v0 >= 0 && c.v < 0) c.v = 0;
      if (d.reverse && v0 <= 0 && c.v > 0 && !(inp.thr > 0)) c.v = 0;   // braking a reversing car stops it, not more
      // the rear axle rolls straight: sideways speed at the centre of mass is B_REAR × yaw rate (no tyre slip)
      c.yawRate = c.v * FM.tan(delta) / L; c.vy = B_REAR * c.yawRate;
      c.h += c.yawRate * h;
      c.x += (FM.cos(c.h) * c.v - FM.sin(c.h) * c.vy) * h; c.z += (FM.sin(c.h) * c.v + FM.cos(c.h) * c.vy) * h;
      continue;
    }
    // axle loads (per mass): weight + downforce (less in dirty air, and sideways or backwards the wings stall)
    // ± load transfer from the last acceleration
    const beta = FM.atan2(Math.abs(vy), v), stall = clamp((beta - OT.spinFrom) / (OT.spinTo - OT.spinFrom), 0, 1);
    // = smoothstep(stall), written out: the helper multiplies in another order (last-bit rounding: sim-trace would differ)
    const yawAero = 1 - (1 - OT.spinFloor) * stall * stall * (3 - 2 * stall);
    // (open wings: straight mode, active-aero.js; aeroOpen 0 multiplies by exactly 1)
    let df = S.dfK * v * v * (1 - CH.dirtyAir * (c.slip || 0)) * yawAero * cond.aero * (1 - ACTIVE_AERO.downforceCut * c.aeroOpen);
    const transfer = c.ax * CH.cgHeight / L;
    let surfMu = surf.grip * dirt, aF = S.aeroFront, plankF = 1, plankR = 1, kerbK = 1;
    const P = S.susp, Dm = S.damp, onKerb = c.surface === 'kerb' || c.surface === 'sausage';
    const D = Dm ? c.damp || (c.damp = { x: 0, v: 0, x0: 0, v0: 0, p: 0, pv: 0, p0: 0, pv0: 0, kerb: 0 }) : null;
    if (P || D) {                                  // (the suspension off stock: the floor's height at speed, kerbs)
      const dF = t => gN * CH.frontWeight + df * aF - t - G * CH.frontWeight, dR = t => gN * (1 - CH.frontWeight) + df * (1 - aF) + t - G * (1 - CH.frontWeight);
      const r = D ? (tp => suspAero(Q, P || STOCK_SUSP, dF(tp), dR(tp), S.mass, aF, dF(transfer), dR(transfer)))(transfer + dampPitch(Q, D, Dm, transfer, h))
        : suspAero(Q, P, dF(transfer), dR(transfer), S.mass, aF);
      df *= r.k; aF += r.front; plankF = r.gripF; plankR = r.gripR;
      if (P && onKerb) {
        const lower = KERB_RIDE - (P.rideF + P.rideR) / 2;
        kerbK = Math.max(0, 1 + SU.kerb * P.stiff + SU.kerbRide * lower);
        surfMu = (1 - (1 - surf.grip) * kerbK) * dirt;
      }
    }
    if (D) {                                       // (the dampers off stock: a kerb strike, and how long it lingers)
      const strike = onKerb ? Math.min(1, (1 - surf.grip) * kerbK * Math.max(0, 1 + DA.kerb * Dm.bump)) : 0;
      D.kerb = Math.max(strike, Dm.linger > 0 ? D.kerb * FM.exp(-h / Dm.linger) : 0);
      surfMu = (onKerb ? 1 : surf.grip) * (1 - D.kerb) * dirt;
    }
    // per wheel (2026-10-24): the sideways load transfer of the last step moves load to the outer wheel of each axle;
    // load sensitivity (tyreGrip) makes the axle give less than with the load shared evenly
    // (dampers off stock: + the change their roll damping makes while the body rolls, dampRoll)
    let lf, lr;
    if (Dm) {
      const T = c.ay * CH.cgHeight / CH.track, d = dampRoll(Q, c.damp, Dm, T, S.rollFront, h);
      lf = Math.abs(T * S.rollFront + d.f); lr = Math.abs(T * (1 - S.rollFront) + d.r);
    } else { const lat = Math.abs(c.ay) * CH.cgHeight / CH.track; lf = lat * S.rollFront; lr = lat * (1 - S.rollFront); }
    const loadF = Math.max(0.5, gN * CH.frontWeight + df * aF * cond.front - transfer);
    const loadR = Math.max(0.5, gN * (1 - CH.frontWeight) + df * (1 - aF) + transfer);
    const Df0 = surfMu * S.frontGrip * axleGrip(loadF, lf, G * CH.frontWeight, S);
    const Dr0 = surfMu * S.rearGrip * axleGrip(loadR, lr, G * (1 - CH.frontWeight), S);
    const DfT = tg ? Df0 * tg.f : Df0, DrT = tg ? Dr0 * tg.r : Dr0;
    const Df = P ? DfT * P.latF * plankF : D ? DfT * plankF : DfT, Dr = P ? DrT * P.latR * plankR : D ? DrT * plankR : DrT;      // (camber: cornering grip; its cost lengthways in axle(); the plank)
    // slip angles (velocity at each axle vs where its wheels point)
    // (rolling backwards the steering acts the other way round)
    const back = v / Math.max(sp, 0.5);   // +1 forwards, −1 backwards, smooth through 0 (brakes then damp v to rest)
    const alphaF = FM.atan2(vy + A_FRONT * w, Math.max(sp, 1)) - delta * Math.sign(back || 1);
    const alphaR = FM.atan2(vy - B_REAR * w, Math.max(sp, 1));
    // brakes split by axle load (+ a front bias), drive on the rear
    const brake = brakeMax(sp, S) * inp.brk;
    // (brake-by-wire keeps the rear share with the MGU-K harvesting; it moves forward as the pedal comes off: migration)
    const bias = Math.min(1, S.brakeBias + S.brakeMigration * (1 - inp.brk));
    // ABS / traction control hold the tyres at `limit` × what they can give: medium / high 0.97, low 0.985 (2026-10-24: low
    // used to allow 1.045 / 1.095, past the grip, so its wheels locked and spun as with none)
    const absLimit = A.abs > 0 ? 0.97 + 0.03 * (1 - A.abs) : null, tcLimit = A.tc > 0 ? 0.97 + 0.03 * (1 - A.tc) : null;
    const front = axle(Q, Df, alphaF, S.peakF, -brake * bias * back, absLimit, null, 1, 0, P ? P.longF : 1);
    // (engine braking on a lift, d.rear: through the rear tyres; the handbrake's own branch keeps it in the car's drag)
    const eng = inp.hb ? 0 : d.rear;
    const rearLong = d.drive - eng - brake * (1 - bias) * back;
    // rear braking: ABS, and (stability assist) a margin kept for cornering, like brake-force distribution
    // any ABS keeps the rears from locking (a locked rear turning in spins the car); partial ABS only lets the fronts lock a little
    const rearBrakeLimit = absLimit === null ? null : Math.min(0.97, absLimit) * (1 - CH.rearBrakeMargin * A.stability);
    const braking = brake * (1 - bias) + eng > d.drive;   // which limit applies: ABS while braking, traction control on the throttle
    // handbrake: the rears locked (no drive, no ABS); written as its own branch so nothing changes without it
    // (without traction control the rear wheels' spin builds up: c.rearSpin, CH.spin)
    const spin = !braking && tcLimit === null && rearLong > 0 ? (spinState.v = sp, spinState) : null;
    // the differential vs stock in this phase (DIFF; 0 at the stock setup: nothing below changes)
    const lock = inp.hb ? 0 : S.diff[inp.brk > DIFF.pedal ? 0 : inp.thr > DIFF.pedal ? 2 : 1];
    // (on the throttle a more open diff lets the inside rear, unloaded by the cornering, spin up first)
    const unload = clamp(lr / (loadR / 2), 0, 1), driveK = lock < 0 && inp.thr > DIFF.pedal ? 1 - DIFF.traction * -lock * unload : 1;
    const rear = inp.hb ? axle(Q, Dr, alphaR, S.peakR, -Dr * CH.longGrip * HANDBRAKE.lock * inp.hb * back, null)
      : axle(Q, Dr, alphaR, S.peakR, rearLong, braking ? rearBrakeLimit : tcLimit, spin, driveK, (1 - unload) / 2, P ? P.longR : 1);
    if (!spin) spinState.s = 0;
    // how far past the grip limit each axle is: 0 = gripping, 1 = fully sliding (locked, spinning or past peak slip)
    slideF = Math.max(slideF, front.over - 1, Math.abs(alphaF) / S.peakF - 1);
    slideR = Math.max(slideR, rear.over - 1, Math.abs(alphaR) / S.peakR - 1);
    if (front.over > 1 && brake > 0) lockF = true;
    if (rear.over > 1 && braking && !inp.hb) lockR = true;
    if (rear.over > 1 && !braking && d.drive > 0 && !inp.hb) spinR = true;
    if (TT) {
      // friction power = force × slip speed: sideways (slip angle) + lengthways (a gripping tyre's small slip; all of
      // the speed once locked or spinning)
      const slipL = o => speed * (o > 1 ? Math.min(1, TTC.longSlip + o - 1) : TTC.longSlip * o);
      heatF += S.mass * (Math.abs(front.fy) * speed * Math.abs(FM.sin(alphaF)) + Math.abs(front.fx) * slipL(front.over)) * h;
      // (a spinning rear slips by its wheel speed, which can be far more than the car's own: a locked wheel only by the car's)
      const spinV = rear.over > 1 && rear.fx > 0 ? Math.max(slipL(rear.over), Math.min(TTC.spinSlip.max, TTC.spinSlip.base + TTC.spinSlip.per * (rear.over - 1))) : slipL(rear.over);
      heatR += S.mass * (Math.abs(rear.fy) * speed * Math.abs(FM.sin(alphaR)) + Math.abs(rear.fx) * spinV) * h;
      const hf = loadF / 2, hr = loadR / 2, df_ = Math.min(lf, hf), dr_ = Math.min(lr, hr), left = c.ay >= 0;   // (ay > 0: turning right, the left wheels outside)
      wheelN = [left ? hf + df_ : hf - df_, left ? hf - df_ : hf + df_, left ? hr + dr_ : hr - dr_, left ? hr - dr_ : hr + dr_].map(x => x * S.mass);
      outF = (left ? 1 : -1) * (hf + df_) / loadF; outR = (left ? 1 : -1) * (hr + dr_) / loadR;
    }
    // equations of motion in the car's frame
    const cosD = FM.cos(delta), sinD = FM.sin(delta);
    // the surface drags against the car's whole motion (a car sliding sideways through gravel is slowed too)
    const sd = surfaceDrag(surf, speed) / speed;
    let ax = rear.fx + front.fx * cosD - front.fy * sinD - (d.resist - eng) - sd * v;
    let ay = front.fy * cosD + front.fx * sinD + rear.fy - sd * vy;
    // gravity on the slope; on a bank the plan view only sees cos(bank) of the cornering the tyres give in the road's
    // plane, the rest (1 − cos) comes for free with the tilt
    if (E) { ax -= G * gx; ay += -G * gy + (1 - Math.sqrt(1 - eSN * eSN)) * v * w; }
    let dw = (A_FRONT * (front.fy * cosD + front.fx * sinD) - B_REAR * rear.fy) / K2;
    // a more locked diff holds the rear wheels to one speed: a moment against the rotation (less lock: with it)
    // (rear toe-in over stock damps the rear's rotation; less toe-in, less of that)
    if (P && P.toeIn) dw -= SU.toe.damp * P.toeIn * w * Math.min(1, sp / SU.toe.dampV);
    if (lock) dw -= lock * (lock < 0 ? DIFF.open : 1) * DIFF.yaw * Dr * CH.longGrip * (CH.track / 2) * clamp(w * CH.track / DIFF.slip, -1, 1) / K2;
    // stability assist: when the rear slides, pull the yaw rate back toward what the steering asks for
    // damping assist: always, gently, toward that same yaw rate
    if ((A.stability > 0 || A.damping > 0) && !inp.hb) {               // (the handbrake asks for the rotation)
      const wGrip = lateralGrip(sp, S) / sp, wRef = clamp(v * FM.tan(delta) / L, -wGrip, wGrip);
      const rearSliding = clamp((Math.abs(alphaR) - 0.4 * S.peakR) / (0.6 * S.peakR), 0, 1);
      dw -= (A.stability * CH.stabilityGain * rearSliding + (A.damping || 0) * CH.dampingGain) * (w - wRef);
    }
    // aero yaw stability: the car's side area behind the centre of mass (sidepods, engine cover fin, endplates) turns
    // the nose toward where it is going, ∝ dynamic pressure × slip angle (gone once the car is sideways: yawAero)
    // (the slip angle there, aeroArm m behind: so it also damps the rotation, like the rear tyres)
    dw += CH.aeroYaw * v * Math.abs(v) * FM.atan2(vy - CH.aeroArm * w, Math.max(Math.abs(v), 1)) * yawAero;
    c.ax = ax; c.ay = ay;
    const v0 = c.v;
    c.v += (ax + vy * w) * h;
    c.vy += (ay - v * w) * h;
    c.yawRate += dw * h;
    if (v0 > 0 && c.v < 0 && speedOf(c) < CH.lowSpeed) c.v = 0;   // braking to a stop doesn't roll back
    c.v = Math.min(c.v, TUNING.V_CAP);
    // below blendSpeed (the real speed) fade toward kinematic steering, which is stable at walking pace
    const k = clamp((speedOf(c) - CH.lowSpeed) / (CH.blendSpeed - CH.lowSpeed), 0, 1);
    if (k < 1) { const w0 = c.v * FM.tan(delta) / L; c.yawRate = k * c.yawRate + (1 - k) * w0; c.vy = k * c.vy + (1 - k) * B_REAR * w0; }
    c.h += c.yawRate * h;
    c.x += (FM.cos(c.h) * c.v - FM.sin(c.h) * c.vy) * h;
    c.z += (FM.sin(c.h) * c.v + FM.cos(c.h) * c.vy) * h;
  }
  c.slideF = clamp(slideF, 0, 1); c.slideR = clamp(slideR, 0, 1); c.lockF = lockF; c.lockR = lockR; c.spinR = spinR; c.rearSpin = spinState.s;
  c.roll += c.v * dt / TUNING.WHEEL_RADIUS;
  if (TT) {
    const st = S.mass * G / 2;    // (crawling: the static loads)
    stepTyreTemps(TT, heatF / dt, heatR / dt, wheelN || [st * CH.frontWeight, st * CH.frontWeight, st * (1 - CH.frontWeight), st * (1 - CH.frontWeight)], speedOf(c), dt, S.flex);
    if (wheelN) TT.out = [outF, outR];
    tyreEvents(c, dt);
  }
}

// Angle between where the car points and where it is going (rad, + = sliding to the right).
/** @param {Car} c */
export const driftAngle = c => FM.atan2(c.vy, Math.max(Math.abs(c.v), 1));
