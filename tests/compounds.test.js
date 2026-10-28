// Tyre compounds (COMPOUNDS, pit.js fitTyres / bestCompound) and the pit box options (c.pitPlan): soft is quicker and
// wears sooner, hard the other way, each warms in its own window; the team's choice; what the crew does at a stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, run, seeded, aiDriver } from './helpers.js';

const fastest = () => [S.DRIVERS.filter(d => !d.player).reduce((a, d) => d.skill > a.skill ? d : a)];
// the fastest AI driver alone: its best flying lap of 3 on that compound
function bestLap(compound, opts = {}) {
  const race = S.createRace({ type: 'unlimited' }, { drivers: fastest(), seed: 7, compound, ...opts }), c = race.cars[0];
  let best = Infinity, walls = 0;
  while (c.lap <= 3 && race.t < 300) {
    race.t += DT; S.driveAI(race, c, DT);
    for (const e of c.events) { if (e.type === S.EV.LAP && c.lap > 2) best = Math.min(best, e.time); if (e.type === S.EV.WALL) walls++; }
    c.events.length = 0;
  }
  return { best, walls, c };
}

test('compounds: medium is the old tyre (a race that picks none is unchanged); soft quicker, hard slower, all clean', () => {
  const race = S.createRace(3);
  assert.ok(race.cars.every(c => c.compound === 'medium' && c.planWear === S.PIT.ai.tyres && c.pitPlan.tyres === 'same'));
  assert.equal(S.carCondition(race.cars[0]).grip, 1);
  const [soft, medium, hard] = ['soft', 'medium', 'hard'].map(k => bestLap(k));
  assert.ok(soft.best < medium.best - 0.1 && medium.best < hard.best - 0.1, `${soft.best.toFixed(2)} / ${medium.best.toFixed(2)} / ${hard.best.toFixed(2)}`);
  assert.ok(medium.best - soft.best < 1 && hard.best - medium.best < 1, 'within a second of each other');
  assert.equal(soft.walls + medium.walls + hard.walls, 0, 'no wall hits');
});

test('compounds: soft wears out sooner, hard lasts longer', () => {
  const wear = k => {
    const race = S.createRace(3, { drivers: fastest(), seed: 3, compound: k, wear: { tyres: 'normal' } }), c = race.cars[0];
    run(S, race, 120, aiDriver(S)); return c.tyreWear;
  };
  const [soft, medium, hard] = ['soft', 'medium', 'hard'].map(wear);
  assert.ok(Math.abs(soft / medium - 1 / 0.6) < 0.15 && Math.abs(hard / medium - 1 / 1.6) < 0.1, `${soft.toFixed(3)} / ${medium.toFixed(3)} / ${hard.toFixed(3)}`);
});

test('compounds: each has its own temperature window (soft cooler, hard hotter)', () => {
  const soft = S.tyreSet(95, 'soft'), hard = S.tyreSet(95, 'hard'), medium = S.tyreSet(95);
  assert.deepEqual(medium.win, S.TYRE_TEMP.window);
  assert.equal(S.axleTempGrip(soft).f, 1);
  assert.equal(S.axleTempGrip(medium).f, 1);
  assert.ok(S.axleTempGrip(hard).f < 1, 'a hard at 95 °C is still cold');
  assert.ok(S.tempGrip(112, S.COMPOUNDS.soft.window) < S.tempGrip(112), 'a soft at 112 °C is overheating');
  // from the blankets the soft is up to speed sooner: a quicker first flying lap
  const lap1 = k => { const r = S.createRace({ type: 'unlimited' }, { drivers: fastest(), seed: 7, compound: k, tyreTemp: true }), c = r.cars[0];
    while (c.lap < 2) { r.t += DT; S.driveAI(r, c, DT); c.events.length = 0; } return r.t; };
  assert.ok(lap1('soft') < lap1('medium') && lap1('medium') < lap1('hard'));
});

test('strategy: soft for a short race, harder for a long one; soft with no tyre wear', () => {
  const pick = (laps, tyres = 'normal') => { const r = S.createRace(laps, { wear: { tyres } }); return S.bestCompound(r, r.cars[0]); };
  assert.equal(pick(3).compound, 'soft');
  assert.equal(pick(3).stops, 0);
  assert.notEqual(pick(12).compound, 'soft');
  assert.ok(pick(30).stops >= 1, 'a long race needs a stop');
  assert.equal(pick(30, 'off').compound, 'soft');
  // 'auto': every AI car on its team's choice, planning its stop
  const r = S.createRace(30, { compound: 'auto', wear: { tyres: 'normal' } });
  for (const c of r.cars) { assert.equal(c.compound, S.bestCompound(r, c).compound); assert.equal(c.pitPlan.tyres, 'auto'); assert.ok(c.planWear <= S.PIT.ai.tyres); }
});

test('pit box options: the crew fits the planned compound, and leaves the wing and repairs when told to', () => seeded(() => {
  const race = S.createRace(8, { aiPace: 0.95, compound: 'auto', wear: { tyres: 'high', damage: true } });
  const c = race.cars[0];
  c.pitPlan = { tyres: 'hard', wing: false, repair: false };
  let served = null;
  run(S, race, 120, (r, car) => {
    if (car === c && !car.pitStops && car.lap === 2) { car.pitRequest = true; car.damage.wing = 0.5; car.damage.floor = 0.3; }
    aiDriver(S)(r, car);
    for (const e of car.events) if (car === c && e.type === S.EV.PIT_STOP) served = e.service;
    if (car.lap >= 3) car.finished = true;
  });
  assert.ok(served, 'it stopped');
  assert.equal(served.compound, 'hard');
  assert.ok(!served.wing && !served.repair, 'no wing, no repairs');
  assert.equal(c.compound, 'hard');
  assert.ok(c.damage.wing >= 0.5 && c.damage.floor >= 0.3, 'the damage is still there');
}));

test('strategy race: a 12-lap race with the teams choosing, everyone finishes, the stops follow their plans', () => seeded(() => {
  const race = S.createRace(12, { aiPace: 0.95, compound: 'auto', wear: { tyres: 'normal' } }), stints = new Map();
  for (const c of race.cars) stints.set(c, [c.compound]);
  const seen = run(S, race, 900, (r, c) => { aiDriver(S)(r, c); if (c.events.some(e => e.type === S.EV.PIT_STOP)) stints.get(c).push(c.pitPlan.tyres); });
  assert.ok(race.cars.every(c => c.finished), 'all finished');
  for (const c of race.cars) assert.ok(c.pitStops <= 2 && c.tyreWear < 0.95, `${c.code}: ${c.pitStops} stops, wear ${c.tyreWear.toFixed(2)} (${stints.get(c)})`);
  const walls = race.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0);
  assert.ok(walls <= 2, `${walls} wall hits`);
}));
