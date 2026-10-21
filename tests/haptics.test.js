// Force feedback for the phone (src/game/haptics.js): what the player's car feels → { fx } messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { createHaptics, HAPTICS } from '../src/game/haptics.js';

const car = (o = {}) => ({ v: 40, vy: 0, steer: 0, onKerb: false, offTrack: false, surface: 'track', slideF: 0, slideR: 0, lockF: false, spinR: false, pit: null, ...o });

test('kerbs, gravel, grass and slides are felt; a clean lap on the road is not', () => {
  const h = createHaptics();
  assert.deepEqual(h.feel(car()), { k: 0, kh: 0, o: 0, s: 0, l: 0 });
  const k = h.feel(car({ onKerb: true, surface: 'kerb' }));
  assert.ok(k.k > 0.3 && k.kh >= HAPTICS.kerb.minHz && k.kh <= HAPTICS.kerb.maxHz);
  assert.equal(h.feel(car({ onKerb: true, surface: 'sausage' })).k, 1);
  assert.ok(h.feel(car({ offTrack: true, surface: 'gravel' })).o > h.feel(car({ offTrack: true, surface: 'grass' })).o);
  assert.ok(h.feel(car({ slideR: 0.5 })).s > 0);
  assert.equal(h.feel(car({ v: 1, offTrack: true, surface: 'gravel' })).o, 0, 'nothing when stopped');
});

test('messages: at HAPTICS.hz while felt, one with zeros when it stops, hits and shifts once', () => {
  const h = createHaptics(), dt = 1 / 120;
  assert.equal(h.frame(car(), dt), null, 'nothing felt, nothing sent');
  let sent = 0;
  for (let i = 0; i < 120; i++) if (h.frame(car({ offTrack: true, surface: 'grass' }), dt)) sent++;
  assert.ok(Math.abs(sent - HAPTICS.hz) <= 1, `${sent} per second`);
  for (let i = 0; i < 12; i++) h.frame(car({ offTrack: true, surface: 'grass' }), dt);
  let stop = null; for (let i = 0; i < 12 && !stop; i++) stop = h.frame(car(), dt);
  assert.deepEqual(stop.fx, { k: 0, kh: 0, o: 0, s: 0, l: 0 });
  for (let i = 0; i < 24; i++) assert.equal(h.frame(car(), dt), null, 'then quiet');
  h.event({ type: S.EV.WALL, impact: 30, hard: 1 });
  assert.equal(h.frame(car(), dt).fx.h, 1, 'a hit goes at once');
  h.event({ type: S.EV.SHIFT, from: 3, to: 4 });
  assert.equal(h.frame(car(), dt).fx.g, 1);
  h.event({ type: S.EV.CONTACT, impact: 0.5 });
  assert.equal(h.frame(car(), dt), null, 'a brush is not a hit');
  h.event({ type: S.EV.WALL, impact: 30, hard: 1 });
  assert.equal(h.frame(null, dt), null, 'menus / pause: nothing');
});

test('full steering lock: a knock when it gets there, then held while it stays (any speed), released after', () => {
  const h = createHaptics(), dt = 1 / 120;
  const first = h.frame(car({ steer: -1, v: 0 }), dt);
  assert.equal(first.fx.l, 1); assert.equal(first.fx.ls, 1, 'the knock once');
  let knocks = 0, held = 0;
  for (let i = 0; i < 120; i++) { const m = h.frame(car({ steer: 0.99 }), dt); if (m) { held += m.fx.l; knocks += m.fx.ls ? 1 : 0; } }
  assert.equal(knocks, 0, 'left to right without letting go of the lock: no new knock');
  assert.ok(held >= HAPTICS.hz - 1);
  let stop = null; for (let i = 0; i < 12 && !stop; i++) stop = h.frame(car({ steer: 0.5 }), dt);
  assert.equal(stop.fx.l, 0);
  assert.equal(h.frame(car({ steer: 1 }), dt).fx.ls, 1, 'again after letting go');
  assert.equal(h.feel(car({ steer: 1, pit: {} })).l, 0, 'not in the pit lane');
});
