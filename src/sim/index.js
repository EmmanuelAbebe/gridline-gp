// SIM: track geometry, driving model and race rules.
// Pure JS (no DOM, no Three.js) so it also runs headless in Node: tools/sim-test.mjs, tests/.
// Units are SI throughout: metres, seconds, m/s, m/s².
import { TUNING, AI, CONTACT, LIMITS, SLIP, ASSISTS, EV, SURFACES, OFFTRACK, WALLS, RUNOFF, BARRIER, BARRIERS, ZONE, PIT, SPEED_STEER, ELEVATION, SECTORS } from './tuning.js';
// the F1's tables under their old names (the game reads them: car classes stage 6)
import { HITBOX, CAR, CHASSIS, WEAR, SETUP, MODS, ACTIVE_AERO, OVERTAKE, ERS, HANDBRAKE, TYRE_TEMP, COMPOUNDS, ECU } from './classes/f1-2026.js';
import { buildSectors } from './sectors.js';
import { carSpec, STOCK, stockOf, validSetup, validMods, isModified } from './spec.js';
import { CLASSES, DEFAULT_CLASS, classOf } from './classes/index.js';
import { aiOf } from './ai-profile.js';
import { specStats, balanceAt } from './spec-stats.js';
import { surfaceAt } from './runoff.js';
import { fuelLaps, lapsToGo, fitTyres, bestCompound, carCondition, laneCentre, laneOuter, alongLane, serviceSteps } from './pit.js';
import { steerLock, tyreCurve, driftAngle } from './chassis.js';
import { CIRCUITS } from './circuits.js';
import { DRIVERS } from './drivers.js';
import { clamp, wrapA, wrapIdx, smoothstep, speedOf } from './math.js';
import { buildTrack, gridSlot, headingAt, DEFAULT_TRACK } from './track.js';
import { createRace, order, gapTo, progress, raceTime } from './race.js';
import { drivePlayer, driveAI, calmSteer, speedSteer } from './driving.js';
import { collide, carGap } from './collide.js';
import { gapAhead, setAeroZones, aeroZonesInMetres, zoneRisk, aeroSafeOf, aiAeroPlan } from './active-aero.js';
import { surfaceY, samplePos, cornerSpeedAt, brakeLimitAt } from './elevation.js';
import { rpmAt, cornerSpeed, lateralGrip, brakeLimit, brakeMax, tyreGrip, wakeHalfWidth, VEHICLE_INFO, vehicleInfo } from './vehicle.js';

import { tyreSet, tempGrip, axleTempGrip, gripTemp } from './tyre-temp.js';
import { STRATEGY, AIR } from './tuning.js';
import { hitboxFrom, HITBOX_FIT } from './hitbox.js';
import { REPLAY, quantizeInput, createReplayRecorder, replayRun } from './replay.js';
import { SIM_VERSION } from './sim-version.js';
import { ecuMapOf, gapBehind } from './ecu.js';
export const SIM = Object.freeze({ SIM_VERSION, ECU, ecuMapOf, gapBehind, REPLAY, quantizeInput, createReplayRecorder, replayRun, TYRE_TEMP, COMPOUNDS, STRATEGY, AIR, hitboxFrom, HITBOX_FIT, fitTyres, bestCompound, tyreSet, tempGrip, axleTempGrip, gripTemp, TUNING, AI, CONTACT, HITBOX, LIMITS, CAR, SLIP, ASSISTS, CHASSIS, HANDBRAKE, SPEED_STEER, CIRCUITS,
  SURFACES, OFFTRACK, WALLS, RUNOFF, BARRIER, BARRIERS, ZONE, surfaceAt, PIT, WEAR, fuelLaps, lapsToGo, carCondition, laneCentre, laneOuter, alongLane, serviceSteps,
  steerLock, tyreCurve, driftAngle, DRIVERS, EV, track: DEFAULT_TRACK,
  SETUP, MODS, ACTIVE_AERO, OVERTAKE, ERS, gapAhead, setAeroZones, aeroZonesInMetres, zoneRisk, aeroSafeOf, aiAeroPlan, carSpec, STOCK, stockOf, CLASSES, DEFAULT_CLASS, classOf, aiOf, validSetup, validMods, isModified, specStats, balanceAt,
  rpmAt, cornerSpeed, lateralGrip, brakeLimit, brakeMax, tyreGrip, wakeHalfWidth, VEHICLE: VEHICLE_INFO, vehicleInfo,
  ELEVATION, SECTORS, buildSectors, surfaceY, samplePos, cornerSpeedAt, brakeLimitAt,
  buildTrack, gridSlot, headingAt, createRace, drivePlayer, driveAI, calmSteer, speedSteer, collide, carGap, order, gapTo, progress, raceTime, clamp, wrapA, wrapIdx, smoothstep, speedOf });
