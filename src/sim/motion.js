// Moving a car and everything that has to run after any position change.
import { TUNING } from './tuning.js';
import { locate, resolveWalls, updateSurface } from './car.js';
import { updateLap, updateCheckpoints } from './race.js';

export function afterMove(race, c) {
  const old = locate(race.track, c, false);
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
