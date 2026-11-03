// Tyre temperatures (src/sim/tyre-temp.js, TYRE_TEMP in tuning.js): the grip window, off unless a race asks for it,
// warming up from the blankets into the window at racing pace, a slow lap cooling them, wheelspin heating the rears,
// a pit stop's fresh set, and the AI (no assists either) lapping clean on cold tyres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from './helpers.js';
import { SIM } from '../src/sim/index.js';

const TT = SIM.TYRE_TEMP, track = SIM.track;

test('the grip window: full grip between 90 and 110 °C, less cold, less hot', () => {
  for (const t of [90, 100, 110]) assert.equal(SIM.tempGrip(t), 1);
  assert.ok(Math.abs(SIM.tempGrip(70) - 0.918) < 0.005, `blankets: ${SIM.tempGrip(70)}`);
  assert.ok(SIM.tempGrip(30) < SIM.tempGrip(70) && SIM.tempGrip(30) > 0.8, 'really cold');
  assert.ok(SIM.tempGrip(130) < 1 && SIM.tempGrip(150) < SIM.tempGrip(130) && SIM.tempGrip(300) >= 1 - TT.hot.max, 'overheated');
});

function aiRace(opts = {}) {
  const race = SIM.createRace({ type: 'unlimited' }, { track, drivers: SIM.DRIVERS.filter(d => d.code === 'VOS'), seed: 7, ...opts });
  race.started = true; return { race, c: race.cars[0] };
}
const lap = (race, c, laps, skill = 0) => { const to = c.lap + laps; let walls = 0;
  while (c.lap < to && race.t < 900) { race.t += DT; SIM.driveAI(race, c, DT, skill); walls += c.events.filter(e => e.type === SIM.EV.WALL).length; c.events.length = 0; }
  return walls; };

test('off unless the race asks for it; on, every car starts on a fresh set off the blankets', () => {
  assert.equal(aiRace().c.tyreT, null);
  const { c } = aiRace({ tyreTemp: true });
  assert.deepEqual(c.tyreT.s, [TT.blanket, TT.blanket, TT.blanket, TT.blanket]);
});

test('from the blankets into the window at racing pace; a slow lap cools them; a push lap brings them back', () => {
  const { race, c } = aiRace({ tyreTemp: true });
  assert.equal(lap(race, c, 3), 0, 'no walls');
  const warm = [0, 1, 2, 3].map(i => SIM.gripTemp(c.tyreT, i));
  assert.ok(warm.every(t => t > 78 && t < 125), `after 2 laps: ${warm.map(t => t.toFixed(0))}`);
  assert.ok(Math.max(...warm) - Math.min(...warm) < 30, 'the four within 30 °C of each other (outer and inner wheels)');
  lap(race, c, 1, 0.55);
  const cool = [0, 1, 2, 3].map(i => SIM.gripTemp(c.tyreT, i));
  assert.ok(cool.every((t, i) => t < warm[i]), `a slow lap cools them: ${cool.map(t => t.toFixed(0))}`);
});

test('wheelspin heats the rears, not the fronts', () => {
  const race = SIM.createRace({ type: 'unlimited' }, { track, drivers: SIM.DRIVERS.filter(d => d.player), seed: 1, tyreTemp: true });
  const c = race.cars[0]; c.assists = SIM.ASSISTS.off; race.started = true;
  for (let t = 0; t < 10; t += DT) { race.t += DT; SIM.drivePlayer(race, c, { steer: 1, thr: 1, brk: 0, analog: true, steerRate: Infinity }, DT); c.events.length = 0; }
  assert.ok(c.tyreT.s[2] > TT.blanket + 15 && c.tyreT.s[3] > TT.blanket + 15, `rears ${c.tyreT.s.slice(2).map(t => t.toFixed(0))}`);
  assert.ok(c.tyreT.s[0] < TT.blanket + 3, `fronts ${c.tyreT.s.slice(0, 2).map(t => t.toFixed(0))}`);
});

test('a pit stop fits a fresh set at the blankets\' temperature', () => {
  const { race, c } = aiRace({ tyreTemp: true, wear: { tyres: 'normal' } });
  lap(race, c, 2);
  assert.ok(Math.max(...c.tyreT.s) > TT.blanket + 10, 'warm before the stop');
  let ready = null;
  for (let k = 0; k < 120 * 200 && !ready; k++) {
    if (!c.pitStops && !c.pit) c.pitRequest = true;
    race.t += DT; SIM.driveAI(race, c, DT, 0);
    if (c.events.some(e => e.type === SIM.EV.PIT_READY)) ready = c.tyreT.s.slice();
    c.events.length = 0;
  }
  assert.ok(ready, 'it stopped');
  assert.ok(ready.every(t => Math.abs(t - TT.blanket) < 2), `fresh tyres: ${ready.map(t => t.toFixed(1))}`);
});

test('the AI laps clean from cold tyres without assists, every circuit (ALIEN and LEGEND)', () => {
  for (const [id, circuit] of Object.entries(SIM.CIRCUITS)) {
    const t = SIM.buildTrack(circuit);
    for (const aiAlien of [true, false]) {
      const race = SIM.createRace({ type: 'unlimited' }, { track: t, drivers: SIM.DRIVERS.filter(d => d.code === 'VOS'), seed: 11, tyreTemp: true, activeAero: true, aiAlien, aiAssists: SIM.ASSISTS.off });
      const c = race.cars[0]; race.started = true; let walls = 0, spins = 0, was = false;
      while (c.lap < 3 && race.t < 400) {
        race.t += DT; SIM.driveAI(race, c, DT, 0); walls += c.events.filter(e => e.type === SIM.EV.WALL).length; c.events.length = 0;
        const s = Math.abs(SIM.driftAngle(c)) > 0.5; if (s && !was) spins++; was = s;
      }
      assert.equal(c.lap, 3, `${id} ${aiAlien ? 'ALIEN' : 'LEGEND'}: two laps done`);
      assert.equal(walls + spins, 0, `${id} ${aiAlien ? 'ALIEN' : 'LEGEND'}: ${walls} walls, ${spins} spins`);
    }
  }
});

test('tyre pressures (garage Setup → Tyres): lower = more grip and hotter tyres, higher = less grip and cooler; stock changes nothing', () => {
  const S = SIM, DT = 1 / 120, T = S.buildTrack(S.CIRCUITS.elkmoor);
  const run = setup => {
    const race = S.createRace(2, { track: T, drivers: [S.DRIVERS[0]], seed: 7, tyreTemp: true }), c = race.cars[0];
    c.spec = S.carSpec(setup);
    for (let s = 0; s < 120 * 200 && !c.finished; s++) { race.t += DT; S.driveAI(race, c, DT); c.events.length = 0; }
    return { core: c.tyreT.k.reduce((a, b) => a + b) / 4, x: c.x };
  };
  const low = run({ pressF: 20, pressR: 18 }), stock = run({}), same = run({ pressF: 23, pressR: 21 }), high = run({ pressF: 26, pressR: 24 });
  assert.equal(same.x, stock.x, 'the stock pressures are the stock car');
  assert.ok(low.core > stock.core + 3 && high.core < stock.core - 3, `core °C: low ${low.core.toFixed(1)}, stock ${stock.core.toFixed(1)}, high ${high.core.toFixed(1)}`);
  const sp = (p, q) => S.carSpec({ pressF: p, pressR: q });
  assert.ok(sp(21, 19).frontGrip > 1 && sp(25, 23).frontGrip < 1 && sp(20, 18).frontGrip < sp(21, 19).frontGrip, 'grip: more lower, until the sidewall folds');
  assert.ok(sp(20, 18).peakF > S.STOCK.peakF && sp(26, 24).peakR < S.STOCK.peakR, 'a softer tyre peaks at a bigger slip angle');
});
