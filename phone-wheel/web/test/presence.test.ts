// Is the phone in the driver's hands? (src/engine/presence.ts): put down flat, dropped, thrown; driving is neither.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence, PRESENCE } from '../src/engine/presence.ts';

const G = 9.81;
// n samples at 60 Hz from t0 (ms), each from f(i)
function feed(p: ReturnType<typeof createPresence>, n: number, f: (i: number) => { ax: number; ay: number; az: number; rate: number }, t0 = 0) {
  let r = 0; for (let i = 0; i < n; i++) r = p.sample(f(i), t0 + i * 1000 / 60); return r;
}

test('held as a wheel, steering hard, shaking on kerbs: never away', () => {
  const p = createPresence();
  // landscape, tilted up to ±60°, hands trembling, a quick flick of 300 °/s now and then, kerb rattle ±0.8 g
  const r = feed(p, 60 * 120, (i) => {
    const a = Math.sin(i / 40) * 1.0, tremble = Math.sin(i * 1.7) * 0.2, kerb = i % 300 < 60 ? Math.sin(i * 3) * 8 : 0;
    return { ax: G * Math.cos(a) + tremble + kerb, ay: G * Math.sin(a), az: 2 + tremble, rate: i % 500 < 10 ? 300 : 20 + Math.abs(Math.sin(i)) * 30 };
  });
  assert.equal(r, 0);
});

test('lying flat and still on a table: away (1) after PRESENCE.flatFor; "I\'m here" clears it', () => {
  const p = createPresence(), n = Math.ceil(PRESENCE.flatFor / (1000 / 60));
  assert.equal(feed(p, n - 10, () => ({ ax: 0.05, ay: -0.03, az: G, rate: 0.5 })), 0, 'not yet');
  assert.equal(feed(p, 20, () => ({ ax: 0.05, ay: -0.03, az: G, rate: 0.5 }), PRESENCE.flatFor - 200), 1);
  p.back(); assert.equal(p.away, 0);
  // flat but moving (carried around, screen up): not put down
  const q = createPresence();
  assert.equal(feed(q, 200, (i) => ({ ax: Math.sin(i) * 0.6, ay: 0, az: G, rate: 15 })), 0);
});

test('dropped (falling) or thrown (a jolt, a spin): away (2) at once', () => {
  assert.equal(feed(createPresence(), 8, () => ({ ax: 0.5, ay: 0.3, az: 0.2, rate: 40 })), 2, 'free fall');
  assert.equal(feed(createPresence(), 3, () => ({ ax: 0.5, ay: 0.3, az: 0.2, rate: 40 })), 0, 'a moment light is not a fall');
  assert.equal(createPresence().sample({ ax: 35, ay: 5, az: 3, rate: 50 }, 0), 2, 'a 3 g jolt');
  assert.equal(createPresence().sample({ ax: G, ay: 0, az: 0, rate: 900 }, 0), 2, 'spinning');
});
