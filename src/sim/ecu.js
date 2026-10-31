// The ECU's energy maps (2026-10-31; user: "ECU manual and map control (map similar to aero controls but adaptive to racer
// style of driving)"). ECU in tuning.js. A car with c.ecuMode ('auto' | 'manual'; '' = none: every AI car, and the
// deployment is ERS.map's as before) deploys the MGU-K by its map (c.ecuMap, an index into ECU.maps), cutting before
// the nearer of the track's braking points and the lifts learnt from its own driving (c.ecuBrk: metres to the next
// lift off full throttle, per track sample). MANUAL: the driver steps through the maps (inp.map = −1 / +1 the step a
// button was pressed); AUTO: the ECU picks one from the battery and the cars around. Called from chassis.js before the
// drivetrain, so a test bot driving the car gets it too.
import { ECU, ERS, EV } from './tuning.js';
import { clamp } from './math.js';
import { gapAhead } from './active-aero.js';
import { emit } from './events.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */
/** @typedef {import('./types.js').Track} Track */

export const ecuMapOf = c => (c.ecuMode ? ECU.maps[c.ecuMap] : null);

// Time to the car right behind on the road (any car): how long ago this car passed the spot it is at now.
/** @param {Race} race @param {Car} c */
export function gapBehind(race, c, within = 5) {
  let best = Infinity;
  for (const o of race.cars) {
    if (o === c || o.pit) continue;
    const t = c.trailT[o.idx], d = race.t - t;
    if (t >= 0 && d > 0 && d < Math.min(best, within)) best = d;
  }
  return best;
}

// per sample: metres to the next of these braking starts (sample indices), round the lap
/** @param {Track} T @param {number[]} starts */
export function brakeMap(T, starts) {
  const { N, ds } = T, mark = new Uint8Array(N), out = new Float32Array(N);
  for (const i of starts) mark[i] = 1;
  let d = Infinity;
  for (let k = 2 * N - 1; k >= 0; k--) { const i = k % N; d = mark[i] ? 0 : d + ds; if (k < N) out[i] = d; }
  return out;
}

// metres to this car's next lift / braking point: its own (learnt), else the track's
/** @param {Race} race @param {Car} c */
export function brakeAhead(race, c) {
  const T = race.track;
  const own = T.BRK ? T.BRK[c.idx] * T.ds : Infinity;
  return c.ecuBrk ? Math.min(own, c.ecuBrk[c.idx]) : own;
}

// AUTO: the map for now (hysteresis: the map it is on decides which thresholds apply)
/** @param {Race} race @param {Car} c */
function autoMap(race, c) {
  const A = ECU.auto, s = c.soc / ERS.store, now = ECU.maps[c.ecuMap].id;
  // the last lap of a race: everything that's left (energy is worth nothing after the flag)
  if (race.laps < Infinity && c.lap === race.laps) return s > A.lastFrom ? 'quali' : 'balanced';
  if (s < A.harvest || (now === 'harvest' && s < A.refill)) return 'harvest';
  const k = now === 'attack' ? A.exit : 1;
  if (s > A.attackFrom && (gapAhead(race, c) < A.chase * k || gapBehind(race, c) < A.defend * k)) return 'attack';
  return 'balanced';
}

/** @param {Race} race @param {Car} c */
export function updateEcu(race, c, inp) {
  if (!c.ecuMode) return;
  const L = ECU.learn;
  // a new lap: the last one's lift points become the map (a lap with too few keeps the old one)
  if (c.ecuLap !== c.lap) {
    if (c.ecuStarts.length >= L.min) c.ecuBrk = brakeMap(race.track, c.ecuStarts);
    c.ecuStarts = []; c.ecuLap = c.lap;
  }
  // a lift: off the throttle (or on the brakes) after being flat out (ecuBraking = lifted since)
  const thr = (inp.brk || 0) >= L.brk ? 0 : inp.thr || 0;
  if (thr < L.lift && !c.ecuBraking) { c.ecuBraking = true; if (c.v > L.minSpeed && !c.pit) c.ecuStarts.push(c.idx); }
  else if (thr >= L.full) c.ecuBraking = false;
  const was = c.ecuMap;
  if (c.ecuMode === 'manual') { if (inp.map) c.ecuMap = clamp(c.ecuMap + Math.sign(inp.map), 0, ECU.maps.length - 1); }
  else { const id = autoMap(race, c); c.ecuMap = ECU.maps.findIndex(m => m.id === id); }
  if (c.ecuMap !== was || (inp.map && c.ecuMode === 'manual'))
    emit(c, EV.ECU, { map: ECU.maps[c.ecuMap].name, auto: c.ecuMode === 'auto', press: !!inp.map, end: c.ecuMap === was });
}
