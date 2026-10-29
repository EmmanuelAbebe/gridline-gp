// The game's online client (src/game/online.js) against the leaderboard's own handlers (leaderboard/lib) in memory:
// join, send a lap, the board's fastest lap and its ghost; nothing sent when it isn't worth it or the physics differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { SIM as S } from '../src/sim/index.js';
import { createOnline, loadAccount, boardOf } from '../src/game/online.js';
import { memoryStore } from '../leaderboard/lib/store.js';
import { register, playerOf, submit, board, ghost } from '../leaderboard/lib/boards.js';
import { boardKey } from '../leaderboard/lib/verify.js';
import { DT, centreProfile } from './helpers.js';

globalThis.performance ??= { now: () => Date.now() };
// a fetch that answers like the Vercel functions do (api/*.js), straight from the libraries
function fakeServer(store, sim = S.SIM_VERSION) {
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  return async (url, opts = {}) => {
    const u = new URL(url), body = opts.body ? JSON.parse(opts.body) : {}, q = Object.fromEntries(u.searchParams);
    if (u.pathname === '/api/info') return json(200, { sim, physics: S.TUNING.PHYSICS });
    if (u.pathname === '/api/register') { const r = await register(store, body); return json(r.status, r.body); }
    if (u.pathname === '/api/submit') {
      const replay = JSON.parse(gunzipSync(Buffer.from(body.replay, 'base64')).toString('utf8'));
      const r = await submit(store, await playerOf(store, opts.headers.Authorization), { replay, claim: body.claim });
      return json(r.status, r.body);
    }
    if (u.pathname === '/api/board') { const r = await board(store, boardKey(q.circuit, q.aero !== 'off')); return json(r.status, r.body); }
    if (u.pathname === '/api/ghost') { const r = await ghost(store, boardKey(q.circuit, q.aero !== 'off'), q.id); return json(r.status, r.body); }
    return json(404, { error: 'no' });
  };
}
function trialRun() {
  const T = S.buildTrack(S.CIRCUITS.elkmoor), VP = centreProfile(S, T), format = { type: 'unlimited' };
  const race = S.createRace(format, { track: T, drivers: S.DRIVERS.filter(d => d.player), seed: 4, activeAero: true, tyreTemp: true, wear: {}, compound: 'medium' });
  const c = race.cars[0], rec = S.createReplayRecorder(race, { format, wear: {}, compound: 'medium' }, { setup: {}, mods: {}, compound: 'medium' });
  c.assists = { ...S.ASSISTS.medium }; c.autoShift = true; S.fitTyres(race, c, 'medium');
  let best = null;
  for (let step = 0; step < 150 * 120; step++) {
    race.t += DT;
    const ti = (c.idx + 12) % T.N, d = S.wrapA(Math.atan2(T.PZ[ti] - c.z, T.PX[ti] - c.x) - c.h), slow = c.v > VP[(c.idx + 4) % T.N] * 0.97;
    const inp = S.quantizeInput({ thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(d * 3, -1, 1), analog: true, steerRate: Infinity, calm: 1 });
    rec.step(c, inp); S.drivePlayer(race, c, inp, DT);
    for (const e of c.events) if (e.type === S.EV.LAP && c.lap - 1 >= 2 && !e.invalid && (!best || e.time < best.time)) best = { time: e.time, lap: c.lap - 1 };
    c.events.length = 0;
  }
  return { replay: rec.finish(), best };
}

test('join, send a lap, race the board\'s fastest lap', async () => {
  const store = memoryStore(), saved = [], on = createOnline({ account: loadAccount(null), save: a => saved.push(JSON.stringify(a)), fetchImpl: fakeServer(store) });
  assert.equal(on.signedIn, false); assert.equal(on.worthSending('x', 1), false, 'not joined: nothing sent');
  await assert.rejects(on.register('x'), /name/);
  await on.register('Mray');
  assert.ok(on.signedIn && loadAccount(saved.at(-1)).name === 'Mray', 'the account is saved');
  const { replay, best } = trialRun(), B = boardOf('elkmoor', true);
  assert.ok(best, 'a clean flying lap');
  assert.ok(on.worthSending(B, best.time));
  const r = await on.submit(replay, { time: best.time, lap: best.lap, controller: 'phone' }, B);
  assert.equal(r.status, 'new'); assert.equal(r.rank, 1); assert.equal(r.time, best.time);
  assert.equal(on.worthSending(B, best.time + 1), false, 'slower than what was sent: not sent');
  const top = await on.top('elkmoor', true);
  assert.equal(top.name, 'Mray'); assert.equal(top.time, best.time);
  const g = await on.ghost('elkmoor', true, top);
  assert.equal(g.driver, 'Mray'); assert.ok(g.frames.length > 300 && Math.abs(g.time - best.time) < 1e-9);
  on.setAuto(false); assert.equal(on.worthSending(B, 1), false, 'sending off');
});

test('another physics version on the server: nothing is sent, the game says why', async () => {
  const store = memoryStore(), on = createOnline({ account: loadAccount(null), save: () => {}, fetchImpl: fakeServer(store, 'other') });
  await on.register('Someone');
  await assert.rejects(on.submit({ steps: 10 }, {}, 'b'), /another version/);
  assert.equal((await on.status()).same, false);
});

test('your best lap per board is kept with its run, to send now or later', async () => {
  const { loadRuns, runsJson, keepRun, sendable, settle, statusText } = await import('../src/game/lap-runs.js');
  const runs = {}, base = { board: '2:elkmoor:on', circuit: 'elkmoor', aero: true, lap: 2, date: 1, controller: 'pad', steps: 9000, packed: 'H4sI' };
  assert.ok(keepRun(runs, { ...base, time: 45 }));
  assert.equal(keepRun(runs, { ...base, time: 46 }), false, 'a slower lap is not kept');
  assert.ok(keepRun(runs, { ...base, time: 44.5 }));
  assert.equal(runs[base.board].status, 'unsent'); assert.ok(sendable(runs[base.board]));
  assert.equal(keepRun(runs, { ...base, time: 40, packed: 'x'.repeat(2e6) }), false, 'too big to send: not kept');
  settle(runs[base.board], { status: 'new', rank: 3 });
  assert.equal(statusText(runs[base.board]), 'on the board, P3'); assert.equal(sendable(runs[base.board]), false);
  assert.deepEqual(loadRuns(runsJson(runs)), runs, 'saved and read back');
  assert.deepEqual(loadRuns(JSON.stringify({ sim: 'old', runs })), {}, 'another physics version: dropped');
  settle(runs[base.board], null, 'a modified car');
  assert.match(statusText(runs[base.board]), /not ranked: a modified car/);
});

test('the board\'s 100th place: what a lap must beat to show SUBMIT', async () => {
  const store = memoryStore(), on = createOnline({ account: loadAccount(null), save: () => {}, fetchImpl: fakeServer(store) });
  assert.equal(await on.cutoff('elkmoor', true), Infinity, 'room on the board');
  for (let k = 0; k < 100; k++) await store.zadd(`b:${boardKey('elkmoor', true)}`, 40 + k * 0.1, ('a' + k).padStart(12, '0'));
  on.useServer('https://example.test');           // (a fresh cache)
  assert.ok(Math.abs(await on.cutoff('elkmoor', true) - 49.9) < 1e-9);
});
