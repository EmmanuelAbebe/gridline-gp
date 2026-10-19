// Active aero (straight mode / corner mode) and overtake mode (active-aero.js): the zones on every circuit, that it
// is off unless asked for, that every car uses it safely, and the overtake boost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { ACTIVE_AERO, OVERTAKE } from '../src/sim/tuning.js';
import { gapAhead } from '../src/sim/active-aero.js';
import { DT, run, seeded, aiDriver, centreProfile } from './helpers.js';

const tracks = Object.fromEntries(Object.entries(S.CIRCUITS).map(([id, c]) => [id, S.buildTrack(c)]));

test('every circuit has straight-mode zones, all flat out and closing before any braking', () => {
  for (const [id, T] of Object.entries(tracks)) {
    assert.ok(T.aeroZones.length >= 1, `${id}: a zone`);
    const ahead = Math.round(ACTIVE_AERO.zone.closeAhead / T.ds);
    for (let i = 0; i < T.N; i++) if (T.aeroZone[i]) {
      for (let o = 0; o <= ahead; o++) assert.ok(T.VP[(i + o) % T.N] >= S.TUNING.V_CAP - 1e-3, `${id}: no braking within ${ahead} samples of ${i}`);
    }
    for (const z of T.aeroZones) assert.ok(((z.to - z.from + T.N) % T.N) * T.ds >= ACTIVE_AERO.zone.minLength - T.ds, `${id}: zone long enough`);
  }
});

test('off by default: the wings never open and nobody gets a boost', () => seeded(() => {
  const r = S.createRace(2, { track: tracks.harrow, drivers: S.DRIVERS.slice(0, 4) });
  let open = 0, boost = 0;
  run(S, r, 60, (race, c) => { aiDriver(S)(race, c); open = Math.max(open, c.aeroOpen); boost = Math.max(boost, c.boostLeft); });
  assert.equal(open, 0); assert.equal(boost, 0);
}));

test('straight mode: wings open on the straights, more top speed, faster laps, no walls or cuts', () => {
  for (const id of ['harrow', 'elkmoor']) {
    const lap = activeAero => {
      const r = S.createRace(2, { track: tracks[id], drivers: [S.DRIVERS.find(d => !d.player)], activeAero, seed: 3 });
      let top = 0, openSteps = 0, steps = 0;
      const seen = run(S, r, 300, (race, c) => { aiDriver(S)(race, c); top = Math.max(top, c.v); steps++; if (c.aeroOpen === 1) openSteps++; });
      const s = seen.get(r.cars[0]);
      return { best: r.cars[0].bestLap, top, open: openSteps / steps, trouble: (s[S.EV.WALL] || 0) + (s[S.EV.CUT] || 0) };
    };
    const off = lap(false), on = lap(true);
    assert.ok(on.open > 0.15, `${id}: open ${(on.open * 100).toFixed(0)}% of the time`);
    assert.ok(on.top > off.top + 4, `${id}: top speed ${off.top.toFixed(1)} → ${on.top.toFixed(1)} m/s`);
    assert.ok(on.best < off.best - 0.2, `${id}: lap ${off.best.toFixed(2)} → ${on.best.toFixed(2)} s`);
    assert.equal(on.trouble, 0, `${id}: clean`);
  }
});

test('straight mode: a full field races clean, and the proportional test driver gets round with it', () => seeded(() => {
  for (const id of ['northfold', 'cobalt']) {
    const T = tracks[id], r = S.createRace(2, { track: T, aiPace: 0.95, activeAero: true }), seen = run(S, r, 400, aiDriver(S));
    assert.ok(r.cars.every(c => c.finished), `${id}: all finished`);
    const walls = r.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0);
    assert.ok(walls <= 2, `${id}: ${walls} wall hits`);
    const solo = S.createRace(1, { track: T, drivers: S.DRIVERS.filter(d => d.player), activeAero: true }), VP = centreProfile(S, T);
    let opened = 0;
    const s2 = run(S, solo, 200, (race, car) => {
      const ti = (car.idx + 12) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - car.z, T.PX[ti] - car.x) - car.h);
      const slow = car.v > VP[(car.idx + 4) % T.N];
      S.drivePlayer(race, car, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true }, DT);
      opened = Math.max(opened, car.aeroOpen);
    });
    assert.ok(solo.cars[0].finished && opened === 1, `${id}: test driver finished, wings opened`);
    assert.equal(s2.get(solo.cars[0])[S.EV.WALL] || 0, 0, `${id}: test driver no wall hits`);
  }
}));

test('overtake mode: within a second of the car ahead at the line → boost for the lap; it adds power', () => {
  const T = tracks.harrow, r = S.createRace(5, { track: T, drivers: S.DRIVERS.slice(0, 2), activeAero: true, seed: 1 });
  const [a, b] = r.cars;
  // b passed the sample a is on 0.6 s ago, and a is starting lap 2
  r.t = 100; a.lap = 2; a.boostLap = 1; b.trailT[a.idx] = r.t - 0.6;
  assert.ok(Math.abs(gapAhead(r, a) - 0.6) < 1e-4);   // trail times are Float32
  a.player = true; a.v = 60; a.gear = 7;
  S.drivePlayer(r, a, { steer: 0, thr: 1, brk: 0 }, DT);
  assert.equal(a.events.filter(e => e.type === S.EV.BOOST_READY).length, 1);
  assert.ok(a.boostLeft > OVERTAKE.seconds - 0.1 && !a.boostOn, 'ready, not on until pressed');
  const before = a.drive;
  S.drivePlayer(r, a, { steer: 0, thr: 1, brk: 0, boost: true }, DT);
  assert.ok(a.boostOn && a.boostLeft < OVERTAKE.seconds, 'on and counting down');
  assert.ok(a.drive > before * (1 + OVERTAKE.power * 0.8), `drive ${before.toFixed(2)} → ${a.drive.toFixed(2)}`);
  // too far behind at the next line: no boost
  a.lap = 3; b.trailT[a.idx] = r.t - 2.5;
  S.drivePlayer(r, a, { steer: 0, thr: 1, brk: 0 }, DT);
  assert.equal(a.boostLeft, 0); assert.equal(a.boostOn, false);
});
