// Driving and race-rule constants. Units are SI throughout: metres, seconds, m/s, m/s².
export const TUNING = Object.freeze({
  VMAX: 92,           // top speed
  ACC: 12.5,          // peak acceleration (falls off with (v/VMAX)²)
  LAT_AI: 33,         // AI lateral grip: sets corner speeds in the speed profile
  BRK_AI: 23,         // AI braking
  LAT_P: 37,          // player grip and braking: a little better than the AI
  BRK_P: 30,
  REVERSE_MAX: 9,
  CAR_RADIUS: 4.4,    // centre-to-centre contact distance
  WHEEL_RADIUS: 0.36, // for wheel spin
});
export const TRACK_DEFAULTS = Object.freeze({ samples: 1200, halfWidth: 7.5, kerb: 1.4, runoff: 14 });
export const GRID = Object.freeze({ front: 6, spacing: 7.5, lat: 3.2 }); // metres behind the line, between slots, off centre
export const CP = 20;          // checkpoint spacing in samples, for timing gaps
export const LAP_ZONE = 0.2;   // fraction of the lap either side of the line used to detect a crossing
// Things that happen to a car during a step; pushed into car.events, drained by the game.
export const EV = Object.freeze({ LAP: 'lap', FASTEST: 'fastest', FINISH: 'finish', WALL: 'wall', CONTACT: 'contact' });
