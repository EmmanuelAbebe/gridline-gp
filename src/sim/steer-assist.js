// Steering assist for a phone or a pad (2026-11-09; user: their old phone wheel felt better in two browser games, both
// of which limit a pad's steering; LibreCorsa's is this one). Adapted from LibreCorsa's steering-assist.ts
// (github.com/KhazP/librecorsa, MIT, © 2026 KhazP), itself adapted from AC-Advanced-Gamepad-Assist v1.5.5 by Adam D.
// (github.com/adam10603/AC-Advanced-Gamepad-Assist, MIT): see CREDITS.md.
//
// A phone or a stick has a few centimetres of travel and no force feedback: nothing tells the driver the fronts are at
// their limit, the way a real steering wheel goes light. So:
// - full travel = the road-wheel angle that puts the front tyres just under their peak slip angle relative to the
//   front axle's direction of travel (at any speed, on the brakes too), not the full lock;
// - self-steer: the wheels turn toward the rear axle's direction of travel, with yaw damping, in full when the
//   controller is centred and fading out as the driver steers (a real wheel self-aligning when the hands relax);
// - countersteer: steering into a slide aims at the rear axle's travel plus a margin, not opposite lock;
// - yaw guard: when the car already rotates toward the steering side faster than its grip can turn it, the limit
//   shrinks (else a held countersteer becomes a tank-slapper when the rear grips again).
// Left out (2026-11-09): their stick smoother (the user drives with no in-game smoothing on controllers), the keyboard's
// parts, and learning the peak slip angle from the tyres (ours is the tyre data's exactly: spec.peakF).
// The car and its tyres are unchanged: drivePlayer runs it on an analog controller's steering when inp.padAssist names
// a preset (STEER_ASSIST); the state lives on the car (c.sa), so replays drive it again bit for bit.
import { ASSISTS, STEER_ASSIST } from './tuning.js';
import { steerLock, chassisOf } from './chassis.js';
import { lateralGrip } from './vehicle.js';
import { clamp } from './math.js';
import { M as FM } from './fmath.js';

/** @typedef {import('./types.js').Car} Car */

const D = 180 / Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;
const lis = (v, a, b) => clamp((v - a) / (b - a), 0, 1);            // where v is between a and b, 0..1
const spow = (x, y) => Math.sign(x) * FM.pow(Math.abs(x), y);

// clamp with a quadratic ease into the bounds over `window` (a share of the range)
function clampEased(v, lo, hi, window) {
  const w = window * (hi - lo), half = w * 0.5;
  if (v < lo - half) return lo;
  if (v > hi + half) return hi;
  if (v < lo + half) { const t = (v - (lo - half)) / w; return lo + t * t * half; }
  if (v > hi - half) { const t = (v - (hi - half) - w) / w; return hi - t * t * half; }
  return v;
}
// st[k] toward target at a rate proportional to the distance left, blended with a constant rate by `lin` (1 = linear);
// rates per second over `range`
function smooth(st, k, target, dt, rate, lin, range, mult = 1) {
  const l2 = lin * lin, r = rate * mult / (1 - 1 / (l2 + 1 / 0.75)) * 0.5, diff = Math.abs(target - st[k]) / range;
  st[k] += Math.sign(target - st[k]) * Math.min(diff, dt * (diff * (1 - l2) + l2) * r) * range;
  return st[k];
}

// the wheels' own angle (deg, toward the side the rear slides to) for the rear axle travelling rearDeg off the heading
function selfSteerDeg(rearDeg, P, lockDeg) {
  const cap = Math.min(lockDeg, P.maxSelfDeg);
  return clampEased(spow(clamp(rearDeg / 72, -1, 1), P.exponent) * 72, -cap, cap, 1);
}

export { STEER_ASSIST };

/** The steering share (−1..1 of the car's lock, + = right) for the controller's share `s`, with preset P.
 * @param {Car} c @param {number} s @param {any} P @param {number} dt */
export function steerAssist(c, s, P, dt) {
  const S = c.spec, { L, A_FRONT, B_REAR } = chassisOf(S.cls), A = c.assists || ASSISTS.medium;
  const st = c.sa || (c.sa = { self: 0, limit: 32, counter: 0 });
  const v = c.v, vy = c.vy, w = c.yawRate, speed = FM.hypot(v, vy);
  const lockDeg = steerLock(v, A.steer, S) * D, wb = L / 2.5, sign = Math.sign(s);
  // the axles' directions of travel in the car's frame (deg, + = moving to the right)
  const vx = Math.abs(v), vF = vy + A_FRONT * w, vR = vy - B_REAR * w;
  const frontDeg = FM.atan2(vF, vx) * D, rearDeg = FM.atan2(vR, vx) * D;
  const fadeIn = lis(FM.hypot(v, vF), 2 * wb, 6 * wb), midFade = lis(speed, 10 * wb, 20 * wb);
  const peakDeg = S.peakF * D;

  // self-steer: the wheels follow the rear axle's travel, plus yaw damping (a fraction of it in the air)
  const damping = -w * P.damping * 0.15 * (30 / lockDeg);
  const self = clamp(smooth(st, 'self', selfSteerDeg(rearDeg, P, lockDeg) / lockDeg + damping, dt, 7, 0.13, 2), -2, 2) * (c.air ? 0.25 : 1) * fadeIn;

  // the limit that keeps the fronts just under their peak slip angle
  const targetSlip = peakDeg * P.targetSlip;
  const maxCut = lerp(targetSlip * 0.4, targetSlip * 0.75, clamp(P.maxCut / 10, 0, 1));
  const sub = lerp(maxCut, maxCut * 0.9, c.brake);
  // the front axle's travel *away* from the steering side (outward = +)
  const frontAway = clampEased(-sign * frontDeg, -lockDeg - 15, sub, sub * 0.4 / (lockDeg + 15 + sub));

  // countersteering: steering toward the side the rear slides to (0 under ~2.9° of rear slide, 1 past ~11.6°)
  const counterNow = Math.abs(s) > 1e-6 && sign === Math.sign(vR);
  const rawCounter = counterNow ? clampEased((Math.abs(rearDeg) - 4.5) / 5.5, 0, 1, 0.6) : 0;
  const back = lerp(0.8, 0.3, lis(Math.abs(frontDeg - rearDeg), 2, 10));
  const counter = smooth(st, 'counter', rawCounter, dt, 12, 1, 1, rawCounter < st.counter ? back : 1) * midFade;
  const rearToward = sign * rearDeg;                          // the rear axle's travel on the steering side
  const counterK = lerp(lis(rearToward, 0, 30) / 3 + 2 / 3, 1, P.counter);
  // yaw guard: less limit by the steering the rotation beyond the grip's corresponds to
  const yawTo = sign * w, maxYaw = 1.1 * lateralGrip(speed, S) / Math.max(5, speed);
  const yawExcess = Math.max(0, yawTo - maxYaw) * L * D / Math.max(5, speed);
  const inward = targetSlip - frontAway - 2.5 * yawExcess;
  // countersteer: line up with the rear axle's travel (+ a margin), never past the fronts' peak (on a quick flick the
  // rear still slides from the last turn and would read as a slide to catch)
  const counterTo = Math.min(targetSlip * (P.counter * counterK * 0.7 + 0.1) + rearToward, inward);
  const target = lerp(clamp(inward, 0, lockDeg), clamp(counterTo, 0, lockDeg), counter);
  // no limit travelling sideways or backwards
  const travel = FM.atan2(vy, v) * D, notForward = FM.pow(FM.sin(clamp(travel * 2 / 3 / D, -Math.PI / 2, Math.PI / 2)), 16);
  const limit = lerp(smooth(st, 'limit', target, dt, 11, 0.01, 32) / lockDeg, 1, notForward);

  const out = clamp(s * limit + self - Math.abs(s) * self, -1, 1);
  return clamp(lerp(s, out, fadeIn), -1, 1);
}
