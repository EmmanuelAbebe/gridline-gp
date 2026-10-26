// Sectors and lap analysis (src/sim/sectors.js, src/game/lap-analysis.js): every circuit's split, laps recorded at
// every sample (their sectors add up to the lap), ghost laps and AI laps read the same way, corner numbers, bests and
// colours, session pace, the saved form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from './helpers.js';
import { SIM } from '../src/sim/index.js';
import { createRecorder } from '../src/game/ghost.js';
import { aiLap } from '../src/game/ai-ghosts.js';
import * as A from '../src/game/lap-analysis.js';

globalThis.devicePixelRatio ??= 1;
const { RACE_SETUP } = await import('../src/game/config.js');
const T = SIM.track, L = SIM.buildSectors(T);

test('every circuit: corners, mini-sectors end to end over the lap, three sectors of a fair share each', () => {
  for (const [id, circuit] of Object.entries(SIM.CIRCUITS)) {
    const track = SIM.buildTrack(circuit), S = SIM.buildSectors(track), N = track.N;
    assert.ok(S.corners.length >= 4 && S.corners.length <= 14, `${id}: ${S.corners.length} corners`);
    assert.equal(S.minis[0].from, 0); assert.equal(S.minis[S.minis.length - 1].to, N);
    for (let m = 1; m < S.minis.length; m++) assert.equal(S.minis[m].from, S.minis[m - 1].to, `${id}: mini ${m} follows on`);
    assert.equal(S.sectors.length, 3);
    for (const s of S.sectors) assert.ok((s.to - s.from) / N > 0.15, `${id}: a sector of ${((s.to - s.from) / N * 100).toFixed(0)} % of the lap`);
    for (const c of S.corners) { const m = S.minis.find(x => x.corner === c.n - 1); assert.ok(m && m.from === c.from, `${id} ${c.name}: its mini-sector starts at its braking point`); }
  }
});

// a "player" lapping Elkmoor (the AI on the player's car), recorded as the game does (sector-timing.js) and as a ghost
function drive(laps = 3) {
  const race = SIM.createRace({ type: 'unlimited' }, { track: T, drivers: SIM.DRIVERS.filter(d => d.player), seed: 3 }), c = race.cars[0];
  const rec = A.createTraceRecorder(T.N), ghost = createRecorder(), traces = [], ghosts = [], firsts = [];
  let first = {};                 // the boundaries' times as the HUD reads them, the moment they are first written
  rec.start(1, c, 0); ghost.start(0);
  while (traces.length < laps && race.t < 400) {
    race.t += DT; SIM.driveAI(race, c, DT, 0.95);
    rec.sample(c, race.t - c.lapStart); ghost.sample(c, race.t);
    for (const m of L.minis) if (m.to < T.N && !(m.to in first) && Number.isFinite(rec.current?.t[m.to])) first[m.to] = rec.current.t[m.to];
    for (const e of c.events) if (e.type === SIM.EV.LAP) {
      traces.push(rec.finish(e.time, { invalid: e.invalid, lap: c.lap - 1 })); firsts.push(first); first = {};
      ghosts.push(ghost.lap(e.time, { circuit: T.id, modified: false, start: c.lap === 2 }));
      rec.start(c.lap, c, race.t - c.lapStart); ghost.start(c.lapStart);
    }
    c.events.length = 0;
  }
  return { traces, ghosts, firsts };
}
const run = drive();

test('a recorded lap: every sample timed, in order, and its sectors and mini-sectors add up to the lap', () => {
  const { traces } = run;
  assert.equal(traces.length, 3); assert.ok(traces[0].start && !traces[1].start, 'lap 1 is from the grid');
  for (const tr of traces) {
    for (let i = 1; i < T.N; i++) { assert.ok(Number.isFinite(tr.t[i]) && Number.isFinite(tr.kmh[i]), `sample ${i}`); assert.ok(tr.t[i] >= tr.t[i - 1], `in order at ${i}`); }
    const sum = a => a.reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sum(A.sectorTimes(tr, L)) - tr.time) < 1e-6 && Math.abs(sum(A.miniTimes(tr, L)) - tr.time) < 1e-6);
  }
  // the live panel's times are the saved lap's (a sample keeps the step the car first reached it)
  run.firsts.forEach((f, k) => { for (const [i, t] of Object.entries(f)) assert.equal(traces[k].t[+i], t, `lap ${k + 1} sample ${i}`); });
});

test('a ghost lap and an AI lap read as traces: the same mini-sector times', () => {
  const { traces, ghosts } = run, tr = traces[1], g = A.traceFromGhost(ghosts[1], T.N);
  A.miniTimes(g, L).forEach((t, m) => assert.ok(Math.abs(t - A.miniTimes(tr, L)[m]) < 0.03, `mini ${m}: ghost ${t.toFixed(3)} vs ${A.miniTimes(tr, L)[m].toFixed(3)}`));
  for (let i = 0; i < T.N; i += 37) assert.ok(Math.abs(g.kmh[i] - tr.kmh[i]) < 6, `speed at ${i}: ${g.kmh[i].toFixed(0)} vs ${tr.kmh[i].toFixed(0)}`);
  const ai = A.traceFromAi(aiLap(T, 'alien', RACE_SETUP.aiLevels.alien, true));
  assert.ok(Math.abs(A.sectorTimes(ai, L).reduce((a, b) => a + b, 0) - ai.time) < 1e-6);
});

test('corners: braking point before the apex, the slowest speed below entry and exit, full gas after it', () => {
  const tr = run.traces[1], M = A.cornerMetrics(tr, L, T.ds);
  assert.equal(M.length, L.corners.length);
  const hairpin = M.reduce((a, c) => c.min < a.min ? c : a);
  assert.ok(hairpin.brakeAt > 30 && hairpin.entry > hairpin.min + 60 && hairpin.exit > hairpin.min, JSON.stringify(hairpin));
  assert.ok(hairpin.fullAt !== null && hairpin.fullAt > -40, `full gas at ${hairpin.fullAt}`);
});

test('bests and colours: the grid lap leaves out its first sector; purple / green / yellow; the reference is the fastest', () => {
  const [l1, l2, l3] = run.traces, b = A.emptyBests(L);
  A.keepBests(b, L, l1);
  assert.equal(b.sec[0], Infinity); assert.ok(Number.isFinite(b.sec[1]) && !b.best, 'lap 1: sectors 2 and 3 only, not the best lap');
  A.keepBests(b, L, l2); A.keepBests(b, L, l3);
  assert.equal(b.best.time, Math.min(l2.time, l3.time));
  assert.ok(A.theoretical(b) <= b.best.time + 1e-9);
  assert.equal(A.colourOf(10, 10.2, 10.1), 'purple'); assert.equal(A.colourOf(10.15, 10.2, 10.1), 'green'); assert.equal(A.colourOf(10.3, 10.2, 10.1), 'yellow');
  assert.equal(A.keepBests(b, L, { ...l2, invalid: true }).sec.length, 0, 'an invalid lap counts for nothing');
  const ai = A.traceFromAi(aiLap(T, 'alien', RACE_SETUP.aiLevels.alien, true));
  const R = A.referenceOf(L, [{ id: 'mine', trace: b.best }, { id: 'alien', trace: ai }]);
  assert.equal(R.ref.id, ai.time < b.best.time ? 'alien' : 'mine');
  R.sec.forEach((t, s) => assert.equal(t, Math.min(A.sectorTimes(ai, L)[s], A.sectorTimes(b.best, L)[s])));
});

test('session pace: average and spread of the valid flying laps, laps near the best, the gap to the AI in %', () => {
  const lap = (time, more = {}) => ({ ...run.traces[1], time, ...more });
  const P = A.sessionPace([lap(80, { start: true }), lap(70), lap(70.4), lap(70.2), lap(90), lap(69, { invalid: true })], L, { pro: 72, alien: 66 });
  assert.equal(P.best, 70); assert.equal(P.counted, 3, 'not lap 1, the 90 s lap or the invalid one');
  assert.ok(Math.abs(P.avg - 70.2) < 1e-9 && Math.abs(P.sd - 0.2) < 1e-9);
  assert.equal(P.within, 3);
  assert.ok(Math.abs(P.gaps.alien.pct - 4 / 66 * 100) < 1e-9 && P.gaps.pro.pct < 0);
});

test('saved: the bests survive a save and load; another layout or physics starts afresh', () => {
  const b = A.emptyBests(L); for (const tr of run.traces) A.keepBests(b, L, tr);
  const store = {}; A.putBests(store, T.id, 'stock', b);
  const json = A.storeSectorsJson(store), back = A.bestsOf(A.loadSectorStore(json), T.id, 'stock', L);
  assert.deepEqual(back.sec.map(t => t.toFixed(3)), b.sec.map(t => t.toFixed(3)));
  assert.ok(Math.abs(back.best.time - b.best.time) < 1e-9);
  for (let i = 0; i < T.N; i += 53) assert.ok(Math.abs(back.best.t[i] - b.best.t[i]) < 0.001 && Math.abs(back.best.kmh[i] - b.best.kmh[i]) <= 0.5);
  assert.ok(json.length < 40000, `${json.length} bytes`);
  assert.equal(A.bestsOf(A.loadSectorStore(json), T.id, 'stock', { ...L, key: 'other' }), null);
  assert.deepEqual(A.loadSectorStore(json.replace(`"physics":${SIM.TUNING.PHYSICS}`, '"physics":1')), {});
});
