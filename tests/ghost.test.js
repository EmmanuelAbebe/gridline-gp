// Ghost laps (src/game/ghost.js): recording a real lap, playing it back, the live delta, keeping the best per circuit
// and class, the file format (send a lap to a friend), and rejecting broken data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { createRecorder, ghostPose, ghostDelta, loadGhosts, keepGhost, ghostOf, dropGhost, ghostFile, readGhostFile, GHOST, storeJson, compactGhost, expandGhost, packGhost, unpackGhost } from '../src/game/ghost.js';
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
  assert.ok(g && g.time > 34 && g.time < 50, `lap ${g?.time}`);   // (Elkmoor, real-F1 physics since 2026-10-24)
  assert.ok(Math.abs(g.frames.length / 3 - g.time * GHOST.hz) < 3, 'frames at GHOST.hz');
  // every playback point lies on the road
  for (let t = 0; t < g.time - 1 / GHOST.hz; t += 0.37) {    // (the last frame is up to 1/hz before the lap's end)
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

// the compact form keeps every pose exactly and the splits to the millisecond
function same(a, b) {
  const { frames, splits, ...meta } = b;
  assert.ok(a); assert.deepEqual(a.frames, frames);
  assert.equal(a.splits.length, splits.length);
  a.splits.forEach((t, i) => assert.ok(Math.abs(t - splits[i]) <= 5e-4 + 1e-9, `split ${i}`));
  for (const k in meta) assert.deepEqual(a[k], meta[k], k);
}

test('compact and gzipped laps round-trip, and are much smaller', async () => {
  const { ghost: g } = recordLap();
  const c = compactGhost(g);
  same(expandGhost(JSON.parse(JSON.stringify(c))), g);
  assert.ok(c.d.every(Number.isInteger) && c.ds.every(Number.isInteger));
  const plain = JSON.stringify({ gridlineGhost: 1, ...g }).length, small = ghostFile(g).length, bytes = await packGhost(g);
  assert.ok(small < plain * 0.6, `compact ${small} vs ${plain}`);
  assert.ok(bytes.length < plain * 0.15, `gzipped ${bytes.length} vs ${plain}`);
  same(await unpackGhost(bytes, S.CIRCUITS), g);
  same(await unpackGhost(new TextEncoder().encode(JSON.stringify({ gridlineGhost: 1, ...g })), S.CIRCUITS), g);   // an old .json
  assert.equal(await unpackGhost(new Uint8Array([0x1f, 0x8b, 1, 2, 3]), S.CIRCUITS), null, 'broken gzip');
  assert.equal(expandGhost({ ...c, d: [1, 2] }), null);
});

// laps 1 and 2 recorded the way the game does (from lights out, then at every crossing): a standing and a flying lap
function recordTwo() {
  const T = S.track, r = S.createRace({ type: 'unlimited' }, { track: T, drivers: [S.DRIVERS[0]], seed: 2 }), c = r.cars[0], rec = createRecorder(), laps = [];
  rec.start(0);
  for (let s = 0; s < 120 * 120 && laps.length < 2; s++) {
    r.t += DT; S.driveAI(r, c, DT, 1); rec.sample(c, r.t);
    for (const e of c.events) if (e.type === S.EV.LAP) { laps.push(rec.lap(e.time, { circuit: T.id, modified: false, driver: 'You', start: c.lap === 2 })); rec.start(c.lapStart); }
    c.events.length = 0;
  }
  return laps;
}

test('standing-start and flying laps are kept apart; old saves are sorted; a file carries both', async () => {
  const [st, fl] = recordTwo(), store = {};
  assert.ok(st.start && !fl.start && st.time > fl.time, `${st.time} standing vs ${fl.time} flying`);
  assert.ok(keepGhost(store, st) && keepGhost(store, fl), 'both kept: different slots');
  assert.equal(ghostOf(store, st.circuit, false).time, fl.time);
  assert.equal(ghostOf(store, st.circuit, false, true).time, st.time);
  const back = loadGhosts(storeJson(store), S.CIRCUITS);
  assert.equal(ghostOf(back, st.circuit, false, true).time, st.time);
  // a save from before the flag: one lap in the flying slot, from the grid → moved to the standing slot
  const { start, ...old } = st; void start;
  const moved = loadGhosts(JSON.stringify({ [st.circuit]: { stock: old } }), S.CIRCUITS);
  assert.equal(ghostOf(moved, st.circuit, false), null);
  assert.equal(ghostOf(moved, st.circuit, false, true).time, st.time);
  // a file: the flying lap with the standing one inside
  const read = await unpackGhost(await packGhost(fl, st), S.CIRCUITS);
  assert.equal(read.time, fl.time); assert.equal(read.standing.time, st.time); assert.ok(read.standing.start && !read.start);
  dropGhost(back, st.circuit, false);
  assert.equal(ghostOf(back, st.circuit, false, true), null, 'drop clears both');
});

test('the store keeps the best per circuit and class; files round-trip; broken data is ignored', () => {
  // (a flying lap, flagged as the game flags them: the old saves' guess from the first frames is tested below)
  const { ghost: g0 } = recordLap(), g = { ...g0, start: false }, store = {};
  assert.ok(keepGhost(store, g));
  assert.equal(keepGhost(store, { ...g, time: g.time + 1 }), false, 'a slower lap is not kept');
  assert.ok(keepGhost(store, { ...g, time: g.time - 1 }), 'a faster one replaces it');
  assert.ok(keepGhost(store, { ...g, modified: true }), 'modified cars apart');
  assert.equal(ghostOf(store, g.circuit, false).time, g.time - 1);
  const back = loadGhosts(storeJson(store), S.CIRCUITS);
  assert.equal(ghostOf(back, g.circuit, true).time, g.time);
  dropGhost(back, g.circuit, true); assert.equal(ghostOf(back, g.circuit, true), null);
  same(readGhostFile(ghostFile(g), S.CIRCUITS), g);
  same(readGhostFile(JSON.stringify({ gridlineGhost: 1, ...g }), S.CIRCUITS), g);       // an old plain file
  assert.deepEqual(loadGhosts(JSON.stringify(store), S.CIRCUITS)[g.circuit].stock, { ...store[g.circuit].stock, start: false }, 'old plain saves load (a flying lap)');
  for (const bad of ['nope', '{}', JSON.stringify({ gridlineGhost: 1, ...g, circuit: 'mars' }), JSON.stringify({ gridlineGhost: 1, ...g, frames: [1, 2] })])
    assert.equal(readGhostFile(bad, S.CIRCUITS), null);
  assert.deepEqual(loadGhosts('{"elkmoor": {"stock": {"v": 1}}}', S.CIRCUITS), {});
});

test('ghosts on your own straight-mode zones are kept apart from the automatic zones\' (and from other zones)', () => {
  const { ghost: g0 } = recordLap(), g = { ...g0, start: false }, store = {};
  assert.ok(keepGhost(store, g));
  assert.ok(keepGhost(store, { ...g, time: g.time + 5, zones: '100-600' }), 'a slower lap on other zones is still kept: it is their best');
  assert.ok(keepGhost(store, { ...g, time: g.time + 3, zones: 'none', start: true }));
  assert.equal(ghostOf(store, g.circuit, false).time, g.time);
  assert.equal(ghostOf(store, g.circuit, false, false, '100-600').time, g.time + 5);
  assert.equal(ghostOf(store, g.circuit, false, true, 'none').time, g.time + 3);
  assert.equal(ghostOf(store, g.circuit, false, false, '200-700'), null);
  const back = loadGhosts(storeJson(store), S.CIRCUITS);
  assert.equal(ghostOf(back, g.circuit, false, false, '100-600').zones, '100-600', 'saved and read back in its slot');
  assert.equal(ghostOf(back, g.circuit, false, true, 'none').time, g.time + 3);
  dropGhost(back, g.circuit, false, '100-600');
  assert.equal(ghostOf(back, g.circuit, false, false, '100-600'), null); assert.ok(ghostOf(back, g.circuit, false), 'the others stay');
  // a file keeps its zones (its standing lap too)
  const f = readGhostFile(ghostFile({ ...g, zones: '100-600' }, { ...g, start: true }), S.CIRCUITS);
  assert.equal(f.zones, '100-600'); assert.equal(f.standing.zones, '100-600');
  assert.equal(readGhostFile(ghostFile({ ...g, zones: 'x; y' }), S.CIRCUITS), null, 'broken zones: not a ghost');
});
