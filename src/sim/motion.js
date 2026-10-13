// Moving a car and everything that has to run after any position change.
import { TUNING } from './tuning.js';
import { locate, resolveWalls, updateSurface } from './car.js';
import { updateLap, updateCheckpoints } from './race.js';

// Record where the car passed each sample it crossed this step (moving forward; skipped when reversing).
function updateTrail(race, c, old) {
  const N = race.track.N, d = (c.idx - old + N) % N;
  if (d > 8) return;
  for (let k = d ? 1 : 0; k <= d; k++) { const i = (old + k) % N; c.trailLat[i] = c.lat; c.trailT[i] = race.t; }
}

export function afterMove(race, c) {
  const old = locate(race.track, c, false);
  updateTrail(race, c, old);
  updateLap(race, c, old);
  updateCheckpoints(race, c);
  resolveWalls(race.track, c);
  updateSurface(race.track, c);
}

export function move(race, c, dt) {
  c.x += Math.cos(c.h) * c.v * dt; c.z += Math.sin(c.h) * c.v * dt;
  c.roll += c.v * dt / TUNING.WHEEL_RADIUS;
  afterMove(race, c);
}
