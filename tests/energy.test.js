// A race's energy for an electric car (src/sim/energy.js; car classes step 2 stage 3, docs/formula-e-plan.md): the
// battery is the race's allowance, sized from a measured flat-out lap at the race's level (LEGEND / ALIEN); the cars save
// the rest (less power, then lifting) to reach the flag with a little left. The F1 has none of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';

const DT = 1 / 120, FE = S.classOf('fe'), VOS = () => [S.DRIVERS.find(d => d.code === 'VOS')];
function run(race, c, { force = null, steps = 120 * 1200 } = {}) {
  let empty = false;
  for (let k = 0; k < steps && !c.finished; k++) {
    if (force) Object.assign(c, force);
    race.t += DT; S.driveAI(race, c, DT); c.events.length = 0; if (c.soc <= 0) empty = true;
  }
  return empty;
}

test('energy: the F1 has no race allowance (its battery is per lap)', () => {
  const race = S.createRace(5, { track: S.buildTrack(S.CIRCUITS.elkmoor) });
  assert.equal(race.energy, null);
  assert.equal(S.batteryFull(race, race.cars[0]), S.ERS.store);
});

test('energy: the allowance is the race\'s laps × a measured flat-out lap × the budget; time trials get a lap\'s each lap', () => {
  const T = S.buildTrack(S.CIRCUITS.elkmoor), lap = S.lapEnergy(T, FE), B = FE.energy.budget;
  assert.ok(lap.energy > 1.2 * 3.6e6 && lap.energy < 2.5 * 3.6e6 && lap.time > 40 && lap.time < 60, `a lap: ${(lap.energy / 3.6e6).toFixed(2)} kWh, ${lap.time.toFixed(1)} s`);
  assert.equal(S.lapEnergy(T, FE), lap, 'measured once');
  const race = S.createRace(8, { carClass: FE, track: T, drivers: VOS(), seed: 3 });
  assert.equal(race.cars[0].soc, 8 * lap.energy * B);
  const timed = S.createRace({ type: 'timed', minutes: 5 }, { carClass: FE, track: T, drivers: VOS(), seed: 3 });
  assert.equal(timed.energy.total, (300 / lap.time + 1) * lap.energy * B, 'timed: the laps the time gives');
  const trial = S.createRace({ type: 'unlimited' }, { carClass: FE, track: T, drivers: VOS(), seed: 3 }), c = trial.cars[0];
  assert.equal(trial.energy.total, null); assert.equal(c.soc, lap.energy * B);
  run(trial, c, { steps: 120 * 140 });
  assert.ok(c.lap >= 3, 'two laps and more on lap allowances');
});

test('energy: the AI makes it last at LEGEND and ALIEN: the flag with a little left; flat out the battery runs dry first', () => {
  for (const id of ['elkmoor', 'harrow']) for (const aiAlien of [false, true]) {
    const T = S.buildTrack(S.CIRCUITS[id]), at = `${id}${aiAlien ? ' (ALIEN)' : ''}`;
    const race = S.createRace(8, { carClass: FE, track: T, drivers: VOS(), seed: 3, aiAlien }), c = race.cars[0], total = c.soc;
    assert.equal(total, 8 * S.lapEnergy(T, FE, aiAlien).energy * FE.energy.budget, `${at}: its level's allowance`);
    const empty = run(race, c);
    assert.ok(c.finished && !empty, `${at}: finished without running dry`);
    assert.ok(c.soc > 0.01 * total && c.soc < 0.06 * total, `${at}: ${(c.soc / total * 100).toFixed(1)} % left at the flag`);
    assert.ok(c.powerK < 1, `${at}: it saved (power ${c.powerK.toFixed(2)})`);
    const greedy = S.createRace(8, { carClass: FE, track: T, drivers: VOS(), seed: 3, aiAlien }), g = greedy.cars[0];
    assert.ok(run(greedy, g, { force: { save: 0, powerK: 1, liftM: 0 } }), `${at}: flat out it runs dry before the flag`);
  }
});

test('energy: lifting and coasting: the AI comes off the throttle before a braking point, the HUD says LIFT', () => {
  const T = S.buildTrack(S.CIRCUITS.harrow), race = S.createRace(3, { carClass: FE, track: T, drivers: VOS(), seed: 3 }), c = race.cars[0];
  let lifted = 0, cued = 0;
  for (let k = 0; k < 120 * 70; k++) {
    c.liftM = 150; c.save = 1;
    race.t += DT; S.driveAI(race, c, DT); c.events.length = 0;
    if (S.liftNow(race, c)) { cued++; if (c.thr === 0 && c.brake === 0) lifted++; }
  }
  assert.ok(cued > 120 && lifted > 0.9 * cued, `in the lift window ${(cued / 120).toFixed(1)} s, coasting ${(lifted / 120).toFixed(1)} s of it`);
});
