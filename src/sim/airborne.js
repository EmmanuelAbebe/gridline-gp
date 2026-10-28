// A car in the air (AIR in tuning.js): launched over another car's wheel (collide.js), flying as a rigid body (height,
// pitch, roll; the tyres give nothing), landing on its wheels (damage) or on its side / roof (stuck until the marshals
// put it back). c.air is null on the ground: then nothing here runs.
import { AIR, EV } from './tuning.js';
import { addDamage } from './pit.js';
import { emit } from './events.js';
import { wrapA } from './math.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

const G = 9.81;
/** @typedef {{ y: number, vy: number, pitch: number, roll: number, pr: number, rr: number }} Air */

// an upward impulse `up` (m/s per unit mass) at (along, right) m from the centre of mass, in the car's frame: off the
// ground only if it lifts the car faster than AIR.min (less is the suspension's to take)
/** @param {Car} c */
export function lift(c, up, along, right) {
  const a = c.air || { y: 0, vy: 0, pitch: 0, roll: 0, pr: 0, rr: 0 };
  const vy = a.vy + up, pr = a.pr + AIR.turn * up * along / (AIR.pitchK * AIR.pitchK), rr = a.rr - AIR.turn * up * right / (AIR.rollK * AIR.rollK);
  if (!c.air && vy < AIR.min) return;
  if (!c.air) emit(c, EV.LAUNCHED, { up });
  c.air = Object.assign(a, { vy, pr, rr });
}

// one step in the air (stepChassis, instead of the tyres): drag slows it, gravity and the downforce (lift once the
// nose is up) move it up and down, it turns as it was turning; then the landing
/** @param {Race} race @param {Car} c */
export function stepAir(race, c, resist, dt) {
  const a = c.air, S = c.spec, sp = Math.hypot(c.v, c.vy);
  if (sp > 0.1) { const k = Math.max(0, 1 - resist * dt / sp); c.v *= k; c.vy *= k; }
  c.h += c.yawRate * dt; c.yawRate *= 1 - AIR.damp * dt;
  c.x += (Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy) * dt; c.z += (Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy) * dt;
  // downforce (per mass), down while level, lift once pitched nose-up past liftFrom (all of it as lift by liftAt)
  const df = S.dfK * c.v * c.v * Math.max(0, Math.cos(a.roll)), tilt = Math.min(1, Math.max(0, (a.pitch - AIR.liftFrom) / (AIR.liftAt - AIR.liftFrom)));
  a.vy += (-G - df * (1 - (1 + AIR.lift) * tilt)) * dt;
  a.y += a.vy * dt; a.pitch += a.pr * dt; a.roll += a.rr * dt;
  a.pr *= 1 - AIR.damp * dt; a.rr *= 1 - AIR.damp * dt;
  c.ax = c.ay = 0; c.slideF = c.slideR = 0;
  if (a.y > 0 || a.vy > 0) return;
  // down: on its wheels or not
  const speed = -a.vy, flipped = Math.abs(wrapA(a.pitch)) > AIR.flipAt || Math.abs(wrapA(a.roll)) > AIR.flipAt;
  c.air = null;
  emit(c, EV.LANDED, { impact: speed, flipped });
  addDamage(race, c, speed * AIR.land * (flipped ? 3 : 1), 0, 1, AIR.landSusp * AIR.land);
  if (flipped) {
    // lying on its side or its back until the marshals right it (car.js updateBeached): the nearest quarter turn
    const q = t => Math.round(wrapA(t) / (Math.PI / 2)) * (Math.PI / 2);
    c.upset = { pitch: q(a.pitch), roll: q(a.roll) };
    c.beached = true; c.beachedAt = race.t; c.v = c.vy = c.yawRate = 0; emit(c, EV.BEACHED, { flipped: true });
  }
}
