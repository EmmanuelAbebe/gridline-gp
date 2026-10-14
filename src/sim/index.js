// SIM: track geometry, driving model and race rules.
// Pure JS (no DOM, no Three.js) so it also runs headless in Node: tools/sim-test.mjs, tests/.
// Units are SI throughout: metres, seconds, m/s, m/s².
import { TUNING, CAR, SLIP, ASSISTS, CHASSIS, EV } from './tuning.js';
import { steerLock, tyreCurve, driftAngle } from './chassis.js';
import { CIRCUITS } from './circuits.js';
import { DRIVERS } from './drivers.js';
import { clamp, wrapA } from './math.js';
import { buildTrack, gridSlot, headingAt, DEFAULT_TRACK } from './track.js';
import { createRace, order, gapTo, progress } from './race.js';
import { drivePlayer, driveAI } from './driving.js';
import { collide } from './collide.js';
import { rpmAt, cornerSpeed, lateralGrip, brakeLimit, wakeHalfWidth, VEHICLE_INFO } from './vehicle.js';

export const SIM = Object.freeze({ TUNING, CAR, SLIP, ASSISTS, CHASSIS, CIRCUITS,
  steerLock, tyreCurve, driftAngle, DRIVERS, EV, track: DEFAULT_TRACK,
  rpmAt, cornerSpeed, lateralGrip, brakeLimit, wakeHalfWidth, VEHICLE: VEHICLE_INFO,
  buildTrack, gridSlot, headingAt, createRace, drivePlayer, driveAI, collide, order, gapTo, progress, clamp, wrapA });
