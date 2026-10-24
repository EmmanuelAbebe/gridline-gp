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
  assert.equal(s.brakeBias, S.SETUP.brakes.def / 100); assert.equal(s.brakeSystem, S.CHASSIS.brakeSystem); assert.equal(s.rollFront, S.CHASSIS.rollFront);
  assert.equal(s.modified, false);
  const same = S.carSpec(Object.fromEntries(Object.entries(S.SETUP).filter(([, r]) => typeof r === 'object').map(([k, r]) => [k, r.def])));
  for (const k of ['dfK', 'dragK', 'grip', 'frontGrip', 'rearGrip', 'rollFront', 'aeroFront', 'brakeBias', 'brakeSystem', 'power', 'mass']) assert.equal(same[k], s[k], k);
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
  // (real-F1 physics since 2026-10-24: the top speed on a real straight, a charged battery)
  assert.ok(base.top > 318 && base.top < 342 && base.t100 < 3.1 && base.corner[80] > 165, JSON.stringify(base));
  const lo = st({ wing: 1 }), hi = st({ wing: 11 });
  assert.ok(lo.top > base.top && hi.top < base.top, 'less wing: faster on the straights');
  assert.ok(lo.corner[80] < base.corner[80] && hi.corner[80] > base.corner[80], 'more wing: faster in corners');
  assert.ok(hi.brake.dist < base.brake.dist, 'more wing: shorter braking');
  const fwd = st({ balance: 50 }), back = st({ balance: 40 });
  assert.ok(fwd.balance.fast > base.balance.fast && back.balance.fast < base.balance.fast, 'aero balance moves the fast-corner balance');
  const mf = st({ mech: 5 }), mr = st({ mech: -5 });
  // (the anti-roll bars: a softer front takes less of the sideways load transfer, so the front grips more and the rear
  // less, in slow and fast corners alike; straight-line traction is the same)
  assert.ok(mf.balance.slow > base.balance.slow && mf.balance.fast > base.balance.fast, 'softer front: turns in, the rear lets go sooner');
  assert.ok(mr.balance.slow < base.balance.slow && mr.balance.fast < base.balance.fast, 'stiffer front: understeer');
  assert.ok(st({ gearing: 310 }).top < base.top, 'short gears: the limiter caps the top speed');
  // (2026 power unit: the MGU-K's taper above 290 km/h caps the top speed before the limiter does, so long gears no
  // longer add top speed, even with a low wing; they cost acceleration)
  assert.ok(st({ gearing: 380 }).t200 > base.t200 && st({ wing: 1, gearing: 380 }).top < lo.top + 3, 'long gears: slower to get there, no faster');
  assert.ok(st({}, { power: 150 }).t200 < base.t200 && st({}, { mass: 1000 }).t200 > base.t200, 'mods do what they say');
});

test('a car on a garage spec drives and races normally', () => seeded(() => {
  const race = S.createRace(2, { drivers: S.DRIVERS.slice(0, 4) });
  race.cars[0].spec = S.carSpec({ wing: 9, balance: 47, brakes: 55, gearing: 330, mech: 2 });
  race.cars[1].spec = S.carSpec({}, { power: 150, grip: 120 });
  run(S, race, 300, aiDriver(S));
  assert.ok(race.cars.every(c => c.finished), race.cars.map(c => `${c.code} lap ${c.lap}`).join(', '));
}));
