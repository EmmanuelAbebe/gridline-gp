// A race's energy for an electric car (car classes step 2 stage 3: docs/formula-e-plan.md). Formula E races on one
// battery: an allowance for the whole race (the FIA sets it per event, so that running flat out doesn't reach the
// flag), ~40 % of it won back under braking, and the drivers lift and coast before the braking points to make it last.
// Here: lapEnergy = the net energy of a flat-out lap (measured: the fastest AI driver alone); the race's allowance = laps × that × ENERGY.budget (timed races: the laps
// the time gives at that pace). Unlimited races (time trials) get a lap's allowance afresh at every crossing of the line
// (a qualifying lap). Every electric car keeps a lift distance (c.liftM): metres before a braking point to coast,
// set at each crossing of the line from the energy the last lap took against what is left per lap to go; the AI lifts
// there (driving.js), the player's HUD shows LIFT. A car with an engine: nothing here (race.energy null).
import { EV } from './tuning.js';
import { DRIVERS } from './drivers.js';
import { createRace } from './race.js';
import { driveAI } from './driving.js';
import { lapsToGo } from './pit.js';
import { aiOf } from './ai-profile.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */
/** @typedef {import('./types.js').Track} Track */
/** @typedef {import('./types.js').CarClass} CarClass */

const measured = new WeakMap(), DT = 1 / 120;
// A flat-out lap's net energy (J) and time (s) on this track in this class's car: the fastest AI driver alone at full
// pace, its flying lap (lap 2), on a battery that never runs out; measured once per track × class (~0.2–0.5 s). The
// race's allowance is made from it, as the FIA sets each event's from the cars' real consumption. (A formula, a point
// mass on the AI's speed profile, was tried first: ±10 % per circuit, so Cobalt Bay asked for an 18 % saving and ran dry.)
/** @param {Track} track @param {CarClass} cls @returns {{ energy: number, time: number }} */
export function lapEnergy(track, cls) {
  let byClass = measured.get(track);
  if (!byClass) measured.set(track, byClass = new Map());
  if (byClass.has(cls)) return byClass.get(cls);
  const driver = DRIVERS.filter(d => !d.player).reduce((a, d) => d.skill > a.skill ? d : a);
  const race = createRace(2, { carClass: cls, track, drivers: [driver], seed: 1, energy: false }), c = race.cars[0];
  c.soc = 1e12;
  let mark = 0, out = { energy: 0, time: 0 };
  for (let k = 0; k < 120 * 900 && !c.finished; k++) {
    race.t += DT; driveAI(race, c, DT);
    for (const e of c.events) if (e.type === EV.LAP) { if (c.lap === 2) mark = c.soc; else out = { energy: mark - c.soc, time: e.time }; }
    c.events.length = 0;
  }
  byClass.set(cls, out);
  return out;
}

// what a full battery is for the HUD's gauge: the race's allowance (a time trial's: a lap's), else the battery
/** @param {Race} race @param {Car} c */
export const batteryFull = (race, c) => race.energy ? race.energy.total ?? race.energy.perLap : c.spec.cls.ers.store;
// an electric car in its lift window now (a braking point closer than c.liftM, fast enough): the HUD's LIFT
/** @param {Race} race @param {Car} c */
export function liftNow(race, c) {
  if (!race.energy || !(c.liftM > 0) || c.v <= race.carClass.energy.liftFrom) return false;
  const T = race.track, to = aiOf(T, c.spec.cls).BRK[c.idx] * T.ds;
  return to > 0 && to < c.liftM;
}

// createRace: the allowance for every electric car (and race.energy); nothing for cars with engines
/** @param {Race} race */
export function setupEnergy(race) {
  race.energy = null;
  if (!race.carClass.car.motor) return;
  const lap = lapEnergy(race.track, race.carClass), ENERGY = race.carClass.energy;
  const laps = race.laps < Infinity ? race.laps : race.duration < Infinity ? race.duration / lap.time + 1 : null;
  race.energy = { lap: lap.energy, perLap: lap.energy * ENERGY.budget, total: laps ? laps * lap.energy * ENERGY.budget : null };
  for (const c of race.cars) {
    c.soc = race.energy.total ?? race.energy.perLap;
    c.energyMark = c.soc; c.energyLast = lap.energy; c.save = 0; c.liftM = 0; c.powerK = 1;
    liftFor(race, c);
  }
}

// at every crossing of the line (race.js updateLap): a time trial's lap allowance afresh; the saving for the laps to
// go (c.save 0..1: + savePerLap × the share of a lap's energy the last lap took above the allowance left per lap, −
// below it; per J, the long circuits' laps swung between full and 70 % power): its first `cutShare`
// = less motor power (c.powerK down to 1 − maxCut), the rest = lifting earlier too (c.liftM up to maxLift m before a
// braking point). Measured (2026-11-07, a flying lap): 20 % less power saved 13–18 % of the energy for 0.9–2.2 s, lifting
// 100–250 m 10–13 % for 2.5–6.3 s (coasting 1.5–2 s into each of ~9 braking zones): the power first. (Lift first: Elkmoor
// and Cantera ran dry on the last lap.)
/** @param {Race} race @param {Car} c */
export function energyAtLine(race, c) {
  const E = race.energy;
  if (!E) return;
  const measured = c.lap >= 2;                        // (a lap was driven; crossing the line from the grid: none yet)
  if (measured) c.energyLast = c.energyMark - c.soc;
  if (E.total === null) c.soc = E.perLap;            // (unlimited: every lap on a lap's allowance)
  c.energyMark = c.soc;
  if (measured) liftFor(race, c);
}
/** @param {Race} race @param {Car} c */
function liftFor(race, c) {
  const E = race.energy, ENERGY = race.carClass.energy, left = E.total === null ? 1 : Math.max(0.3, lapsToGo(race, c));
  const reserve = E.total === null ? 0 : E.total * ENERGY.reserve, target = Math.max(0, c.soc - reserve) / left, over = c.energyLast - target;
  c.save = Math.min(1, Math.max(0, c.save + over / E.lap * ENERGY.savePerLap));
  const C = ENERGY.cutShare;
  c.powerK = 1 - ENERGY.maxCut * Math.min(1, c.save / C);
  c.liftM = ENERGY.maxLift * Math.max(0, (c.save - C) / (1 - C));
}
