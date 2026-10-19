// Car specs (src/sim/spec.js, spec-stats.js): the stock spec is exactly the shared car, setups and mods are validated,
// every setup item is a trade-off (it buys something and costs something), and a car on a garage spec races normally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { run, aiDriver, seeded } from './helpers.js';

test('the stock spec is the shared car, exactly', () => {
  const s = S.STOCK, A = S.CAR.aero;
  assert.equal(s.dfK, 0.5 * A.rho * A.liftArea / S.CAR.mass);
  assert.equal(s.dragK, 0.5 * A.rho * A.dragArea / S.CAR.mass);
  assert.deepEqual(s.top, S.CAR.gearbox.top);
  assert.equal(s.grip, S.CAR.grip); assert.equal(s.rearGrip, S.CHASSIS.rearGrip); assert.equal(s.aeroFront, S.CHASSIS.aeroFront);
  assert.equal(s.brakeBias, S.CHASSIS.brakeBias); assert.equal(s.brakeSystem, S.CHASSIS.brakeSystem);
  assert.equal(s.modified, false);
  const same = S.carSpec(Object.fromEntries(Object.entries(S.SETUP).filter(([, r]) => typeof r === 'object').map(([k, r]) => [k, r.def])));
  for (const k of ['dfK', 'dragK', 'grip', 'frontGrip', 'rearGrip', 'aeroFront', 'brakeBias', 'brakeSystem', 'power', 'mass']) assert.equal(same[k], s[k], k);
  assert.equal(S.createRace(1).cars[0].spec, S.STOCK, 'every car starts stock');
});

test('setup and mods are clamped and snapped; any mod flags the car', () => {
  assert.deepEqual(S.validSetup({ wing: 99, balance: 44.2, brakes: 'x', gearing: null, mech: -2.4 }),
    { wing: 11, balance: 44, brakes: 57, gearing: 340, mech: -2 });
  assert.equal(S.validMods({ power: 1000 }).power, S.MODS.power.max);
  assert.equal(S.isModified({}), false);
  assert.equal(S.isModified({ mass: 790 }), true);
  assert.equal(S.carSpec({ wing: 1 }).modified, false, 'a setup is not a mod');
  assert.equal(S.carSpec({}, { grip: 120 }).modified, true);
});

test('every setup item is a trade-off', () => {
  const st = (setup, mods) => S.specStats(S.carSpec(setup, mods)), base = st();
  assert.ok(base.top > 320 && base.top < 340 && base.t100 < 2.5 && base.corner[80] > 200, JSON.stringify(base));
  const lo = st({ wing: 1 }), hi = st({ wing: 11 });
  assert.ok(lo.top > base.top && hi.top < base.top, 'less wing: faster on the straights');
  assert.ok(lo.corner[80] < base.corner[80] && hi.corner[80] > base.corner[80], 'more wing: faster in corners');
  assert.ok(hi.brake.dist < base.brake.dist, 'more wing: shorter braking');
  const fwd = st({ balance: 50 }), back = st({ balance: 40 });
  assert.ok(fwd.balance.fast > base.balance.fast && back.balance.fast < base.balance.fast, 'aero balance moves the fast-corner balance');
  const mf = st({ mech: 5 }), mr = st({ mech: -5 });
  assert.ok(mf.balance.slow > base.balance.slow && mf.t100 > base.t100, 'front mechanical grip: turns in, but less traction');
  assert.ok(mr.balance.slow < base.balance.slow && mr.t100 <= base.t100);
  assert.ok(st({ gearing: 310 }).top < base.top, 'short gears: the limiter caps the top speed');
  assert.ok(st({ wing: 1, gearing: 380 }).top > lo.top, 'low wing needs long gears');
  assert.ok(st({}, { power: 150 }).t200 < base.t200 && st({}, { mass: 1000 }).t200 > base.t200, 'mods do what they say');
});

test('a car on a garage spec drives and races normally', () => seeded(() => {
  const race = S.createRace(2, { drivers: S.DRIVERS.slice(0, 4) });
  race.cars[0].spec = S.carSpec({ wing: 9, balance: 47, brakes: 55, gearing: 330, mech: 2 });
  race.cars[1].spec = S.carSpec({}, { power: 150, grip: 120 });
  run(S, race, 300, aiDriver(S));
  assert.ok(race.cars.every(c => c.finished), race.cars.map(c => `${c.code} lap ${c.lap}`).join(', '));
}));
