// AI ghosts (pure: no DOM, no Three.js; tests/ai-ghosts.test.js). 2026-10-20, user: "add the ALIEN or the best driver
// for the ghost, and a list of the AIs and their times on the course"; then: an AI ghost should be the best driver
// really driving, continuously, with no contact. So an AI ghost is a live car in a race of its own (`createRival`),
// stepped in lockstep with yours from lights out: it never sees you, you never touch it, and it drives on lap after
// lap. The lap list (`aiLap`) comes from the same race driven ahead of time (same seed: the same laps), and the
// ALIEN's best lap also gives the racing line (racing-line.js): where it was, its speed and pedals at every sample.
import { SIM } from '../sim/index.js';

export const AI_GHOSTS = Object.freeze({
  laps: 3,          // laps timed for the list: the first is a standing start, the best of the others is kept
  seed: 20261020,   // fixed: the same laps every time
  dt: 1 / 120,
  maxTime: 600,     // s of sim time before giving up
});

// the fastest AI driver (the ghost's driver)
export const ghostDriver = () => SIM.DRIVERS.filter(d => !d.player).reduce((a, d) => d.skill > a.skill ? d : a);

// The ghost's own race: the fastest driver alone at that level, on the trial's active-aero setting
// (aiAssists: the player's ABS / traction control, setup-store aiAssistsOf: the ghost drives on the same terms)
// (tyreTemp: tyre temperatures as in your race, so off the line it is on cold tyres too; compound: your tyres)
function rivalRace(track, level, activeAero, aiAssists = null, tyreTemp = false, compound = 'medium') {
  return SIM.createRace({ type: 'unlimited' }, { track, drivers: [ghostDriver()], aiPace: level.pace, aiFollow: level.follow || 1,
    aiAlien: !!level.alien, seed: AI_GHOSTS.seed, activeAero, overtake: false, aiAssists, tyreTemp, compound });
}

// A live AI ghost: step(dt) once per sim step after lights out (its race.t follows yours). car = its car (pose,
// pedals and steering for the model and the input charts).
export function createRival(track, levelId, level, { activeAero = false, aiAssists = null, tyreTemp = false, compound = 'medium' } = {}) {
  const race = rivalRace(track, level, activeAero, aiAssists, tyreTemp, compound), car = race.cars[0];
  return {
    race, car, levelId, driver: ghostDriver(),
    step(dt) { race.t += dt; SIM.driveAI(race, car, dt); car.events.length = 0; },
  };
}

// The live gap to a rival in s (+ = you are behind): how long ago the one ahead passed the other's spot (each car's
// trail keeps its race time at every track sample; both clocks start at lights out). null until there is one.
export function rivalGap(player, now, rival) {
  const g = rival.car, N = player.trailT.length;
  const ahead = g.lap * N + g.idx >= player.lap * N + player.idx;
  const t = ahead ? g.trailT[player.idx] : player.trailT[g.idx];
  return t >= 0 ? (ahead ? now - t : t - now) : null;
}

// One level's lap: { time, line } of its best clean flying lap (null if none). ~50 ms of sim.
// line: that lap per track sample: x, z, kmh, thr, brk, t (s into the lap) (Float32Arrays of N)
export function aiLapRun(track, level, { activeAero = false, aiAssists = null, tyreTemp = false, compound = 'medium' } = {}) {
  const A = AI_GHOSTS, race = rivalRace(track, level, activeAero, aiAssists, tyreTemp, compound), c = race.cars[0], N = track.N;
  const fresh = () => ({ x: new Float32Array(N), z: new Float32Array(N), kmh: new Float32Array(N), thr: new Float32Array(N), brk: new Float32Array(N), t: new Float32Array(N) });
  let cur = fresh(), best = null, last = c.idx;
  while (c.lap <= A.laps && race.t < A.maxTime) {
    race.t += A.dt;
    SIM.driveAI(race, c, A.dt);
    for (const e of c.events) if (e.type === SIM.EV.LAP) {
      if (c.lap > 2 && !e.invalid && (!best || e.time < best.time)) best = { time: e.time, line: cur };   // (lap 1 = the standing start)
      cur = fresh();
    }
    c.events.length = 0;
    // this step's values at every sample reached since the last step (each keeps the step the car got there: t)
    const passed = Math.min(50, SIM.wrapIdx(c.idx - last, N));
    for (let k = 0; k < passed; k++) {
      const i = SIM.wrapIdx(c.idx - k, N);
      cur.x[i] = c.x; cur.z[i] = c.z; cur.kmh[i] = c.v * 3.6; cur.thr[i] = c.thr; cur.brk[i] = c.brake; cur.t[i] = race.t - c.lapStart;
    }
    last = c.idx;
  }
  return best;
}

// Each level's lap on a circuit, made once per session (circuit × level × active aero × the AI's ABS / TC / stability
// × tyre temperatures × compound)
const cache = new Map();
const keyOf = (track, id, aero, a, tt, cmp) => `${track.id}:${id}:${aero}:${a ? `${a.abs}/${a.tc}/${a.stability}` : '-'}:${tt ? 'tt' : ''}:${cmp}`;
export const aiLapReady = (track, id, aero, aiAssists = null, tyreTemp = false, compound = 'medium') => cache.has(keyOf(track, id, aero, aiAssists, tyreTemp, compound));
export function aiLap(track, id, level, activeAero, aiAssists = null, tyreTemp = false, compound = 'medium') {
  const k = keyOf(track, id, activeAero, aiAssists, tyreTemp, compound);
  if (!cache.has(k)) cache.set(k, aiLapRun(track, level, { activeAero, aiAssists, tyreTemp, compound }));
  return cache.get(k);
}
