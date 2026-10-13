// The player's and the AI's driving models.
import { TUNING } from './tuning.js';
import { clamp, wrapA } from './math.js';
import { progress } from './race.js';
import { move } from './motion.js';

// Shared by every car: engine push minus aero drag. Settles at VMAX·√thr, so full throttle tops out at VMAX.
const powertrain = (v, thr) => TUNING.ACC * (thr - (v / TUNING.VMAX) ** 2);

// inp: steer -1..1 (+ = right), thr 0..1, brk 0..1, analog = from a wheel/pad (faster steering response)
export function drivePlayer(race, c, inp, dt) {
  const { VMAX, LAT_P, BRK_P, REVERSE_MAX } = TUNING;
  const rate = inp.analog ? 14 : 5;
  c.steer += clamp(clamp(inp.steer, -1, 1) - c.steer, -dt*rate, dt*rate);
  const sp = Math.abs(c.v);
  const yaw = c.steer * Math.min(1.5, LAT_P / Math.max(sp, 4)) * Math.min(1, sp/6) * Math.sign(c.v || 1);
  c.h += yaw * dt;
  let a = 0;
  const thr = inp.thr, brk = inp.brk, coasting = thr < 0.02 && brk < 0.02;
  const driving = thr > 0 && c.v >= 0;
  if (thr > 0) a += driving ? powertrain(c.v, thr) : BRK_P * thr;   // gas while rolling backwards acts as a brake
  if (brk > 0) a -= c.v > 0.5 ? BRK_P * brk : 5 * brk;
  // engine braking / drag when not on the gas (on the gas, drag is already inside powertrain)
  if (!driving) a -= Math.sign(c.v) * (coasting ? 0.9 + 0.0011*c.v*c.v : 0.15 + 0.0004*c.v*c.v);
  if (c.offTrack) a -= c.v * 1.25;
  c.v = clamp(c.v + a*dt, -REVERSE_MAX, VMAX);
  if (coasting && Math.abs(c.v) < 0.3) c.v = 0;
  move(race, c, dt);
}

// Look-ahead steering toward the racing line, target speed = profile × skill, simple car-ahead avoidance.
// skillOverride (0 = use the car's own) lets the game slow finished cars or drive the player car in tests.
export function driveAI(race, c, dt, skillOverride = 0) {
  const { LAT_AI, BRK_AI } = TUNING, T = race.track, { N, HW, ds, PX, PZ, NX, NZ, VP, RO } = T;
  const skill = skillOverride || c.skill;
  const ti = (c.idx + Math.round((9 + c.v*0.42) / ds)) % N;
  let off = RO[ti] + c.bias;
  let targetV = Math.min(VP[(c.idx+2)%N], VP[(c.idx+6)%N]) * skill;
  const myP = progress(race, c);
  for (const o of race.cars) {
    if (o === c) continue;
    const gap = (progress(race, o) - myP) * ds;
    if (gap > 0 && gap < 16 && Math.abs(o.lat - c.lat) < 2.8) {
      const room = o.lat > 0 ? o.lat - 3.8 : o.lat + 3.8;
      off = clamp(room, -(HW-1.6), HW-1.6);
      if (Math.abs(off - c.lat) > 1.2 || Math.abs(o.lat - c.lat) < 2.2) targetV = Math.min(targetV, o.v + gap*0.25);
    }
  }
  off = clamp(off, -(HW-1.5), HW-1.5);
  c.offset += (off - c.offset) * Math.min(1, dt*1.6);
  const tx = PX[ti] + NX[ti]*c.offset, tz = PZ[ti] + NZ[ti]*c.offset;
  const diff = wrapA(Math.atan2(tz - c.z, tx - c.x) - c.h);
  const yawMax = LAT_AI * 1.15 / Math.max(c.v, 4);
  c.h += clamp(diff * 4, -yawMax, yawMax) * Math.min(1, c.v/4 + 0.25) * dt;
  c.steer = clamp(diff*2.2, -1, 1);
  if (c.v < targetV) c.v = Math.min(targetV, c.v + powertrain(c.v, 1) * dt * (0.6 + 0.4*skill));
  else c.v = Math.max(targetV, c.v - BRK_AI * 1.25 * dt);
  if (c.offTrack) c.v -= c.v * 0.8 * dt;
  move(race, c, dt);
}
