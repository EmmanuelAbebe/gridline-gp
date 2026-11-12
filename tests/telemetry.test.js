// Telemetry (src/game/telemetry.js): the car's state at every sample of a lap, recorded by the lap recorders (your laps,
// the AI's, practice runs), saved small and read back within its quanta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from './helpers.js';
import { SIM } from '../src/sim/index.js';
import { RACE_SETUP } from '../src/game/config.js';
import { aiLap } from '../src/game/ai-ghosts.js';
import { traceFromAi, compactTrace, expandTrace } from '../src/game/lap-analysis.js';
import * as TL from '../src/game/telemetry.js';
import * as P from '../src/game/practice-core.js';

globalThis.devicePixelRatio ??= 1;
const T = SIM.buildTrack(SIM.CIRCUITS.hautvale), N = T.N;
const lap = traceFromAi(aiLap(T, 'legend', RACE_SETUP.aiLevels.legend, true));

test('an AI lap carries the car\'s state at every sample: steering, rpm, g, downforce, tyres, battery …', () => {
  const tel = lap.tel;
  assert.ok(tel, 'telemetry recorded');
  const all = id => Array.from(tel[id]), finite = id => all(id).filter(Number.isFinite);
  for (const id of ['steer', 'wheel', 'rpm', 'glat', 'glong', 'yaw', 'df', 'wear', 'soc', 'ers', 'lat', 'surface'])
    assert.equal(finite(id).length, N, id);
  // the downforce grows with the speed² (the fastest sample has far more than the slowest)
  let fast = 0, slow = 0; for (let i = 0; i < N; i++) { if (lap.kmh[i] > lap.kmh[fast]) fast = i; if (lap.kmh[i] < lap.kmh[slow]) slow = i; }
  assert.ok(tel.df[fast] > 3 * tel.df[slow] && tel.df[fast] > 5, `${tel.df[fast]} vs ${tel.df[slow]} kN`);
  assert.ok(Math.max(...finite('glat').map(Math.abs)) > 2, 'cornering g');
  assert.ok(Math.max(...finite('wheel').map(Math.abs)) > 1, 'road-wheel angle');
});

test('saved and read back: every channel within its quantum, a lap in a few tens of KB', () => {
  const back = TL.unpackTelemetry(JSON.parse(JSON.stringify(TL.packTelemetry(lap.tel))), N);
  for (const [id, , , q] of TL.CHANNELS) for (let i = 0; i < N; i++) {
    const a = lap.tel[id][i], b = back[id][i];
    if (!Number.isFinite(a)) { assert.ok(!Number.isFinite(b), `${id}[${i}] NaN`); continue; }
    assert.ok(Math.abs(a - b) <= q / 2 + 1e-4 * Math.abs(a), `${id}[${i}] ${a} → ${b}`);
  }
  const c = compactTrace(lap), json = JSON.stringify(c);
  assert.ok(json.length < 120000, `${json.length} chars`);
  const tr = expandTrace(JSON.parse(json), N);
  assert.ok(tr && tr.tel && Math.abs(tr.tel.rpm[100] - lap.tel.rpm[100]) <= 5);
  assert.equal(TL.unpackTelemetry(TL.packTelemetry(lap.tel), N + 1), null, 'another length: not this lap\'s');
});

test('a practice run records it too, and its saved best keeps the whole run', () => {
  const L = SIM.buildSectors(T), sec = P.sectionFromCorners(L, 2, 4), lead = P.leadSamples(T), len = P.lengthOf(sec, N);
  const race = SIM.createRace({ type: 'unlimited' }, { track: T, drivers: [SIM.DRIVERS[0]], seed: 3 }), c = race.cars[0];
  const rec = P.createRunRecorder(T, sec, lead);
  let t = 0;
  for (let k = 0; k < 120 * 140 && rec.last < lead + len; k++) { SIM.driveAI(race, c, DT); race.t += DT; t += DT; rec.sample(c, t); }
  const run = rec.run, parts = P.runParts(run, P.partsOf(L, sec)), W = lead + len + 1;
  assert.ok(Array.from(run.tel.rpm).every(Number.isFinite));
  const b = P.unpackRun(JSON.parse(JSON.stringify(P.packRun({ time: 10, parts, run }))), lead, len);
  assert.ok(b.run && b.run.tel, 'the run inside');
  for (const w of [0, lead, W - 1]) {
    assert.ok(Math.abs(b.run.kmh[w] - run.kmh[w]) < 0.06 && Math.abs(b.run.x[w] - run.x[w]) < 0.006, `w ${w}`);
    assert.ok(Math.abs(b.run.tel.df[w] - run.tel.df[w]) < 0.006);
  }
  const tr = P.runAsTrace(b.run, sec, N);
  assert.ok(Number.isFinite(tr.tel.steer[sec.from]) && Number.isFinite(tr.x[sec.from]));
});
