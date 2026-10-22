// SIM: track geometry, driving model and race rules.
// Pure JS (no DOM, no Three.js) so it also runs headless in Node: tools/sim-test.mjs, tests/.
// Units are SI throughout: metres, seconds, m/s, m/s².
import { TUNING, AI, CONTACT, LIMITS, CAR, SLIP, ASSISTS, CHASSIS, EV, SURFACES, OFFTRACK, WALLS, RUNOFF, BARRIER, BARRIERS, ZONE, PIT, WEAR, SETUP, MODS, ACTIVE_AERO, OVERTAKE, HANDBRAKE, SPEED_STEER } from './tuning.js';
import { carSpec, STOCK, validSetup, validMods, isModified } from './spec.js';
import { specStats, balanceAt } from './spec-stats.js';
import { surfaceAt } from './runoff.js';
import { fuelLaps, lapsToGo, carCondition, laneCentre, laneOuter, alongLane, serviceSteps } from './pit.js';
import { steerLock, tyreCurve, driftAngle } from './chassis.js';
import { CIRCUITS } from './circuits.js';
import { DRIVERS } from './drivers.js';
import { clamp, wrapA, wrapIdx, smoothstep, speedOf } from './math.js';
import { buildTrack, gridSlot, headingAt, DEFAULT_TRACK } from './track.js';
import { createRace, order, gapTo, progress, raceTime } from './race.js';
import { drivePlayer, driveAI, calmSteer, speedSteer } from './driving.js';
import { collide, carGap } from './collide.js';
import { gapAhead } from './active-aero.js';
import { rpmAt, cornerSpeed, lateralGrip, brakeLimit, wakeHalfWidth, VEHICLE_INFO } from './vehicle.js';

export const SIM = Object.freeze({ TUNING, AI, CONTACT, LIMITS, CAR, SLIP, ASSISTS, CHASSIS, HANDBRAKE, SPEED_STEER, CIRCUITS,
  SURFACES, OFFTRACK, WALLS, RUNOFF, BARRIER, BARRIERS, ZONE, surfaceAt, PIT, WEAR, fuelLaps, lapsToGo, carCondition, laneCentre, laneOuter, alongLane, serviceSteps,
  steerLock, tyreCurve, driftAngle, DRIVERS, EV, track: DEFAULT_TRACK,
  SETUP, MODS, ACTIVE_AERO, OVERTAKE, gapAhead, carSpec, STOCK, validSetup, validMods, isModified, specStats, balanceAt,
  rpmAt, cornerSpeed, lateralGrip, brakeLimit, wakeHalfWidth, VEHICLE: VEHICLE_INFO,
  buildTrack, gridSlot, headingAt, createRace, drivePlayer, driveAI, calmSteer, speedSteer, collide, carGap, order, gapTo, progress, raceTime, clamp, wrapA, wrapIdx, smoothstep, speedOf });
