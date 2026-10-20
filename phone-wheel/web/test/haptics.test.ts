// Force feedback on the phone (src/engine/haptics.ts): the game's {fx} → vibrate() patterns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFB, idlePlan, planFeedback, type Plan } from '../src/engine/haptics.ts';
import { DEFAULTS, clone, sanitize } from '../src/settings/settings.ts';

const cfg = () => clone(DEFAULTS.feedback);
const sum = (p: number[]) => p.reduce((a, b) => a + b, 0);
const onTime = (p: number[]) => p.reduce((a, b, i) => a + (i % 2 ? 0 : b), 0);

test('nothing felt plays nothing; stopping a rumble stops the motor once', () => {
  assert.equal(planFeedback({ k: 0, o: 0, s: 0 }, cfg(), 0, idlePlan()).pattern, null);
  const r = planFeedback({ s: 0.5 }, cfg(), 0, idlePlan());
  assert.ok(r.pattern && sum(r.pattern) >= FFB.span);
  const off = planFeedback({}, cfg(), 50, r.state);
  assert.deepEqual(off.pattern, []);
  assert.equal(planFeedback({}, cfg(), 100, off.state).pattern, null);
});

test('stronger = on for longer; strength and the effect switches apply', () => {
  const at = (fx: object, c = cfg()) => onTime(planFeedback(fx, c, 0, idlePlan(), () => 0.5).pattern ?? []);
  assert.ok(at({ k: 0.9, kh: 10 }) > at({ k: 0.3, kh: 10 }));
  assert.ok(at({ o: 0.8 }) > at({ o: 0.3 }));
  const weak = cfg(); weak.strength = 0.5;
  assert.ok(at({ s: 0.8 }, weak) < at({ s: 0.8 }));
  const noKerbs = cfg(); noKerbs.kerbs = false;
  assert.equal(at({ k: 0.9, kh: 10 }, noKerbs), 0);
  const off = cfg(); off.on = false;
  assert.equal(planFeedback({ h: 1 }, off, 0, idlePlan()).pattern, null);
  // every pulse is long enough for the motor
  for (const p of [planFeedback({ k: 0.1, kh: 18 }, cfg(), 0, idlePlan()).pattern!, planFeedback({ o: 1 }, cfg(), 0, idlePlan()).pattern!])
    p.forEach((ms, i) => { if (i > 1) assert.ok(ms >= (i % 2 ? FFB.minOff : FFB.minOn), `pulse ${i} = ${ms} ms`); });
});

test('the same kerb ripple keeps playing in step when it is renewed', () => {
  let st: Plan = idlePlan();
  const first = planFeedback({ k: 0.6, kh: 10 }, cfg(), 0, st); st = first.state;
  assert.equal(planFeedback({ k: 0.6, kh: 10 }, cfg(), 50, st).pattern, null, 'still playing: left alone');
  const t = st.until - FFB.renew + 5, again = planFeedback({ k: 0.6, kh: 10 }, cfg(), t, st);
  assert.ok(again.pattern);
  // the renewed pattern's pulses start on the 100 ms grid of the first one
  const p = again.pattern!, firstOnAt = p[0] > 0 && (t % 100) < p[0] + (t % 100) ? t : t + p[0] + p[1];
  const nextOn = p[0] > 0 ? t + p[0] + p[1] : t + p[1];
  assert.equal(Math.round(nextOn) % 100, 0, `next pulse at ${nextOn}`);
  assert.ok(firstOnAt >= t);
});

test('a hit takes the motor, then the rumble carries on', () => {
  const hit = planFeedback({ h: 1, o: 0.5 }, cfg(), 0, idlePlan());
  assert.equal(hit.pattern!.length, 1);
  assert.ok(hit.pattern![0] > planFeedback({ h: 0.2 }, cfg(), 0, idlePlan()).pattern![0], 'harder = longer');
  assert.equal(planFeedback({ o: 0.5 }, cfg(), 10, hit.state).pattern, null, 'not during the hit');
  assert.ok(planFeedback({ o: 0.5 }, cfg(), hit.pattern![0] + 1, hit.state).pattern!.length > 2, 'after it');
});

test('feedback settings are sanitized; old profiles get the defaults', () => {
  assert.deepEqual(sanitize({}).feedback, DEFAULTS.feedback);
  const s = sanitize({ feedback: { strength: 9, kerbs: 'no', on: false } }).feedback;
  assert.equal(s.strength, 2); assert.equal(s.kerbs, true); assert.equal(s.on, false);
});
