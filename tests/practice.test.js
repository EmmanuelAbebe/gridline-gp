// Practice mode, the pure part (src/game/practice-core.js): sections from corners and over the line, their parts, a
// lap's times over them, a run recorded while a car drives it, the summary's numbers, the corner table and the weakest
// stretch, the saved form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from './helpers.js';
import { SIM } from '../src/sim/index.js';
import { RACE_SETUP } from '../src/game/config.js';
import { aiLap } from '../src/game/ai-ghosts.js';
import { traceFromAi } from '../src/game/lap-analysis.js';
import * as P from '../src/game/practice-core.js';

globalThis.devicePixelRatio ??= 1;
const T = SIM.buildTrack(SIM.CIRCUITS.hautvale), L = SIM.buildSectors(T), N = T.N;
// (the reference lap: LEGEND's; the ALIEN has no clean lap here on these settings)
const alien = traceFromAi(aiLap(T, 'legend', RACE_SETUP.aiLevels.legend, true));
const sum = a => a.reduce((s, t) => s + t, 0);

test('a section from corners: timed in one part per corner, the parts add up to the stretch on a lap', () => {
  const sec = P.sectionFromCorners(L, 2, 4), parts = P.partsOf(L, sec);
  assert.deepEqual(parts.map(p => p.name), ['T3', 'T4', 'T5']);
  assert.equal(P.sectionName(L, sec, T.ds), 'T3 – T5');
  assert.deepEqual(P.cornersIn(L, sec), [2, 3, 4]);
  const lp = P.lapParts(alien, sec, parts, N);
  assert.ok(lp.parts.every(t => t > 1), JSON.stringify(lp));
  assert.ok(Math.abs(lp.time - P.lapSpan(alien, sec.from, sec.to, N)) < 1e-4);
  // the same corners' mini-sectors on that lap
  const mini = k => { const m = L.minis.find(x => x.corner === k); return P.lapSpan(alien, m.from, m.to, N); };
  [2, 3, 4].forEach((k, j) => assert.ok(Math.abs(lp.parts[j] - mini(k)) < 1e-4, `T${k + 1}`));
});

test('a section over the line, a sector and the whole lap', () => {
  const last = L.corners.length - 1, sec = P.sectionFromCorners(L, last, 0);
  assert.ok(sec.to < sec.from, 'over the line');
  const parts = P.partsOf(L, sec), lp = P.lapParts(alien, sec, parts, N);
  assert.ok(parts.length >= 2 && lp.parts.every(t => t > 0.5), JSON.stringify(parts.map(p => p.name)));
  assert.ok(lp.time < alien.time / 2);
  const s2 = { from: SIM.wrapIdx(L.sectors[1].from, N), to: SIM.wrapIdx(L.sectors[1].to, N) };
  assert.equal(P.sectionName(L, s2, T.ds), 'Sector 2');
  const lap = { from: 0, to: 0 };
  assert.equal(P.sectionName(L, lap, T.ds), 'Whole lap');
  assert.equal(P.lengthOf(lap, N), N);
  assert.ok(Math.abs(P.lapParts(alien, lap, P.partsOf(L, lap), N).time - alien.time) < 1e-4);
  // the lap's time from the ring: − on the lead-in, + after it
  assert.ok(P.lapTimeFromRing(alien, sec, SIM.wrapIdx(sec.from - 50, N), N) < 0 && P.lapTimeFromRing(alien, sec, SIM.wrapIdx(sec.from + 50, N), N) > 0);
});

test('a run recorded while a car drives it: its parts add up to the ring-to-square time, its ghost follows the car', () => {
  const sec = P.sectionFromCorners(L, 2, 4), parts = P.partsOf(L, sec), lead = P.leadSamples(T);
  const race = SIM.createRace({ type: 'unlimited' }, { track: T, drivers: [SIM.DRIVERS[0]], seed: 3 }), c = race.cars[0];
  const rec = P.createRunRecorder(T, sec, lead), len = P.lengthOf(sec, N);
  let t = 0, seen = [];
  for (let k = 0; k < 120 * 140 && rec.last < lead + len; k++) {
    SIM.driveAI(race, c, DT); race.t += DT; t += DT; rec.sample(c, t);
    if (k % 97 === 0 && rec.last >= 0) seen.push([t, c.x, c.z]);
  }
  const run = rec.run, ps = P.runParts(run, parts);
  assert.ok(Number.isFinite(run.ring) && ps.every(x => x > 1), JSON.stringify(ps));
  assert.ok(Math.abs(sum(ps) - P.runTime(run, lead + len)) < 1e-4);
  for (const [tt, x, z] of seen) { const p = P.framePose(run.frames, tt); if (p) assert.ok(Math.hypot(p.x - x, p.z - z) < 4, `ghost at ${tt.toFixed(2)} s`); }
  // as a lap trace: corner metrics of those corners
  const tr = P.runAsTrace(run, sec);
  assert.ok(Number.isFinite(tr.kmh[L.corners[2].apex]));
  // kept and read back (ms, cm): the same times
  const back = P.unpackRun(JSON.parse(JSON.stringify(P.packRun({ time: sum(ps), parts: ps, run }))), lead, len);
  assert.ok(back && Math.abs(back.ts[lead + len] - P.runTime(run, lead + len)) < 0.002 && Math.abs(back.ts[lead]) < 0.002);
  assert.equal(P.unpackRun(P.packRun({ time: 1, parts: ps, run }), lead + 1, len), null, 'another lead-in: not this section\'s');
});

test('the summary: best, average, spread, best of each part, colours (purple best, green quicker than the run before)', () => {
  const r = (parts, off) => ({ parts, time: off ? null : sum(parts), off: off || null });
  const runs = [r([6.512, 4.950, 7.741]), r([6.390, 4.871, NaN], 'T5'), r([6.371, 4.902, 7.629]), r([6.302, 4.865, 7.322]),
    r([6.188, 4.802, 7.422]), r([6.260, 4.786, 7.484]), r([6.231, 4.833, 7.533])];
  const S = P.sessionStats(runs);
  assert.equal(S.clean, 6); assert.ok(Math.abs(S.best - 18.412) < 1e-6); assert.equal(S.bestIndex, 4);
  assert.ok(Math.abs(S.spread - (19.203 - 18.412)) < 1e-6);
  assert.deepEqual(S.ofEachRuns, [4, 5, 3]); assert.ok(Math.abs(S.ofEach - (6.188 + 4.786 + 7.322)) < 1e-6);
  assert.equal(P.partColour(runs, 0, 0), 'yellow'); assert.equal(P.partColour(runs, 2, 0), 'green'); assert.equal(P.partColour(runs, 2, 1), 'yellow');
  assert.equal(P.partColour(runs, 4, 0), 'purple'); assert.equal(P.partColour(runs, 1, 2), 'off');
  assert.equal(P.sessionStats([r([1, 2], 'T4')]).best, null);
});

test('where you lose time: corner by corner against a faster lap, the worst three in a row, the words for a corner', () => {
  const pro = traceFromAi(aiLap(T, 'pro', RACE_SETUP.aiLevels.pro, true));
  const rows = P.cornerTable(L, pro, alien, T.ds);
  assert.equal(rows.length, L.corners.length);
  assert.ok(rows.every(x => Number.isFinite(x.gap)) && sum(rows.map(x => x.gap)) > 0, 'PRO loses to LEGEND overall');
  const w = P.weakestStretch(rows);
  const worst = (a) => [0, 1, 2].reduce((s, j) => s + rows[(a + j) % rows.length].gap, 0);
  for (let a = 0; a < rows.length; a++) assert.ok(worst(w[0]) >= worst(a) - 1e-9);
  const k = P.weakestOf(rows, [0, 1, 2]);
  assert.ok([0, 1, 2].every(j => rows[k].gap >= rows[j].gap));
  const words = P.cornerWords(rows[k].me, rows[k].other);
  assert.ok(words.length >= 2 && words.every(([a, b]) => a && b), JSON.stringify(words));
  assert.match(P.changeSentence('T3', { brakeAt: 131, min: 114, fullAt: 48 }, { brakeAt: 117, min: 122, fullAt: 31 }, { brakeAt: 103, min: 127, fullAt: 19 }),
    /^Biggest step: .* in T3\. The ALIEN brakes another 14 m later and carries 5 km\/h more\.$/);
});

test('saved: the choices checked, bests only for this physics', () => {
  const D = P.loadPractice('nonsense');
  assert.deepEqual(D.opts, P.DEFAULT_OPTS); assert.deepEqual(D.best, {});
  const back = P.loadPractice(P.practiceJson({ opts: { start: 'standing', against: 'nope', after: 'drive' }, last: { hautvale: { from: 1, to: 9 } }, best: { k: { time: 1 } } }));
  assert.deepEqual(back.opts, { start: 'standing', against: 'best', after: 'drive' });
  assert.deepEqual(back.last.hautvale, { from: 1, to: 9 }); assert.equal(back.best.k.time, 1);
  const old = JSON.parse(P.practiceJson(back)); old.physics = -1;
  assert.deepEqual(P.loadPractice(JSON.stringify(old)).best, {});
});

test('the analysis: a run and the AI lap as series over the window, where each is at a time, the times line up at the ring', () => {
  const sec = P.sectionFromCorners(L, 2, 4), lead = P.leadSamples(T), len = P.lengthOf(sec, N), W = lead + len + 1;
  const ai = P.traceWindow(alien, sec, lead, len, N);
  assert.equal(ai.t.length, W);
  assert.ok(Math.abs(ai.t[lead]) < 1e-6 && ai.t[0] < 0 && ai.t[W - 1] > 0);
  assert.ok(Math.abs(ai.t[lead + len] - P.lapSpan(alien, sec.from, sec.to, N)) < 1e-4);
  // over the line too
  const over = P.sectionFromCorners(L, L.corners.length - 1, 0), lo = P.lengthOf(over, N), aw = P.traceWindow(alien, over, lead, lo, N);
  for (let w = 1; w <= lead + lo; w++) assert.ok(aw.t[w] >= aw.t[w - 1], `w ${w}: ${aw.t[w - 1]} → ${aw.t[w]}`);
  const at = P.seriesAt(ai, ai.t[lead + 40] + 0.001);
  assert.ok(Math.abs(at.s - (lead + 40)) < 1 && Math.hypot(at.x - ai.x[lead + 40], at.z - ai.z[lead + 40]) < 3);
  assert.equal(P.windowOf(sec, lead, len, sec.from, N), lead);
  assert.equal(P.windowOf(sec, lead, len, SIM.wrapIdx(sec.to + 5, N), N), -1);
});
