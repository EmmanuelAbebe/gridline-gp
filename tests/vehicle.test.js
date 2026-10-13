// Vehicle model tests: gearbox, engine, downforce, brakes and slipstream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT } from './helpers.js';

const T = S.track, V = S.VEHICLE;
const kmh = v => v * 3.6;
const solo = (code = 'YOU') => { const race = S.createRace(1, { drivers: S.DRIVERS.filter(d => d.code === code) }); return { race, c: race.cars[0] }; };
// Keep a car on a line `off` metres right of the centre: heading along the track, nudged toward the line.
const follow = (c, off = 0) => { c.h = S.headingAt(T, c.idx) + S.clamp((off - c.lat) * 0.1, -0.2, 0.2); };
// Drive along the track with steering replaced by follow(), so only the drivetrain is tested.
function straight(race, c, inp, seconds, each = () => {}) {
  for (let i = 0; i < seconds * 120; i++) {
    race.t += DT;
    S.drivePlayer(race, c, typeof inp === 'function' ? inp(i) : inp, DT);
    follow(c);
    each(c, i);
  }
}
const GAS = { thr: 1, brk: 0, steer: 0, analog: false }, BRAKE = { thr: 0, brk: 1, steer: 0, analog: false };

test('auto gearbox: accelerating, gears only go up and revs stay in the power band', () => {
  const { race, c } = solo();
  let maxGear = 1, low = Infinity, high = 0;
  straight(race, c, GAS, 25, c => {
    assert.ok(c.gear >= maxGear, `gear went down to ${c.gear} at ${kmh(c.v).toFixed(0)} km/h`);
    maxGear = c.gear;
    if (c.v > 22) { low = Math.min(low, c.rpm); high = Math.max(high, c.rpm); }   // below ~80 km/h the clutch slips in 1st
  });
  assert.equal(maxGear, V.gears, 'reaches top gear');
  assert.ok(low > 8000 && high < V.limiter, `rpm range ${low.toFixed(0)}–${high.toFixed(0)}`);
  assert.ok(kmh(c.v) > 320 && kmh(c.v) < 335, `top speed ${kmh(c.v).toFixed(1)} km/h`);
});

test('auto gearbox: braking from top speed goes down the box without over-revving', () => {
  const { race, c } = solo();
  straight(race, c, GAS, 25);
  let gear = c.gear;
  straight(race, c, BRAKE, 6, c => {
    if (c.v < 1) return;
    assert.ok(c.gear <= gear, 'never shifts up under braking');
    gear = c.gear;
    assert.ok(c.rpm < V.limiter, `rpm ${c.rpm.toFixed(0)} in gear ${c.gear}`);
  });
  assert.ok(c.v <= 0.3, 'stopped');
});

test('gear matches speed: the same speed always shows the same gear band (auto)', () => {
  // for every speed band, the gear chosen accelerating and braking may differ by at most one
  const up = new Map(), down = new Map();
  const { race, c } = solo();
  straight(race, c, GAS, 25, c => { if (c.v > 20) up.set(Math.round(kmh(c.v) / 20), c.gear); });
  straight(race, c, BRAKE, 6, c => { if (c.v > 20) down.set(Math.round(kmh(c.v) / 20), c.gear); });
  for (const [band, g] of down) if (up.has(band)) assert.ok(Math.abs(up.get(band) - g) <= 1, `${band * 20} km/h: ${up.get(band)} up vs ${g} down`);
});

test('manual gearbox: paddles shift, over-revving downshift is refused, wrong gear is slow', () => {
  const { race, c } = solo();
  c.autoShift = false;
  straight(race, c, GAS, 3);
  assert.equal(c.gear, 1, 'no automatic shifts');
  assert.ok(c.rpm >= V.redline, 'sits on the limiter');
  for (let g = 2; g <= 4; g++) { straight(race, c, { ...GAS, shift: +1 }, DT); assert.equal(c.gear, g); }
  straight(race, c, GAS, 5);
  c.events.length = 0;
  straight(race, c, { ...GAS, shift: -1 }, DT); straight(race, c, { ...GAS, shift: -1 }, DT); straight(race, c, { ...GAS, shift: -1 }, DT);
  assert.ok(c.events.includes(S.EV.SHIFT_DENIED), 'downshift into an over-rev was refused');
  assert.equal(c.gear, 4, 'all three refused: 3rd would over-rev at this speed');
  // from 80 km/h, 3rd pulls much harder than 8th
  const pull = gear => { const t = solo(); t.c.autoShift = false; t.c.gear = gear; t.c.v = 80 / 3.6; straight(t.race, t.c, GAS, 2); return t.c.v; };
  assert.ok(pull(3) > pull(8) + 8, `3rd ${kmh(pull(3)).toFixed(0)} vs 8th ${kmh(pull(8)).toFixed(0)} km/h after 2 s`);
});

test('downforce: slow corners like before, fast corners much faster; brakes stronger at speed', () => {
  const old = R => Math.sqrt(37 * R);          // the old constant-grip model
  assert.ok(Math.abs(S.cornerSpeed(1 / 24) / old(24) - 1) < 0.05, 'hairpin about the same');
  assert.ok(S.cornerSpeed(1 / 75) > old(75) * 1.25, 'R75 corner at least 25% faster');
  assert.ok(S.cornerSpeed(1 / 400) >= S.TUNING.V_CAP, 'gentle curves are flat out');
  assert.ok(S.brakeLimit(85) > 2 * S.brakeLimit(20));
  assert.ok(S.lateralGrip(80) > 2 * S.lateralGrip(10));
});

test('slipstream: strong in the wake, none beside it, and the follower gains speed', () => {
  const setup = () => {
    const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [lead, tail] = race.cars;
    lead.v = tail.v = 250 / 3.6;
    // tail 15 m behind the leader, both on the centre line
    tail.idx = (lead.idx - Math.round(15 / T.ds) + T.N) % T.N; tail.x = T.PX[tail.idx]; tail.z = T.PZ[tail.idx]; tail.lap = lead.lap;
    return { race, lead, tail };
  };
  const run = (t, seconds, tailOff, hold = true) => {
    for (let i = 0; i < seconds * 120; i++) {
      t.race.t += DT;
      S.drivePlayer(t.race, t.lead, GAS, DT); follow(t.lead, 0);
      S.drivePlayer(t.race, t.tail, GAS, DT); follow(t.tail, tailOff);
      if (hold) t.tail.v = Math.min(t.tail.v, t.lead.v);       // keep the gap
    }
  };
  const a = setup();
  run(a, 1, 0);
  assert.ok(a.tail.slip > 0.4, `in the wake: ${a.tail.slip.toFixed(2)}`);
  assert.equal(a.tail.slipBy, a.lead);
  assert.equal(a.lead.slip, 0, 'the car in front gets nothing');
  run(a, 2, 6);
  assert.equal(a.tail.slip, 0, 'six metres to the side: no wake');
  // the same run, free to close up: in the wake the tail goes faster than beside it
  const b = setup(); run(b, 4, 0, false);
  const c = setup(); run(c, 4, 6, false);
  assert.ok(b.tail.v > c.tail.v + 1, `after 4 s: ${kmh(b.tail.v).toFixed(1)} km/h in the tow vs ${kmh(c.tail.v).toFixed(1)} beside`);
});
