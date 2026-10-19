// The controller registry (src/game/controllers.js): device kinds from their names, readable names, and which
// device drives (prefs.controller). Pure, so tested in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controllers, kindOf, nameOf, KINDS } from '../src/game/controllers.js';

test('controller kinds and names from the device name', () => {
  const cases = {
    'Xbox 360 Controller (XInput STANDARD GAMEPAD)': 'xbox', 'Microsoft X-Box 360 pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)': 'xbox',
    'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)': 'playstation',
    'Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)': 'wheel', 'Thrustmaster T300RS Racing wheel': 'wheel',
    'FANATEC CSL Elite Wheel Base': 'wheel', 'MOZA R5 Base': 'wheel',
    'Thrustmaster T.16000M (Vendor: 044f Product: b10a)': 'joystick', 'Logitech Extreme 3D Pro Joystick': 'joystick',
    '8BitDo Pro 2 (STANDARD GAMEPAD)': 'gamepad', 'USB Gamepad': 'gamepad',
  };
  for (const [id, kind] of Object.entries(cases)) assert.equal(kindOf(id), kind, id);
  for (const k of new Set(Object.values(cases))) assert.ok(KINDS[k].label && KINDS[k].note, k);
  assert.equal(nameOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'Xbox 360 Controller');
  assert.equal(nameOf('045e-028e-Microsoft X-Box 360 pad'), 'Microsoft X-Box 360 pad');
  assert.equal(nameOf(''), 'Controller');
});

test('which controller drives: the chosen one, else phone, then a standard pad, then any', () => {
  const raw = { key: 'pad:raw', kind: 'wheel', mapping: '' }, std = { key: 'pad:std', kind: 'xbox', mapping: 'standard' }, phone = { key: 'phone', kind: 'phone', mapping: 'standard' };
  assert.equal(Controllers.pick('auto', [raw, std, phone]), phone);
  assert.equal(Controllers.pick('auto', [raw, std]), std);
  assert.equal(Controllers.pick('auto', [raw]), raw);
  assert.equal(Controllers.pick('pad:raw', [raw, std, phone]), raw);
  assert.equal(Controllers.pick('pad:gone', [raw, std]), std, 'the chosen one is unplugged: auto');
  assert.equal(Controllers.pick('auto', []), null);
  assert.deepEqual(Controllers.list(), [], 'in Node: no phone link, no Gamepad API');
});
