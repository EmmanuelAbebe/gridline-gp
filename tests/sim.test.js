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
  assert.equal(square.N, 1200);
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
  assert.ok(ord[0].finishTime > 110 && ord[0].finishTime < 150, `winning time ${ord[0].finishTime}`);
  for (const c of race.cars) { assert.equal(c.finishLap, 4); assert.ok(c.bestLap > 35 && c.bestLap < 50, `${c.code} best ${c.bestLap}`); }
  assert.equal(race.fastestBy, ord.find(c => c.bestLap === race.fastest));
}));

test('player: a scripted lap with drivePlayer finishes without hitting walls', () => seeded(() => {
  const race = S.createRace(1, { drivers: S.DRIVERS.filter(d => d.player) }), p = race.cars[0];
  const { N, PX, PZ, VP } = T;
  const seen = run(S, race, 200, (r, c) => {
    const ti = (c.idx + 12) % N, diff = S.wrapA(Math.atan2(PZ[ti] - c.z, PX[ti] - c.x) - c.h);
    const slow = c.v > VP[(c.idx + 4) % N];
    S.drivePlayer(r, c, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: diff < -0.02 ? -1 : diff > 0.02 ? 1 : 0, analog: false }, DT);
  });
  assert.ok(p.finished, 'lap completed');
  assert.ok(p.finishTime < 60, `lap time ${p.finishTime}`);
  assert.equal(seen.get(p)[S.EV.WALL] || 0, 0);
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
  run(S, race, 400, aiDriver(S, { COS: 0.55 }));
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

test('contact: cars that touch push apart and report the impact once', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars;
  b.x = a.x + 2; b.z = a.z; a.v = 20; a.h = 0; b.v = 5; b.h = 0;
  S.collide(race);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) >= S.TUNING.CAR_RADIUS - 1e-6, 'separated');
  assert.deepEqual(a.events, [S.EV.CONTACT]);
  assert.ok(a.impact > 10);
  a.events.length = 0; b.x = a.x + 3; b.z = a.z;
  S.collide(race);
  assert.deepEqual(a.events, [], 'still touching: no second event');
});
