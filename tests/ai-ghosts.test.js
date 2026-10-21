// AI ghosts (src/game/ai-ghosts.js): the lap list (levels in order, the same laps every time, the ALIEN's line), the
// live rival (the same laps as the list, in a race of its own) and the live gap
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { SIM } from '../src/sim/index.js';
import { aiLap, aiLapRun, createRival, rivalGap } from '../src/game/ai-ghosts.js';

globalThis.devicePixelRatio ??= 1;
const { RACE_SETUP } = await import('../src/game/config.js');
const L = RACE_SETUP.aiLevels, T = SIM.track;

test('every level laps Elkmoor clean, slowest to fastest; the line has pedals and speed', () => {
  const times = Object.keys(L).map(id => { const l = aiLap(T, id, L[id], true); assert.ok(l, id); return l.time; });
  for (let i = 1; i < times.length; i++) assert.ok(times[i] < times[i - 1], `level ${i} faster: ${times}`);
  const { line } = aiLap(T, 'alien', L.alien, true);
  let brk = 0, gas = 0;
  for (let i = 0; i < T.N; i++) { assert.ok(Math.hypot(line.x[i] - T.PX[i], line.z[i] - T.PZ[i]) < T.HW + 1, `on the road at ${i}`); brk += line.brk[i] > 0.5; gas += line.thr[i] > 0.95; }
  assert.ok(brk > 20 && gas > T.N / 3, `brakes ${brk}, full gas ${gas}`);
});

test('the live rival drives the list\'s laps, and the gap follows', () => {
  const lap = aiLapRun(T, L.pro), r = createRival(T, 'pro', L.pro), laps = [];
  const you = SIM.createRace({ type: 'unlimited' }, { track: T, drivers: [SIM.DRIVERS[1]], seed: 5 }), y = you.cars[0];
  let gaps = 0;
  for (let s = 0; s < 120 * 110; s++) {
    const before = r.car.lap; r.step(1 / 120); if (r.car.lap !== before) laps.push(r.car.lastLap);
    you.t += 1 / 120; SIM.driveAI(you, y, 1 / 120, 0.9); y.events.length = 0;
    const g = rivalGap(y, you.t, r);
    if (s > 120 * 20) { assert.ok(g !== null && g > 0, `the slower car is behind: ${g}`); gaps++; }
  }
  assert.ok(gaps > 0);
  assert.ok(laps.some(t => Math.abs(t - lap.time) < 1e-6), `${laps} has ${lap.time}`);
});
