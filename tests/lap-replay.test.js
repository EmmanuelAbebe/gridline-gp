// The lap replay (src/game/lap-replay.js, the lap analysis's COMPARE): a lap's position and readings any time into it,
// two laps compared by time and by distance, the delta, what the car models are given; the AI's lap carries its
// positions and gears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from '../src/sim/index.js';
import { aiLap } from '../src/game/ai-ghosts.js';
import { traceFromAi, createTraceRecorder } from '../src/game/lap-analysis.js';
import { replayOf, compareAt, deltaSeries, modelState } from '../src/game/lap-replay.js';

globalThis.devicePixelRatio ??= 1;
const { RACE_SETUP } = await import('../src/game/config.js');
const T = SIM.track, N = T.N, LV = RACE_SETUP.aiLevels;
const alien = traceFromAi(aiLap(T, 'alien', LV.alien, false));
const rookie = traceFromAi(aiLap(T, 'rookie', LV.rookie, false));

test('an AI lap carries where the car was and its gear at every sample', () => {
  for (const k of ['x', 'z', 'h', 'gear']) assert.ok(alien[k] && alien[k].length === N, k);
  assert.ok(alien.gear.every(g => g >= 1 && g <= 8));
  // (on the road: within the barriers of the sample's spot)
  for (let i = 0; i < N; i += 50) { const lat = (alien.x[i] - T.PX[i]) * T.NX[i] + (alien.z[i] - T.PZ[i]) * T.NZ[i]; assert.ok(Math.abs(lat) < T.HW + 2, `sample ${i}: ${lat.toFixed(1)} m off the middle`); }
});

test('a replay: time and sample are each other\'s inverse; its position follows the lap', () => {
  const R = replayOf(alien, T);
  assert.equal(R.source, 'trace');
  assert.ok(Math.abs(R.time - alien.time) < 1e-9);
  for (const t of [0.5, 7.3, 20, R.time - 0.2]) assert.ok(Math.abs(R.timeAt(R.sampleAt(t)) - t) < 1e-6, `${t}`);
  // the pose at the time it reached a sample is at that sample's recorded spot, heading along the road
  for (const i of [10, 400, 900]) {
    const p = R.poseAt(alien.t[i]);
    assert.ok(Math.hypot(p.x - alien.x[i], p.z - alien.z[i]) < 0.01, `sample ${i}`);
    assert.ok(Math.cos(p.h - Math.atan2(T.TZ[i], T.TX[i])) > 0.9, `sample ${i}: heading`);
  }
  // no positions: the middle of the road
  const bare = replayOf({ ...alien, x: null, z: null, h: null }, T), q = bare.poseAt(alien.t[400]);
  assert.equal(bare.source, 'centre'); assert.ok(Math.hypot(q.x - T.PX[400], q.z - T.PZ[400]) < 2.5);
});

test('compared by time the faster lap is ahead; by distance it is at your spot; the delta is the time difference there', () => {
  const me = replayOf(rookie, T), ref = replayOf(alien, T), t = me.time * 0.6;
  const a = compareAt(me, ref, t, 'time'), b = compareAt(me, ref, t, 'distance');
  assert.ok(a.ahead > 0, 'the ALIEN is ahead of the ROOKIE at the same time');
  assert.ok(a.delta > 0, 'and the ROOKIE is slower to here');
  assert.equal(b.ahead, 0); assert.ok(Math.abs(b.sRef - b.sMe) < 1e-9);
  assert.ok(Math.abs(a.delta - b.delta) < 1e-9, 'the delta is the same either way');
  assert.ok(Math.abs(b.delta - (me.timeAt(b.sMe) - ref.timeAt(b.sMe))) < 1e-9);
  const d = deltaSeries(me, ref);
  assert.ok(Math.abs(d[N] - (rookie.time - alien.time)) < 1e-6, 'the delta at the line = the lap times\' difference');
  // past the faster lap's end, it waits at the line
  const end = compareAt(me, ref, me.time, 'time');
  assert.ok(Math.abs(end.tRef - ref.time) < 1e-9);
});

test('the car model is given wheels turning, steering into the bends and the brake lights', () => {
  const R = replayOf(alien, T);
  let steered = 0, braked = 0, last = -Infinity;
  for (let t = 0.5; t < R.time - 0.5; t += 0.25) {
    const { car, pose } = modelState(R, t, T.ds);
    assert.ok(Math.abs(car.steer) <= 1 && car.roll >= last); last = car.roll;
    const k = T.K[Math.round(pose.s) % N];
    if (Math.abs(k) > 0.005 && Math.sign(car.steer) === Math.sign(k)) steered++;
    if (car.brake > 0.3) braked++;
  }
  assert.ok(steered > 5, `steered into ${steered} tight bends`); assert.ok(braked > 5);
});

test('your laps are recorded with where the car was and its gear', () => {
  const race = SIM.createRace({ type: 'unlimited' }, { track: T, drivers: SIM.DRIVERS.filter(d => d.player), seed: 3 }), c = race.cars[0];
  const rec = createTraceRecorder(N); let tr = null;
  rec.start(1, c, 0);
  while (!tr && race.t < 120) {
    race.t += 1 / 120; SIM.driveAI(race, c, 1 / 120, 0.9);
    for (const e of c.events) if (e.type === SIM.EV.LAP) tr = rec.finish(e.time);
    c.events.length = 0;
    if (!tr) rec.sample(c, race.t - c.lapStart);
  }
  assert.ok(tr, 'a lap');
  for (const k of ['x', 'z', 'h', 'gear']) assert.ok(tr[k].every(Number.isFinite), k);
  const R = replayOf(tr, T), p = R.poseAt(tr.t[600]);
  assert.ok(Math.hypot(p.x - tr.x[600], p.z - tr.z[600]) < 0.01);
});
