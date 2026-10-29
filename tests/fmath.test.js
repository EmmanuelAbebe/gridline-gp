// Deterministic maths (src/sim/fmath.js): as accurate as the engine's own, over the ranges the sim uses and beyond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M } from '../src/sim/fmath.js';

let a = 12345;
const rnd = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
// the worst difference from Math's, in units of the result's last place
function worst(f, g, gen, n = 200000) {
  let w = 0, at = 0;
  for (let i = 0; i < n; i++) {
    const x = gen(), y = f(...x), z = g(...x);
    if (!Number.isFinite(z)) { assert.equal(y, z, `${x}`); continue; }
    const ulp = Math.max(Number.MIN_VALUE, Math.abs(z) * 2.220446049250313e-16), e = Math.abs(y - z) / ulp;
    if (e > w) { w = e; at = x; }
  }
  return [w, at];
}
const one = (lo, hi) => () => [lo + (hi - lo) * rnd()];

test('sin, cos, tan, atan, atan2, exp, log, pow, hypot: within a few last places of Math\'s', () => {
  const cases = [
    ['sin', M.sin, Math.sin, one(-50, 50), 1.5], ['sin', M.sin, Math.sin, one(-1e4, 1e4), 2], ['cos', M.cos, Math.cos, one(-50, 50), 1.5],
    ['cos', M.cos, Math.cos, one(-1e4, 1e4), 2], ['tan', M.tan, Math.tan, one(-1.5, 1.5), 3], ['tan', M.tan, Math.tan, one(-50, 50), 4],
    ['atan', M.atan, Math.atan, one(-20, 20), 1.5], ['atan', M.atan, Math.atan, one(-1e-6, 1e-6), 1],
    ['atan2', M.atan2, Math.atan2, () => [rnd() * 400 - 200, rnd() * 400 - 200], 2],
    ['exp', M.exp, Math.exp, one(-50, 50), 1.5], ['exp', M.exp, Math.exp, one(-700, 700), 1.5],
    ['log', M.log, Math.log, () => [Math.exp(rnd() * 80 - 40)], 1.5],
    ['pow', M.pow, Math.pow, () => [rnd() * 3, rnd() * 4 - 2], 8], ['pow', M.pow, Math.pow, () => [rnd() * 100, rnd() * 3], 64],
    ['hypot', M.hypot, Math.hypot, () => [rnd() * 200 - 100, rnd() * 200 - 100], 1.5],
  ];
  for (const [name, f, g, gen, max] of cases) {
    const [w, at] = worst(f, g, gen);
    assert.ok(w <= max, `${name}: ${w.toFixed(2)} ulp at ${at}`);
  }
});

test('the special values', () => {
  assert.ok(Object.is(M.sin(0), 0) && Object.is(M.sin(-0), -0) && M.cos(0) === 1 && Number.isNaN(M.sin(Infinity)));
  assert.equal(M.atan2(0, -1), Math.PI); assert.equal(M.atan2(1, 0), Math.PI / 2); assert.equal(M.atan2(-1, 0), -Math.PI / 2);
  assert.ok(Object.is(M.atan2(0, 1), 0) && Object.is(M.atan2(-0, 1), -0));
  assert.equal(M.atan2(1, -1), Math.atan2(1, -1)); assert.equal(M.atan2(-1, -1), Math.atan2(-1, -1));
  assert.equal(M.exp(0), 1); assert.equal(M.exp(1000), Infinity); assert.equal(M.exp(-1000), 0);
  assert.equal(M.pow(3, 2), 9); assert.equal(M.pow(2, 0.5), Math.SQRT2); assert.equal(M.pow(0, 2), 0); assert.equal(M.pow(-2, 3), -8); assert.ok(Number.isNaN(M.pow(-2, 0.5)));
  assert.equal(M.log(1), 0); assert.equal(M.log(0), -Infinity); assert.equal(M.hypot(3, 4), 5);
});
