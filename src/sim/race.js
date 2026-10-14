// Race formats, lap counting, the chequered flag, timing checkpoints and classification.
import { EV, CP, LAP_ZONE } from './tuning.js';
import { DRIVERS } from './drivers.js';
import { DEFAULT_TRACK } from './track.js';
import { createCar } from './car.js';

// Race format: { type: 'laps', laps } | { type: 'timed', minutes } | { type: 'unlimited' }; a plain number means laps.
// `drivers` is the grid in order (slot 0 = pole).
function normalizeFormat(f) {
  if (typeof f === 'number') return { type: 'laps', laps: Math.max(1, Math.round(f)) };
  if (f && f.type === 'timed') return { type: 'timed', minutes: Math.max(0.1, +f.minutes || 10) };
  if (f && f.type === 'unlimited') return { type: 'unlimited' };
  return { type: 'laps', laps: Math.max(1, Math.round(+(f && f.laps) || 3)) };
}
// aiPace scales every AI driver's skill (difficulty, 1 = their own).
export function createRace(format, { track = DEFAULT_TRACK, drivers = DRIVERS, aiPace = 1 } = {}) {
  const fmt = normalizeFormat(format);
  return { track, format: fmt, aiPace,
    laps: fmt.type === 'laps' ? fmt.laps : Infinity,               // distance; Infinity for timed / unlimited
    duration: fmt.type === 'timed' ? fmt.minutes * 60 : Infinity,  // seconds; the clock starts at lights out
    chequered: false, t: 0, fastest: Infinity, fastestBy: null, cars: drivers.map((d, slot) => createCar(track, d, slot)) };
}

export const progress = (race, c) => c.lap * race.track.N + c.idx;

// ---------- race rules (run after every position change) ----------
// Chequered flag: shown to the first car to complete the distance (laps), or to the leader when it crosses the line
// after time has run out (timed). After that every car finishes the next time it crosses the line, lapped cars
// included. Unlimited races never show it.
const isLeader = (race, c) => race.cars.every(o => o === c || progress(race, o) <= progress(race, c));
const flagFor = (race, c) => race.chequered || c.lap > race.laps || (race.t >= race.duration && isLeader(race, c));

export function updateLap(race, c, oldIdx) {
  const N = race.track.N;
  if (oldIdx > N*(1-LAP_ZONE) && c.idx < N*LAP_ZONE) {
    c.lap++;
    if (c.lap >= 2 && !c.finished) {
      const lt = race.t - c.lapStart; c.lastLap = lt; c.lapStart = race.t;
      if (lt < c.bestLap) c.bestLap = lt;
      if (lt < race.fastest) { race.fastest = lt; race.fastestBy = c; c.events.push(EV.FASTEST); }
      c.events.push(EV.LAP);
    }
    if (!c.finished && c.lap >= 2 && flagFor(race, c)) {
      race.chequered = true; c.finished = true; c.finishTime = race.t; c.finishLap = c.lap; c.events.push(EV.FINISH);
    }
  } else if (oldIdx < N*LAP_ZONE && c.idx > N*(1-LAP_ZONE)) c.lap--;
}

export function updateCheckpoints(race, c) {
  const cp = Math.floor(progress(race, c) / CP);
  if (cp > c.lastCp) { for (let k = c.lastCp + 1; k <= cp; k++) if (k >= 0) c.cpT[k] = race.t; c.lastCp = cp; }
}

// ---------- classification ----------
export function order(race) {
  return race.cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return (b.finishLap - a.finishLap) || (a.finishTime - b.finishTime);   // laps done, then time
    if (a.finished) return -1; if (b.finished) return 1;
    return progress(race, b) - progress(race, a);
  });
}

// Gap to the leader: { laps } when lapped, else { t } = now − when the leader passed my current checkpoint.
export function gapTo(race, leader, c) {
  if (c === leader) return null;
  if (leader.finished && c.finished) {
    const down = leader.finishLap - c.finishLap;
    return down > 0 ? { laps: down } : { t: c.finishTime - leader.finishTime };
  }
  const lapsDown = Math.floor((progress(race, leader) - progress(race, c)) / race.track.N);
  if (lapsDown >= 1) return { laps: lapsDown };
  const k = c.lastCp;
  if (k < 0 || leader.cpT[k] === undefined) return { t: 0 };
  return { t: Math.max(0, race.t - leader.cpT[k]) };
}
