// AI ghost laps (pure: no DOM, no Three.js; tests/ai-ghosts.test.js). 2026-10-20, user: "add the ALIEN or the best
// driver for the ghost, and a list of the AIs and their times on the course". The fastest AI driver drives alone on
// the circuit at a difficulty level (the race's own physics, same seed every time, so a level's lap is always the same
// lap); its best clean flying lap becomes a ghost like yours.
import { SIM } from '../sim/index.js';
import { createRecorder } from './ghost.js';

export const AI_GHOSTS = Object.freeze({
  laps: 3,          // laps driven: the first is a standing start, the best of the others is kept
  seed: 20261020,   // fixed: the same lap every time
  dt: 1 / 120,
  maxTime: 600,     // s of sim time before giving up (a lap that never ends)
});

// the fastest AI driver (the ghost's driver)
export const ghostDriver = () => SIM.DRIVERS.filter(d => !d.player).reduce((a, d) => d.skill > a.skill ? d : a);

// One level's best clean flying lap on one circuit (a ghost; null if it never laps clean). ~50 ms of sim per level.
// It carries `standing` = the same driver's lap 1 from lights out (null if not clean): your first lap starts from
// the grid too, so that one is raced first (2026-10-20, user: the flying ghost was gone while they launched from 0).
// level: an AI_LEVELS entry { pace, follow?, alien? }; activeAero: the trial's setting (the lap times differ)
export function aiGhostLap(track, levelId, level, { activeAero = false } = {}) {
  const A = AI_GHOSTS, d = ghostDriver();
  const race = SIM.createRace({ type: 'laps', laps: A.laps }, { track, drivers: [d], aiPace: level.pace, aiFollow: level.follow || 1,
    aiAlien: !!level.alien, seed: A.seed, activeAero, overtake: false });
  const c = race.cars[0], rec = createRecorder();
  let best = null, standing = null, first = true;
  rec.start(0);
  while (!c.finished && race.t < A.maxTime) {
    race.t += A.dt;
    SIM.driveAI(race, c, A.dt);
    rec.sample(c, race.t);
    for (const e of c.events) if (e.type === SIM.EV.LAP) {
      const g = rec.lap(e.time, { circuit: track.id, modified: false, driver: `${d.code} · ${levelId.toUpperCase()}`, ai: levelId,
        livery: { color: d.color, accent: d.accent } });
      rec.start(c.lapStart);
      if (first) { first = false; standing = !e.invalid ? g : null; continue; }   // lap 1: from the grid
      if (!e.invalid && g && (!best || g.time < best.time)) best = g;
    }
    c.events.length = 0;
  }
  return best && { ...best, standing };
}

// Every level's lap on a circuit, made once per session (circuit × active aero); { [levelId]: ghost | null }
const cache = new Map();
export const aiGhostsReady = (track, activeAero) => cache.has(`${track.id}:${activeAero}`);
export function aiGhosts(track, levels, activeAero) {
  const key = `${track.id}:${activeAero}`;
  if (!cache.has(key)) cache.set(key, Object.fromEntries(Object.entries(levels).map(([id, l]) => [id, aiGhostLap(track, id, l, { activeAero })])));
  return cache.get(key);
}
