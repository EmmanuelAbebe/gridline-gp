// The starting grid by lap time and qualifying (src/game/grid.js): pure, tested in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { RACE_SETUP } from '../src/game/config.js';
import { rivalsOf, topSkill, gridOrder, qualiPlan, qualiStandings } from '../src/game/grid.js';
import { driverLap } from '../src/game/ai-ghosts.js';

const you = S.DRIVERS.find(d => d.player), rivals = rivalsOf(10);
const times = Object.fromEntries(rivals.map((d, i) => [d.code, 60 + i * 0.3]));   // 60.0, 60.3, …

test('the grid: rivals by time, you in front of the first rival slower than you', () => {
  assert.equal(rivals.length, 9); assert.ok(rivals.every(d => !d.player));
  const codes = (t, tt = times) => gridOrder(rivals, tt, you, t).map(d => d.code);
  assert.equal(codes(59)[0], 'YOU', 'faster than all of them: pole');
  assert.equal(codes(60.4).indexOf('YOU'), 2);
  assert.equal(codes(60.3).indexOf('YOU'), 2, 'a tie goes to the rival');
  assert.equal(codes(null).at(-1), 'YOU', 'no lap: the back');
  assert.equal(codes(99).at(-1), 'YOU');
  // a rival with no clean lap goes behind the ones with a time (you too, if you have one)
  const tt = { ...times, [rivals[0].code]: null };
  assert.equal(codes(61, tt).at(-1), rivals[0].code);
  assert.equal(codes(null, tt).at(-1), 'YOU');
  assert.equal(gridOrder(rivals, times, you, 1).length, 10);
});

test('qualifying: every rival sets a first time, then its best, within the session; the timing screen in order', () => {
  const D = 600, plan = qualiPlan(rivals, times, D, 7);
  for (const d of rivals) {
    const [a, b] = plan[d.code];
    assert.ok(a.at > 0 && a.at < b.at && b.at < D, 'both laps inside the session, the best one later');
    assert.ok(a.time > b.time && b.time === times[d.code]);
  }
  assert.deepEqual(qualiPlan(rivals, times, D, 7), plan, 'the same session for the same seed');
  const start = qualiStandings(rivals, plan, 0, you, null);
  assert.ok(start.every(r => r.time === null), 'nobody has a time at the start');
  const end = qualiStandings(rivals, plan, Infinity, you, 60.1);
  assert.deepEqual(end.slice(0, 3).map(r => r.driver.code), [rivals[0].code, 'YOU', rivals[1].code]);
  assert.equal(end[0].gap, 0); assert.ok(Math.abs(end[1].gap - 0.1) < 1e-9);
  assert.deepEqual(end.map(r => r.driver.code), gridOrder(rivals, times, you, 60.1).map(d => d.code), 'the final timing screen = the grid');
});

test('rival lap times: the faster driver is quicker alone at the same level', () => {
  const T = S.buildTrack(S.CIRCUITS.elkmoor), lv = RACE_SETUP.aiLevels.pro, top = topSkill(rivals);
  const a = driverLap(T, rivals[0], 'pro', lv, { aiTop: top }), b = driverLap(T, rivals.at(-1), 'pro', lv, { aiTop: top });
  assert.ok(a > 20 && b > a, `${a} < ${b}`);
});
