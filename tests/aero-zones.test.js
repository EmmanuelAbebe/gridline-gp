// The saved straight-mode zones per circuit (src/game/aero-zones.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAeroZones, zonesFor, withZones } from '../src/game/aero-zones.js';

test('saved zones: per circuit, checked on load, removed = automatic', () => {
  const circuits = { harrow: {}, elkmoor: {} };
  let s = loadAeroZones(null, circuits);
  assert.equal(zonesFor(s, 'harrow'), null);
  s = withZones(s, 'harrow', [{ from: 100.04, to: 400 }]);
  assert.deepEqual(zonesFor(s, 'harrow'), [{ from: 100, to: 400 }]);
  s = withZones(s, 'elkmoor', []);
  assert.deepEqual(zonesFor(s, 'elkmoor'), [], 'no zones at all is a choice too');
  const back = loadAeroZones(JSON.stringify({ ...s, nowhere: [{ from: 1, to: 2 }], cobalt: 'x' }), circuits);
  assert.deepEqual(back, s);
  assert.deepEqual(loadAeroZones(JSON.stringify({ harrow: [{ from: -1, to: 5 }, { from: 'a' }, { from: 3, to: 9 }] }), circuits).harrow, [{ from: 3, to: 9 }]);
  assert.equal(zonesFor(withZones(s, 'harrow', null), 'harrow'), null);
});
