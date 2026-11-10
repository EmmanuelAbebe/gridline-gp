// Formula E, Gen3 Evo (car classes step 2: docs/formula-e-plan.md, 2026-11-07; the user's pick: today's car). Built on
// the F1 class: what differs from it is set here, the rest (suspension, dampers, differential, the AI's racecraft
// numbers) is the F1's until a stage of the plan gives it its own. Figures from the FIA / Formula E and the press
// (the plan's sources); ~ = our estimate where none was published.
// Done so far (stage 1): the electric powertrain (one gear, the motor drawn from the battery), mass, tyres' grip, aero,
// size; the brakes = regeneration (stage 2); the race's energy (stage 3); attack mode and the AWD start (stage 4); the tyres (stage 5); the AI (stage 6). Still the F1's: the hitbox (the 3D model).
import { F1_2026 } from './f1-2026.js';
import { RACING_LINES, ALIEN_LINES } from '../racing-lines-fe.js';

const F1 = F1_2026;
const TOP = 322;                      // km/h at the motor's max speed: the theoretical top speed (Wikipedia, FIA)

// The motor (vehicle.js electricDrive): the rear motor's power out of the battery, `race` 300 kW / `attack` 350 kW
// (qualifying, attack mode: stage 4), its torque up to the speed where that power takes over (constant power above),
// `maxRpm` at the top speed through its single gear (~: FE motors spin to ~20 000 rpm), `efficiency` battery → wheels.
// torque: ~ enough that the rear tyres, not the motor, limit a launch (Gen3: 0–60 mph ~2.8 s rear-wheel drive)
// regen (stage 2, chassis.js): the motors brake the car and charge the battery: `rear` 350 kW = the rear's only brake (no
// rear hydraulics), `front` 250 kW before the front hydraulics take the rest; force = P / v, so at speed the rear does
// little and the balance moves forward; below `minSpeed` m/s as at it (the motor's torque caps it); `efficiency` of the
// braking power reaches the battery ~; lifting off the throttle: `coast` kW, at most `coastMax` m/s² ~ (the F1's)
// the front motor (stage 4: attack mode, the start): up to `frontKw` and `frontTorque` ~ of the drive on the front wheels
// (the total stays race / attack kW)
const MOTOR = Object.freeze({ race: 300, attack: 350, torque: 540, maxRpm: 20000, efficiency: 0.93, frontKw: 250, frontTorque: 360,
  regen: Object.freeze({ front: 250, rear: 350, efficiency: 0.9, minSpeed: 5, coast: 120, coastMax: 1.0 }) });

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
  // the brakes: full pedal asks about what the tyres hold near the top speed (as the F1's: ~23 m/s² at 290 km/h; the F1
  // 46 at 300), brakeSystem = the most the plans count on; the rear's part is the rear motor's regen (motor.regen)
  brakeFull: 23, brakeSystem: 35,
});

// the garage: the gearing around its own top speed (stock = 322 km/h, so the stock car is the class's), the mass mod
// around its own mass
const SETUP = Object.freeze({ ...F1.setup, gearing: Object.freeze({ min: 290, max: 350, step: 2, def: TOP }) });
const MODS = Object.freeze({ ...F1.mods, mass: Object.freeze({ ...F1.mods.mass, def: CAR.mass }) });

// the battery (the hybrid's `ers` table: what the HUD, the car and the rest read): 38.5 kWh usable in a race (stage 3
// sizes it to the race's distance), full at the start; the MGU-K's own numbers don't apply (no hybrid deployment)
// (capacity: the whole pack, 47 kWh: regeneration can put energy back above the race's usable 38.5)
const ERS = Object.freeze({ ...F1.ers, store: 38.5 * 3.6e6, start: 1, capacity: 47 * 3.6e6 });

// no fuel (the battery is its only energy): every fuel-use level is none
// tyre wear (stage 5): laps until worn out 4× the F1's (normal 40 ~: a set lasts the race; high wear 20) and less grip lost
// when worn (`drop`, ~: a hard all-weather compound)
const WEAR = Object.freeze({ ...F1.wear, fuel: Object.freeze(Object.fromEntries(Object.keys(F1.wear.fuel).map(k => [k, 0]))),
  tyres: Object.freeze(Object.fromEntries(Object.entries(F1.wear.tyres).map(([k, v]) => [k, v * 4]))), drop: 0.1 });

// The tyres (stage 5): Hankook iON all-weather (grooved, one specification for the season: dry or wet), no tyre
// blankets: a set starts at the air's temperature (start, every stop), warms into a lower, wider window than a slick's
// (~: none published; measured: VOS on the F1's heat model settles at 75–100 °C), loses less grip cold (an all-weather
// compound is made to work cold ~), and the fronts are nearly the rears' size (Gen3 ~: 0.9 of a rear's heat capacity)
const TYRE_TEMP = Object.freeze({ ...F1.tyreTemp, blanket: F1.tyreTemp.air, window: Object.freeze([55, 100]),
  cold: Object.freeze({ loss: 0.15, scale: 40 }), front: 0.9 });
// one compound for the race (FE: no choice of tyre): under the F1's 'medium' name, so a garage's strategy, the pit box
// and the HUD work as they are (the game names it ALL-WEATHER); it lasts a whole E-Prix (~: a set does qualifying and the
// race) and wears very little
const COMPOUNDS = Object.freeze({ medium: Object.freeze({ grip: 1, life: 1, window: TYRE_TEMP.window }) });

// no straight mode (Formula E has no moving wings): opening them changes nothing
const ACTIVE_AERO = Object.freeze({ ...F1.activeAero, dragCut: 0, downforceCut: 0 });

// The race's energy (stage 3, energy.js): the allowance = laps × a flat-out lap's net energy (energy.js measures one) ×
// `budget` ~ (the drivers save the rest). The saving moves `savePerLap` × the share of a lap's energy a lap takes above
// the allowance left per lap: its first `cutShare` = up to `maxCut` less power, the rest = lifting up to `maxLift` m
// before braking points too (only faster than `liftFrom` m/s); aiming for the flag with `reserve` of the allowance left
// (a time trial: each lap `trial` × a flat-out lap, a qualifying lap with energy to spare)
const ENERGY = Object.freeze({ trial: 1.25, budget: 0.93, maxLift: 250, cutShare: 0.5, maxCut: 0.3, savePerLap: 1.5, reserve: 0.03, liftFrom: 25 });

// Attack mode (stage 4, attack.js): `uses` activations, `share` of the race in all (8 minutes of a ~45-minute race), from
// lap `fromLap`; the front motor drives at the start until `start` m/s ~. The activation zone: the outside of a slow corner's
// apex (`minV`..`maxV` m/s on the line, the line within `inside` of the half-width of its inside edge, `clear` m from the
// line and the pit roads), three loops over `length` m, each crossed `lat` of the half-width past the middle (within
// `window` samples); the AI aims `aim` m past that from `ahead` m before it (at most `slow` × its line's apex speed until
// `exit` m past the zone), decides `ai.decide` m before it: armed when
// nobody is within `ai.safeGap` s behind or with no more than `ai.each` × uses + `ai.spare` laps left
const ATTACK = Object.freeze({ share: 8 / 45, uses: 2, fromLap: 2, start: 100 / 3.6,
  zone: Object.freeze({ length: 24, lat: 0.3, inside: 0.4, minV: 14, maxV: 40, clear: 250, window: 3, aim: 2.0, ahead: 180, slow: 0.92, exit: 30 }),
  ai: Object.freeze({ safeGap: 1.5, decide: 300, each: 1.5, spare: 1 }) });

// ALIEN paces (stage 6): the most that stays clean, the fastest driver alone in a 5-lap race (energy, attack mode); with
// medium assists / none. Its laps match the lap model's on its line (Elkmoor 49.6 s vs 49.5). Without assists two
// circuits hold it back: Cobalt Bay 0.96 (into the attack zone at a hairpin's apex, held on the outside it turns late
// while braking, and spins), Cantera 0.96 (its corkscrew's crest)
// (2026-11-09: lock-ups build up (CHASSIS.lock), so it brakes better without ABS: Northfold 1.12 → 1.10 (it cut a
// corner), Harrow 1.06 → 1.04 (walls))
const ALIEN = Object.freeze({
  pace: Object.freeze({ default: 1.06, elkmoor: 1.02, harrow: 1.04, marrow: 1.08, northfold: 1.08, hautvale: 1.04, cantera: 1.04, ironpark: 1.10 }),
  paceOff: Object.freeze({ default: 1.04, elkmoor: 1.00, harrow: 1.04, cobalt: 0.96, marrow: 1.08, northfold: 1.10, cantera: 0.96, ironpark: 1.06 }),
});
// The AI on this car (stage 6): its own time-optimal lines (racing-lines-fe.js: npm run lap-optimum -- <circuit>
// --class=fe --write-line / --write-alien, the F1's margins); defending only into corners slower than `defendBelow`
// (~150 km/h: on these tyres a car covering the inside of a fast corner was 5 m off its line when the move ended, too
// fast for where it was, and ran wide: the whole field at Saltcross's and Hautvale's first fast corners on lap 1);
// off its line the speed from the road's curve there (`offRoad`: passing round the outside of those corners, held at the
// road's edge 10 m from its line, it planned the line's speed and ran wide); its mistakes half the F1's (`mistakeK`: a
// 5 % late brake while passing in the pack slid it straight on at Elkmoor and Cantera; on the F1's grip it is caught); the ALIEN without ABS plans its
// braking with the hold-back its feet keep after a lock (`alienHold`)
const AI_CAR = Object.freeze({ ...F1.ai, alien: ALIEN, lines: Object.freeze({ racing: RACING_LINES, alien: ALIEN_LINES }), defendBelow: 150 / 3.6,
  offRoad: true, mistakeK: 0.5, alienHold: true });

export const FE_GEN3_EVO = Object.freeze({
  ...F1,
  id: 'fe', name: 'Formula E (Gen3 Evo)',
  ranked: false,                      // not on the leaderboard until the class is finished
  car: CAR, chassis: CHASSIS, setup: SETUP, mods: MODS, ers: ERS, activeAero: ACTIVE_AERO, wear: WEAR, energy: ENERGY, attack: ATTACK, tyreTemp: TYRE_TEMP, compounds: COMPOUNDS, ai: AI_CAR,
});
