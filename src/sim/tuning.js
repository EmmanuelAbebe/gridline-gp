// Driving and race-rule constants. Units are SI throughout: metres, seconds, m/s, m/s².
export const TUNING = Object.freeze({
  // the physics' version: 2 = real-F1 physics (2026-10-24). Lap records and ghosts are kept per version (game
  // config storageKeys, ghost.js validGhost): laps on different physics don't compare
  PHYSICS: 2,
  VMAX: 82,           // nominal top speed (an endless straight, the battery empty: ERS clipping; 92 until 2026-10-24); camera FOV scales with it
  V_CAP: 100,         // hard speed cap, above anything the car can reach
  // reverse (2026-10-26): stopped, brake + gas held together for REVERSE_HOLD s selects it (never before the car has
  // first driven off: the launch); then gas = backwards (as fast as the rear tyres and the surface allow), brake = stop;
  // stopped on the brake alone = forward again. Brake alone at rest only holds the car (it used to select reverse)
  REVERSE_MAX: 9,
  REVERSE_ACC: 5,
  REVERSE_HOLD: 0.4,
  WHEEL_RADIUS: 0.36, // driven wheel: gearing and wheel spin
});

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
// Airborne (airborne.js, 2026-10-28; user: launches over a wheel, airborne crashes). A front tyre that runs into the back
// of another car's rear tyre (or its diffuser, a `ramp` part) climbs it: the treads rub in opposite directions there (the
// rear one's moving up), so the friction of the push (the contact's mu × its normal impulse) lifts the car behind at its
// front wheel, at most `climb` × the closing speed per touch (the wheel rides up the other one). Lifted faster than `min`
// m/s the car leaves the ground: height, vertical speed, pitch (nose up +) and roll (right side down +) with their rates,
// as a rigid body (gyration `pitchK` / `rollK` m) of which `turn` of the kick turns it (the wheels still on the ground
// take the rest); in the air the tyres give nothing, gravity and the downforce pull it down, and pitched nose-up past
// `liftFrom` rad the floor's downforce turns into lift (by `liftAt`: `lift` × the downforce), which is how real cars flip. Landing: on its wheels (pitch and roll within `flipAt` rad) it
// takes damage by the landing speed (× `land` as an impact, the suspension bending from `landSusp` m/s); on its side or
// upside down it is stuck (beached: the marshals put it back). Cars more than `over` m apart in height don't touch.
export const AIR = Object.freeze({ min: 1.0, climb: 0.35, pitchK: 1.3, rollK: 0.6, turn: 0.35, liftFrom: 0.08, liftAt: 0.2, lift: 0.6, damp: 0.4, flipAt: 1.3,
  land: 2.5, landSusp: 3, over: 0.9 });
// The contact solver: `iterations` passes of impulses over a pair's contact points; positions pushed apart along the
// deepest overlap (+ `slop` m), at most `pushes` times while parts still overlap. Real yaw inertia (CHASSIS.gyration). damageHard = how hard a car feels to hit (walls 1);
// a tyre hit above `wheelFrom` m/s also bends the suspension (WEAR.damage.susp per m/s over it).
export const CONTACT = Object.freeze({ iterations: 4, pushes: 3, slop: 0.001, damageHard: 0.8, wheelFrom: 4 });

// The AI drivers (driving.js): they drive the same car as the player, through steering, throttle and brake.
export const AI = Object.freeze({
  grip: 0.98,          // share of the cornering grip the speed profile plans with, on the racing line
  brake: 0.85,          // share of the braking limit the profile plans with
  dirtyTime: 0.8,      // s: how fast the AI adapts its corner speeds to the dirty air it is in
  lineMargin: 2.2,      // m: the fallback (minimum-curvature) line keeps the car's centre this far inside the road edge
  lineBlend: 0.5,       // the AI's line: this share of the time-optimal line, the rest minimum curvature (track.js)
  lineEdge: 1.4,        // m: the stored time-optimal line (racing-lines.js, made with a 2.2 m margin) never closer than this
  lineStrides: [24, 12, 6, 3], lineIterations: 300,   // racing-line smoothing passes, coarse to fine (track.js)
  look: 8, lookTime: 0.3,   // steering aims at a point this far ahead: metres + seconds × speed
  yawGain: 0.6,         // steering correction toward the turn rate the path needs
  steerRate: 10,        // how fast the AI turns the wheel (full lock per 1/steerRate s)
  thrGain: 0.5,         // throttle per m/s under the target speed
  brakeGain: 0.12,      // extra brake per m/s over the target speed
  brakeLook: 60,        // samples ahead checked for braking
  lockThrottle: 0.25,   // throttle at most while the steering is at its lock or the front slides
  // moving across to a new line (racing line, passing): rate 1/s, at most lineSlope m per m driven and lineSpeed m/s
  lineRate: 2, lineSlope: 0.06, lineSpeed: 2.5, cleanFollow: 3,   // (× in clean air, 2026-10-24: driving.js)
  // racecraft (m): bodies touch 1.88 m apart sideways (HITBOX). A car within followRange ahead and closer than sideGap
  // sideways is in our lane: move to pass it; closer than followLat we can't get by yet, so close only to followGap
  // (followGain m/s per metre). A car within ±alongside along the track: keep sideGap from it.
  sideGap: 3.4, followLat: 2.3, followRange: 40, followGap: 8, followGain: 0.6, alongside: 8,
  cutRange: 10,         // m: a car this close ahead counts where it is heading as well as where it is
  recoverSpeed: 8,      // m/s: pointing the wrong way (after a spin), turn back at this speed
  // late braking: per braking zone (speed to lose > minDrop m/s), chance × (1 − driver skill) × 10; the next `length`
  // metres are then driven `over` too fast
  // (2026-10-24, real grip: 6–14 % too fast was a sure run-wide; now 3–7 %: a lock-up or a wide moment)
  mistakes: Object.freeze({ chance: 0.12, over: [0.03, 0.07], length: 140, minDrop: 8 }),
  // the way out of a corner: lift when the car will be past the kerb's end (+ room m) in look s (driving.js)
  edge: Object.freeze({ look: 0.8, room: 0.2, fade: 1.5, min: 0.2, off: 0.5 }),   // off: m wide of its line for the full lift
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
  // racecraft (driving.js; m unless noted). Drivers' traits 0..1 (drivers.js `traits`, 0.5 when missing) scale them.
  // racecraft (driving.js; m unless noted). Drivers' traits 0..1 (drivers.js `traits`, 0.5 when missing) scale them.
  craft: Object.freeze({ squeeze: 0.96,
    behindRange: 30,    // a car this close behind puts the driver under pressure (0 at 30 m .. 1 alongside)
    pressureMistakes: 2.5,   // mistake chance × (1 + this × nerves × pressure)
    defendRange: 14, defendFrom: 160, defendLate: 40,   // defend against a car within defendRange, decided between
                        // defendFrom and defendLate m before the braking point (not later: no blocking in the braking zone)
    defendChance: 1.2,  // chance × defend trait of covering the inside (once per corner)
    defendMargin: 2.2,  // the defensive line keeps this far inside the road edge
  }),
  assists: 'medium',    // the AI drives with the same assists the game defaults to
  // ALIEN (createRace aiAlien; the top rival level only): its own line and pace, no mistakes, and attack racecraft
  alien: Object.freeze({
    lineEdge: 0.6,      // m: its line (racing-lines.js ALIEN_LINES, made with --margin=0.8) never closer to the edge
    edge: 0.6,          // m: its car's centre may come this close to the edge: its whole line (the others 1.5)
    // its speed profile brakes as the lap-optimum bot plans it (friction circle, drag: track.js), checked brakeLook
    // samples ahead (the others AI.brakeLook: short at 350 km/h)
    brakeLook: 120,
    // pedals in clean air (the lap-optimum bot's): full throttle until over the target (− thrGain per m/s over); brake
    // once the deceleration needed passes brakeAt × 0.97 × the tyres' limit (or overBrake m/s too fast), pedal =
    // need / (limit × brakeScale) + over × brakeGain
    snap: 1,          // m: in clean air, once this close to its line it drives exactly on it (no mistakes either)
    steerRate: 40,      // turns the wheel this fast (the others AI.steerRate)
    thrGain: 0.8, brakeAt: 0.92, overBrake: 0.8, brakeScale: 1.15, brakeGain: 0.3,   // (× 0.97 of the limit)
    // pace (createRace aiPace for an ALIEN race): × the drivers' skill on its profile; the most each circuit's line
    // takes without spins or cuts (2026-10-20, solo laps of the fastest driver: Elkmoor 29.0, Harrow 49.3, Cobalt
    // 50.4, Marrow 38.0, Northfold 59.1 s; the user's best there 59.975; 2026-10-22 hills: Hautvale 58.8, Saltcross 64.8,
    // Cantera 44.5 s; 2026-10-23 Ironvale Park 42.8 s, clean at the default)
    // (2026-10-24, the real-physics car: rescanned on the new lines, the most that stays clean with active aero on and off)
    pace: Object.freeze({ default: 1.13, harrow: 1.07, hautvale: 1.07, northfold: 1.07, saltcross: 1.07, cantera: 1.09, marrow: 1.16 }),
    // with no ABS / traction control (the player's assists, createRace aiAssists; 2026-10-24): where it differs, the most
    // that stays clean with active aero on and off (Saltcross cut corners at 1.14)
    paceOff: Object.freeze({ default: 1.10, hautvale: 1.01, cantera: 1.04, saltcross: 1.02, marrow: 1.14, northfold: 1.07 }),
    // in traffic (a car ahead in its lane, alongside, or in a wake) its pace eases to `traffic` × that
    // over trafficTime s: the full push only works on the line in clean air (it put cars into walls in traffic)
    // clean air (no car in its lane or alongside, slip < cleanSlip) = 1; deep in a wake (slip > wakeSlip) or alongside
    // = `traffic`; following = `chase` (more ran wide / into walls)
    traffic: 0.84, chase: 0.9, trafficDrop: 0.15, trafficTime: 0.5, cleanSlip: 0.05, wakeSlip: 0.3,   // s to ease down / up
    // attack (m): a car ahead within towRange on a straight (more than `straight` m to the next braking zone): sit in
    // its wake, close to followGap, pull out at pullOut (to the inside of the next corner when it fits). (A late-braking
    // dive down the inside was tried: twice the passes, but also 2.5× the hard contacts.)
    // Hunting the player (within huntLat m sideways, from alongside to towRange ahead): pace `hunt` and the bot's pedals
    // (only against the player: a whole field of ALIENs racing each other like that wrecked itself)
    attack: Object.freeze({ towRange: 40, straight: 120, followGap: 8, pullOut: 18, huntLat: 7 }),
    hunt: 1,
    // the field: a driver's skill gap to the fastest one × (1 + spread) (VOS 0.975 → 59.1 s on Northfold; MAR, OKA
    // just faster than a great lap; the rest about the user's 59.975 and slower): not the whole field past you
    spread: 1.5,
  }),
});

// The car: one performance model for every car (player and AI). Accelerations are m/s² per unit mass.
export const CAR = Object.freeze({
  // Real Formula 1 (2026 rules; 2026-10-24, user: "as close to reality as possible"; tools/car-bench.mjs checks the car
  // against real figures): ~770 kg with the driver (the rules' minimum 768), slicks of ~1.8 friction at their static
  // load, losing loadSens per g of extra load (load sensitivity, vehicle.js tyreGrip; never below muMin of it)
  mass: 770,          // kg, with driver
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
  mech:    { min: -5, max: 5, step: 1, def: 0 },        // mechanical balance (anti-roll bars): + = front grip up, rear down
  liftPerStep: 0.07, dragPerStep: 0.045,                // wing: liftArea × (1 + 0.07·steps), dragArea × (1 + 0.045·steps)
  rollPerStep: 0.03,                                    // mech: the front's share of the sideways load transfer − 0.03·steps
});
export const MODS = Object.freeze({
  power:     { min: 50, max: 250, step: 5, def: 100 },   // % engine power
  mass:      { min: 500, max: 1200, step: 10, def: 770 }, // kg with driver
  grip:      { min: 50, max: 250, step: 5, def: 100 },   // % tyre grip
  downforce: { min: 0, max: 300, step: 5, def: 100 },    // % downforce (on top of the wing setting)
  drag:      { min: 20, max: 200, step: 5, def: 100 },   // % aerodynamic drag
  brakes:    { min: 50, max: 250, step: 5, def: 100 },   // % brake system force (the tyres still limit it)
});

// Speed-sensitive steering (2026-10-21; user drives with assists OFF and found it violent: a phone's whole tilt range
// is the car's full 17° lock at any speed, while at 300 km/h only ~3.5° is usable). A controller mapping, not a car
// assist (the car and its tyres are unchanged): drivePlayer inp.speedSteer = how much the lock shrinks with speed (the
// steering help's scale: 0.85 = medium's), applied only when the car's own steering help is lower. Up to `catchFrom`
// of the travel the controller reaches that speed's usable angle; the rest of the travel reaches the full lock, so a
// big slide can still be caught with opposite lock.
export const SPEED_STEER = Object.freeze({ catchFrom: 0.85 });

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
  // brake migration (2026-10-25), as the real cars' setting: the balance moves `brakeMigration` further forward at a
  // light pedal than at full (linear): trail-braking into a corner locked the rears first (a spin) at 57 %
  brakeMigration: 0.05,
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

// Surfaces (2026-10-18, after research into real run-off; the user found the old grass "too punishing": it braked at
// up to 2.2 g down to 60 km/h). Real grass barely slows a car, it takes the grip away: tyres have about half their
// asphalt friction on it, so the car keeps its speed but can hardly brake or turn. Gravel is made to stop cars: about
// 0.6 g in tests, up to 1.1 g measured (Silverstone 1999), but only once the car is below ~80 km/h (faster it skims).
//   grip: × the tyres' grip. rolling: m/s² at any speed. bite: extra m/s², full from biteFrom m/s, fading above
//   biteTo m/s to `skim` of it at biteTo + biteFade (gravel). Artificial grass behind the kerbs costs time but keeps
//   control; tarmac run-off has almost full grip (and lets cars rejoin); a sausage kerb upsets the car (car.js).
const S = o => Object.freeze({ grip: 1, rolling: 0, bite: 0, biteFrom: 1, biteTo: Infinity, biteFade: 1, skim: 1, ...o });
export const SURFACES = Object.freeze({
  track:   S({}),
  kerb:    S({ grip: 0.92 }),
  sausage: S({ grip: 0.55, rolling: 3 }),
  turf:    S({ grip: 0.6, rolling: 1.2 }),
  tarmac:  S({ grip: 0.9, rolling: 0.3 }),
  // (2026-10-26: rolling 2.2 → 1.0, about real grass: a spinning rear's push on it only matched 2.2, so a car stopped
  // on the grass could never get going faster than 7 km/h)
  grass:   S({ grip: 0.35, rolling: 1.0 }),
  // (2026-10-24, real grip 1.8: rolling 1.5 → 0.4 and the bite built up to 20 m/s, or a car's drive in gravel never beat it)
  gravel:  S({ grip: 0.3, rolling: 0.4, bite: 6.5, biteFrom: 20, biteTo: 22, biteFade: 28, skim: 0.35 }),
});
// Surfaces that leave dirt on the tyres (rough = camera shake, off-track sound)
export const ROUGH = Object.freeze({ turf: 0.4, grass: 1, gravel: 1 });
// After an off: grip × (1 − loss × dirt), dirt (0..1) wears off over `clean` s back on a hard surface.
// Spinning: past spinFrom rad of slip angle the downforce fades (smoothly) to `spinFloor` of it at spinTo: a car
// sideways or backwards loses its wings (normal cornering, a few degrees, is not affected).
// Gravel: deeper than `deep` m and slower than `digSpeed` m/s the wheels dig in (drive × dig); stopped there
// (< stuckSpeed for stuckTime s) the car is beached, and marshals put it back at the track edge after recoverTime s.
export const OFFTRACK = Object.freeze({ loss: 0.1, clean: 3, spinFloor: 0.1, spinFrom: 0.35, spinTo: 1.5, deep: 2, digSpeed: 2, dig: 0.2,
  stuckSpeed: 0.6, stuckTime: 1.5, recoverTime: 4, sausageWidth: 0.7, sausageYaw: 0.35, sausageLoss: 0.02,
  sausageFull: 40, sausageImpact: 0.25,   // full kick from 40 m/s; impact (sound, shake) = speed × sausageImpact
  recoverLat: 1.5, recoverWall: 2 });     // marshals set a car down 1.5 m beyond the turf, at least 2 m off the barrier
// Hitting a barrier (car.js resolveWalls): the car's centre stays `clearance` m off it, keeps `sideways` of its slide
// and yaw, and its heading turns `align` of the way to the wall's each step while it scrapes along.
export const WALLS = Object.freeze({ clearance: 1.3, sideways: 0.3, align: 0.12 });

// Run-off layout (runoff.js), metres from the centre line. Each side of each sample gets: kerb (where painted), an
// artificial-grass strip behind it, then grass or tarmac, gravel from some distance, and a barrier. What goes where
// depends on the corner: the outside of a fast corner (apex above `fast` m/s) gets wide tarmac and TecPro, a medium
// corner a gravel trap and a tyre wall (heavy: extra m of run-off per m/s scrubbed in the braking zone), a slow one (hairpin) tarmac and tyres; heavy braking zones get more room.
// Inside of corners and straights: grass and Armco. `street` circuits: concrete walls close to the road, tarmac
// escape roads on the outside of corners. A fast corner: tarmac first, then gravel. Sausage kerbs at chicanes (opposite corners within `chicane` samples).
export const BARRIER = Object.freeze({ armco: 0, tyres: 1, tecpro: 2, concrete: 3 });
export const ZONE = Object.freeze({ grass: 0, tarmac: 1 });
// barrier behaviour: speed kept along the wall after a hit, and how hard it feels (sound, shake)
export const BARRIERS = Object.freeze([
  Object.freeze({ name: 'armco',    keep: 0.55, hard: 0.85 }),
  Object.freeze({ name: 'tyres',    keep: 0.4,  hard: 0.45 }),
  Object.freeze({ name: 'tecpro',   keep: 0.45, hard: 0.55 }),
  Object.freeze({ name: 'concrete', keep: 0.6,  hard: 1 }),
]);
const R = o => Object.freeze(o);
// Hills and banking (elevation.js): height profiles smoothed over heightBlur m, bank over bankBlur m, vertical
// curvature measured over ±curveSpan m; the AI's plan never asks for less than minCorner m/s in a corner or less than
// minBrake m/s² of braking (a steep downhill); cars more than `apart` m apart in height never touch (a bridge)
export const ELEVATION = Object.freeze({ heightBlur: 22, bankBlur: 16, curveSpan: 10, minCorner: 8, minBrake: 3, apart: 3 });
export const RUNOFF = Object.freeze({
  fast: 50, slow: 25,             // m/s at the apex
  turf: 2,                        // artificial grass behind kerbs (m)
  slope: 0.3, exitSlope: 0.12,    // m of barrier distance per m of track: ramp in before a corner, longer out after
  chicane: 50,
  gravelSmooth: 8,                // samples either side averaged into the gravel's edge
  exitKerb: 15,                   // samples the outside kerb runs on after the corner
  bank: 1.5, crossSpan: 60,       // hills: m between two parts' barriers per m of height between them (a 1:1.5 grass bank);
                                  // samples either side of a crossing (bridge) left out of that
  permanent: R({ heavy: 0.15,
    straight: R({ wall: 9, zone: 'grass', barrier: 'armco' }),
    inside:   R({ wall: 11, zone: 'grass', barrier: 'armco' }),
    fast:     R({ wall: 26, zone: 'tarmac', gravel: 9, barrier: 'tecpro' }),
    medium:   R({ wall: 21, zone: 'grass', gravel: 3, barrier: 'tyres' }),
    slow:     R({ wall: 17, zone: 'tarmac', barrier: 'tyres' }),
  }),
  street: R({ heavy: 0.05,
    straight: R({ wall: 3, zone: 'tarmac', barrier: 'concrete' }),
    inside:   R({ wall: 3.5, zone: 'tarmac', barrier: 'concrete' }),
    fast:     R({ wall: 12, zone: 'tarmac', barrier: 'tecpro' }),
    medium:   R({ wall: 11, zone: 'tarmac', barrier: 'tecpro' }),
    slow:     R({ wall: 10, zone: 'tarmac', barrier: 'tecpro' }),
  }),
  // main straight: pit wall on the pit side, a concrete wall with debris fence in front of the grandstand
  pitWall: 3.5, standWall: 6, landmarkSpan: 45,   // samples either side of the landmark
});

// Driver assists, each 0..1. steer: speed-sensitive steering (full lock asks only for what the front tyres can give),
// stability: catches rear slides, damping: calms the car's rotation all the time (for on/off keyboard steering),
// tc: traction control (no wheel spin at 1), abs: no lock-ups at 1.
export const ASSISTS = Object.freeze({
  off:    Object.freeze({ steer: 0,    stability: 0,    damping: 0,   tc: 0,   abs: 0 }),
  low:    Object.freeze({ steer: 0.5,  stability: 0.35, damping: 0,   tc: 0.5, abs: 0.5 }),
  medium: Object.freeze({ steer: 0.85, stability: 0.7,  damping: 0,   tc: 1,   abs: 1 }),
  high:   Object.freeze({ steer: 1,    stability: 1,    damping: 1,   tc: 1,   abs: 1 }),
});

// Slipstream: behind another car, inside its wake, drag drops. The wake follows the path the car actually drove.
export const SLIP = Object.freeze({
  range: 50,          // m behind the car where the wake ends
  minGap: 4,          // m: closer than this the cars are touching
  drag: 0.35,         // drag reduction at full strength
  width: 1.1, spread: 0.025, edge: 1.0,   // wake half-width = width + spread × gap (m), soft edge over `edge` m
  minSpeed: 40,       // full wake from this speed (m/s); weaker below
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

// Sectors and corners (sectors.js, 2026-10-26; user: sectors "to determine where a player is slow or faster"). Corners
// = the minima of the ALIEN line's speed profile: two closer than `merge` m/s (the speed between them never rises more
// than that above the faster one) are one corner, one dropping less than `minDrop` m/s from the speed before it is no
// corner (a flat kink). A corner's mini-sector runs from its braking point to the next corner's; the `count` sectors
// split at the braking points nearest equal shares of the ALIEN's lap time. launch = the acceleration cap (m/s²) of the
// pass that turns the profile into speeds the car reaches.
export const SECTORS = Object.freeze({ count: 3, merge: 6, minDrop: 6, launch: 13 });

// kerbs where |curvature| > kerbK; runoff = the default barrier distance past the road edge (the layout varies it)
// samples: fixed count, or (when absent) one sample every `ds` metres; Elkmoor fixes 1200 (≈ 2.06 m)
export const TRACK_DEFAULTS = Object.freeze({ ds: 2.06, halfWidth: 7.5, kerb: 1.4, runoff: 14, kerbK: 0.0025, style: 'permanent' });
// Track limits (race.js): a cut = the whole car (centre ± halfWidth) past the edge (the kerb where one is painted, else
// the white line) on the inside of a corner (curvature over ±cornerSpan samples above KERB_K), for at least cutDist
// metres of track. Every cut invalidates the lap; after `warnings` cuts in a race each one adds `penalty` s.
// Since 2026-10-18 running wide counts too (whole car past the outside edge at more than wideSpeed m/s, as in F1:
// the run-off no longer costs much time, so it would be quicker); a slow car that spun or was recovered doesn't.
export const LIMITS = Object.freeze({ halfWidth: 1.1, cutDist: 5, cornerSpan: 20, warnings: 2, penalty: 2, wideSpeed: 15 });
export const GRID = Object.freeze({ front: 6, spacing: 7.5, lat: 3.2 }); // metres behind the line, between slots, off centre
export const CP = 20;          // checkpoint spacing in samples, for timing gaps
export const LAP_ZONE = 0.2;   // fraction of the lap either side of the line used to detect a crossing
// Pit lane (pit.js), on the right of the main straight: the pit wall at RUNOFF.pitWall from the road edge, the fast
// lane `fast` m and the boxes `box` m beyond the pit wall, the garages `garage` m beyond it. The entry road leaves the
// track `entry` samples before the pit wall begins, the exit road joins it `exit` samples after it ends. In the lane
// the car drives itself (as in F1 games) at `speed` m/s (80 km/h), braking at most `brake` m/s² to get there.
// Service: tyres always (base s), fuel at refuel kg/s, a new front wing (wing s), the rest by damage (repair s per
// unit of damage). AI: pits when fuel would not last to the flag (+ margin laps), worn tyres (> tyres) with > 1.5
// laps to go, or wing damage over `wing`.
export const PIT = Object.freeze({ fast: 2.4, box: 8, garage: 12.5, entry: 55, exit: 55, speed: 80 / 3.6, brake: 35,
  base: 2.4, refuel: 12, wing: 3, repair: 5, boxLength: 7,
  // garages (world.js draws them, pit.js stops each car at its own): door k at first + step·k m from the `pits` landmark
  garages: Object.freeze({ first: -67.5, step: 15, door: 11, building: 150 }),
  // entering (AI): on the entry road = more than `road` m past the track edge; a car asked to pit turns in within
  // `request` samples of the entry road's start; neither counts later than `latest` samples before the pit wall.
  // Driving yourself: in the pit lane once more than `drive` m past the edge on the entry road (before a track-limits
  // cut could count: the whole car past the edge)
  enter: Object.freeze({ road: 2.5, request: 4, latest: 12, drive: 1 }),
  edge: 1.5,                     // m inside the track edge where the pit roads leave and join the track
  // the AI's path into the box (m): swings across from `turnIn` before it over `turnInLength`, out over `turnOut`, so it
  // stays clear of the neighbouring boxes (15 m apart, 7 m long)
  turnIn: 16, turnInLength: 15, turnOut: 15,
  // driving yourself (the player): stopped in your box = the car's centre within `along` m of the box's centre and `lat` m
  // of its middle, pointing within `angle` rad of the lane, slower than `speed` m/s; then held until the service is done.
  // The lane's outer edge (the garages) narrows to the pit roads' barrier over `taper` m at both ends.
  boxFit: Object.freeze({ along: 1.5, lat: 1.1, angle: 0.35, speed: 0.4 }), taper: 16,
  // the player's own pit limiter (Settings → Driving Pit limiter BUTTON, car limiterAuto false; 2026-10-28, user's phone
  // wheel has a PIT button): pressed = the engine cut above `speed` anywhere (it holds, it doesn't brake); faster than
  // speed + `tol` m/s from the pit wall's start to its end = a `seconds` time penalty, once per visit (as in F1)
  speeding: Object.freeze({ tol: 1 / 3.6, seconds: 5, hold: 0.5 }),
  // speeds in the lane: braking into the box at boxBrake m/s², pulling away at accel m/s², exitAccel on the exit road
  boxBrake: 6, accel: 8, exitAccel: 18, stopAt: 0.05, creep: Object.freeze({ within: 1, below: 0.3 }),
  // what the self-driving car shows the HUD and sound: throttle in / out, brake light, gear and revs
  // (steering: wheel angle = atan(wheelbase × the path's curvature), as a share of wheelLock rad; eased at steerRate/s)
  show: Object.freeze({ thrIn: 0.15, thrOut: 0.6, brake: 0.3, wheelbase: 3.4, wheelLock: 0.32, steerRate: 8, upshift: 10500, idle: 4200 }),
  // service: a wing counts as damaged above wingFrom, floor + suspension damage above repairFrom gets repaired
  wingFrom: 0.05, repairFrom: 0.02,
  // the AI's decision: never within `late` laps of the flag; fuel only when under fuelBelow laps are left; tyres only
  // with more than tyresLeft laps to go, the wing with more than wingLeft
  ai: Object.freeze({ margin: 0.05, tyres: 0.75, wing: 0.45, late: 0.6, fuelBelow: 1.6, tyresLeft: 1.5, wingLeft: 1 }) });
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
// The team's tyre choice (pit.js bestCompound; the AI's, and the player's AUTO): every plan of `stops` to `stops + more`
// stops, equal stints, costed in laps: the grip lost to wear (lap time ≈ grip^−0.5, the average of drop·wear² over a
// stint = drop·end²/3) plus `stopLaps` laps per stop; worn tyres past `maxWear` don't count as a plan; an endless race
// plans for `endless` laps.
export const STRATEGY = Object.freeze({ stopLaps: 0.3, maxWear: 0.8, more: 2, endless: 30 });

// Things that happen to a car during a step: the `type` of the event objects in car.events (events.js `emit`).
export const EV = Object.freeze({ LAP: 'lap', FASTEST: 'fastest', FINISH: 'finish', WALL: 'wall', CONTACT: 'contact',
  SHIFT: 'shift', SHIFT_DENIED: 'shift-denied', CUT: 'cut', PENALTY: 'penalty',
  SAUSAGE: 'sausage', BEACHED: 'beached', RECOVERED: 'recovered',
  PIT_IN: 'pit-in', PIT_STOP: 'pit-stop', PIT_READY: 'pit-ready', PIT_GO: 'pit-go', PIT_OUT: 'pit-out', DAMAGE: 'damage',
  FUEL_LOW: 'fuel-low', FUEL_BOX: 'fuel-box', FUEL_OUT: 'fuel-out', TYRES_WORN: 'tyres-worn', TYRES_WARM: 'tyres-warm', TYRES_HOT: 'tyres-hot',
  BOOST_READY: 'boost-ready', BOOST: 'boost', PIT_SPEEDING: 'pit-speeding', LIMITER: 'limiter', AERO: 'aero', ECU: 'ecu', LAUNCHED: 'launched', LANDED: 'landed', WING_OFF: 'wing-off' });
