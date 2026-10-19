// Ghost laps (src/game/ghost.js): recording a real lap, playing it back, the live delta, keeping the best per circuit
// and class, the file format (send a lap to a friend), and rejecting broken data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { createRecorder, ghostPose, ghostDelta, loadGhosts, keepGhost, ghostOf, dropGhost, ghostFile, readGhostFile, GHOST } from '../src/game/ghost.js';
import { DT } from './helpers.js';

// one flying lap of the best AI on Elkmoor, recorded like the game does (start at the line, sample every step)
function recordLap() {
  const T = S.track, r = S.createRace(3, { track: T, drivers: [S.DRIVERS[0]], seed: 2 }), c = r.cars[0], rec = createRecorder();
  let ghost = null, lap = 0;
  for (let s = 0; s < 120 * 120 && !ghost; s++) {
    r.t += DT; S.driveAI(r, c, DT, 1);
    for (const e of c.events) if (e.type === S.EV.LAP && lap >= 1) ghost = rec.lap(e.time, { circuit: T.id, modified: false, driver: 'Arno Voss' });
    c.events.length = 0;
    if (c.lap !== lap) { lap = c.lap; if (!ghost) rec.start(c.lapStart); }
    rec.sample(c, r.t);
  }
  return { ghost, T };
}

test('a recorded lap plays back along the track and gives the live delta', () => {
  const { ghost: g, T } = recordLap();
  assert.ok(g && g.time > 25 && g.time < 40, `lap ${g?.time}`);
  assert.ok(Math.abs(g.frames.length / 3 - g.time * GHOST.hz) < 3, 'frames at GHOST.hz');
  // every playback point lies on the road
  for (let t = 0; t < g.time; t += 0.37) {
    const p = ghostPose(g, t); assert.ok(p, `pose at ${t.toFixed(2)}`);
    let best = Infinity; for (let i = 0; i < T.N; i += 2) best = Math.min(best, Math.hypot(p.x - T.PX[i], p.z - T.PZ[i]));
    assert.ok(best < T.HW + 3, `on the road at ${t.toFixed(1)} s (${best.toFixed(1)} m)`);
  }
  assert.equal(ghostPose(g, g.time + 1), null, 'nothing after the lap');
  // splits rise along the lap; the delta of the same lap at its own split is 0
  const sp = g.splits.filter(Number.isFinite);
  assert.ok(sp.length > T.N / GHOST.split * 0.9 && sp.every((v, i) => !i || v >= sp[i - 1]), 'splits in order');
  const k = 20, idx = k * g.split;
  assert.ok(Math.abs(ghostDelta(g, idx, g.splits[k])) < 1e-9);
  assert.ok(Math.abs(ghostDelta(g, idx, g.splits[k] + 0.4) - 0.4) < 1e-9, '+ = slower');
});

test('the store keeps the best per circuit and class; files round-trip; broken data is ignored', () => {
  const { ghost: g } = recordLap(), store = {};
  assert.ok(keepGhost(store, g));
  assert.equal(keepGhost(store, { ...g, time: g.time + 1 }), false, 'a slower lap is not kept');
  assert.ok(keepGhost(store, { ...g, time: g.time - 1 }), 'a faster one replaces it');
  assert.ok(keepGhost(store, { ...g, modified: true }), 'modified cars apart');
  assert.equal(ghostOf(store, g.circuit, false).time, g.time - 1);
  const back = loadGhosts(JSON.stringify(store), S.CIRCUITS);
  assert.equal(ghostOf(back, g.circuit, true).time, g.time);
  dropGhost(back, g.circuit, true); assert.equal(ghostOf(back, g.circuit, true), null);
  const file = readGhostFile(ghostFile(g), S.CIRCUITS);
  assert.deepEqual(file, g);
  for (const bad of ['nope', '{}', JSON.stringify({ gridlineGhost: 1, ...g, circuit: 'mars' }), JSON.stringify({ gridlineGhost: 1, ...g, frames: [1, 2] })])
    assert.equal(readGhostFile(bad, S.CIRCUITS), null);
  assert.deepEqual(loadGhosts('{"elkmoor": {"stock": {"v": 1}}}', S.CIRCUITS), {});
});
