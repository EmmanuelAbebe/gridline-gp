// The ECU's energy maps (src/sim/ecu.js, ECU in tuning.js): what each map does to the battery and the lap, the lift
// points learnt from the driver, MANUAL map buttons, AUTO's choices, and replays of a race with map presses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT } from './helpers.js';
import { brakeAhead } from '../src/sim/ecu.js';

const tracks = {};
const trackOf = id => (tracks[id] ??= S.buildTrack(S.CIRCUITS[id]));
const idOf = name => S.ECU.maps.findIndex(m => m.id === name);

// VOS alone for `laps`, its car on an ECU mode / map ('' = none): lap times and battery % at each line
function solo(id, { mode = '', map = 1, laps = 4, onStep = null } = {}) {
  const race = S.createRace(laps, { track: trackOf(id), drivers: [S.DRIVERS[0]], seed: 7, activeAero: true });
  const c = race.cars[0], out = [];
  c.ecuMode = mode; c.ecuMap = map;
  for (let s = 0; s < 120 * 400 && !c.finished; s++) {
    race.t += DT; S.driveAI(race, c, DT); onStep?.(race, c, s);
    for (const e of c.events) if (e.type === S.EV.LAP) out.push({ time: e.time, soc: c.soc / S.ERS.store });
    c.events.length = 0;
  }
  return { race, c, laps: out };
}

test('BALANCED on the learnt lift points is the AI\'s own map; HARVEST fills the battery, QUALI is quicker while it lasts', () => {
  for (const id of ['elkmoor', 'harrow']) {
    const none = solo(id), bal = solo(id, { mode: 'manual', map: idOf('balanced') });
    const harvest = solo(id, { mode: 'manual', map: idOf('harvest') }), quali = solo(id, { mode: 'manual', map: idOf('quali') });
    none.laps.forEach((l, k) => assert.ok(Math.abs(bal.laps[k].time - l.time) < 0.1, `${id} lap ${k + 1}: BALANCED ${bal.laps[k].time} vs ${l.time}`));
    assert.ok(harvest.laps.at(-1).soc > none.laps.at(-1).soc + 0.25, `${id}: HARVEST ends fuller (${harvest.laps.at(-1).soc} vs ${none.laps.at(-1).soc})`);
    assert.ok(quali.laps[0].time < none.laps[0].time - 0.2, `${id}: QUALI's first lap quicker (${quali.laps[0].time} vs ${none.laps[0].time})`);
    assert.ok(quali.laps.at(-1).soc < 0.1, `${id}: QUALI empties the battery`);
  }
});

test('the ECU learns where the driver lifts, and only ever stops deploying earlier than the track\'s own points', () => {
  const T = trackOf('elkmoor'), { c } = solo('elkmoor', { mode: 'manual', laps: 2 });
  assert.ok(c.ecuBrk instanceof Float32Array && c.ecuBrk.length === T.N, 'a learnt map after a lap');
  const zeros = [...c.ecuBrk].filter(d => d === 0).length;
  assert.ok(zeros >= 4 && zeros < 60, `lift points: ${zeros}`);
  const race = /** @type {any} */ ({ track: T }), probe = /** @type {any} */ ({ ecuBrk: c.ecuBrk, idx: 0 });
  let earlier = 0;
  for (let i = 0; i < T.N; i++) {
    probe.idx = i; const d = brakeAhead(race, probe);
    assert.ok(d <= T.BRK[i] * T.ds + 1e-6, `sample ${i}`); if (d < T.BRK[i] * T.ds - 1) earlier++;
  }
  assert.ok(earlier > 0, 'the driver\'s own lifts add cut points');
});

test('MANUAL: the map buttons step through the maps, stop at the ends and say so', () => {
  const T = trackOf('elkmoor'), race = S.createRace(3, { track: T, drivers: [S.DRIVERS.find(d => d.player)], seed: 1 });
  const c = race.cars[0]; c.ecuMode = 'manual';
  const seen = [];
  const press = map => { race.t += DT; S.drivePlayer(race, c, S.quantizeInput({ steer: 0, thr: 1, brk: 0, map }), DT); seen.push(...c.events.filter(e => e.type === S.EV.ECU)); c.events.length = 0; };
  assert.equal(c.ecuMap, idOf('balanced'));
  press(1); press(0); press(1); press(1);
  assert.equal(c.ecuMap, idOf('quali'));
  assert.deepEqual(seen.map(e => [e.map, e.end]), [['ATTACK', false], ['QUALI', false], ['QUALI', true]]);
  for (let k = 0; k < 6; k++) press(-1);
  assert.equal(c.ecuMap, idOf('harvest'));
});

test('AUTO: HARVEST when the battery runs low, back to BALANCED once refilled, QUALI on the last lap', () => {
  const maps = new Set(), last = new Set();
  const { race } = solo('harrow', { mode: 'auto', laps: 3, onStep: (r, c) => { const m = S.ECU.maps[c.ecuMap].id; maps.add(m); if (c.lap === r.laps) last.add(m); } });
  assert.ok(maps.has('harvest') && maps.has('balanced'), [...maps].join());
  assert.ok(last.has('quali') && !last.has('harvest'), `last lap: ${[...last]}`);
  assert.ok(race.cars[0].finished);
  // a fight: within a second of another car → ATTACK
  const T = trackOf('elkmoor'), fight = S.createRace(5, { track: T, drivers: [S.DRIVERS[0], S.DRIVERS[1]], seed: 3 });
  const me = fight.cars[1]; me.ecuMode = 'auto';
  let attack = 0;
  for (let s = 0; s < 120 * 60; s++) {
    fight.t += DT; for (const c of fight.cars) S.driveAI(fight, c, DT); S.collide(fight);
    if (S.ECU.maps[me.ecuMap].id === 'attack') { attack++; assert.ok(S.gapAhead(fight, me) < 1.4 || S.gapBehind(fight, me) < 1.2, 'only in a fight'); }
    for (const c of fight.cars) c.events.length = 0;
  }
  assert.ok(attack > 0, 'ATTACK at some point behind the leader');
});

test('a replay with the ECU on MANUAL and map presses drives the same laps', () => {
  const T = trackOf('marrow'), me = S.DRIVERS.find(d => d.player);
  const opts = { format: { type: 'unlimited' } };
  const race = S.createRace(opts.format, { track: T, drivers: [me], seed: 9, activeAero: true });
  const c = race.cars[0]; c.ecuMode = 'auto';
  const rec = S.createReplayRecorder(race, opts, { setup: {}, mods: {}, compound: 'medium' }), laps = [];
  for (let s = 0; s < 120 * 130; s++) {
    if (s === 4000) c.ecuMode = 'manual';                          // Settings → Driving, mid-race
    race.t += DT;
    // a test driver on the player's controls (steering to the centre line, bang-bang pedals), a map button now and then
    const ti = (c.idx + 12) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - c.z, T.PX[ti] - c.x) - c.h);
    const fast = c.v > T.VP[(c.idx + 8) % T.N] * 0.85;
    const inp = S.quantizeInput({ steer: S.clamp(diff * 3, -1, 1), thr: fast ? 0 : 1, brk: fast ? 0.7 : 0, analog: true, steerRate: Infinity, calm: 1,
      map: s % 3000 === 1500 ? (s % 6000 === 1500 ? 1 : -1) : 0 });
    rec.step(c, inp); S.drivePlayer(race, c, inp, DT);
    for (const e of c.events) if (e.type === S.EV.LAP) laps.push({ lap: c.lap - 1, time: e.time, invalid: !!e.invalid });
    c.events.length = 0;
  }
  assert.ok(laps.length >= 2, `laps: ${laps.length}`);
  const rp = JSON.parse(JSON.stringify(rec.finish()));
  assert.ok(rp.changes.some(([, d]) => d.ecuMode === 'manual'), 'the mode change is in the replay');
  const again = S.replayRun(rp, { track: S.buildTrack(S.CIRCUITS.marrow) });
  assert.deepEqual(again.laps, laps);
  assert.equal(again.car.ecuMap, c.ecuMap);
  assert.equal(again.car.soc, c.soc);
});
