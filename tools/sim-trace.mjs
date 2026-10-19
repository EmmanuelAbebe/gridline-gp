// Seeded fingerprint of the simulation: runs fixed races with Math.random replaced by a seeded generator and
// hashes every car's state after every step. Two sources that print the same hashes behave identically, so use it
// to check that a refactor did not change the physics.
// Usage: node tools/sim-trace.mjs [old.html | path/to/sim/index.js]
import { createHash } from 'node:crypto';
import { loadSim } from './load-sim.mjs';

function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const realRandom = Math.random;
const S = await loadSim(process.argv[2]);
const dt = 1 / 120;

function trace(name, makeRace, seconds, drive) {
  Math.random = mulberry32(12345);
  const race = makeRace(), h = createHash('sha256'), buf = new Float64Array(6);
  for (let step = 0; step < seconds * 120 && !race.cars.every(c => c.finished); step++) {
    race.t += dt;
    for (const c of race.cars) drive(race, c, step);
    S.collide(race);
    for (const c of race.cars) {
      buf.set([c.x, c.z, c.h, c.v, c.lap, c.steer]); h.update(new Uint8Array(buf.buffer));
      h.update(c.events.map(e => e.type ?? e).join(',')); c.events.length = 0;   // ?? e: older builds pushed bare strings
    }
  }
  Math.random = realRandom;
  const order = S.order(race).map(c => c.code).join(' ');
  console.log(`${name.padEnd(10)} ${h.digest('hex').slice(0, 16)}  t=${race.t.toFixed(3)}  ${order}`);
}

// The player car follows a fixed input script: gas, braking, analog and digital steering, reversing.
const script = step => {
  const t = step * dt;
  return { thr: t % 9 < 6 ? 1 : 0.3, brk: t % 9 > 7.5 ? 1 : 0, steer: Math.sin(t * 0.7) * (t % 20 < 10 ? 1 : 0.4), analog: t % 30 < 15 };
};
const drivePlayerScript = (race, c, step) => c.player ? S.drivePlayer(race, c, script(step), dt) : S.driveAI(race, c, dt);
const driveAll = (race, c) => S.driveAI(race, c, dt, c.player ? 0.95 : 0);

trace('ai-3laps', () => S.createRace(3), 600, driveAll);
trace('scripted', () => S.createRace(2), 120, drivePlayerScript);
trace('timed', () => S.createRace({ type: 'timed', minutes: 1.5 }, { drivers: S.DRIVERS.slice(0, 4) }), 400, driveAll);
trace('unlimited', () => S.createRace({ type: 'unlimited' }, { drivers: S.DRIVERS.slice(5) }), 150, driveAll);
// the other circuits (run-off, walls, surfaces) and the pit lane with fuel, tyre wear and damage on
if (S.CIRCUITS && S.WEAR) {
  const wear = { fuel: 'high', tyres: 'high', damage: true };
  for (const id of Object.keys(S.CIRCUITS).filter(id => id !== S.track.id)) {
    const track = S.buildTrack(S.CIRCUITS[id]);
    trace(id.slice(0, 10), () => S.createRace(2, { track, drivers: S.DRIVERS.slice(0, 6) }), 300, drivePlayerScript);
  }
  trace('pits', () => S.createRace(6, { track: S.buildTrack(S.CIRCUITS.marrow ?? Object.values(S.CIRCUITS)[1]), wear }), 400, driveAll);
}
