// Every circuit: sane geometry (no overlapping track, room for the grid), the AI laps it clean alone and races a
// full field to the flag, and the test driver (proportional steering, like the phone) gets round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, run, seeded, aiDriver, centreProfile } from './helpers.js';

for (const [id, circuit] of Object.entries(S.CIRCUITS)) {
  const T = S.buildTrack(circuit);
  test(`${id}: geometry: parts of the track far apart along it never come within two run-off widths (or pass over each other)`, () => {
    const gap = Math.round(200 / T.ds); let min = Infinity;
    for (let i = 0; i < T.N; i += 2) for (let j = i + gap; j < Math.min(T.N, T.N - gap + i); j += 2) {
      if (T.elev && Math.abs(T.elev.Y[i] - T.elev.Y[j]) >= 6) continue;          // a bridge over the other part
      min = Math.min(min, Math.hypot(T.PX[i] - T.PX[j], T.PZ[i] - T.PZ[j]));
    }
    assert.ok(min > 2 * T.WALL + 10, `closest ${min.toFixed(0)} m`);
    // the grid (10 cars ≈ 75 m) sits on the straight before the line
    let back = 0; for (let i = T.N - 1; i > 0 && Math.abs(T.K[i]) < 0.002; i--) back += T.ds;
    assert.ok(back > 90, `straight before the line ${back.toFixed(0)} m`);
    assert.ok(Math.abs(T.ds - 2.06) < 0.05, `sample spacing ${T.ds.toFixed(2)} m`);
  });
  test(`${id}: the AI laps it clean alone, and a full field races 2 laps (the odd racing incident allowed)`, () => seeded(() => {
    const solo = S.createRace(2, { track: T, drivers: [S.DRIVERS.find(d => !d.player)] }), seenSolo = run(S, solo, 300, aiDriver(S));
    assert.ok(solo.cars[0].finished, 'solo finished');
    assert.equal(seenSolo.get(solo.cars[0])[S.EV.WALL] || 0, 0, 'solo lap: no wall hits');
    const r = S.createRace(2, { track: T, aiPace: 0.95 }), seen = run(S, r, 400, aiDriver(S));
    assert.ok(r.cars.every(c => c.finished), 'all finished');
    const walls = r.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0);
    assert.ok(walls <= 2, `${walls} wall hits`);
  }));
  test(`${id}: the proportional test driver laps it`, () => {
    const race = S.createRace(1, { track: T, drivers: S.DRIVERS.filter(d => d.player) }), VP = centreProfile(S, T);
    const seen = run(S, race, 200, (r, car) => {
      const ti = (car.idx + 12) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - car.z, T.PX[ti] - car.x) - car.h);
      const slow = car.v > VP[(car.idx + 4) % T.N];
      S.drivePlayer(r, car, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true }, DT);
    });
    assert.ok(race.cars[0].finished, 'finished');
    assert.equal(seen.get(race.cars[0])[S.EV.WALL] || 0, 0, 'no wall hits');
  });
}
