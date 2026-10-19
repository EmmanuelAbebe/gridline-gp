// The phone page's pure logic: settings (sanitize, profiles), curves, flick to shift, and the tilt → steering angle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUTTONS, DEFAULTS, bitOf, clone, createFlick, loadStore, pedalValue, sanitize, steerCurve } from '../src/settings/settings.ts';
import { tiltDegrees } from '../src/engine/engine.ts';

test('button bits match the wire protocol order (phonewheel/protocol.py, desktop/phone-link.cjs)', () => {
  assert.deepEqual(BUTTONS.map((b) => b[0]), ['A', 'B', 'X', 'Y', 'LB', 'RB', 'BACK', 'START', 'GUIDE', 'LS', 'RS', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
  assert.equal(bitOf('RB'), 5);
});

test('sanitize: defaults round-trip, junk and out-of-range values are fixed, old profiles load', () => {
  assert.deepEqual(sanitize(clone(DEFAULTS)), DEFAULTS);
  const s = sanitize({ steer: { sensitivity: 999, smoothing: 'x', invert: 1 }, gas: { mode: 'warp', max: -3 }, buttons: [{ label: 'LONGER', bind: 'Z' }, null], layout: { buttonSize: 'xl' } });
  assert.equal(s.steer.sensitivity, 70); assert.equal(s.steer.smoothing, DEFAULTS.steer.smoothing); assert.equal(s.steer.invert, false);
  assert.equal(s.gas.mode, 'ramp'); assert.equal(s.gas.max, 0.1);
  assert.deepEqual(s.buttons, [{ label: 'LONG', bind: 'A', toggle: false }, { label: '2', bind: 'A', toggle: false }]);
  assert.equal(s.layout.buttonSize, 'm');
  // the old page's store format
  const store = loadStore(JSON.stringify({ active: 'Race', profiles: { Race: { steer: { sensitivity: 50 } }, Default: {} } }));
  assert.equal(store.active, 'Race'); assert.equal(store.profiles.Race.steer.sensitivity, 50);
  assert.equal(loadStore('not json').active, 'Default');
});

test('curves: pedal and steering', () => {
  const p = { ...DEFAULTS.gas };
  assert.equal(pedalValue(0, p), 0.2); assert.equal(pedalValue(1, p), 1); assert.equal(pedalValue(5, p), 1);
  assert.equal(pedalValue(0.3, { ...p, mode: 'instant', max: 0.8 }), 0.8);
  const st = { ...DEFAULTS.steer, deadzone: 10, curve: 2 };
  assert.equal(steerCurve(0.05, st), 0); assert.equal(steerCurve(-1, st), -1);
  assert.ok(Math.abs(steerCurve(0.55, st) - 0.25) < 1e-9);
});

test('flick to shift: a quick sideways flick counts, a slow or vertical one does not', () => {
  const f = createFlick(), c = DEFAULTS.flick;
  assert.equal(f.add(100, 100, 0, 1, c), false);
  assert.equal(f.add(150, 105, 100, 1, c), true, 'fast, sideways, toward the centre');
  f.reset(); f.add(100, 100, 0, 1, c);
  assert.equal(f.add(150, 100, 500, 1, c), false, 'too slow');
  f.reset(); f.add(100, 100, 0, 1, c);
  assert.equal(f.add(130, 200, 50, 1, c), false, 'mostly vertical');
  f.reset(); f.add(100, 100, 0, 1, c);
  assert.equal(f.add(50, 100, 50, 1, c), false, 'away from the centre');
});

test('tilt: level = 0°, the steering angle follows the roll in landscape either way round', () => {
  assert.ok(Math.abs(tiltDegrees(1, 0, 90)) < 1e-9, 'landscape, level');
  const r = 20 * Math.PI / 180;
  assert.ok(Math.abs(tiltDegrees(Math.cos(r), Math.sin(r), 90) - 20) < 1e-6);
  assert.ok(Math.abs(tiltDegrees(-Math.cos(r), -Math.sin(r), 270) - 20) < 1e-6, 'turned the other way');
});
