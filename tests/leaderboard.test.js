// The online leaderboard's server side (leaderboard/lib): a time-trial run recorded the way the game records it,
// checked by replaying it, and the boards (names, tokens, top 100, one lap per player, ghosts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, centreProfile } from './helpers.js';
import { verifyRun, boardKey } from '../leaderboard/lib/verify.js';
import { memoryStore } from '../leaderboard/lib/store.js';
import { register, playerOf, submit, board, ghost, nameOk, BOARDS } from '../leaderboard/lib/boards.js';

// a time trial as the game runs it (main.js newRace with type 'trial'), driven by a test driver through drivePlayer
// and recorded from lights out; → { replay, laps (as the game saw them) }
function timeTrial({ circuit = 'elkmoor', seconds = 150, mods = {}, aero = true } = {}) {
  const T = S.buildTrack(S.CIRCUITS[circuit]), VP = centreProfile(S, T), format = { type: 'unlimited' };
  const race = S.createRace(format, { track: T, drivers: S.DRIVERS.filter(d => d.player), seed: 99, activeAero: aero, overtake: aero, tyreTemp: true, wear: {}, compound: 'soft' });
  const c = race.cars[0]; c.spec = S.carSpec({}, mods); S.fitTyres(race, c, 'soft');
  const rec = S.createReplayRecorder(race, { format, wear: {}, compound: 'soft', finishedAiSkill: 0.62 }, { setup: {}, mods, compound: 'soft' });
  const laps = [];
  for (let step = 0; step < seconds * 120; step++) {
    race.t += DT;
    const ti = (c.idx + 12) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - c.z, T.PX[ti] - c.x) - c.h), slow = c.v > VP[(c.idx + 4) % T.N];
    const inp = S.quantizeInput({ thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true, steerRate: Infinity, calm: 1 });
    rec.step(c, inp); S.drivePlayer(race, c, inp, DT);
    for (const e of c.events) if (e.type === S.EV.LAP) laps.push({ lap: c.lap - 1, time: e.time, invalid: !!e.invalid });
    c.events.length = 0;
  }
  return { replay: JSON.parse(JSON.stringify(rec.finish())), laps };
}
const run = timeTrial();
const bestFlying = run.laps.filter(l => l.lap >= 2 && !l.invalid).reduce((a, l) => !a || l.time < a.time ? l : a, null);

test('a time-trial run: replayed on the server, its best flying lap is the one the game saw, with sectors, settings and a ghost', () => {
  assert.ok(bestFlying, `a clean flying lap was driven (${JSON.stringify(run.laps)})`);
  const v = verifyRun(run.replay, { time: bestFlying.time, lap: bestFlying.lap });
  assert.ok(v.ok, v.reason);
  assert.equal(v.time, bestFlying.time); assert.equal(v.lap, bestFlying.lap); assert.equal(v.board, boardKey('elkmoor', true));
  assert.equal(v.sectors.length, 3); assert.ok(Math.abs(v.sectors.reduce((a, b) => a + b) - v.time) < 0.01, 'the sectors add up to the lap');
  assert.equal(v.settings.tyres, 'soft'); assert.equal(v.settings.tyreTemp, true); assert.equal(v.settings.gearbox, 'auto');
  assert.equal(v.ghost.enc, 'delta2'); assert.ok(Math.abs(v.ghost.time - v.time) < 1e-9);
});

test('what is not ranked is refused, with the reason', () => {
  const R = run.replay, reasons = [
    [{ ...R, sim: 'other' }, /version/], [{ ...R, tainted: 'autopilot' }, /not driven by you/], [{ ...R, zones: [{ from: 0, to: 500 }] }, /zones/],
    [{ ...R, drivers: ['VOS', 'YOU'] }, /time trial/], [{ ...R, race: { ...R.race, wear: { fuel: 'normal' } } }, /time trial/],
    [{ ...R, player: { ...R.player, mods: { power: 130 } } }, /modified/], [{ ...R, circuit: 'monza' }, /circuit/], [null, /replay/],
  ];
  for (const [rp, why] of reasons) { const v = verifyRun(rp); assert.equal(v.ok, false); assert.match(v.reason, why); }
  assert.match(verifyRun(R, { time: bestFlying.time - 0.5, lap: bestFlying.lap }).reason, /different lap/, 'a claimed time the replay does not drive');
  // an edited input stream: a different race (here: a different, slower or invalid lap, never the claimed one)
  const edited = JSON.parse(JSON.stringify(R)); edited.inputs.thr = edited.inputs.thr.map((v, i) => i % 2 === 0 ? v : Math.ceil(v * 0.7));
  const ve = verifyRun(edited, { time: bestFlying.time, lap: bestFlying.lap });
  assert.ok(!ve.ok || ve.time !== bestFlying.time, 'edited inputs never give the claimed time');
});

test('the boards: names, sign-in, one lap per player, ranks, the top 100 only, ghosts', async () => {
  const store = memoryStore();
  assert.ok(nameOk('Mray 7') && !nameOk('ab') && !nameOk(' x y ') && !nameOk('shithead') && !nameOk('a'.repeat(17)));
  const a = await register(store, { name: 'Mray' }, '1.1.1.1');
  assert.equal(a.status, 200);
  assert.equal((await register(store, { name: 'mray' }, '1.1.1.2')).status, 409, 'names are unique (any case)');
  assert.equal((await register(store, { name: 'x' })).status, 400);
  const me = await playerOf(store, `Bearer ${a.body.id}.${a.body.token}`);
  assert.equal(me.name, 'Mray');
  assert.equal(await playerOf(store, `Bearer ${a.body.id}.${'0'.repeat(48)}`), null, 'a wrong token is nobody');
  assert.equal((await submit(store, null, { replay: run.replay })).status, 401);

  const first = await submit(store, me, { replay: run.replay, claim: { controller: 'phone' } }, { replayBlob: 'gz…' });
  assert.equal(first.status, 200); assert.equal(first.body.status, 'new'); assert.equal(first.body.rank, 1);
  assert.equal((await submit(store, me, { replay: run.replay })).body.status, 'kept', 'the same lap again: nothing changes');
  const B = boardKey('elkmoor', true), list = (await board(store, B)).body.rows;
  assert.equal(list.length, 1); assert.equal(list[0].name, 'Mray'); assert.equal(list[0].settings.controller, 'phone'); assert.equal(list[0].time, bestFlying.time);
  assert.equal((await ghost(store, B, a.body.id)).body.time, bestFlying.time);
  assert.equal((await submit(store, me, { replay: { ...run.replay, zones: [] } })).status, 422);

  // 100 faster laps from others: this one drops out, its ghost with it, and a new lap this slow is "outside"
  for (let k = 0; k < BOARDS.size; k++) await store.zadd(`b:${B}`, 20 + k * 0.01, ('f' + k).padStart(12, '0'));
  const out = await submit(store, me, { replay: run.replay }), b = await register(store, { name: 'Second' });
  assert.equal(out.body.status, 'kept', 'still its own best until the board is trimmed');
  const other = await submit(store, await playerOf(store, `Bearer ${b.body.id}.${b.body.token}`), { replay: run.replay });
  assert.equal(other.body.status, 'outside'); assert.ok(other.body.hundredth < bestFlying.time);
  assert.equal((await board(store, B)).body.rows.length, BOARDS.size);
});

test('the website\'s circuit maps are up to date (npm run tracks in leaderboard/ after a circuit changes)', async () => {
  const fs = await import('node:fs'), { tracksJson } = await import('../leaderboard/build-tracks.mjs');
  assert.equal(fs.readFileSync(new URL('../leaderboard/public/tracks.json', import.meta.url), 'utf8'), tracksJson(), 'run: cd leaderboard && npm run tracks');
});
