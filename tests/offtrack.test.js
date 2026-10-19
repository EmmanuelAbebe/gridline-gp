// Off the track (2026-10-18): grass takes grip away rather than braking the car, gravel stops it (about 0.6–1 g, and
// only once it is slow), dirty tyres after an off, beaching and recovery, sausage kerbs, the run-off layout itself,
// and running wide counting against track limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { surfaceAt } from '../src/sim/runoff.js';
import { DT } from './helpers.js';

const T = S.track, { PX, PZ, NX, NZ } = T;
const solo = (track = T) => { const race = S.createRace(1, { track, drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0]; c.assists = S.ASSISTS.medium; return { race, c }; };
const place = (c, i, lat, track = T) => { c.idx = i; c.lat = lat; c.x = track.PX[i] + track.NX[i] * lat; c.z = track.PZ[i] + track.NZ[i] * lat; c.h = S.headingAt(track, i); };
// a corner sample with gravel on one side, deep enough to test in
const gravelSpot = (track = T) => {
  for (let i = 0; i < track.N; i++) for (const side of [0, 1]) {
    const R = track.runoff[side];
    if (R.wall[i] - R.gravel[i] > 8) return { i, s: side ? 1 : -1, R };
  }
  throw new Error('no gravel');
};

// speed after `seconds` on one surface, driven straight along the track (held on its heading)
function coast(surface, kmh, { thr = 0, brk = 0, seconds = 1 } = {}) {
  const { race, c } = solo(); c.v = kmh / 3.6; c.gear = kmh > 200 ? 7 : kmh > 100 ? 4 : 2;
  for (let k = 0; k < seconds * 120; k++) {
    race.t += DT; c.surface = surface; c.dirt = 0;
    S.drivePlayer(race, c, { thr, brk, steer: 0, analog: true }, DT);
    place(c, c.idx, 0);
  }
  return c.v * 3.6;
}

test('grass keeps the speed but takes the grip: little extra drag, much weaker brakes', () => {
  const lost = s => 300 - coast(s, 300);
  assert.ok(lost('grass') - lost('track') < 12, `grass costs ${(lost('grass') - lost('track')).toFixed(1)} km/h more per second than the track at 300`);
  const stop = s => { const { race, c } = solo(); c.v = 150 / 3.6; c.gear = 4; let d = 0;
    for (let k = 0; k < 20 * 120 && c.v > 0.5; k++) { race.t += DT; c.surface = s; S.drivePlayer(race, c, { thr: 0, brk: 1, steer: 0, analog: true }, DT); d += c.v * DT; place(c, c.idx, 0); }
    return d; };
  const ratio = stop('grass') / stop('track');
  assert.ok(ratio > 2, `braking from 150 km/h on grass takes ${ratio.toFixed(1)}× the distance`);
});

test('gravel stops a car at roughly 0.6–1 g once it is slow, and skims at high speed', () => {
  // surface-only deceleration (gravel minus track, coasting) in m/s²
  const extra = kmh => ((coast('track', kmh, { seconds: 0.25 }) - coast('gravel', kmh, { seconds: 0.25 })) / 3.6) / 0.25;
  const slow = extra(70), fast = extra(250);
  assert.ok(slow > 6 && slow < 10.5, `at 70 km/h: ${slow.toFixed(1)} m/s²`);
  assert.ok(fast < slow * 0.75, `at 250 km/h: ${fast.toFixed(1)} m/s² (skims)`);
});

test('dirty tyres after an off: less grip, clean again after a few seconds on the track', () => {
  const { race, c } = solo(); c.v = 30;
  const step = s => { race.t += DT; c.surface = s; S.drivePlayer(race, c, { thr: 0.5, brk: 0, steer: 0, analog: true }, DT); place(c, c.idx, 0); };
  for (let k = 0; k < 30; k++) step('grass');
  assert.equal(c.dirt, 1);
  for (let k = 0; k < 120 * 1.5; k++) step('track');
  assert.ok(c.dirt > 0.3 && c.dirt < 0.7, `half way: ${c.dirt.toFixed(2)}`);
  for (let k = 0; k < 120 * 2; k++) step('track');
  assert.equal(c.dirt, 0);
});

test('gravel: keep moving and the car drives out; stop deep in it and it is beached, then recovered to the edge', () => {
  const { i, s, R } = gravelSpot();
  // shallow (just past the edge of the trap), full throttle from rest: it gets going
  { const { race, c } = solo(); place(c, i, s * (R.gravel[i] + 1));
    for (let k = 0; k < 120 * 2; k++) { race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT); }
    assert.ok(!c.beached && c.v > 2.5, `shallow: ${(c.v * 3.6).toFixed(0)} km/h after 2 s`); }
  // deep, stopped: beached, then put back beside the track
  const { race, c } = solo(); place(c, i, s * (R.gravel[i] + 5)); const seen = [];
  for (let k = 0; k < 120 * 8; k++) { race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT); seen.push(...c.events.splice(0)); }
  assert.ok(seen.includes(S.EV.BEACHED), 'beached');
  assert.ok(seen.includes(S.EV.RECOVERED), 'recovered');
  assert.ok(!c.beached && c.surface !== 'gravel' && Math.abs(c.lat) < R.turf[c.idx] + 3, `put back at lat ${c.lat.toFixed(1)} on ${c.surface}`);
});

test('run-off layout: kerb, artificial grass, then grass / tarmac / gravel and a barrier; street circuit walls close', () => {
  for (const [id, circuit] of Object.entries(S.CIRCUITS)) {
    const track = S.buildTrack(circuit);
    for (const R of track.runoff) for (let i = 0; i < track.N; i++) {
      assert.ok(track.HW <= R.kerb[i] && R.kerb[i] <= R.turf[i] && R.turf[i] < R.wall[i], `${id} ${i}: strips in order`);
      assert.ok(R.gravel[i] === Infinity || (R.gravel[i] >= R.turf[i] && R.gravel[i] < R.wall[i]), `${id} ${i}: gravel inside the wall`);
    }
    const walls = track.runoff.flatMap(R => [...R.wall]), avg = walls.reduce((a, b) => a + b, 0) / walls.length - track.HW;
    if (track.style === 'street') assert.ok(avg < 8, `${id}: walls ${avg.toFixed(1)} m from the road on average`);
    else assert.ok(avg > 10, `${id}: run-off ${avg.toFixed(1)} m on average`);
  }
  const { i, s } = gravelSpot();
  assert.equal(surfaceAt(T, i, 0).surface, 'track');
  assert.equal(surfaceAt(T, i, s * (T.runoff[s < 0 ? 0 : 1].gravel[i] + 1)).surface, 'gravel');
});

test('run-off never reaches into another part of the track', () => {
  for (const [id, circuit] of Object.entries(S.CIRCUITS)) {
    const track = S.buildTrack(circuit), { N, ds, HW } = track;
    for (const [side, R] of track.runoff.entries()) for (let i = 0; i < N; i += 3) {
      const s = side ? 1 : -1, x = track.PX[i] + track.NX[i] * s * R.wall[i], z = track.PZ[i] + track.NZ[i] * s * R.wall[i];
      for (let j = 0; j < N; j += 2) {
        const along = Math.min((j - i + N) % N, (i - j + N) % N) * ds;
        if (along < 2 * R.wall[i] + 12) continue;
        const d = Math.hypot(x - track.PX[j], z - track.PZ[j]);
        assert.ok(d > HW + 2 && d > R.wall[i] - 2, `${id}: barrier at ${i} is ${d.toFixed(1)} m from sample ${j}`);
      }
    }
  }
});

test('sausage kerbs upset the car', () => {
  const side = T.runoff.findIndex(R => R.sausage.includes(1)), R = T.runoff[side], i = R.sausage.indexOf(1), s = side ? 1 : -1;
  assert.ok(i >= 0, 'Elkmoor has sausage kerbs');
  const { race, c } = solo(); place(c, i, s * (R.kerb[i] - 0.3)); c.v = 25; c.surface = 'kerb';
  c.h += s * 0.15;                                     // heading over it
  const w0 = c.yawRate; let hit = false;
  for (let k = 0; k < 30 && !hit; k++) { race.t += DT; S.drivePlayer(race, c, { thr: 0.3, brk: 0, steer: 0, analog: true }, DT); hit = c.events.includes(S.EV.SAUSAGE); c.events.length = 0; }
  assert.ok(hit, 'hit the sausage');
  assert.ok(Math.abs(c.yawRate - w0) > 0.1, 'yaw kick');
});

test('track limits: running wide at speed counts, a slow car rejoining does not', () => {
  // outside of the first corner, whole car past the kerb, moving along the track
  const i0 = [...T.CK].findIndex((k, i) => Math.abs(k) > T.KERB_K && Math.abs(T.K[i]) > T.KERB_K), side = T.CK[i0] > 0 ? 0 : 1, s = side ? 1 : -1;
  // drive the check through afterMove: move the car sample by sample along the outside
  const run = v => { const { race, c } = solo(); const R = T.runoff[side]; place(c, i0, s * (R.kerb[i0] + 1.5));
    for (let k = 1; k < 10; k++) { const i = i0 + k; c.x = PX[i] + NX[i] * s * (R.kerb[i] + 1.5); c.z = PZ[i] + NZ[i] * s * (R.kerb[i] + 1.5); c.v = v; race.t += DT;
      S.drivePlayer(race, c, { thr: 0, brk: 0, steer: 0, analog: true }, 0); }
    return c; };
  const fast = run(40);
  assert.equal(fast.cuts, 1); assert.ok(fast.cutWide && fast.lapInvalid);
  assert.equal(run(5).cuts, 0);
});
