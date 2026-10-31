// Controller button maps (src/game/button-map.js): per device, defaults, one action per button, saved JSON checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAP, ACTIONS, MAX_PER_ACTION, loadButtonMaps, mapFor, bindButton, unbindButton, resetDevice, actionOf, cleanMap, buttonName } from '../src/game/button-map.js';

test('button maps: the defaults are the old fixed layout, every action listed, no button twice, no pedals', () => {
  assert.deepEqual(Object.keys(DEFAULT_MAP).sort(), ACTIONS.map(a => a[0]).sort());
  assert.deepEqual(cleanMap(DEFAULT_MAP), { ...DEFAULT_MAP });
  assert.equal(actionOf(DEFAULT_MAP, 9), 'pause');
  assert.equal(actionOf(DEFAULT_MAP, 2), 'box');
  assert.equal(actionOf(DEFAULT_MAP, 8), 'boost');
  assert.equal(actionOf(DEFAULT_MAP, 0), 'shiftDown');
  assert.equal(actionOf(DEFAULT_MAP, 6), null);
  assert.equal(actionOf(DEFAULT_MAP, 16), 'mapUp');             // Guide: the phone's MAP button
  assert.equal(buttonName(8), 'View');
  assert.equal(mapFor(loadButtonMaps(null), 'phone'), DEFAULT_MAP);
});

test('button maps: binding moves a button to the new action, per device; unbind, reset; saved JSON round trip', () => {
  let s = loadButtonMaps('');
  s = bindButton(s, 'phone', 'aero', 8);                        // View: overtake → straight mode, on the phone only
  assert.equal(actionOf(mapFor(s, 'phone'), 8), 'aero');
  assert.deepEqual(mapFor(s, 'phone').boost, []);
  assert.equal(actionOf(mapFor(s, 'pad:xbox'), 8), 'boost');
  s = bindButton(s, 'phone', 'limiter', 16);                   // Guide
  s = bindButton(s, 'phone', 'limiter', 13);
  s = bindButton(s, 'phone', 'limiter', 14);
  assert.deepEqual(mapFor(s, 'phone').limiter, [13, 14], `at most ${MAX_PER_ACTION}, the newest kept`);
  assert.equal(bindButton(s, 'phone', 'aero', 7), s, 'a trigger is never bound');
  assert.equal(bindButton(s, 'phone', 'nonsense', 3), s);
  s = unbindButton(s, 'phone', 'limiter', 13);
  assert.deepEqual(mapFor(s, 'phone').limiter, [14]);
  const back = loadButtonMaps(JSON.stringify(s));
  assert.deepEqual(back, s);
  assert.equal(mapFor(resetDevice(s, 'phone'), 'phone'), DEFAULT_MAP);
  // a hand-edited / broken save: bad buttons dropped, a button on two actions kept by the first, missing actions = default
  const bad = loadButtonMaps(JSON.stringify({ devices: { phone: { shiftDown: [0, 'x', 7, 99], shiftUp: [0, 1], pause: 'START' } } }));
  assert.deepEqual(bad.devices.phone.shiftDown, [0]);
  assert.deepEqual(bad.devices.phone.shiftUp, [1]);
  assert.deepEqual(bad.devices.phone.pause, [9]);
  assert.deepEqual(loadButtonMaps('{nope'), { devices: {} });
});
