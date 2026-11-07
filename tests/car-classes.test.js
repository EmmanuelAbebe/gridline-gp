// Car classes (docs/car-classes-plan.md): the car is data. Step 1 keeps the 2026 F1 exactly as it was; these check the
// plumbing that later classes ride on: a spec knows its class, a race hands every car its class's stock spec, a replay
// names the class it was driven in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';

const F1 = S.DEFAULT_CLASS;
// a throwaway class: the F1 with stronger brakes (a stock value the spec copies) and its own id
const other = Object.freeze({ ...F1, id: 'test-brakes', chassis: Object.freeze({ ...F1.chassis, brakeSystem: 90 }) });

test('car classes: the F1 is the default class and its stock car is STOCK', () => {
  assert.equal(F1.id, 'f1');
  assert.equal(S.classOf('f1'), F1);
  assert.equal(S.classOf('nope'), null, 'an unknown id');
  assert.equal(S.classOf('toString'), null, 'not a property of every object');
  assert.equal(S.stockOf(F1), S.STOCK, 'made once per class');
  assert.equal(S.STOCK.cls, F1);
  assert.equal(S.carSpec({ wing: 8 }).cls, F1, 'a garage spec is the F1 unless told otherwise');
  assert.equal(F1.chassis, S.CHASSIS, 'the old table names are the class\'s tables');
});

test('car classes: a spec is made from its own class', () => {
  const st = S.stockOf(other);
  assert.equal(st.cls, other);
  assert.equal(st.brakeSystem, 90);
  assert.equal(S.STOCK.brakeSystem, S.CHASSIS.brakeSystem, 'the F1 untouched');
  assert.equal(S.stockOf(other), st, 'cached');
  assert.equal(S.carSpec({}, { brakes: 110 }, other).brakeSystem, 90 * 1.1);
});

test('car classes: a race gives every car its class\'s stock spec', () => {
  const f1 = S.createRace(1);
  assert.equal(f1.carClass, F1, 'the F1 by default');
  assert.ok(f1.cars.every(c => c.spec === S.STOCK));
  assert.equal(f1.hitbox, F1.hitbox.parts, 'the class\'s shape');
  const r = S.createRace(1, { carClass: other });
  assert.equal(r.carClass, other);
  assert.ok(r.cars.every(c => c.spec === S.stockOf(other)));
});

test('car classes: a replay names its class; one from before classes is the F1, an unknown class is refused', () => {
  const T = S.buildTrack(S.CIRCUITS.elkmoor), opts = { format: 1 };
  const race = S.createRace(opts.format, { track: T, drivers: [S.DRIVERS.find(d => d.player)], seed: 5 });
  const car = race.cars[0], rec = S.createReplayRecorder(race, opts, { setup: {}, mods: {}, compound: 'medium' });
  for (let k = 0; k < 240; k++) {
    const inp = S.quantizeInput({ steer: 0, thr: 1, brk: 0, analog: true, hb: 0, shift: 0, steerRate: Infinity, calm: 1, speedSteer: 0 });
    race.t += 1 / 120; rec.step(car, inp); S.drivePlayer(race, car, inp, 1 / 120);
  }
  const rp = JSON.parse(JSON.stringify(rec.finish()));
  assert.equal(rp.race.carClass, 'f1');
  const end = c => [c.x, c.z, c.v].join(',');
  assert.equal(end(S.replayRun(rp, { track: T }).car), end(car), 'replays the same');
  const old = structuredClone(rp); delete old.race.carClass;
  const again = S.replayRun(old, { track: T });
  assert.equal(again.race.carClass, F1, 'a replay from before car classes');
  assert.equal(end(again.car), end(car));
  const odd = structuredClone(rp); odd.race.carClass = 'hovercraft';
  assert.throws(() => S.replayRun(odd, { track: T }), /car class hovercraft/);
});

// (stage 3) the physics reads the car's class, not the F1's tables: a throwaway class with more power, a bigger battery,
// warmer blankets and a shorter wheelbase drives differently, and the F1 beside it is unchanged
test('car classes: the physics reads the car\'s own class', () => {
  const engine = { ...F1.car.engine, power: F1.car.engine.power.map(([rpm, kw]) => [rpm, kw * 1.3]) };
  const strong = Object.freeze({ ...F1, id: 'test-strong', car: Object.freeze({ ...F1.car, engine: Object.freeze(engine) }),
    ers: Object.freeze({ ...F1.ers, store: 6e6 }), tyreTemp: Object.freeze({ ...F1.tyreTemp, blanket: 95 }),
    chassis: Object.freeze({ ...F1.chassis, wheelbase: 2.8 }) });
  const T = S.buildTrack(S.CIRCUITS.harrow), you = [S.DRIVERS.find(d => d.player)];
  const run = cls => {
    const race = S.createRace(1, { carClass: cls, track: T, drivers: you, seed: 1, tyreTemp: true }), c = race.cars[0];
    c.assists = S.ASSISTS.medium; c.autoShift = true;
    const soc = c.soc, temp = c.tyreT.s[0];
    for (let k = 0; k < 360; k++) { race.t += 1 / 120; S.drivePlayer(race, c, { steer: 0, thr: 1, brk: 0, analog: true, steerRate: Infinity }, 1 / 120); }
    return { soc, temp, kmh: c.v * 3.6 };
  };
  const f1 = run(F1), st = run(strong);
  assert.equal(st.soc, 6e6 * F1.ers.start, 'its battery');
  assert.equal(st.temp, 95, 'its blankets');
  assert.equal(f1.temp, F1.tyreTemp.blanket);
  assert.ok(st.kmh > f1.kmh + 3, `its engine: ${st.kmh.toFixed(1)} vs ${f1.kmh.toFixed(1)} km/h after 3 s`);
  assert.ok(S.steerLock(80, 1, S.stockOf(strong)) < S.steerLock(80, 1, S.STOCK), 'its wheelbase: less lock for the same turn');
});

// (stage 4) the AI's line and speed profile on a circuit are per car class: the F1's is the track's own, another class
// gets its own (made once), and its AI cars drive by it
test('car classes: the AI plans with its own class', () => {
  const T = S.buildTrack(S.CIRCUITS.marrow);
  assert.equal(S.aiOf(T, F1), T, 'the F1\'s profile is the track\'s');
  const careful = Object.freeze({ ...F1, id: 'test-careful', ai: Object.freeze({ ...F1.ai, grip: 0.8, brake: 0.6 }) });
  const P = S.aiOf(T, careful);
  assert.notEqual(P, T); assert.equal(S.aiOf(T, careful), P, 'made once');
  const slowest = vp => Math.min(...vp);
  assert.ok(slowest(P.VP) < slowest(T.VP) - 1, `slower corners: ${slowest(P.VP).toFixed(1)} vs ${slowest(T.VP).toFixed(1)} m/s`);
  assert.ok(S.aiAeroPlan(T, false, careful) !== S.aiAeroPlan(T, false, F1), 'its own wing plan');
  // a race in that class: the AI drives its profile (slower than the F1's, clean)
  const lap = cls => {
    const race = S.createRace(1, { carClass: cls, track: T, drivers: [S.DRIVERS.find(d => d.code === 'VOS')], seed: 2 }), c = race.cars[0];
    let walls = 0;
    for (let k = 0; k < 120 * 120 && !c.finished; k++) {
      race.t += 1 / 120; S.driveAI(race, c, 1 / 120);
      walls += c.events.filter(e => e.type === S.EV.WALL).length; c.events.length = 0;
    }
    assert.ok(c.finished, `${cls.id}: finished the lap`); assert.equal(walls, 0, `${cls.id}: no walls`);
    return c.finishTime;
  };
  const f1 = lap(F1), slow = lap(careful);
  assert.ok(slow > f1 + 1, `the careful class's AI is slower: ${slow.toFixed(2)} vs ${f1.toFixed(2)} s`);
});
