// Replays (2026-10-28; the online leaderboard, docs/leaderboard-plan.md phase 0): a race kept as what the player's car
// was given, not where it went. Same race options + seed + these inputs = the same race, step for step (the sim is
// pure and every random draw is the race's own rng), so a server can drive a submitted lap again and read the time off
// its own result. What the game feeds the player's car each 120 Hz step: the controls (quantised here *before* the car
// uses them, so the live race and the replay see the very same numbers) and the settings it can change mid-race
// (assists, gearbox mode, overtake / straight mode / limiter buttons, the BOX call, the pit plan, steering prefs),
// recorded only when they change. Pure: no DOM; tests/replay.test.js.
import { createRace } from './race.js';
import { buildTrack } from './track.js';
import { CIRCUITS } from './circuits.js';
import { DRIVERS } from './drivers.js';
import { carSpec } from './spec.js';
import { fitTyres } from './pit.js';
import { setAeroZones, aeroZonesInMetres } from './active-aero.js';
import { drivePlayer, driveAI } from './driving.js';
import { collide } from './collide.js';
import { TUNING, EV } from './tuning.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

export const REPLAY = Object.freeze({
  version: 1,
  dt: 1 / 120,
  steer: 4096, pedal: 1024,       // steps per unit: steering to 1/4096, gas and brake to 1/1024
});

// ---- the controls ----
// inp as the game builds it for drivePlayer → the same, quantised (and only the fields the car reads). The prefs
// that travel with it (steerRate, calm, speedSteer) are settings: kept as they are.
const q = (v, k) => Math.round(Math.max(-1, Math.min(1, +v || 0)) * k) / k;
export function quantizeInput(inp) {
  return { steer: q(inp.steer, REPLAY.steer), thr: Math.max(0, q(inp.thr, REPLAY.pedal)), brk: Math.max(0, q(inp.brk, REPLAY.pedal)),
    analog: !!inp.analog, hb: inp.hb ? 1 : 0, shift: Math.sign(inp.shift || 0), boost: !!inp.boost, aero: !!inp.aero, limiter: !!inp.limiter,
    steerRate: inp.steerRate, calm: inp.calm, speedSteer: inp.speedSteer };
}
// one step's controls as whole numbers (the channels of a replay) and back
const CH = ['steer', 'thr', 'brk', 'flags', 'shift'];
function toInts(inp) {
  const flags = (inp.analog ? 1 : 0) | (inp.hb ? 2 : 0) | (inp.boost ? 4 : 0) | (inp.aero ? 8 : 0) | (inp.limiter ? 16 : 0);
  return [Math.round(inp.steer * REPLAY.steer), Math.round(inp.thr * REPLAY.pedal), Math.round(inp.brk * REPLAY.pedal), flags, inp.shift];
}
/** @param {ArrayLike<number>} v */
function fromInts(v, prefs) {
  const [steer, thr, brk, flags, shift] = Array.from(v);
  return { steer: steer / REPLAY.steer, thr: thr / REPLAY.pedal, brk: brk / REPLAY.pedal, analog: !!(flags & 1), hb: flags & 2 ? 1 : 0,
    boost: !!(flags & 4), aero: !!(flags & 8), limiter: !!(flags & 16), shift, ...prefs };
}
// a channel: its values' changes from step to step as runs [change, how many steps, …] (constant = one pair)
function encode(values) {
  const out = []; let last = 0, run = 0, d0 = null;
  for (const v of values) {
    const d = v - last; last = v;
    if (d === d0) run++; else { if (run) out.push(d0, run); d0 = d; run = 1; }
  }
  if (run) out.push(d0, run);
  return out;
}
function decode(runs, n) {
  const out = new Int32Array(n); let v = 0, k = 0;
  for (let r = 0; r + 1 < runs.length; r += 2) for (let m = 0; m < runs[r + 1] && k < n; m++) { v += runs[r]; out[k++] = v; }
  return out;
}

// ---- the settings the game may change on the player's car mid-race ----
const FLAGS = ['autoShift', 'autoDown', 'boostAuto', 'aeroAuto', 'limiterAuto', 'pitRequest'];
const PREFS = ['steerRate', 'calm', 'speedSteer'];
const num = v => v === Infinity ? 'inf' : v ?? null;                 // (JSON keeps no Infinity)
const unnum = v => v === 'inf' ? Infinity : v ?? undefined;
/** @param {Car} c */
function settingsOf(c, inp) {
  const s = { assists: { ...c.assists }, pitPlan: c.pitPlan ? { ...c.pitPlan } : null };
  for (const k of FLAGS) s[k] = c[k];
  for (const k of PREFS) s[k] = num(inp[k]);
  return s;
}
/** @param {Car} c */
function applySettings(c, s, prefs) {
  if ('assists' in s) c.assists = { ...s.assists };
  if ('pitPlan' in s) c.pitPlan = s.pitPlan ? { ...s.pitPlan } : null;
  // (the gearbox mode is changed the way the game does it: main.js setGearbox empties the downshift queue)
  if (('autoShift' in s && s.autoShift !== c.autoShift) || ('autoDown' in s && s.autoDown !== c.autoDown)) c.downQueue = 0;
  for (const k of FLAGS) if (k in s) c[k] = s[k];
  for (const k of PREFS) if (k in s) prefs[k] = unnum(s[k]);
}
const changed = (a, b) => Object.fromEntries(Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => [k, b[k]]));

// ---- recording ----
// race: the race as created (its options are read off it); opts: what createRace was given that the race doesn't keep
// in plain form ({ format, aiAssists, hitbox, compound, wear }); car: { setup, mods, compound } of the player's car
// (its spec = carSpec(setup, mods), its tyres fitTyres(compound)). Start it at lights out, step(c, inp) every sim step
// just before drivePlayer with the quantised controls, finish() → the replay (plain JSON data).
/** @param {Race} race */
export function createReplayRecorder(race, opts, car) {
  const T = race.track, frames = CH.map(() => []), changes = [];
  const header = {
    v: REPLAY.version, physics: TUNING.PHYSICS, circuit: T.id, zones: T.aeroKey === 'auto' ? null : aeroZonesInMetres(T),
    race: { format: opts.format, seed: race.seed, aiPace: race.aiPace, aiFollow: race.aiFollow, aiAlien: race.aiAlien, activeAero: race.activeAero,
      overtake: race.overtake, tyreTemp: !!race.tyreTemp, compound: opts.compound ?? 'medium', wear: opts.wear ?? {}, aiAssists: opts.aiAssists ?? null,
      hitbox: opts.hitbox ?? null },
    drivers: race.cars.map(c => c.code), player: { setup: car.setup, mods: car.mods, compound: car.compound },
    finishedAiSkill: opts.finishedAiSkill ?? 0,
  };
  let start = null, last = null, steps = 0, tainted = '';
  return {
    get steps() { return steps; },
    // something drove the car that isn't in the replay (the debug autopilot, a car moved by hand): it can't be replayed
    taint(why) { tainted ||= why; },
    /** @param {Car} c */
    step(c, inp) {
      const s = settingsOf(c, inp);
      if (!start) start = s; else { const d = changed(last, s); if (Object.keys(d).length) changes.push([steps, d]); }
      last = s;
      toInts(inp).forEach((v, k) => frames[k].push(v));
      steps++;
    },
    finish() {
      return { ...header, start, changes, steps, tainted: tainted || undefined, inputs: Object.fromEntries(CH.map((k, i) => [k, encode(frames[i])])) };
    },
  };
}

// ---- replaying ----
const tracks = new Map();
// The race again from the replay: { race, car (the player's), laps [{ lap, time, invalid }] }. opts.track = a built
// track to use (else one is built and kept per circuit; its zones are set from the replay); onStep(race, car, step)
// after every step (a ghost recorder, a hash).
export function replayRun(rp, { track = null, onStep = null } = {}) {
  if (rp.v !== REPLAY.version) throw new Error(`replay version ${rp.v}`);
  if (rp.physics !== TUNING.PHYSICS) throw new Error(`physics version ${rp.physics}`);
  if (!Object.hasOwn(CIRCUITS, rp.circuit)) throw new Error(`circuit ${rp.circuit}`);
  if (rp.tainted) throw new Error(`not replayable: ${rp.tainted}`);
  const T = track || tracks.get(rp.circuit) || tracks.set(rp.circuit, buildTrack(CIRCUITS[rp.circuit])).get(rp.circuit);
  if (!track) setAeroZones(T, rp.zones);
  const R = rp.race, drivers = rp.drivers.map(code => DRIVERS.find(d => d.code === code));
  if (drivers.some(d => !d)) throw new Error('unknown driver');
  const race = createRace(R.format, { track: T, drivers, aiPace: R.aiPace, aiFollow: R.aiFollow, aiAlien: R.aiAlien, seed: R.seed,
    activeAero: R.activeAero, overtake: R.overtake, tyreTemp: R.tyreTemp, compound: R.compound, wear: R.wear, aiAssists: R.aiAssists,
    ...(R.hitbox ? { hitbox: R.hitbox } : {}) });
  const car = race.cars.find(c => c.player), prefs = {};
  car.spec = carSpec(rp.player.setup, rp.player.mods);
  fitTyres(race, car, rp.player.compound);
  applySettings(car, rp.start, prefs);
  const ch = CH.map(k => decode(rp.inputs[k], rp.steps)), laps = [], dt = REPLAY.dt;
  let next = 0;
  for (let step = 0; step < rp.steps; step++) {
    while (next < rp.changes.length && rp.changes[next][0] === step) applySettings(car, rp.changes[next++][1], prefs);
    race.t += dt;
    // (every car in the race's order, as the game's simStep does; a finished player's car cools down on the AI)
    for (const c of race.cars) {
      if (c.player && !c.finished) drivePlayer(race, c, fromInts(ch.map(a => a[step]), prefs), dt);
      else driveAI(race, c, dt, c.finished ? rp.finishedAiSkill : 0);
    }
    collide(race);
    for (const e of car.events) if (e.type === EV.LAP) laps.push({ lap: car.lap - 1, time: e.time, invalid: !!e.invalid });
    onStep?.(race, car, step);
    for (const c of race.cars) c.events.length = 0;
  }
  return { race, car, laps };
}
