// Moving a car and everything that has to run after any position change.
import { locate, resolveWalls, updateSurface, updateBeached } from './car.js';
import { updateLap, updateCheckpoints, updateLimits } from './race.js';
import { addDamage, laneWalls } from './pit.js';
import { wrapIdx } from './math.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

// Record where the car passed each sample it crossed this step (moving forward; skipped when reversing).
/** @param {Race} race @param {Car} c */
function updateTrail(race, c, old) {
  const N = race.track.N, d = wrapIdx(c.idx - old, N);
  if (d > 8) return;
  for (let k = d ? 1 : 0; k <= d; k++) { const i = (old + k) % N; c.trailLat[i] = c.lat; c.trailT[i] = race.t; }
}

/** @param {Race} race @param {Car} c */
export function afterMove(race, c) {
  const old = locate(race.track, c, false);
  updateTrail(race, c, old);
  updateLap(race, c, old);
  updateCheckpoints(race, c);
  if (c.pit && !c.pit.drive) return;     // an AI car in the pit lane: on its own path (pit.js), no walls or track limits
  // driving in the pit lane (pit.js): its walls behind the pit wall, tarmac, no track limits
  const lane = c.pit ? laneWalls(race.track, c) : null;
  const hit = resolveWalls(race.track, c, lane);
  if (hit) addDamage(race, c, hit.impact, hit.front, hit.hard);
  updateSurface(race.track, c, !!lane);
  if (c.pit) return;
  updateBeached(race, c);
  updateLimits(race, c, old);
}
