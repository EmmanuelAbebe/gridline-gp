// AI ghost laps (src/game/ai-ghosts.js): every level laps clean, the levels are in order, the same lap every time
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { SIM } from '../src/sim/index.js';
import { aiGhostLap, aiGhosts, aiGhostsReady, ghostDriver } from '../src/game/ai-ghosts.js';
import { validGhost, ghostPose } from '../src/game/ghost.js';

globalThis.devicePixelRatio ??= 1;
const { RACE_SETUP } = await import('../src/game/config.js');

test('every level laps Elkmoor clean, slowest to fastest', () => {
  const T = SIM.track, laps = aiGhosts(T, RACE_SETUP.aiLevels, true);
  assert.ok(aiGhostsReady(T, true) && !aiGhostsReady(T, false));
  const times = Object.keys(RACE_SETUP.aiLevels).map(id => { const g = laps[id]; assert.ok(validGhost(g, SIM.CIRCUITS), id); return g.time; });
  for (let i = 1; i < times.length; i++) assert.ok(times[i] < times[i - 1], `level ${i} faster: ${times}`);
  assert.equal(laps.alien.driver, `${ghostDriver().code} · ALIEN`);
  assert.ok(ghostPose(laps.alien, laps.alien.time / 2), 'plays back');
  // lap 1 from the grid: starts still, at the grid slot, and is slower than the flying lap
  const st = laps.alien.standing, F = st.frames;
  assert.ok(validGhost(st, SIM.CIRCUITS) && st.time > laps.alien.time);
  assert.ok(Math.hypot(F[3] - F[0], F[4] - F[1]) < 0.1, 'still at lights out');
});

test('the same lap every time', () => {
  const a = aiGhostLap(SIM.track, 'pro', RACE_SETUP.aiLevels.pro), b = aiGhostLap(SIM.track, 'pro', RACE_SETUP.aiLevels.pro);
  assert.equal(a.time, b.time); assert.deepEqual(a.frames, b.frames);
});
