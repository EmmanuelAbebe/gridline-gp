// The rear lights (src/game/rear-lights.js): real 2026 F1 (energy and slow-car lights), + braking, or brake lights; the
// exhaust's heat glow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rearLightWant, exhaustHeat, REAR_LIGHTS } from '../src/game/rear-lights.js';

const car = o => ({ brake: 0, thr: 0, ersKw: 0, v: 50, limiterOn: false, pit: null, beached: false, upset: null, ...o });
const litOver = (c, mode, secs = 1, step = 0.01) => { let on = 0, flips = 0, last = null; for (let t = 0; t < secs; t += step) { const w = rearLightWant(c, mode, t).want; if (w > 0.5) on++; if (last !== null && (w > 0.5) !== last) flips++; last = w > 0.5; } return { share: on * step / secs, flips }; };

test('real: no brake lights; flashing while harvesting, fast when super clipping; steady with the limiter or stopped', () => {
  assert.equal(rearLightWant(car({ brake: 1 }), 'real', 0).want, 0, 'braking alone: dark');
  assert.equal(rearLightWant(car({ thr: 1, ersKw: 300 }), 'real', 0).want, 0, 'deploying: dark');
  const h = litOver(car({ brake: 0.8, ersKw: -300 }), 'real', 2), c = litOver(car({ thr: 1, ersKw: -150 }), 'real', 2);
  assert.ok(Math.abs(h.share - 0.5) < 0.05 && Math.abs(h.flips - 2 * REAR_LIGHTS.slow * 2) <= 1, JSON.stringify(h));
  assert.ok(c.flips > h.flips * 2.5, `super clipping flashes faster (${c.flips} vs ${h.flips})`);
  assert.ok(rearLightWant(car({ ersKw: -300 }), 'real', 0).flash);
  for (const o of [{ limiterOn: true }, { pit: {} }, { beached: true }, { upset: {} }]) assert.equal(rearLightWant(car(o), 'real', 0.3).want, 1, JSON.stringify(o));
});

test('real + braking adds hard braking; brake lights are the pedal', () => {
  assert.equal(rearLightWant(car({ brake: 0.3 }), 'realBrake', 0).want, 0);
  assert.equal(rearLightWant(car({ brake: 0.9 }), 'realBrake', 0).want, 0.8);
  assert.equal(rearLightWant(car({ brake: 0.4 }), 'brake', 0).want, 1);
  assert.equal(rearLightWant(car({ brake: 0.02, ersKw: -300 }), 'brake', 0).want, 0);
});

test('the exhaust heats up flat out and cools off the throttle', () => {
  let h = 0; for (let i = 0; i < 120; i++) h = exhaustHeat(h, car({ thr: 1, v: 80 }), 0.025);
  assert.ok(h > 0.95, String(h));
  for (let i = 0; i < 30; i++) h = exhaustHeat(h, car({ thr: 0, v: 80 }), 0.025);
  assert.ok(h < 0.55 && h > 0.4, String(h));
  assert.equal(exhaustHeat(0, car({ thr: 1, v: 5 }), 1), 0, 'not at walking pace');
});
