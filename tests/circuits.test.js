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
    // a real circuit (circuit.real) is as it is: two parts may run side by side with only a wall between them (Monaco,
    // Mexico City's stadium); they must not overlap. The invented ones keep room for run-off on both.
    if (circuit.real) assert.ok(min > 2 * T.HW + 1, `closest ${min.toFixed(1)} m: the roads overlap`);
    else assert.ok(min > 2 * T.WALL + 10, `closest ${min.toFixed(0)} m`);
    // the grid (10 cars ≈ 75 m) sits on the straight before the line (a real one: as straight as it is, Monaco's 300 m radius)
    let back = 0; for (let i = T.N - 1; i > 0 && Math.abs(T.K[i]) < (circuit.real ? 0.004 : 0.002); i--) back += T.ds;
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
      // (a real hairpin, Monaco's 8 m: looking 25 m ahead cuts its inside)
      const ti = (car.idx + (circuit.real ? 8 : 12)) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - car.z, T.PX[ti] - car.x) - car.h);
      const slow = car.v > VP[(car.idx + 4) % T.N];
      S.drivePlayer(r, car, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true }, DT);
    });
    assert.ok(race.cars[0].finished, 'finished');
    // (a real circuit: one touch allowed: this bot steers at the centre line's point ahead with the assisted lock, and
    // runs wide out of Monaco's Loews hairpin at 30 km/h; the AI and the phone driver use the road's width there)
    assert.ok((seen.get(race.cars[0])[S.EV.WALL] || 0) <= (circuit.real ? 1 : 0), 'no wall hits');
  });
}

// (2026-10-23: two arcs of Saltcross's esses overlapped, so the road zig-zagged back on itself for a few metres)
test('no kinks: the road never turns tighter than its tightest corner is meant to', () => {
  for (const id of Object.keys(S.CIRCUITS)) {
    const T = S.buildTrack(S.CIRCUITS[id]);
    let k = 0, jump = 0;
    for (let i = 0; i < T.N; i++) { k = Math.max(k, Math.abs(T.K[i])); jump = Math.max(jump, Math.abs(T.K[(i + 1) % T.N] - T.K[i])); }
    // (a real circuit's tightest is its own: Monaco's hairpin ~8 m)
    assert.ok(1 / k > (S.CIRCUITS[id].real ? 7.5 : 15), `${id}: a ${(1 / k).toFixed(1)} m radius`);
    // (a real one turns into its hairpins as abruptly as the road does: Monaco 0.021, Mexico City 0.013)
    assert.ok(jump < (S.CIRCUITS[id].real ? 0.025 : 0.01), `${id}: the curvature jumps ${jump.toFixed(4)} between two samples`);
  }
});
