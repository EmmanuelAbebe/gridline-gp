// Simulation tests: track geometry, a full AI race, the player driving model and the race formats.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, seeded, run, aiDriver } from './helpers.js';

const T = S.track;

test('track: Elkmoor geometry is drivable', () => {
  assert.ok(Math.abs(T.L - 2473) < 5, `length ${T.L}`);
  let maxK = 0; for (let i = 0; i < T.N; i++) maxK = Math.max(maxK, Math.abs(T.K[i]));
  assert.ok(1 / maxK > T.HW * 2, `tightest radius ${1 / maxK} m is wider than the road`);
  // separate parts of the circuit never come within two runoff widths of each other
  let minSep = Infinity;
  for (let i = 0; i < T.N; i += 2) for (let j = 0; j < T.N; j += 2) {
    let g = Math.abs(i - j); g = Math.min(g, T.N - g); if (g * T.ds < 120) continue;
    minSep = Math.min(minSep, Math.hypot(T.PX[i] - T.PX[j], T.PZ[i] - T.PZ[j]));
  }
  assert.ok(minSep > 2 * T.WALL, `closest approach ${minSep} m`);
});

test('track: a new circuit only needs control points', () => {
  const square = S.buildTrack({ name: 'Test', ctrl: [[0, 0], [400, 0], [400, 400], [0, 400]] });
  assert.ok(Math.abs(square.ds - 2.06) < 0.02, `a sample every ${square.ds} m`);   // sample count follows the length
  assert.ok(square.L > 1500 && square.L < 1800, `length ${square.L}`);   // the spline bulges past a 4-point square's 1600 m
  assert.equal(square.VP.length, square.N);
});

test('race: 10-car AI race finishes cleanly in skill order', () => seeded(() => {
  const race = S.createRace(3), seen = run(S, race, 600, aiDriver(S));
  assert.ok(race.cars.every(c => c.finished), 'every car finished');
  const walls = race.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0);
  assert.equal(walls, 0, 'no wall hits');
  const ord = S.order(race);
  assert.equal(ord[0].code, 'VOS', 'fastest driver wins');
  assert.ok(ord[0].finishTime > 95 && ord[0].finishTime < 135, `winning time ${ord[0].finishTime}`);
  for (const c of race.cars) { assert.equal(c.finishLap, 4); assert.ok(c.bestLap > 30 && c.bestLap < 45, `${c.code} best ${c.bestLap}`); }
  assert.equal(race.fastestBy, ord.find(c => c.bestLap === race.fastest));
}));

test('player: top speed is VMAX and the brakes stop the car', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.filter(d => d.player) }), p = race.cars[0];
  // put the car on a long straight heading along the track
  const drive = inp => { for (let i = 0; i < 120 * 30; i++) { race.t += DT; S.drivePlayer(race, p, inp, DT); p.x = T.PX[p.idx]; p.z = T.PZ[p.idx]; p.h = S.headingAt(T, p.idx); } };
  drive({ thr: 1, brk: 0, steer: 0, analog: false });
  assert.ok(p.v > S.TUNING.VMAX * 0.98 && p.v <= S.TUNING.VMAX, `top speed ${p.v}`);
  drive({ thr: 0, brk: 1, steer: 0, analog: false });
  assert.ok(p.v <= 0 && p.v >= -S.TUNING.REVERSE_MAX, `after braking ${p.v}`);
});

test('formats: timed race flags the leader after time is up; lapped cars finish a lap down', () => seeded(() => {
  const four = S.DRIVERS.filter(d => ['VOS', 'MAR', 'YOU', 'COS'].includes(d.code));
  const race = S.createRace({ type: 'timed', minutes: 1.5 }, { drivers: four });
  run(S, race, 400, aiDriver(S, { COS: 0.4 }));
  assert.ok(race.cars.every(c => c.finished));
  const ord = S.order(race), leader = ord[0];
  assert.ok(leader.finishTime >= 90, 'flag only after the clock ran out');
  assert.deepEqual(S.gapTo(race, leader, ord.at(-1)), { laps: 1 });
  assert.equal(ord.at(-1).code, 'COS');
  assert.equal(race.laps, Infinity);
}));

test('formats: unlimited never finishes; plain numbers mean laps', () => seeded(() => {
  const race = S.createRace({ type: 'unlimited' }, { drivers: S.DRIVERS.slice(0, 2) });
  run(S, race, 150, aiDriver(S));
  assert.ok(race.cars.every(c => !c.finished && c.lap >= 3));
  assert.equal(race.duration, Infinity);
  assert.deepEqual(S.createRace(5).format, { type: 'laps', laps: 5 });
  assert.deepEqual(S.createRace({ type: 'laps', laps: 0 }).format, { type: 'laps', laps: 3 });   // invalid → default
}));

test('contact: a nose-to-tail hit pushes apart, trades speed and reports the impact once', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars, C = S.CONTACT;
  const reach = C.front + C.rear + 2 * C.radius;            // centre distance at which the bodies touch, in line
  a.h = b.h = 0; b.z = a.z; b.x = a.x + reach - 0.3; a.v = 20; b.v = 5;
  S.collide(race);
  assert.ok(S.carGap(a, b) >= -1e-6, 'separated');
  assert.deepEqual(a.events.map(e => e.type), [S.EV.CONTACT]);
  assert.ok(a.events[0].impact > 10 && a.events[0].with === b.code, `impact ${a.events[0].impact}`);
  assert.ok(a.v < 20 && b.v > 5 && Math.abs(a.v + b.v - 25) < 1e-6, `speeds ${a.v} ${b.v}: the hit car is shoved, momentum kept`);
  a.events.length = 0;
  S.collide(race);
  assert.deepEqual(a.events, [], 'still touching: no second event');
});

test('contact: an off-centre tap turns the cars only as much as their inertia allows, momentum kept', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars, C = S.CONTACT;
  a.h = b.h = 0; b.x = a.x + C.front + C.rear + 2 * C.radius - 0.6; b.z = a.z + 1.4; a.v = 60; b.v = 45;   // 15 m/s, corner to corner
  for (const c of [a, b]) { c.vy = 0; c.yawRate = 0; }
  S.collide(race);
  assert.ok(Math.abs(a.v + b.v - 105) < 1e-6 && Math.abs(a.vy + b.vy) < 1e-6, 'momentum kept');
  assert.ok(Math.abs(a.yawRate) < 1.5 && Math.abs(b.yawRate) < 1.5, `yaw ${a.yawRate.toFixed(2)} / ${b.yawRate.toFixed(2)} rad/s`);
  assert.ok(b.v - 45 < 0.6 * 15, `shove ${(b.v - 45).toFixed(1)} m/s`);
});

test('contact: cars fit side by side a car width apart; a side swipe pushes sideways', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars;
  a.h = b.h = 0; a.v = b.v = 50; b.x = a.x; b.z = a.z + 2 * S.CONTACT.radius + 0.2;   // +z is to the right at h = 0
  S.collide(race);
  assert.deepEqual(a.events, [], 'no contact alongside');
  a.vy = 3;                                                     // a drifts into b
  b.z = a.z + 2 * S.CONTACT.radius - 0.1;
  S.collide(race);
  assert.deepEqual(b.events.map(e => e.type), [S.EV.CONTACT]);
  assert.ok(b.vy > 0 && a.vy < 3, `b pushed right (${b.vy.toFixed(2)}), a slowed sideways (${a.vy.toFixed(2)})`);
  assert.ok(Math.abs(a.v - 50) < 0.01 && Math.abs(b.v - 50) < 0.01, 'forward speeds untouched');
});

test('seed: the same seed gives the same race, another seed a different one (race.rng)', () => {
  const finish = seed => { const race = S.createRace(2, { seed }); run(S, race, 300, aiDriver(S));
    return race.cars.map(c => `${c.code} ${c.finishTime.toFixed(4)} ${c.bias.toFixed(4)}`).join(' | '); };
  const a = finish(42);
  assert.equal(finish(42), a);
  assert.notEqual(finish(43), a);
  assert.equal(S.createRace(1, { seed: 7 }).seed, 7);
});
