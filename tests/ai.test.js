// AI driver tests (driving.js driveAI on the tyre model): racing line, pace, racecraft, mistakes, recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, seeded, run } from './helpers.js';

const T = S.track, { N, HW, K, LK, RO } = T;
const field = codes => S.DRIVERS.filter(d => codes.includes(d.code)).sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));
const hard = (race, seen) => race.cars.reduce((n, c) => n + (seen.get(c).hard || 0), 0) / 2;
// like run(), also counting contacts harder than 3 m/s
function race(r, seconds, skills = {}) {
  const seen = new Map(r.cars.map(c => [c, {}]));
  for (let step = 0; step < seconds * 120 && !r.cars.every(c => c.finished); step++) {
    r.t += DT;
    for (const c of r.cars) S.driveAI(r, c, DT, skills[c.code] || 0);
    S.collide(r);
    for (const c of r.cars) { const s = seen.get(c); for (const e of c.events) { s[e.type] = (s[e.type] || 0) + 1; if (e.type === S.EV.CONTACT && e.impact > 3) s.hard = (s.hard || 0) + 1; } c.events.length = 0; }
  }
  return seen;
}

test('racing line: inside the road, and straighter than the centre line', () => {
  let sumK = 0, sumLK = 0;
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(RO[i]) <= HW - S.AI.lineEdge + 1e-6);
    sumK += K[i] * K[i]; sumLK += LK[i] * LK[i];
  }
  assert.ok(sumLK < sumK * 0.9, `line curvature² ${sumLK.toFixed(4)} vs centre ${sumK.toFixed(4)}`);
});

test('AI: a clean lap on the tyre model, and the pace setting orders lap times', () => seeded(() => {
  const lap = pace => {
    const r = S.createRace(2, { drivers: field(['VOS']), aiPace: pace }), seen = race(r, 120), c = r.cars[0];
    assert.ok(c.finished, `finished at pace ${pace}`);
    assert.equal(seen.get(c)[S.EV.WALL] || 0, 0, 'no wall hits');
    return c.bestLap;
  };
  const times = [0.8, 0.9, 1].map(lap);
  assert.ok(times[0] > times[1] && times[1] > times[2], `lap times ${times.map(t => t.toFixed(2))}`);
  assert.ok(times[2] > 30 && times[2] < 34, `full pace ${times[2].toFixed(2)} s`);
}));

test('AI: drives through its tyres (the car slides a little at the limit, never spins)', () => seeded(() => {
  const r = S.createRace(2, { drivers: field(['VOS']) }), c = r.cars[0];
  let maxDrift = 0;
  for (let i = 0; i < 120 * 70 && !c.finished; i++) {
    r.t += DT; S.driveAI(r, c, DT, 1); c.events.length = 0;
    if (c.v > 20) maxDrift = Math.max(maxDrift, Math.abs(S.driftAngle(c)));
  }
  assert.ok(maxDrift > 0.01 && maxDrift < 0.2, `max drift ${maxDrift.toFixed(3)} rad`);
}));

test('racecraft: a full field races 3 laps without wall hits and with few hard contacts', () => seeded(() => {
  const r = S.createRace(3, { aiPace: 0.92 }), seen = race(r, 400);
  assert.ok(r.cars.every(c => c.finished));
  assert.equal(r.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0), 0, 'no wall hits');
  assert.ok(hard(r, seen) <= 6, `${hard(r, seen)} hard contacts`);
}));

test('racecraft: a faster car gets past a slower one', () => seeded(() => {
  const r = S.createRace(4, { drivers: field(['KIM', 'VOS']) }), [slow, fast] = r.cars, seen = race(r, 300, { KIM: 0.85 });
  assert.ok(fast.finished && slow.finished);
  assert.ok(fast.finishTime < slow.finishTime, 'the faster car finished ahead');
  assert.ok(hard(r, seen) <= 1, `${hard(r, seen)} hard contacts`);
}));

test('mistakes: drivers sometimes brake too late, the weaker ones more often; none when driven at a set skill', () => seeded(() => {
  const r = S.createRace(5, { aiPace: 0.92 }), count = new Map(r.cars.map(c => [c, 0]));
  for (let step = 0; step < 120 * 400 && !r.cars.every(c => c.finished); step++) {
    r.t += DT;
    for (const c of r.cars) { const before = c.mistake; S.driveAI(r, c, DT, c.player ? 0.9 : 0); if (!before && c.mistake) count.set(c, count.get(c) + 1); }
    S.collide(r); for (const c of r.cars) c.events.length = 0;
  }
  const by = code => count.get(r.cars.find(c => c.code === code));
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  assert.ok(total >= 5, `${total} mistakes in 5 laps`);
  assert.equal(by('YOU'), 0, 'skill override: no mistakes');
  const top = ['VOS', 'MAR', 'OKA'].reduce((n, k) => n + by(k), 0), bottom = ['BRA', 'KIM', 'COS'].reduce((n, k) => n + by(k), 0);
  assert.ok(bottom > top, `weakest three ${bottom} vs strongest three ${top}`);
}));

test('recovery: pointing the wrong way, the AI turns round and carries on', () => {
  const r = S.createRace(1, { drivers: field(['VOS']) }), c = r.cars[0];
  c.idx = 300; c.x = T.PX[300]; c.z = T.PZ[300]; c.h = S.headingAt(T, 300) + Math.PI; c.v = 0; c.lap = 1; c.lastCp = 1e9;
  run(S, r, 12, (race, car) => S.driveAI(race, car, DT, 1));
  assert.ok(Math.cos(c.h - S.headingAt(T, c.idx)) > 0.9, 'facing along the track');
  assert.ok(c.v > 30, `moving at ${c.v.toFixed(1)} m/s`);
});
