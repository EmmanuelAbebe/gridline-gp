// The player's and the AI's driving. Both use the same engine, gearbox, downforce and slipstream (vehicle.js); the
// player's car also has the tyre model (chassis.js). The AI still steers without tyre slip (next: AI on the chassis).
import { TUNING } from './tuning.js';
import { clamp, wrapA } from './math.js';
import { progress } from './race.js';
import { move, afterMove } from './motion.js';
import { stepChassis } from './chassis.js';
import { lateralGrip, brakeLimit, powertrain, slipstream } from './vehicle.js';

// inp: steer -1..1 (+ = right), thr 0..1, brk 0..1, analog = from a wheel/pad (faster steering response),
// shift = -1/0/+1 (paddles; used with the manual gearbox). The car itself is the tyre model in chassis.js.
export function drivePlayer(race, c, inp, dt) {
  const rate = inp.analog ? 14 : 5;
  c.steer += clamp(clamp(inp.steer, -1, 1) - c.steer, -dt*rate, dt*rate);
  c.brake = inp.brk;
  slipstream(race, c, progress);
  stepChassis(race, c, inp, dt);
  afterMove(race, c);
}

// Look-ahead steering toward the racing line, target speed = profile × skill, simple car-ahead avoidance.
// The speed profile only limits corners and braking zones; on straights the engine and drag set the speed.
// skillOverride (0 = use the car's own) lets the game slow finished cars or drive the player car in tests.
export function driveAI(race, c, dt, skillOverride = 0) {
  const T = race.track, { N, HW, ds, PX, PZ, NX, NZ, VP, RO } = T, AI = TUNING.AI;
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
  const yawMax = lateralGrip(c.v) * AI.grip * AI.yaw / Math.max(c.v, 4);
  c.h += clamp(diff * 4, -yawMax, yawMax) * Math.min(1, c.v/4 + 0.25) * dt;
  c.steer = clamp(diff*2.2, -1, 1);
  slipstream(race, c, progress);
  // full throttle below the target, braking above it; speed never crosses the target so it doesn't oscillate
  const accel = c.v < targetV;
  const a = powertrain(c, { thr: accel ? 1 : 0, brk: accel ? 0 : 1, shift: 0 }, dt);
  if (accel) c.v = Math.min(targetV, c.v + Math.max(0, a) * dt);
  else c.v = Math.max(targetV, c.v - brakeLimit(c.v) * AI.brake * dt);
  c.brake = accel ? 0 : 1;
  if (c.offTrack) c.v -= c.v * 0.8 * dt;
  move(race, c, dt);
}
