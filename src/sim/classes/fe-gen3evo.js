// Formula E, Gen3 Evo (car classes step 2: docs/formula-e-plan.md, 2026-11-07; the user's pick: today's car). Built on
// the F1 class: what differs from it is set here, the rest (suspension, dampers, differential, the AI's racecraft
// numbers) is the F1's until a stage of the plan gives it its own. Figures from the FIA / Formula E and the press
// (the plan's sources); ~ = our estimate where none was published.
// Done so far (stage 1): the electric powertrain (one gear, the motor drawn from the battery), mass, tyres' grip, aero,
// size. Still the F1's: the brakes (stage 2: regen, no rear hydraulics), the energy per race (stage 3), attack mode and
// AWD (stage 4), tyre temperatures and wear (stage 5), the AI's lines and paces (stage 6), the hitbox (the 3D model).
import { F1_2026 } from './f1-2026.js';

const F1 = F1_2026;
const TOP = 322;                      // km/h at the motor's max speed: the theoretical top speed (Wikipedia, FIA)

// The motor (vehicle.js electricDrive): the rear motor's power out of the battery, `race` 300 kW / `attack` 350 kW
// (qualifying, attack mode: stage 4), its torque up to the speed where that power takes over (constant power above),
// `maxRpm` at the top speed through its single gear (~: FE motors spin to ~20 000 rpm), `efficiency` battery → wheels.
// torque: ~ enough that the rear tyres, not the motor, limit a launch (Gen3: 0–60 mph ~2.8 s rear-wheel drive)
const MOTOR = Object.freeze({ race: 300, attack: 350, torque: 540, maxRpm: 20000, efficiency: 0.93 });

const CAR = Object.freeze({
  ...F1.car,
  mass: 840,                          // kg with driver (760 + 80)
  // Hankook iON all-weather tyres (grooved; the Evo's +5–10 % grip): below the F1's slicks (1.8) ~. 1.45 gave a 0–60 mph
  // of 3.4 s rear-wheel drive (the Gen3: just under 2.8 s): 1.55 → 3.0 s, the launch limited by the rears as the real car's
  grip: 1.55,
  aero: Object.freeze({
    ...F1.car.aero,
    liftArea: 1.6,                    // ~: downforce = the weight at ~330 km/h (the F1: ~185); "a fraction of F1's"
    dragArea: 0.73,                   // ~: 350 kW holds 322 km/h (the theoretical top speed) on an endless straight
  }),
  motor: MOTOR,
  // what the rest of the sim and the game read of an engine: no idle or clutch (an electric motor pulls from 0 rpm),
  // the dash's redline = the motor's top speed, the pedal's torque map as the F1's, no engine braking (stage 2: regen)
  engine: Object.freeze({ idle: 0, launch: 0, redline: MOTOR.maxRpm, limiter: MOTOR.maxRpm, pedalMap: F1.car.engine.pedalMap,
    engineBrake: 0, efficiency: MOTOR.efficiency }),
  // one gear (the teams' own single-speed boxes): no shifting; autoUp = the dash's shift light (never reached)
  gearbox: Object.freeze({ ...F1.car.gearbox, top: Object.freeze([0, TOP]), autoUp: MOTOR.maxRpm }),
});

const CHASSIS = Object.freeze({
  ...F1.chassis,
  wheelbase: 2.97, track: 1.5,        // ~: 5.0 m long, 1.7 m wide
  frontWeight: 0.43,                  // ~: the battery and the rear motor behind the driver
  cgHeight: 0.28, gyration: 1.15,     // ~: a little taller, a shorter car
  // the brakes (stage 2 replaces them: regeneration, front hydraulics only): the F1's scaled to these tyres for now
  brakeFull: 30, brakeSystem: 45,
});

// the garage: the gearing around its own top speed (stock = 322 km/h, so the stock car is the class's), the mass mod
// around its own mass
const SETUP = Object.freeze({ ...F1.setup, gearing: Object.freeze({ min: 290, max: 350, step: 2, def: TOP }) });
const MODS = Object.freeze({ ...F1.mods, mass: Object.freeze({ ...F1.mods.mass, def: CAR.mass }) });

// the battery (the hybrid's `ers` table: what the HUD, the car and the rest read): 38.5 kWh usable in a race (stage 3
// sizes it to the race's distance), full at the start; the MGU-K's own numbers don't apply (no hybrid deployment)
const ERS = Object.freeze({ ...F1.ers, store: 38.5 * 3.6e6, start: 1 });

// no fuel (the battery is its only energy): every fuel-use level is none
const WEAR = Object.freeze({ ...F1.wear, fuel: Object.freeze(Object.fromEntries(Object.keys(F1.wear.fuel).map(k => [k, 0]))) });

// no straight mode (Formula E has no moving wings): opening them changes nothing
const ACTIVE_AERO = Object.freeze({ ...F1.activeAero, dragCut: 0, downforceCut: 0 });

export const FE_GEN3_EVO = Object.freeze({
  ...F1,
  id: 'fe', name: 'Formula E (Gen3 Evo)',
  ranked: false,                      // not on the leaderboard until the class is finished
  car: CAR, chassis: CHASSIS, setup: SETUP, mods: MODS, ers: ERS, activeAero: ACTIVE_AERO, wear: WEAR,
});
