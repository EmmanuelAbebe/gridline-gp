// Is the driver there? (src/game/presence.js): an untouched pad, the phone put down, a controller gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence, PRESENCE } from '../src/game/presence.js';

const pad = (x = 0, kind = 'xbox') => ({ key: 'pad:1', kind, axes: [x, 0, 0, 0], buttons: [{ pressed: false, value: 0 }, { pressed: false, value: 0.3 }] });
const run = (p, secs, input, dt = 1 / 60) => { let r = null; for (let t = 0; t < secs; t += dt) r = p.update(dt, input) ?? r; return r; };

test('a pad nobody touches is idle after PRESENCE.idleAfter s; any movement or not racing resets it', () => {
  const p = createPresence();
  assert.equal(run(p, PRESENCE.idleAfter - 1, { racing: true, pad: pad() }), null);
  assert.equal(p.update(1 / 60, { racing: true, pad: pad(0.2) }), null, 'the stick moved');
  assert.equal(run(p, PRESENCE.idleAfter - 1, { racing: true, pad: pad(0.2) }), null);
  assert.equal(run(p, 1.1, { racing: true, pad: pad(0.2) }), 'idle');
  assert.equal(run(p, 5, { racing: false, pad: pad(0.2) }), null, 'paused / menus: never');
  // a held pad's noise below the step doesn't count as moving... a real move does
  const q = createPresence();
  let r = null;
  for (let t = 0; t < PRESENCE.idleAfter + 1; t += 1 / 60) r = q.update(1 / 60, { racing: true, pad: pad(Math.sin(t * 7) * 0.05) }) ?? r;
  assert.equal(r, null, 'a hand on the pad');
});

test('the phone says when it is away; a controller that disconnects is lost after a moment', () => {
  const p = createPresence();
  assert.equal(p.update(1 / 60, { racing: true, pad: pad(0, 'phone'), phoneAway: 0 }), null);
  assert.equal(run(p, 60, { racing: true, pad: pad(0, 'phone') }), null, 'a still phone is not idle: the phone decides');
  assert.equal(p.update(1 / 60, { racing: true, pad: pad(0, 'phone'), phoneAway: 1 }), 'phone');
  const q = createPresence();
  q.update(1 / 60, { racing: true, pad: pad() });
  assert.equal(run(q, PRESENCE.lostAfter * 0.5, { racing: true, pad: null }), null, 'a blip');
  assert.equal(run(q, PRESENCE.lostAfter, { racing: true, pad: null }), 'lost');
  assert.equal(run(createPresence(), 5, { racing: true, pad: null }), null, 'keyboard only: never');
});

test('carrying on without a lost controller does not ask again', () => {
  const p = createPresence();
  p.update(1 / 60, { racing: true, pad: pad() });
  assert.equal(run(p, 2, { racing: true, pad: null }), 'lost');
  p.reset();
  assert.equal(run(p, 5, { racing: true, pad: null }), null);
});
