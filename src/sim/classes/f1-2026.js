// The 2026 Formula 1 car: the first car class (docs/car-classes-plan.md, 2026-11-06). Everything here belongs to the
// car, not the world (surfaces, run-off, hills, limits, pit lane, contact solver and assists stay in tuning.js). Moved
// from tuning.js unchanged; the tables keep their names and shapes, and F1_2026 at the end gathers them as one class.
// Tuned only on this car (check them when making another class): AI_CAR.feel's learnt brake share (0.8 … 1.05),
// CHASSIS.spin.mass (car mass / ~100 kg), calmLateral, steerMargin, ERS / ECU (the 2026 power unit), the ALIEN paces
// and racing lines (AI_CAR), and tuning.js AI's line margins (lineMargin, lineEdge, alien.lineEdge: the car's width).
import { RACING_LINES, ALIEN_LINES } from '../racing-lines.js';

// Car contact (collide.js, 2026-10-28; user: "real physics collision … a hit box relatively close to the body of the
// car"). HITBOX = the car seen from above as convex parts, [along, right] m from the car's origin (under the middle of
// the wheelbase), measured from car.glb (tests/models.test.js holds them to its body and tyres): front wing (tapering to
// the nose tip), nose, tyres, sidepods + cockpit, engine cover, the rear (diffuser, crash structure, rear wing). A part
// with `mirror` has a twin on the left. kind: what it is made of and what breaks: wing (front wing damage), tyre (rubber:
// grips and bounces more; a hard hit bends the suspension), body (carbon). Contacts mix mu as √(a·b) and the bounce as
// the larger (as Box2D). 5.44 m long, 1.88 m wide (the 2026 rules: 1.90 m).
export const HITBOX = Object.freeze({
  parts: [
    { name: 'front wing', kind: 'wing', mirror: true, pts: [[2.05, 0], [2.95, 0], [2.95, 0.19], [2.85, 0.45], [2.75, 0.68], [2.6, 0.9], [2.05, 0.9]] },
    { name: 'nose', kind: 'body', pts: [[1.08, -0.26], [2.05, -0.22], [2.05, 0.22], [1.08, 0.26]] },
    { name: 'front tyre', kind: 'tyre', mirror: true, pts: [[1.34, 0.6], [2.06, 0.6], [2.06, 0.93], [1.34, 0.93]] },
    { name: 'sidepods', kind: 'body', pts: [[-0.75, -0.68], [-0.3, -0.74], [0.65, -0.85], [1.08, -0.87], [1.08, 0.87], [0.65, 0.85], [-0.3, 0.74], [-0.75, 0.68]] },
    { name: 'engine cover', kind: 'body', pts: [[-1.45, -0.48], [-0.75, -0.58], [-0.75, 0.58], [-1.45, 0.48]] },
    { name: 'rear tyre', kind: 'tyre', mirror: true, pts: [[-2.06, 0.51], [-1.34, 0.51], [-1.34, 0.94], [-2.06, 0.94]] },
    { name: 'rear', kind: 'body', ramp: true, pts: [[-2.5, -0.57], [-1.45, -0.57], [-1.45, 0.57], [-2.5, 0.57]] },
  ],
  mu: Object.freeze({ body: 0.3, wing: 0.3, tyre: 0.8 }),
  restitution: Object.freeze({ body: 0.1, wing: 0.05, tyre: 0.3 }),
  // a front wing is built to break: per touch each half pushes the other car by at most this (m/s, per unit mass), then
  // it gives way: with damage on it breaks off (c.wingOff; a new nose at the pit stop), else it passes through; the nose
  // and tyres behind it take the hit
  wingStrength: 0.8,
});

// The car: one performance model for every car (player and AI). Accelerations are m/s² per unit mass.
export const CAR = Object.freeze({
  // Real Formula 1 (2026 rules; 2026-10-24, user: "as close to reality as possible"; tools/car-bench.mjs checks the car
  // against real figures): ~770 kg with the driver (the rules' minimum 768), slicks of ~1.8 friction at their static
  // load, losing loadSens per g of extra load (load sensitivity, vehicle.js tyreGrip; never below muMin of it)
  mass: 770,          // kg, with driver
  // an electric car's motor (vehicle.js electricDrive; Formula E's class): none, the F1 is a hybrid (engine + ERS)
  motor: /** @type {{ race: number, attack: number, torque: number, maxRpm: number, efficiency: number,
    regen: { front: number, rear: number, efficiency: number, minSpeed: number, coast: number, coastMax: number } }} */ (null),
  grip: 1.8,          // tyre friction at the static load (real slicks ~1.6–1.8). Until 2026-10-24: 3.0, no load sensitivity
  loadSens: 0.08, muMin: 0.6,
  aero: Object.freeze({
    rho: 1.2,         // air density
    liftArea: 4.8,    // downforce = ½·rho·liftArea·v²: equal to the weight at ~185 km/h (2026: 30 % less than before, ~150)
    dragArea: 1.1,    // drag = ½·rho·dragArea·v² (cornering mode, 2026 Z-mode; straight mode: ACTIVE_AERO)
    rolling: 0.15,    // rolling resistance, m/s²
  }),
  engine: Object.freeze({
    idle: 4000, launch: 7000, redline: 12000, limiter: 12500,   // rpm; launch = clutch-slip rpm pulling away in 1st
    // the combustion engine's full-throttle power curve (rpm, kW), linear in between: 400 kW at its peak (2026 rules;
    // the electric motor's 350 kW on top: ERS). Until 2026-10-24 one 750 kW curve.
    power: [[3000, 53], [5000, 139], [7000, 229], [9000, 320], [10500, 381], [11500, 400], [12500, 392]],
    efficiency: 0.92,
    // torque map (2026-10-25): the pedal asks for torque ∝ pedal^pedalMap, as a real F1 car's progressive maps (a linear
    // pedal left 15 % stable and 30 % a spin at the limit in 3rd without traction control; 2026-10-26 1.6 → 1.5, the user
    // found part throttle weak; 1.4 made ALIEN hit walls / spin without assists. Stable at the limit to the same 40 %)
    pedalMap: 1.5,
    engineBrake: 1.4, // extra deceleration off the throttle at redline, scaled by rpm
  }),
  gearbox: Object.freeze({
    top: [0, 108, 142, 174, 205, 235, 265, 296, 340],   // km/h at redline per gear (1..8); ratios are derived from it
    shiftTime: 0.06,  // s of reduced drive during a shift
    shiftCut: 0.3,    // drive kept during the shift
    autoUp: 11800, autoDown: 8000, autoBrakeDown: 11000, autoLug: 6000, autoKick: 8500,   // automatic gearbox shift points (rpm), see vehicle.js
  }),
});

// The player's chassis (chassis.js): a two-axle car whose tyres make grip from slip angle.
// The garage (spec.js carSpec): a car's race SETUP, real trade-offs only (no free speed: fair against the AI, which
// races the stock setup), and OPEN MODS (no limits; any mod off its default flags the car as modified, kept apart in
// the lap records). Every value acts as stock × (1 + k·(value − default)) or stock + k·(value − default), so the
// defaults give exactly the stock car (sim-trace unchanged). Per item: min, max, step, default (def).
export const SETUP = Object.freeze({
  wing:    { min: 1, max: 11, step: 1, def: 6 },        // downforce level: more grip in corners, more drag on straights
  balance: { min: 40, max: 50, step: 0.5, def: 45 },    // % of the downforce on the front axle: more = sharper turn-in, looser rear
  brakes:  { min: 51, max: 63, step: 0.5, def: 57 },    // brake balance, % of the braking on the front axle
  gearing: { min: 310, max: 380, step: 5, def: 340 },   // km/h in top gear at the redline: long enough for the top speed (low wing, slipstream), or the car hits the limiter
  migration: { min: 0, max: 10, step: 1, def: 5 },     // brake migration, %: the balance moves this much further forward as the pedal comes off
  engineBrake: { min: 1, max: 11, step: 1, def: 6 },    // engine braking: how hard the engine + MGU-K hold the rear wheels back on a lift
  diffEntry: { min: 1, max: 11, step: 1, def: 6 },      // differential lock on the brakes (entry), coasting (mid-corner), on the throttle (exit)
  diffMid:   { min: 1, max: 11, step: 1, def: 6 },
  diffExit:  { min: 1, max: 11, step: 1, def: 6 },
  pressF: { min: 20, max: 26, step: 0.5, def: 23 },      // tyre pressures, psi (cold): front, rear
  pressR: { min: 18, max: 24, step: 0.5, def: 21 },
  // suspension (SUSPENSION below): springs and anti-roll bars 1 (soft) … 11 (stiff); ride height mm; camber, toe °
  // (toe: + = toe-in; the front stock is a little toe-out). Before 2026-11-02 the anti-roll bars were one `mech` −5 … +5
  // (+ = a softer front): old saves become arbF 6 − mech, arbR 6 + mech (spec.js validSetup)
  springF: { min: 1, max: 11, step: 1, def: 6 }, springR: { min: 1, max: 11, step: 1, def: 6 },
  arbF:    { min: 1, max: 11, step: 1, def: 6 }, arbR:    { min: 1, max: 11, step: 1, def: 6 },
  rideF:   { min: 20, max: 40, step: 1, def: 30 }, rideR: { min: 50, max: 90, step: 1, def: 70 },
  camberF: { min: -4, max: -2, step: 0.1, def: -3 }, camberR: { min: -2.5, max: -1, step: 0.1, def: -1.8 },
  toeF:    { min: -0.2, max: 0.1, step: 0.01, def: -0.05 }, toeR: { min: 0, max: 0.4, step: 0.01, def: 0.2 },
  // dampers 1 (soft) … 11 (stiff), DAMPER below: bump (compressing) and rebound (extending), front and rear
  bumpF:   { min: 1, max: 11, step: 1, def: 6 }, bumpR:   { min: 1, max: 11, step: 1, def: 6 },
  reboundF: { min: 1, max: 11, step: 1, def: 6 }, reboundR: { min: 1, max: 11, step: 1, def: 6 },
  liftPerStep: 0.07, dragPerStep: 0.045,                // wing: liftArea × (1 + 0.07·steps), dragArea × (1 + 0.045·steps)
  rollPerStep: 0.03,                                    // anti-roll bars: the front's share of the sideways load transfer + 0.03 × (front − rear steps) / 2
  engineBrakePerStep: 0.15,                             // engine braking × (1 + 0.15·steps): 0.25 … 1.75 of stock (the lift-off harvest too)
});

// The differential (2026-11-02, garage Setup → Differential; chassis.js). The stock car's handling already has the
// stock diff in it, so the model is the change from it: at 6 / 6 / 6 nothing changes (every AI car: sim-trace identical).
// More lock than stock: the rear wheels are held to the same speed, so the faster outer one is held back and the inner
// pushed: a yaw moment against the rotation (stable, pushes wide), up to `yaw` × the rear tyres' lengthways grip moved
// between the wheels (full once they turn `slip` m/s apart: yaw rate × track). Less lock: that moment the other way (it
// rotates), and on the throttle the inside rear, unloaded in the corner, spins up first: the drive the rears take ×
// (1 − `traction` × how open × the inner wheel's unloading). Phase: brake on = entry, throttle on = exit, else mid.
// (`open`: the moment with the rotation is only that share of the locked side's: an open diff frees the car, it doesn't spin it)
export const DIFF = Object.freeze({ yaw: 0.12, open: 0.35, slip: 0.6, traction: 0.5, pedal: 0.05 });

// Tyre pressures (2026-11-02, garage Setup → Tyres; spec.js): psi off the stock 23 / 21 (the stock car = those: nothing
// changes). Lower: a bigger contact patch, `grip` more per psi down to `best` psi under stock, then the sidewall folds
// (−`fold` × psi² past it); a softer tyre reaches its peak at a bigger slip angle (`slip` per psi: lazier response); the
// sidewall flexes more (`flex` per psi more flexing heat into the core: tyre-temp.js). Higher: the other way round.
export const PRESSURE = Object.freeze({ grip: 0.006, best: 2, fold: 0.01, slip: 0.04, flex: 0.12 });

// Suspension (2026-11-02, garage Setup → Suspension; spec.js `susp`, chassis.js). The stock car = the stock setup, so
// everything is the change from it and a stock suspension skips it all (spec.susp null: sim-trace identical, the AI).
// - Springs: axle rates `kF` / `kR` N/mm × (1 + `springPerStep`·steps); with the anti-roll bars they share the sideways
//   load transfer (rollFront + `rollSpring` × (front − rear steps) / 2: the stiffer end takes more of it and grips less);
//   they set how far the car sinks under its downforce, braking (dive) and dips (the stock car: ~22 mm front, ~50 rear at
//   full speed); softer springs ride kerbs better: their grip loss × (1 + `kerb` × stiffness steps / 5).
// - Ride height (static) − that sinking = the floor's height at speed: downforce + `ground` per mm lower than the stock
//   car's in the same spot (mean of front and rear); under `stallAt` mm an end's floor stalls (−`stall` per mm, at most
//   `stallMax`); the front's share of the downforce + `rake` per mm of rake (rear − front) over stock. Below 0 the floor
//   is on the road: its plank carries load the tyres lose (that end's grip − `plank` per mm, down to `plankMin`); on
//   kerbs a lower car loses more grip (× 1 + `kerbRide` per mm lower than stock, mean of the two ends).
// - Camber (° more negative than stock = x): cornering grip × (1 + `lat`·x − `over`·(x − `best`)² past best), lengthways
//   (braking, traction) × (1 − `long`·x).
// - Toe (°): front toe-out over stock sharpens turn-in (small steering angles × 1 + `turn`·°), rear toe-in over stock damps
//   the rear's rotation (`damp`·° × yaw rate, full from `dampV` m/s); any toe off stock + `drag` per ° of drag.
export const SUSPENSION = Object.freeze({
  kF: 495, kR: 266, springPerStep: 0.12, rollSpring: 0.015, kerb: 0.6, kerbRide: 0.04,
  ground: 0.005, stallAt: 4, stall: 0.04, stallMax: 0.4, rake: 0.0012, plank: 0.02, plankMin: 0.6,
  camber: Object.freeze({ lat: 0.02, best: 0.7, over: 0.05, long: 0.025 }),
  toe: Object.freeze({ turn: 1.0, small: 0.05, damp: 2.0, dampV: 50, drag: 0.03 }),
});

// Dampers (2026-11-06; chassis.js, spec.damp: null when stock = nothing changes, the AI's car). The body rolls on its
// springs as a mass on a spring and damper (natural frequency `hz`, stock damping ratio `zeta`). While it rolls, the
// dampers carry part of the sideways load transfer, split between the axles by their damping (bump + rebound: in roll
// the outer wheel compresses while the inner one extends); in a steady corner the springs and bars carry it all, as
// before. The stock car's handling already has its dampers in it, so the roll is run twice, on these dampers and on
// the stock ones, and only the difference is added: a stiffer front takes more of the load while the car rolls (less
// front grip on turn-in and in quick changes of direction), softer dampers let the body overshoot (the load swings past
// the steady amount). Kerbs: stiffer bump = a harsher strike (more of the kerb's grip lost), stiffer rebound = the wheel
// comes back down slower after it (the loss lingers `linger` s per step over stock). Pitch: the same for the body's
// dive and squat on its springs (`pitchHz`; the end compressing uses its bump, the one extending its rebound: braking =
// front bump + rear rebound), which sets the floor's height (SUSPENSION, chassis.js suspAero): soft dampers let the nose
// overshoot under braking (a low car's floor stalls or touches the road), stiff ones hold it up a moment longer.
export const DAMPER = Object.freeze({
  perStep: 0.15,     // damping × (1 + 0.15·steps): 0.25 … 1.75 of stock
  hz: 3.5,           // the body's roll frequency on its springs
  pitchHz: 4,        // and its pitch frequency
  zeta: 0.7,         // stock damping ratio
  kerb: 0.5,         // kerb grip loss × (1 + 0.5 × bump steps / 5)
  linger: 0.04,      // s the kerb's grip loss lingers per rebound step over stock
});

export const MODS = Object.freeze({
  power:     { min: 50, max: 250, step: 5, def: 100 },   // % engine power
  mass:      { min: 500, max: 1200, step: 10, def: CAR.mass }, // kg with driver (stock = the car's)
  grip:      { min: 50, max: 250, step: 5, def: 100 },   // % tyre grip
  downforce: { min: 0, max: 300, step: 5, def: 100 },    // % downforce (on top of the wing setting)
  drag:      { min: 20, max: 200, step: 5, def: 100 },   // % aerodynamic drag
  brakes:    { min: 50, max: 250, step: 5, def: 100 },   // % brake system force (the tyres still limit it)
});

// Handbrake (2026-10-21, player only: inp.hb 0..1 in drivePlayer): locks the rear wheels (sliding friction, no ABS),
// cuts the drive to them, and the stability assist lets the car rotate meanwhile. For hairpins on low assists.
// Nothing changes while it is off (sim-trace identical).
export const HANDBRAKE = Object.freeze({
  lock: 2,              // rear braking asked = this × the rear axle's grip: well past it, so the wheels lock
  crawl: 8,             // m/s² of braking at walking pace (the kinematic low-speed branch)
});

export const CHASSIS = Object.freeze({
  wheelbase: 3.4, frontWeight: 0.45,   // m (2026 rules: 3.4, was 3.6); static weight on the front axle
  // sideways load transfer (2026-10-24): accel × cgHeight / track moves load to the outer wheels, `rollFront` of it on the
  // front axle (the anti-roll bars: SETUP mech); with load sensitivity the axle loses grip (chassis.js)
  track: 1.6, rollFront: 0.5,
  // aero yaw stability (2026-10-21; user, assists off: "the car behaves violently"): yaw acceleration per (m/s)² per rad
  // of slip angle. From a side force of ~1.5 m² × 1.5 /rad × dynamic pressure acting ~1.5 m behind the centre of mass:
  // ~0.002–0.004. With it a lift-off at the limit at 220 km/h is caught by a driver who counter-steers in 0.15 s (it
  // spun at 52° without it); one who doesn't still spins; at 120 km/h nothing changes. Steady grip unchanged.
  aeroYaw: 0.0025,
  aeroArm: 1.5,         // m behind the centre of mass where that side force acts
  aeroFront: 0.45,      // share of the downforce on the front axle (more = more oversteer)
  // (brake migration, 2026-10-25: now a setup item, SETUP.migration, default 5 %: the balance moves that much further
  // forward at a light pedal than at full (linear); without it trail-braking locked the rears first (a spin) at 57 %)
  cgHeight: 0.25,       // m: longitudinal load transfer = accel × cgHeight / wheelbase
  gyration: 1.2,        // m: yaw inertia = mass × gyration²
  peakSlip: 0.1,        // rad (~5.7°): front slip angle of peak grip
  rearPeakSlip: 0.075,  // the wider rear tyres are stiffer: the rear holds on, so the car settles instead of spinning
  rearGrip: 1.06,       // and grip a little more
  falloff: 1.3,         // tyre curve shape: grip past the peak falls to sin(falloff·π/2) ≈ 89%
  longGrip: 0.9,        // braking/driving grip relative to cornering grip
  brakeSystem: 70,      // m/s² the brakes can do at most (the AI's plans: brakeLimit)
  brakeFull: 46,        // m/s² asked at full pedal, at any speed: at top speed about where the tyres lock, at 80 km/h a
                        // third of the pedal is (real drivers push ~130 kg at the start of a big stop, ~40 at its end)
  // brake balance: a fixed front share (SETUP brakes, 57 % by default: just more than the front's share of the load at the
  // limit, so the fronts lock first); until 2026-10-24 the load share + 0.12
  rearBrakeMargin: 0.2, // with the stability assist on, rear braking keeps this share of grip spare for cornering
  lockLateral: 0.35,    // cornering grip left on a locked or spinning axle
  slideLong: 0.75,      // braking / drive force of a sliding tyre, relative to its peak (2026-10-25: 0.9 made a locked stop
                        // from 300 km/h only 1 % longer than with ABS; real locked slicks lose a good deal more)
  // wheelspin builds up (2026-10-28; user: the AI accelerates harder out of slow corners without spinning or marks).
  // Before, a rear asked for more than it could give spun fully in one step (drive × slideLong at once): the fast window
  // was ±1 % of pedal, which only the AI (feeling it every step) could hold. Now the rear wheels' spin `c.rearSpin` (0..1:
  // 1 = slip ratio `full`) rises with the drive beyond the grip, as fast as the wheels and drivetrain (mass / `mass` of
  // the car, reflected) spin up at this speed, and falls back as soon as the tyres can take it again; the drive force
  // stays full up to `peak` of the spin (the tyre's peak slip), then falls to slideLong at a full spin, the cornering
  // grip with it to lockLateral. Only without traction control (TC keeps the drive under the limit: nothing changes).
  spin: Object.freeze({ full: 0.3, peak: 0.3, mass: 6, minSpeed: 5 }),
  maxSteer: 0.3,        // rad of road-wheel angle at full lock (no steering assist)
  // player analog steering at speed (driving.js, inp.calm 0..1): the slope near the centre is cut so a small tilt
  // turns the car like the original game (37 m/s² at full tilt; the tyres give ~1.35× their share at small angles,
  // hence 27), and a cubic brings full tilt back up to the grip limit
  calmLateral: 27, calmMinSlope: 0.3,
  limitTurn: 1.0,       // steering assist: full lock = this × the geometric angle of the tightest steady turn
  steerMargin: 0.065,   //   + this many rad (both measured on the skidpad, 2026-10-24: the real-grip tyres need 0.035–0.06 rad
                        //   more than the geometric angle at their limit; full lock lands just past it)
  lowSpeed: 2, blendSpeed: 6,   // m/s: below lowSpeed the car steers kinematically, blended up to blendSpeed
  substeps: 4,          // tyre forces are stiff: integrate in 4 sub-steps of the 120 Hz step
  dirtyAir: 0.25,       // downforce lost at full wake strength (following closely through corners)
  stabilityGain: 14,    // 1/s: yaw-rate correction of the stability assist at full strength
  dampingGain: 6,       // 1/s: always-on yaw-rate correction of the damping assist
});

// Active aero (active-aero.js; race option `activeAero`), as on the 2026 cars: in straight-mode zones (worked out per
// circuit from the racing line: flat out, no corner a car with open wings couldn't take at top speed, not braking for
// `closeAhead` m) the front and rear wing flaps open (straight mode: less drag and downforce) on full throttle with
// the wheel near straight; braking, lifting, turning or the end of the zone closes them (corner mode).
export const ACTIVE_AERO = Object.freeze({
  dragCut: 0.35,        // share of the drag gone with the wings fully open (2026 X-mode; 0.24 until 2026-10-24)
  downforceCut: 0.36,   // share of the downforce gone (the floor keeps the rest)
  openTime: 0.35, closeTime: 0.18,   // s for the flaps to open / close fully
  thr: 0.85, steer: 0.3, minSpeed: 30,   // open only above this throttle, below this steering, above this speed (m/s)
  holdThr: 0.3,         // once open, they stay open down to this throttle
  // the AI's own call (active-aero.js aiAeroPlan): open while the bends ahead take its speed now + spare (m/s) open
  plan: Object.freeze({ spare: 2 }),
  zone: Object.freeze({ minLength: 180, closeAhead: 45, look: 90 }),   // m: shortest zone; close this far before
                        // braking; corners checked this far ahead
});

// Overtake mode: crossing the line within `gap` s of the car ahead gives `seconds` of extra electrical power
// (`power` share more drive) for that lap; the player switches it on (BOOST), the AI uses it on straights when close.
// Overtake mode (2026 rules): within `gap` s of the car ahead at the line, the next lap's deployment keeps the MGU-K's
// full 350 kW up to 337 km/h (ERS.taperFromBoost) instead of 290, with `energy` J of extra battery for it, for at most
// `seconds` of use. (Until 2026-10-24: +14 % power.)
export const OVERTAKE = Object.freeze({ gap: 1.0, seconds: 5, fromLap: 2, energy: 0.5e6 });

// The 2026 power unit's electrical side (vehicle.js ers): the MGU-K on the rear axle deploys up to `kw` on the throttle,
// tapering from taperFrom to nothing at taperTo (the rules' 290 → 355 km/h); the battery (`store` J usable) is charged
// under braking (up to harvestKw, as much as the rear brakes ask: brake-by-wire blends it with the friction brakes, so the
// car feels no difference) and off the throttle (coastKw, a little engine braking), at most `perLap` J a lap (8.5 MJ).
// Deployment fades below `low` of the battery to nothing when it is empty, and above 290 km/h with the battery under
// `clipBelow` the MGU-K harvests `clipKw` from the engine instead ("super clipping": the car slows at the end of a long
// straight), as the real cars' energy management does. Every car the same, the player's included.
export const ERS = Object.freeze({
  kw: 350, taperFrom: 290 / 3.6, taperFromBoost: 337 / 3.6, taperTo: 355 / 3.6,
  store: 4e6, start: 0.9, perLap: 8.5e6, harvestKw: 350, coastKw: 120,
  capacity: 4e6,   // (an electric car's whole pack: regeneration may fill it past `store`; the F1 doesn't use it)
  // (coastMax: the lifting harvest's deceleration cap, m/s²; 2026-10-26 2.0 → 1.0: with the engine braking a lift at
  // 100 km/h slowed the car at 0.39 g, now 0.26)
  low: 0.25, clipBelow: 0.3, clipKw: 200, minSpeed: 15, coastMax: 1.0, fullRpm: 10000,
  // part throttle (below partBelow): the engine's spare power into the battery, up to partKw (2026-10-25: braking alone
  // gave ~3 MJ a lap at Hautvale and the battery sat empty; the rules allow 8.5)
  partBelow: 0.95, partKw: 200,
  // deployment map (chassis.js c.deploy): none within near + far × (1 − charge share) m of a braking zone, full
  // fade m further back (2026-10-25: spent wherever there was throttle, the battery was empty for most of a lap)
  map: Object.freeze({ near: 30, far: 150, fade: 80 }),   // (the motor drives through the
                         // gearbox: its full power from fullRpm of the engine up, less below, torque-limited)   // m/s² at most from lifting (the motor's torque)   // m/s: deployment's force below this as at it (the motor's torque limit)
});

// The ECU's energy maps (ecu.js, 2026-10-31; user: "ECU manual and map control (map similar to aero controls but adaptive
// to racer style of driving)"). A car with an ECU mode (the player's: Settings → Driving ECU maps AUTO / MANUAL; the AI
// and a car without one use ERS.map as before) deploys by its map: `deploy` = share of the MGU-K's power, no deployment
// within near + far × (1 − charge share) m of its braking point (fading over `fade` m), the part-throttle harvest × `part`,
// super clipping below `clipBelow`, deployment fading below `low` of the battery. BALANCED = ERS's numbers.
// The lift points are learnt from the driver (`learn`): each lap's lifts (throttle under `lift`, or the brake ≥ `brk`,
// after being at `full` or more; faster than minSpeed, not in the pit lane) become the next lap's braking points once
// there are `min` of them; until then the track's own (the AI line's). The ECU cuts at the nearer of the two: the driver's
// lifts only ever add cut points (braking alone missed the corners only lifted for, and the AI's own lifts measured later
// than the line's braking points: deploying up to them emptied the battery and lost 0.2–0.6 s a lap).
// AUTO picks the map (`auto`): the last lap of a race QUALI while more than `lastFrom` is left (energy is worth nothing
// after the flag), else HARVEST below `harvest` of the battery until it is back over `refill`, ATTACK in a fight (within
// `chase` s of the car ahead or `defend` s of the one behind; out again past × `exit`) with more than `attackFrom` charge,
// else BALANCED. Measured (VOS alone; BALANCED = the AI's own map to the ms): HARVEST +0.2 s a lap and the battery fills
// (Elkmoor 57 → 91 %, Harrow 22 → 72 %); ATTACK −0.1…0.4 s and QUALI −0.4…0.6 s a lap while the battery lasts (QUALI
// empties it in about a lap).
export const ECU = Object.freeze({
  maps: Object.freeze([
    Object.freeze({ id: 'harvest', name: 'HARVEST', deploy: 0.6, near: 30, far: 260, fade: 80, part: 1.5, clipBelow: 0.5, low: 0.4 }),
    Object.freeze({ id: 'balanced', name: 'BALANCED', deploy: 1, near: 30, far: 150, fade: 80, part: 1, clipBelow: 0.3, low: 0.25 }),
    Object.freeze({ id: 'attack', name: 'ATTACK', deploy: 1, near: 15, far: 60, fade: 50, part: 0.6, clipBelow: 0.15, low: 0.12 }),
    Object.freeze({ id: 'quali', name: 'QUALI', deploy: 1, near: 8, far: 0, fade: 30, part: 0.25, clipBelow: 0, low: 0.04 }),
  ]),
  start: 1,
  learn: Object.freeze({ lift: 0.5, full: 0.9, brk: 0.2, minSpeed: 20, min: 3 }),
  auto: Object.freeze({ harvest: 0.3, refill: 0.55, chase: 1.0, defend: 0.8, exit: 1.4, attackFrom: 0.4, lastFrom: 0.15 }),
});

// Fuel, tyres, damage (race options, off by default: tests and the physics stay as they were).
// fuel: the tank lasts `laps` laps (kg per metre ∝ 0.35 + 0.65 × throttle); a car starts with what the race needs
// (+ reserve laps), at most a full tank; empty = limp (power × limp). tyres: worn after `laps` laps of normal
// driving (+ sliding wears them faster), grip × (1 − drop × wear²). Damage (0..1 each): front wing from frontal
// hits (front downforce × (1 − 0.6 wing) = understeer), floor from any hit (downforce × (1 − 0.3 floor), drag up),
// suspension from hard wall hits (steering pulls, grip down).
export const WEAR = Object.freeze({
  tank: 100, reserve: 0.4, limp: 0.15, slideWear: 6,
  // burn per metre ∝ idle + throttle × thr, divided by the average of that over a racing lap (so a tank lasts its laps)
  burn: Object.freeze({ idle: 0.35, throttle: 0.65, lap: 0.93 }),
  lapSpeed: 62,                  // m/s: lap-time guess for timed races before the first lap is done
  // radio warnings: fuel for fewer than `fuelLow` / `fuelBox` laps (when it won't reach the flag), tyres past `tyres`
  warn: Object.freeze({ fuelLow: 2, fuelBox: 1.1, tyres: 0.75 }),
  fuel: Object.freeze({ off: 0, normal: 8, high: 4 }),            // laps a full tank lasts (0 = no fuel use)
  tyres: Object.freeze({ off: 0, normal: 10, high: 5 }),          // laps until worn out
  drop: 0.18,
  damage: Object.freeze({ min: 2, wing: 22, floor: 45, susp: 30, suspFrom: 12, wingLoss: 0.6, floorLoss: 0.3, floorDrag: 0.2,
    suspPull: 0.02, suspGrip: 0.06, steps: 4 }),               // steps: a message each time a part crosses a 1/steps mark
});

// Tyre temperatures (2026-10-27, tyre-temp.js; user: "tyre temperature vs grip"). Off unless a race asks for it
// (createRace tyreTemp): every path below then multiplies by nothing. Per tyre (FL, FR, RL, RR) two temperatures: the
// surface (thin, quick) and the core (the carcass and its air, slow). Heat in: the friction power where the tyre slides
// over the road (slip angle × cornering force, wheelspin / lock-ups, the small longitudinal slip of braking and drive),
// `share` of it into the tyre, split between an axle's wheels by their loads (the outer one in a corner gets more), and
// the rubber flexing under load at speed (into the core). Heat out: the surface to the air (more with speed), to the
// track and to the core; the core to the rim / air. Grip: full in the window, less below (cold) and above (overheated);
// the grip temperature mixes `mix` of the surface with the core. Real numbers: blankets 70 °C, the window ~90-110 °C.
export const TYRE_TEMP = Object.freeze({
  blanket: 70, air: 25, track: 35,                    // °C: off the blankets (start, pit stop), the air and the track
  window: Object.freeze([90, 110]), mix: 0.7,
  cold: Object.freeze({ loss: 0.25, scale: 50 }),     // grip × (1 − loss·(1 − e^(−(lo − T)/scale))): 70 °C ≈ −8 %, 30 °C ≈ −17 %
  hot: Object.freeze({ loss: 0.12, scale: 40, pow: 1.5, max: 0.2 }),   // grip × (1 − loss·((T − hi)/scale)^pow): 130 °C ≈ −4 %, 150 °C ≈ −12 %
  share: 0.27,                                        // of the friction power that heats the tyre (the rest: the road)
  longSlip: 0.08,                                     // slip ratio at the grip limit (a gripping tyre's longitudinal slip)
  spinSlip: Object.freeze({ base: 8, per: 25, max: 40 }),   // m/s the rears' surface slips in a wheelspin at walking pace (by drive / grip)
  roll: 0.0075,                                       // W of flexing heat per N of load per m/s (into the core)
  // cooling: W/K × the temperature difference × (difference / ref)^grow (convection grows faster than linear: keeps
  // the outer and inner tyres within ~10-20 °C of each other, as real ones)
  surface: Object.freeze({ C: 4000, core: 300, air: 10, airV: 0.45, road: 8 }),   // J/K, W/K, W/K + W/K per m/s, W/K
  core: Object.freeze({ C: 9000, air: 2, airV: 0.08 }),
  grow: 0.6, ref: 60,
  front: 0.73,                                        // a front tyre's size against a rear's (2026: 275 / 375 mm): its heat capacity and cooling
  hotWear: 15,                                        // wear × (1 + (T − hi)/hotWear) above the window
  // events: TYRES_WARM once all four reach the window after a cold set; TYRES_HOT when an axle stays `over` °C above it for `for` s
  warn: Object.freeze({ warmAt: -3, over: 12, for: 3, calm: 6 }),
});

// Tyre compounds (2026-10-28; user: "soft, medium and hard tyres in the garage, and pit box options"). Medium is the tyre
// every number above was tuned on (grip × 1, WEAR tyres laps, TYRE_TEMP window), so a race that picks none is unchanged.
// grip: × the tyre's grip; life: × the WEAR tyres laps; window: °C where it grips fully (tyre-temp.js). Real Pirelli
// spread: a soft ~0.5-0.8 s a lap quicker than a medium, a medium ~0.4-0.6 s quicker than a hard; the soft lasts about
// half as long as the hard, works cooler (quick to warm, overheats sooner), the hard needs more heat.
export const COMPOUNDS = Object.freeze({
  soft:   Object.freeze({ grip: 1.03, life: 0.6, window: Object.freeze([85, 105]) }),
  medium: Object.freeze({ grip: 1, life: 1, window: TYRE_TEMP.window }),
  hard:   Object.freeze({ grip: 0.97, life: 1.6, window: Object.freeze([98, 118]) }),
});
// The AI drivers' side of this car (driving.js, track.js; moved from tuning.js AI, car classes stage 4): the margins its
// speed profile plans with, how it drives without ABS / traction control (feel), the ALIEN's pace per circuit and the
// racing lines made for this car (racing-lines.js: npm run lap-optimum). The racecraft stays in tuning.js AI.
export const AI_CAR = Object.freeze({
  grip: 0.98,          // share of the cornering grip the speed profile plans with, on the racing line
  brake: 0.85,          // share of the braking limit the profile plans with
  // Driving without ABS / traction control (2026-10-24; the player drives with none and the AI's all-or-nothing pedals
  // only worked because of them): driving.js feelPedals. Brake: the pedal it has learnt the fronts take in a straight
  // line (`brake`, starting value), raised by `learn` per second while nothing locks, cut by at most 1 − `cut` per
  // lock-up on tarmac above 25 m/s (never below `brakeMin`; a lock on the grass says nothing); while turning or after a lock it holds back further (`now`, recovering at `recover` per second). Throttle:
  // the same per gear, from wheel spin and the rear sliding (`slide`).
  feel: Object.freeze({ brake: 0.95, brakeMin: 0.8, brakeMax: 1.05, learn: 0.02, cut: 0.97, nowCut: 0.88, recover: 1.5, thr: 1, thrLearn: 0.05, thrCut: 0.9, slide: 0.7, floor: 0.25,
    counter: 1.0,      // opposite lock: × the drift angle, once the rear slides (driving.js steering)
    coldThr: 4,        // cold / overheated rears (tyre-temp.js): the throttle cap × their grip factor^coldThr
    trail: 0.6,        // brake × (1 − trail × |steering|): trail braking
    slideDrift: 0.14,      // rad of drift above which it only touches the throttle (none by twice that)
    react: 0.12,           // s: it feels the rears starting to spin (feelAt × CHASSIS.spin.peak) and sliding this late
    feelAt: 0.7,
    ease: 3,               // /s: easing off the throttle while it still feels them spinning
    rise: 3 }),            // /s: the throttle goes on at most this fast
  alien: Object.freeze({
    // pace (createRace aiPace for an ALIEN race): × the drivers' skill on its profile; the most each circuit's line
    // takes without spins or cuts (2026-10-20, solo laps of the fastest driver: Elkmoor 29.0, Harrow 49.3, Cobalt
    // 50.4, Marrow 38.0, Northfold 59.1 s; the user's best there 59.975; 2026-10-22 hills: Hautvale 58.8, Saltcross 64.8,
    // Cantera 44.5 s; 2026-10-23 Ironvale Park 42.8 s, clean at the default)
    // (2026-10-24, the real-physics car: rescanned on the new lines, the most that stays clean with active aero on and off)
    pace: Object.freeze({ default: 1.13, harrow: 1.07, hautvale: 1.07, northfold: 1.07, saltcross: 1.07, cantera: 1.09, marrow: 1.16 }),
    // with no ABS / traction control (the player's assists, createRace aiAssists; 2026-10-24): where it differs, the most
    // that stays clean with active aero on and off (Saltcross cut corners at 1.14)
    paceOff: Object.freeze({ default: 1.10, hautvale: 1.01, cantera: 1.04, saltcross: 1.02, marrow: 1.14, northfold: 1.07 }),
  }),
  lines: Object.freeze({ racing: RACING_LINES, alien: ALIEN_LINES }),
});

export const F1_2026 = Object.freeze({
  id: 'f1', name: 'Formula 1 (2026)',
  hitbox: HITBOX,
  car: CAR,
  setup: SETUP,
  diff: DIFF,
  pressure: PRESSURE,
  suspension: SUSPENSION,
  damper: DAMPER,
  mods: MODS,
  handbrake: HANDBRAKE,
  chassis: CHASSIS,
  activeAero: ACTIVE_AERO,
  overtake: OVERTAKE,
  ers: ERS,
  ecu: ECU,
  wear: WEAR,
  tyreTemp: TYRE_TEMP,
  compounds: COMPOUNDS,
  ai: AI_CAR,
});
