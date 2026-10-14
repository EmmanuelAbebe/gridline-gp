// Driving and race-rule constants. Units are SI throughout: metres, seconds, m/s, m/s².
export const TUNING = Object.freeze({
  VMAX: 92,           // nominal top speed (what the engine and drag settle at); camera FOV scales with it
  V_CAP: 100,         // hard speed cap, above anything the car can reach
  REVERSE_MAX: 9,
  REVERSE_ACC: 5,
  CAR_RADIUS: 4.4,    // centre-to-centre contact distance
  WHEEL_RADIUS: 0.36, // driven wheel: gearing and wheel spin
  PLAYER_YAW: 1.5,    // cap on the player's turn rate (rad/s) at low speed
  AI: Object.freeze({ grip: 0.9, brake: 0.85, yaw: 1.15 }),   // AI uses this share of the car's grip and brakes
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
    autoUp: 11800, autoDown: 8000, autoBrakeDown: 11000,   // automatic gearbox shift points (rpm), see vehicle.js
  }),
  brakes: Object.freeze({ mech: 22, aero: 0.8 }),   // limit = mech + aero × grip × downforce/mass (m/s²)
  traction: 0.45,     // share of the cornering grip the rear tyres can use to accelerate (no wheel spin yet)
});

// The player's chassis (chassis.js): a two-axle car whose tyres make grip from slip angle.
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
  brakeSystem: 70,      // m/s² the brakes can ask for (more than the tyres give at low speed: they can lock)
  brakeBias: 0.08,      // brake split = front load share + this (front locks first: understeer, not a spin)
  rearBrakeMargin: 0.2, // with the stability assist on, rear braking keeps this share of grip spare for cornering
  lockLateral: 0.35,    // cornering grip left on a locked or spinning axle
  slideLong: 0.9,       // braking / drive force of a sliding tyre, relative to its peak
  maxSteer: 0.3,        // rad of road-wheel angle at full lock (no steering assist)
  steerMargin: 0.02,    // rad the steering assist allows past the tightest steady turn
  lowSpeed: 2, blendSpeed: 6,   // m/s: below lowSpeed the car steers kinematically, blended up to blendSpeed
  substeps: 4,          // tyre forces are stiff: integrate in 4 sub-steps of the 120 Hz step
  dirtyAir: 0.25,       // downforce lost at full wake strength (following closely through corners)
  stabilityGain: 14,    // 1/s: yaw-rate correction of the stability assist at full strength
  dampingGain: 6,       // 1/s: always-on yaw-rate correction of the damping assist
});

// Surfaces: grip multiplier, extra drag per m/s
export const SURFACES = Object.freeze({
  track: Object.freeze({ grip: 1, drag: 0 }),
  kerb:  Object.freeze({ grip: 0.92, drag: 0 }),
  grass: Object.freeze({ grip: 0.5, drag: 0.8 }),
  sand:  Object.freeze({ grip: 0.4, drag: 2.4 }),
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

// kerbs where |curvature| > kerbK; gravel traps `sand` m wide past the kerb on the outside where |curvature| > sandK
export const TRACK_DEFAULTS = Object.freeze({ samples: 1200, halfWidth: 7.5, kerb: 1.4, runoff: 14, sand: 5, sandK: 0.004, kerbK: 0.0025 });
export const GRID = Object.freeze({ front: 6, spacing: 7.5, lat: 3.2 }); // metres behind the line, between slots, off centre
export const CP = 20;          // checkpoint spacing in samples, for timing gaps
export const LAP_ZONE = 0.2;   // fraction of the lap either side of the line used to detect a crossing
// Things that happen to a car during a step; pushed into car.events, drained by the game.
export const EV = Object.freeze({ LAP: 'lap', FASTEST: 'fastest', FINISH: 'finish', WALL: 'wall', CONTACT: 'contact',
  SHIFT: 'shift', SHIFT_DENIED: 'shift-denied' });
