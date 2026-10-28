// Race formats, lap counting, the chequered flag, timing checkpoints and classification.
import { tyreSet } from './tyre-temp.js';
import { EV, CP, LAP_ZONE, LIMITS, AI, HITBOX } from './tuning.js';
import { DRIVERS } from './drivers.js';
import { DEFAULT_TRACK } from './track.js';
import { createCar } from './car.js';
import { setupWear, fitTyres, bestCompound } from './pit.js';
import { wrapIdx, speedOf, mulberry32 } from './math.js';
const randomSeed = () => Math.floor(Math.random() * 2 ** 32);   // the only Math.random in the sim
import { emit } from './events.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./pit.js').Wear} Wear */
/** @typedef {import('./types.js').Race} Race */

// Race format: { type: 'laps', laps } | { type: 'timed', minutes } | { type: 'unlimited' }; a plain number means laps.
// `drivers` is the grid in order (slot 0 = pole).
function normalizeFormat(f) {
  if (typeof f === 'number') return { type: 'laps', laps: Math.max(1, Math.round(f)) };
  if (f && f.type === 'timed') return { type: 'timed', minutes: Math.max(0.1, +f.minutes || 10) };
  if (f && f.type === 'unlimited') return { type: 'unlimited' };
  return { type: 'laps', laps: Math.max(1, Math.round(+(f && f.laps) || 3)) };
}
// aiPace scales every AI driver's skill (difficulty, 1 = their own). wear = { fuel, tyres, damage } (pit.js setupWear).
// seed: the race's random numbers (AI line biases and mistakes: race.rng); the same seed and inputs = the same race.
export function createRace(format, { track = DEFAULT_TRACK, drivers = DRIVERS, aiPace = 1, wear = {}, seed = randomSeed(), activeAero = false, overtake = activeAero, aiFollow = 1, aiAlien = false, aiAssists = null, tyreTemp = false, compound = 'medium', hitbox = HITBOX.parts } = {}) {
  const fmt = normalizeFormat(format), rng = mulberry32(seed);
  // aiFollow: how tightly the AI follows its line (× lineSlope / lineSpeed, driving.js): ALIEN drives it closer
  // aiAlien: the ALIEN level (driving.js): its own line, pedals and attack, at its own pace per circuit
  // (without ABS or traction control a few circuits need it gentler: AI.alien.paceOff)
  if (aiAlien) aiPace = (aiAssists && (!aiAssists.abs || !aiAssists.tc) ? AI.alien.paceOff[track.id] ?? AI.alien.paceOff.default : undefined) ?? AI.alien.pace[track.id] ?? AI.alien.pace.default;
  const aiTop = Math.max(0, ...drivers.filter(d => !d.player).map(d => d.skill));   // the fastest AI driver (ALIEN spread)
  const race = { track, format: fmt, aiPace, aiFollow, aiAlien, aiTop, seed, rng, activeAero, overtake, tyreTemp, compounds: compound, hitbox,   // active-aero.js; tyre-temp.js; pit.js; collide.js (the cars' shape)
    laps: fmt.type === 'laps' ? fmt.laps : Infinity,               // distance; Infinity for timed / unlimited
    duration: fmt.type === 'timed' ? fmt.minutes * 60 : Infinity,  // seconds; the clock starts at lights out
    chequered: false, t: 0, fastest: Infinity, fastestBy: /** @type {Car} */ (null), wear: /** @type {Wear} */ (null), cars: drivers.map((d, slot) => createCar(track, d, slot, rng)) };
  // aiAssists: the AI cars' assists (an ASSISTS-shaped object; default AI.assists, medium). The game gives them the
  // player's ABS / traction control / stability, so both drive on the same terms (driving.js feelPedals without them)
  if (aiAssists) for (const c of race.cars) if (!c.player) c.assists = aiAssists;
  setupWear(race, wear);
  // tyre temperatures (tyre-temp.js): every car on a fresh set off the blankets (after setupWear: it resets the pit state)
  if (tyreTemp) for (const c of race.cars) c.tyreT = tyreSet();
  // tyre compounds (pit.js): every car on medium unless the race says otherwise: one compound for every car, or 'auto' =
  // each team picks its own (bestCompound) and again at every stop (the player's car: the game fits its own choice)
  if (compound !== 'medium') for (const c of race.cars) {
    if (compound === 'auto') c.pitPlan = { ...c.pitPlan, tyres: 'auto' };
    fitTyres(race, c, compound === 'auto' ? bestCompound(race, c).compound : compound);
  }
  return race;
}

/** @param {Race} race @param {Car} c */
export const progress = (race, c) => c.lap * race.track.N + c.idx;

// ---------- race rules (run after every position change) ----------
// Chequered flag: shown to the first car to complete the distance (laps), or to the leader when it crosses the line
// after time has run out (timed). After that every car finishes the next time it crosses the line, lapped cars
// included. Unlimited races never show it.
/** @param {Race} race @param {Car} c */
const isLeader = (race, c) => race.cars.every(o => o === c || progress(race, o) <= progress(race, c));
/** @param {Race} race @param {Car} c */
const flagFor = (race, c) => race.chequered || c.lap > race.laps || (race.t >= race.duration && isLeader(race, c));

/** @param {Race} race @param {Car} c */
export function updateLap(race, c, oldIdx) {
  const N = race.track.N;
  if (oldIdx > N*(1-LAP_ZONE) && c.idx < N*LAP_ZONE) {
    c.lap++;
    if (c.lap >= 2 && !c.finished) {
      const lt = race.t - c.lapStart; c.lastLap = lt; c.lapStart = race.t; c.lastLapInvalid = c.lapInvalid;
      if (!c.lapInvalid) {                       // a lap with a cut never counts as a best or the fastest lap
        if (lt < c.bestLap) c.bestLap = lt;
        if (lt < race.fastest) { race.fastest = lt; race.fastestBy = c; emit(c, EV.FASTEST, { time: lt }); }
      }
      emit(c, EV.LAP, { time: lt, invalid: c.lastLapInvalid });
    }
    c.lapInvalid = false;
    if (!c.finished && c.lap >= 2 && flagFor(race, c)) {
      race.chequered = true; c.finished = true; c.finishTime = race.t; c.finishLap = c.lap; emit(c, EV.FINISH);
    }
  } else if (oldIdx < N*LAP_ZONE && c.idx > N*(1-LAP_ZONE)) c.lap--;
}

// Track limits (LIMITS): count track metres covered with the whole car past the edge (the kerb where one is painted)
// of a corner: on the inside (a cut), or on the outside faster than wideSpeed (running wide). Reaching cutDist is one
// offence (EV.CUT, lap invalid, its `wide` says which), and past the warnings each adds a time penalty (EV.PENALTY).
/** @param {Race} race @param {Car} c */
export function updateLimits(race, c, oldIdx) {
  const { N, ds, CK, KERB_K, runoff } = race.track, i = c.idx;
  const edge = runoff[c.lat < 0 ? 0 : 1].kerb[i], past = Math.abs(c.lat) - LIMITS.halfWidth > edge && Math.abs(CK[i]) > KERB_K;
  const inside = c.lat * CK[i] > 0, wide = past && !inside && speedOf(c) > LIMITS.wideSpeed;
  if (!(past && inside) && !wide) { c.cutRun = 0; return; }
  const d = wrapIdx(i - oldIdx, N);
  if (d === 0 || d > N / 2 || c.finished) return;            // standing still or going backwards
  const before = c.cutRun; c.cutRun += d * ds;
  if (before < LIMITS.cutDist && c.cutRun >= LIMITS.cutDist) {
    c.cuts++; c.lapInvalid = true; emit(c, EV.CUT, { wide: !inside });
    if (c.cuts > LIMITS.warnings) { c.penalty += LIMITS.penalty; emit(c, EV.PENALTY, { seconds: LIMITS.penalty, total: c.penalty }); }
  }
}

/** @param {Race} race @param {Car} c */
export function updateCheckpoints(race, c) {
  const cp = Math.floor(progress(race, c) / CP);
  if (cp > c.lastCp) { for (let k = c.lastCp + 1; k <= cp; k++) if (k >= 0) c.cpT[k] = race.t; c.lastCp = cp; }
}

// ---------- classification ----------
// race time including track-limit penalties
/** @param {Car} c */
export const raceTime = c => c.finishTime + c.penalty;

/** @param {Race} race */
export function order(race) {
  return race.cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return (b.finishLap - a.finishLap) || (raceTime(a) - raceTime(b));   // laps done, then time
    if (a.finished) return -1; if (b.finished) return 1;
    return progress(race, b) - progress(race, a);
  });
}

// Gap to the leader: { laps } when lapped, else { t } = now − when the leader passed my current checkpoint.
/** @param {Race} race @param {Car} leader @param {Car} c */
export function gapTo(race, leader, c) {
  if (c === leader) return null;
  if (leader.finished && c.finished) {
    const down = leader.finishLap - c.finishLap;
    return down > 0 ? { laps: down } : { t: raceTime(c) - raceTime(leader) };
  }
  const lapsDown = Math.floor((progress(race, leader) - progress(race, c)) / race.track.N);
  if (lapsDown >= 1) return { laps: lapsDown };
  const k = c.lastCp;
  if (k < 0 || leader.cpT[k] === undefined) return { t: 0 };
  return { t: Math.max(0, race.t - leader.cpT[k]) };
}
