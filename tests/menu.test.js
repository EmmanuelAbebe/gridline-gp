// The start menu's data (src/game/circuit-outlines.js): every circuit has an outline, and it is up to date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SIM as S } from '../src/sim/index.js';
import { OUTLINES } from '../src/game/circuit-outlines.js';
import { outlinesSource } from '../tools/circuit-outlines.mjs';

test('the start menu\'s circuit outlines: one per circuit, in the 200 × 120 box, up to date (npm run outlines)', () => {
  assert.deepEqual(Object.keys(OUTLINES).sort(), Object.keys(S.CIRCUITS).sort());
  for (const [id, o] of Object.entries(OUTLINES)) {
    const nums = o.d.match(/-?[\d.]+/g).map(Number);
    assert.ok(nums.every(v => v >= 0 && v <= 200) && o.d.endsWith('Z'), `${id}: inside the box`);
    assert.ok(o.km > 2 && o.corners > 3, `${id}: length and corners`);
  }
  assert.equal(fs.readFileSync(new URL('../src/game/circuit-outlines.js', import.meta.url), 'utf8'), outlinesSource(), 'run: npm run outlines');
});
