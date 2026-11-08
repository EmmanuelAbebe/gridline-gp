// Formula E's tyres (car classes step 2 stage 5, docs/formula-e-plan.md): one all-weather tyre for the race, no
// blankets (a set starts at the air's temperature), a lower, wider window than a slick's, very little wear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { tyreSet, gripTemp, tempGrip } from '../src/sim/tyre-temp.js';

const DT = 1 / 120, FE = S.classOf('fe'), VOS = () => [S.DRIVERS.find(d => d.code === 'VOS')];
function race(id, opts = {}, laps = 6) {
  const r = S.createRace(laps, { carClass: FE, track: S.buildTrack(S.CIRCUITS[id]), drivers: VOS(), seed: 3, ...opts }), c = r.cars[0], times = [], temps = [];
  let walls = 0, stops = 0;
  for (let k = 0; k < 120 * 1200 && !c.finished; k++) {
    r.t += DT; S.driveAI(r, c, DT);
    for (const e of c.events) {
      if (e.type === S.EV.LAP) { times.push(e.time); if (c.tyreT) temps.push(Math.min(...[0, 1, 2, 3].map(i => gripTemp(c.tyreT, i)))); }
      if (e.type === S.EV.WALL) walls++;
      if (e.type === S.EV.PIT_STOP) stops++;
    }
    c.events.length = 0;
  }
  return { c, times, temps, walls, stops };
}

test('fe tyres: one compound, no blankets: a set starts at the air\'s temperature; a strategy\'s other compound fits it', () => {
  assert.deepEqual(Object.keys(FE.compounds), ['medium']);
  const t = tyreSet(undefined, 'medium', FE);
  assert.ok(t.s.every(x => x === FE.tyreTemp.air) && t.k.every(x => x === FE.tyreTemp.air) && !t.warm);
  const r = S.createRace(3, { carClass: FE, track: S.buildTrack(S.CIRCUITS.elkmoor), drivers: VOS(), compound: 'soft', tyreTemp: true });
  assert.equal(r.cars[0].compound, 'medium');
  assert.equal(r.cars[0].tyreT.s[0], FE.tyreTemp.air);
});

test('fe tyres: from cold they come in over the first laps, then cost nothing; the AI without assists stays clean', () => {
  for (const id of ['harrow', 'cantera']) {
    const plain = race(id), warm = race(id, { tyreTemp: true }), off = race(id, { tyreTemp: true, aiAssists: S.ASSISTS.off });
    const d1 = warm.times[0] - plain.times[0], d3 = warm.times[2] - plain.times[2];
    assert.ok(d1 > 0.5 && d1 < 3.5, `${id}: lap 1 ${d1.toFixed(2)} s slower from the air's temperature`);
    const d5 = warm.times[4] - plain.times[4];
    assert.ok(Math.abs(d3) < 0.6 && Math.abs(d5) < 0.2, `${id}: lap 3 ${d3.toFixed(2)} s, lap 5 ${d5.toFixed(2)} s`);
    const k3 = tempGrip(warm.temps[2], FE.tyreTemp.window, FE.tyreTemp);
    assert.ok(k3 > 0.95, `${id}: the coldest tyre ${warm.temps[2].toFixed(0)} °C after lap 3, grip × ${k3.toFixed(3)}`);
    assert.ok(warm.temps.every(t => t <= FE.tyreTemp.window[1]), `${id}: never past the window`);
    assert.equal(off.walls, 0, `${id}: no assists, no walls`);
  }
});

test('fe tyres: a race on one set: little wear, no stop for tyres', () => {
  const r = race('elkmoor', { wear: { tyres: 'normal' }, tyreTemp: true }, 10);
  assert.ok(r.c.tyreWear > 0 && r.c.tyreWear < 0.35, `worn ${(r.c.tyreWear * 100).toFixed(0)} % after 10 laps`);
  assert.equal(r.stops, 0);
});
