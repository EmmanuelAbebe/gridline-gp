// Driving and race-rule constants. Units are SI throughout: metres, seconds, m/s, m/s².
// A car's own numbers live in its class (classes/: the 2026 F1's in classes/f1-2026.js; docs/car-classes-plan.md):
// this file holds the world's (surfaces, run-off, hills, limits, the pit lane, contact, assists) and the AI's racecraft.
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
// (the car's side of the AI: its grip and braking margins, its feel without ABS / traction control, the ALIEN's paces
// and the racing lines: the car class's ai, AI_CAR for the F1: classes/f1-2026.js)
export const AI = Object.freeze({
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

// Speed-sensitive steering (2026-10-21; user drives with assists OFF and found it violent: a phone's whole tilt range
// is the car's full 17° lock at any speed, while at 300 km/h only ~3.5° is usable). A controller mapping, not a car
// assist (the car and its tyres are unchanged): drivePlayer inp.speedSteer = how much the lock shrinks with speed (the
// steering help's scale: 0.85 = medium's), applied only when the car's own steering help is lower. Up to `catchFrom`
// of the travel the controller reaches that speed's usable angle; the rest of the travel reaches the full lock, so a
// big slide can still be caught with opposite lock.
export const SPEED_STEER = Object.freeze({ catchFrom: 0.85 });

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
