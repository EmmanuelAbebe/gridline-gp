// Driving and race-rule constants. Units are SI throughout: metres, seconds, m/s, m/s².
export const TUNING = Object.freeze({
  VMAX: 92,           // nominal top speed (what the engine and drag settle at); camera FOV scales with it
  V_CAP: 100,         // hard speed cap, above anything the car can reach
  REVERSE_MAX: 9,
  REVERSE_ACC: 5,
  WHEEL_RADIUS: 0.36, // driven wheel: gearing and wheel spin
});

// Car contact (collide.js): each car is a capsule from `rear` to `front` m along its heading (from the car's origin,
// between the axles), `radius` wide each side: about the bodywork. restitution = bounce of the closing speed, spin =
// how much an off-centre hit turns the car (0..1 of the free-body rotation).
// nose: a touch more than `nose` m ahead of the car's centre hits the front wing; damageHard = how hard a car feels
export const CONTACT = Object.freeze({ rear: 1.5, front: 2.3, radius: 1.05, restitution: 0.1, spin: 0.3, nose: 1.2, damageHard: 0.8 });

// The AI drivers (driving.js): they drive the same car as the player, through steering, throttle and brake.
export const AI = Object.freeze({
  grip: 1.0,           // share of the cornering grip the speed profile plans with, on the racing line
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
  lineRate: 2, lineSlope: 0.06, lineSpeed: 2.5,
  // racecraft (m): bodies touch at 2 × CONTACT.radius sideways. A car within followRange ahead and closer than sideGap
  // sideways is in our lane: move to pass it; closer than followLat we can't get by yet, so close only to followGap
  // (followGain m/s per metre). A car within ±alongside along the track: keep sideGap from it.
  sideGap: 3.4, followLat: 2.3, followRange: 40, followGap: 8, followGain: 0.6, alongside: 8,
  cutRange: 10,         // m: a car this close ahead counts where it is heading as well as where it is
  recoverSpeed: 8,      // m/s: pointing the wrong way (after a spin), turn back at this speed
  // late braking: per braking zone (speed to lose > minDrop m/s), chance × (1 − driver skill) × 10; the next `length`
  // metres are then driven `over` too fast
  mistakes: Object.freeze({ chance: 0.12, over: [0.06, 0.14], length: 140, minDrop: 8 }),
  // racecraft (driving.js; m unless noted). Drivers' traits 0..1 (drivers.js `traits`, 0.5 when missing) scale them.
  // racecraft (driving.js; m unless noted). Drivers' traits 0..1 (drivers.js `traits`, 0.5 when missing) scale them.
  craft: Object.freeze({
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
    // 50.4, Marrow 38.0, Northfold 59.1 s; the user's best there 59.975)
    pace: Object.freeze({ default: 1.16, cobalt: 1.08, marrow: 1.12 }),
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
  mass: 800,          // kg, with driver
  grip: 3.0,          // tyre friction: cornering limit = grip × (g + downforce / mass). Real slicks ~1.8; higher here
                      // because the circuit is tighter than a real one
  aero: Object.freeze({
    rho: 1.2,         // air density
    liftArea: 3.2,    // downforce = ½·rho·liftArea·v² (an F1 car is ~3–4.5 m²)
    dragArea: 1.45,   // drag = ½·rho·dragArea·v²; with the engine below this sets the ~331 km/h top speed
    rolling: 0.15,    // rolling resistance, m/s²
  }),
  engine: Object.freeze({
    idle: 4000, launch: 7000, redline: 12000, limiter: 12500,   // rpm; launch = clutch-slip rpm pulling away in 1st
    // full-throttle power curve (rpm, kW), linear in between
    power: [[3000, 100], [5000, 260], [7000, 430], [9000, 600], [10500, 715], [11500, 750], [12500, 735]],
    efficiency: 0.92,
    engineBrake: 1.4, // extra deceleration off the throttle at redline, scaled by rpm
  }),
  gearbox: Object.freeze({
    top: [0, 108, 142, 174, 205, 235, 265, 296, 340],   // km/h at redline per gear (1..8); ratios are derived from it
    shiftTime: 0.06,  // s of reduced drive during a shift
    shiftCut: 0.3,    // drive kept during the shift
    autoUp: 11800, autoDown: 8000, autoBrakeDown: 11000, autoLug: 6000,   // automatic gearbox shift points (rpm), see vehicle.js
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
  brakes:  { min: 51, max: 63, step: 0.5, def: 57 },    // brake balance, % front (at rest: front weight 45 % + the bias)
  gearing: { min: 310, max: 380, step: 5, def: 340 },   // km/h in top gear at the redline: long enough for the top speed (low wing, slipstream), or the car hits the limiter
  mech:    { min: -5, max: 5, step: 1, def: 0 },        // mechanical balance (anti-roll bars): + = front grip up, rear down
  liftPerStep: 0.07, dragPerStep: 0.045,                // wing: liftArea × (1 + 0.07·steps), dragArea × (1 + 0.045·steps)
  mechPerStep: 0.012,                                   // mech: front × (1 + 0.012·steps), rear × (1 − 0.012·steps)
});
export const MODS = Object.freeze({
  power:     { min: 50, max: 250, step: 5, def: 100 },   // % engine power
  mass:      { min: 500, max: 1200, step: 10, def: 800 }, // kg with driver
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
  wheelbase: 3.6, frontWeight: 0.45,   // static weight on the front axle
  aeroFront: 0.45,      // share of the downforce on the front axle (more = more oversteer)
  cgHeight: 0.25,       // m: longitudinal load transfer = accel × cgHeight / wheelbase
  gyration: 1.2,        // m: yaw inertia = mass × gyration²
  peakSlip: 0.1,        // rad (~5.7°): front slip angle of peak grip
  rearPeakSlip: 0.075,  // the wider rear tyres are stiffer: the rear holds on, so the car settles instead of spinning
  rearGrip: 1.06,       // and grip a little more
  falloff: 1.3,         // tyre curve shape: grip past the peak falls to sin(falloff·π/2) ≈ 89%
  longGrip: 0.9,        // braking/driving grip relative to cornering grip
  brakeSystem: 70,      // m/s² the brakes can ask for at most
  brakePedal: 1.15,     // full pedal = this × the tyres' straight-line limit at the current speed (capped by brakeSystem):
                        // only the last ~15% of pedal locks, so partial braking (and trail braking) is controllable
  brakeBias: 0.12,      // brake split = front load share + this (front locks first: understeer, not a spin)
  rearBrakeMargin: 0.2, // with the stability assist on, rear braking keeps this share of grip spare for cornering
  lockLateral: 0.35,    // cornering grip left on a locked or spinning axle
  slideLong: 0.9,       // braking / drive force of a sliding tyre, relative to its peak
  maxSteer: 0.3,        // rad of road-wheel angle at full lock (no steering assist)
  // player analog steering at speed (driving.js, inp.calm 0..1): the slope near the centre is cut so a small tilt
  // turns the car like the original game (37 m/s² at full tilt; the tyres give ~1.35× their share at small angles,
  // hence 27), and a cubic brings full tilt back up to the grip limit
  calmLateral: 27, calmMinSlope: 0.3,
  limitTurn: 1.25,      // steering assist: full lock = this × the geometric angle of the tightest steady turn
  steerMargin: 0.01,    //   + this many rad (both measured: full lock lands just past the grip limit)
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
  grass:   S({ grip: 0.35, rolling: 2.2 }),
  gravel:  S({ grip: 0.3, rolling: 1.5, bite: 6.5, biteFrom: 15, biteTo: 22, biteFade: 28, skim: 0.35 }),
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
export const RUNOFF = Object.freeze({
  fast: 50, slow: 25,             // m/s at the apex
  turf: 2,                        // artificial grass behind kerbs (m)
  slope: 0.3, exitSlope: 0.12,    // m of barrier distance per m of track: ramp in before a corner, longer out after
  chicane: 50,
  gravelSmooth: 8,                // samples either side averaged into the gravel's edge
  exitKerb: 15,                   // samples the outside kerb runs on after the corner
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
  dragCut: 0.24,        // share of the drag gone with the wings fully open
  downforceCut: 0.36,   // share of the downforce gone (the floor keeps the rest)
  openTime: 0.35, closeTime: 0.18,   // s for the flaps to open / close fully
  thr: 0.85, steer: 0.3, minSpeed: 30,   // open only above this throttle, below this steering, above this speed (m/s)
  holdThr: 0.3,         // once open, they stay open down to this throttle
  zone: Object.freeze({ minLength: 180, closeAhead: 45, look: 90 }),   // m: shortest zone; close this far before
                        // braking; corners checked this far ahead
});
// Overtake mode: crossing the line within `gap` s of the car ahead gives `seconds` of extra electrical power
// (`power` share more drive) for that lap; the player switches it on (BOOST), the AI uses it on straights when close.
export const OVERTAKE = Object.freeze({ gap: 1.0, seconds: 5, power: 0.14, fromLap: 2 });

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
  // entering: on the entry road = more than `road` m past the track edge; a car asked to pit turns in within
  // `request` samples of the entry road's start; neither counts later than `latest` samples before the pit wall
  enter: Object.freeze({ road: 2.5, request: 4, latest: 12 }),
  edge: 1.5,                     // m inside the track edge where the pit roads leave and join the track
  // the path into the box: swings across from `turnIn` samples before it over `turnInLength`, out over `turnOut`
  turnIn: 14, turnInLength: 11, turnOut: 12,
  // speeds in the lane: braking into the box at boxBrake m/s², pulling away at accel m/s², exitAccel on the exit road
  boxBrake: 6, accel: 8, exitAccel: 18, stopAt: 0.05, creep: Object.freeze({ within: 1, below: 0.3 }),
  // what the self-driving car shows the HUD and sound: throttle in / out, brake light, gear and revs
  // (steering: wheel angle = atan(wheelbase × the path's curvature), as a share of wheelLock rad; eased at steerRate/s)
  show: Object.freeze({ thrIn: 0.15, thrOut: 0.6, brake: 0.3, wheelbase: 3.4, wheelLock: 0.32, steerRate: 8, upshift: 10500, idle: 4200 }),
  release: 0.4,                  // a player's car leaves its box once the service is done and the gas is past this
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

// Things that happen to a car during a step: the `type` of the event objects in car.events (events.js `emit`).
export const EV = Object.freeze({ LAP: 'lap', FASTEST: 'fastest', FINISH: 'finish', WALL: 'wall', CONTACT: 'contact',
  SHIFT: 'shift', SHIFT_DENIED: 'shift-denied', CUT: 'cut', PENALTY: 'penalty',
  SAUSAGE: 'sausage', BEACHED: 'beached', RECOVERED: 'recovered',
  PIT_IN: 'pit-in', PIT_STOP: 'pit-stop', PIT_READY: 'pit-ready', PIT_GO: 'pit-go', PIT_OUT: 'pit-out', DAMAGE: 'damage',
  FUEL_LOW: 'fuel-low', FUEL_BOX: 'fuel-box', FUEL_OUT: 'fuel-out', TYRES_WORN: 'tyres-worn',
  BOOST_READY: 'boost-ready', BOOST: 'boost' });
