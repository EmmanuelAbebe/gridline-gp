// Track limits: cutting the inside of corners (and running wide at speed: offtrack.test.js) invalidates laps and,
// after the warnings, adds time penalties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, run, seeded, aiDriver } from './helpers.js';

const T = S.track, { N, PX, PZ, NX, NZ, CK, K, HW, KERB, KERB_K } = T, L = S.LIMITS;

// A driver that aims `inside` metres past the inside edge of every corner (the centre line elsewhere), at ≤ 25 m/s.
function cutter(inside) {
  const race = S.createRace(2, { drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0];
  let past = -Infinity;                                 // furthest the car's inner side got past the edge (m)
  run(S, race, 300, (r, car) => {
    const ti = (car.idx + 10) % N, corner = Math.abs(CK[ti]) > KERB_K;
    const edge = Math.abs(K[ti]) > KERB_K ? HW + KERB : HW, lat = corner ? Math.sign(CK[ti]) * (edge + L.halfWidth + inside) : 0;
    const tx = PX[ti] + NX[ti] * lat, tz = PZ[ti] + NZ[ti] * lat;
    const diff = S.wrapA(Math.atan2(tz - car.z, tx - car.x) - car.h), fast = car.v > 25;
    S.drivePlayer(r, car, { thr: fast ? 0 : 1, brk: fast ? 0.3 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true }, DT);
    const e = Math.abs(K[car.idx]) > KERB_K ? HW + KERB : HW;
    if (car.lat * CK[car.idx] > 0 && Math.abs(CK[car.idx]) > KERB_K) past = Math.max(past, Math.abs(car.lat) - L.halfWidth - e);
  });
  return { race, c, past };
}

test('limits: cutting every corner: laps invalid, warnings first, then penalties added to the race time', () => {
  const { race, c } = cutter(2);
  assert.ok(c.finished, 'finished');
  assert.ok(c.cuts > L.warnings + 2, `${c.cuts} cuts`);
  assert.equal(c.penalty, (c.cuts - L.warnings) * L.penalty);
  assert.equal(c.bestLap, Infinity, 'no valid lap');
  assert.ok(c.lastLapInvalid);
  assert.equal(race.fastestBy, null);
  assert.equal(S.raceTime(c), c.finishTime + c.penalty);
});

test('limits: inside the kerb is fine, and the AI field races clean', () => seeded(() => {
  const { c, past } = cutter(-2.2);                    // hugging the inside, over the kerbs, never fully past them
  assert.ok(past > -1 && past <= 0, `inner side got to ${past.toFixed(2)} m from the limit`);
  assert.equal(c.cuts, 0);
  assert.ok(c.bestLap < Infinity);
  const race = S.createRace(3);
  run(S, race, 400, aiDriver(S));
  assert.ok(race.cars.reduce((n, c) => n + c.cuts, 0) <= 1, 'at most one AI cut (pushed wide in traffic)');
}));

test('limits: a penalty can cost a place at the finish', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars;
  Object.assign(a, { finished: true, finishLap: 2, finishTime: 60 });
  Object.assign(b, { finished: true, finishLap: 2, finishTime: 61 });
  assert.equal(S.order(race)[0], a);
  a.penalty = 2;
  assert.equal(S.order(race)[0], b);
  assert.deepEqual(S.gapTo(race, b, a), { t: 1 });
});
