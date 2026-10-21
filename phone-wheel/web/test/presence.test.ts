// Is the phone in the driver's hands? (src/engine/presence.ts): on a table or left alone for 10 s = away; driving,
// spinning or shaking the phone never is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence, PRESENCE } from '../src/engine/presence.ts';

const G = 9.81, HZ = 60;
type S = { ax: number; ay: number; az: number; rate: number };
// n samples at 60 Hz from t0 (ms), each from f(i)
function feed(p: ReturnType<typeof createPresence>, n: number, f: (i: number) => S, t0 = 0) {
  let r = 0; for (let i = 0; i < n; i++) r = p.sample(f(i), t0 + i * 1000 / HZ); return r;
}
const secs = (s: number) => Math.round(s * HZ);

test('held as a wheel: steering, holding still on a straight, kerbs, spinning or shaking the phone: never away', () => {
  const p = createPresence();
  // two minutes: tilts up to ±60°, a hand's tremble (a few °/s), kerb rattles, a 15 s straight held as still as a hand
  // can, and a few full spins of the phone (900 °/s, 3 g)
  const r = feed(p, secs(120), (i) => {
    const t = i / HZ, straight = t > 30 && t < 45, spin = Math.floor(t) % 20 === 0 && t % 1 < 0.3;
    const a = straight ? 0.05 : Math.sin(i / 40), tremble = Math.sin(i * 1.7) * 0.25, kerb = !straight && i % 300 < 60 ? Math.sin(i * 3) * 8 : 0;
    return { ax: G * Math.cos(a) + tremble + kerb + (spin ? 25 : 0), ay: G * Math.sin(a), az: 2 + tremble, rate: spin ? 900 : straight ? 2 + Math.abs(Math.sin(i)) * 2 : 20 + Math.abs(Math.sin(i)) * 30 };
  });
  assert.equal(r, 0);
});

test('lying flat on a table: away after 10 s, not before; "I\'m here" clears it; flat but carried about is not', () => {
  const p = createPresence(), table = () => ({ ax: 0.05, ay: -0.03, az: G, rate: 0.5 });
  assert.equal(PRESENCE.flatFor, 10000);
  assert.equal(feed(p, secs(9.5), table), 0, 'not yet');
  assert.equal(feed(p, secs(1), table, 9500), 1);
  p.back(); assert.equal(p.away, 0);
  assert.equal(feed(createPresence(), secs(30), (i) => ({ ax: Math.sin(i) * 0.6, ay: 0, az: G, rate: 15 })), 0, 'flat but moving');
});

test('left alone in any position (on a stand, propped up) for 10 s: away', () => {
  const p = createPresence(), stand = () => ({ ax: G * 0.9, ay: 0.4, az: 3.9, rate: 0.3 });
  assert.equal(feed(p, secs(9.5), stand), 0);
  assert.equal(feed(p, secs(1), stand, 9500), 1);
});
