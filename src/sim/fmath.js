// Deterministic maths for the sim (2026-10-28, the online leaderboard: docs/leaderboard-plan.md). + − × ÷ and
// Math.sqrt are exact IEEE 754 operations, the same on every JavaScript engine; Math.sin, cos, tan, atan, atan2,
// hypot, exp and pow are not: a race recorded in the app (Electron's V8 15) and replayed in Node 22 (V8 12) ended up to
// a bit apart after 13 s. These are written with the exact operations only (fdlibm's algorithms and coefficients:
// range reduction + fixed polynomials), so a replay gives the same race everywhere. Accurate to about 1 ulp (sin,
// cos, atan, exp), a few ulp (tan, pow); no slower than Math's in practice. The sim uses M.* in place of Math.*
// for those functions; tests/fmath.test.js checks them against Math's.
const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1, HI = LE ? 1 : 0, LO = LE ? 0 : 1;
const PI = 3.141592653589793, PI_2 = 1.5707963267948966;

// ---- sin, cos, tan: x = k·π/2 + r (Cody-Waite in three parts: exact to |x| ~ 1e5), polynomials on [−π/4, π/4] ----
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_2 = 6.07710050630396597660e-11, PIO2_3 = 2.02226624871116645580e-21;
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function ksin(x) { const z = x * x; return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))))); }
function kcos(x) {
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))), hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + z * r);
}
let red = 0;                                     // (the reduced argument of the last reduce)
function reduce(x) {
  const k = Math.round(x * INV_PIO2);
  red = ((x - k * PIO2_1) - k * PIO2_2) - k * PIO2_3;
  return k & 3;
}
function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < 0.7853981633974483) return x === 0 ? x : ksin(x);
  const n = reduce(x), r = red;
  return n === 0 ? ksin(r) : n === 1 ? kcos(r) : n === 2 ? -ksin(r) : -kcos(r);
}
function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < 0.7853981633974483) return kcos(x);
  const n = reduce(x), r = red;
  return n === 0 ? kcos(r) : n === 1 ? -ksin(r) : n === 2 ? -kcos(r) : ksin(r);
}
function tan(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < 0.7853981633974483) return ksin(x) / kcos(x);
  const n = reduce(x), r = red;
  return n & 1 ? -kcos(r) / ksin(r) : ksin(r) / kcos(r);
}

// ---- atan, atan2 (fdlibm s_atan.c) ----
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
function atan(x) {
  if (x !== x) return NaN;
  const neg = x < 0; let a = Math.abs(x), id;
  if (a >= 7.37869762948382064640e+19) return neg ? -PI_2 : PI_2;     // (2^66)
  if (a < 0.4375) { if (a < 3.7252902984e-09) return x; id = -1; }
  else if (a < 1.1875) { if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); } }
  else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); }
  else { id = 3; a = -1 / a; }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  const r = id < 0 ? a - a * (s1 + s2) : ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a);
  return neg ? -r : r;
}
const PI_LO = 1.2246467991473531772e-16;
function atan2(y, x) {
  if (x !== x || y !== y) return NaN;
  if (y === 0) return x > 0 || Object.is(x, 0) ? y : (Object.is(y, -0) ? -PI : PI);
  if (x === 0) return y > 0 ? PI_2 : -PI_2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.atan2(y, x);   // (never in the sim; exact anyway)
  const a = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? a : -a;
  const r = PI - (a - PI_LO);
  return y > 0 ? r : -r;
}

// ---- hypot: √(Σ x²), the exact operations only (Math.hypot scales its arguments: other last bits) ----
function hypot(a, b, c) {
  if (c === undefined) return Math.sqrt(a * a + b * b);
  return Math.sqrt(a * a + b * b + c * c);
}

// ---- exp (fdlibm e_exp.c), log (e_log.c), pow ----
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
// 2^k exactly (k a whole number −1022 … 1023), from its bits
function pow2(k) { U32[HI] = (k + 1023) << 20; U32[LO] = 0; return F64[0]; }
function exp(x) {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (Math.abs(x) < 3.725290298461914e-09) return 1 + x;
  const k = Math.round(x * INV_LN2), hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo, t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  return k < -1021 ? y * pow2(k + 1000) * pow2(-1000) : k > 1023 ? y * pow2(k - 1) * 2 : y * pow2(k);
}
const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01,
  LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;
function log(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; }      // (subnormal: × 2^54 first)
  F64[0] = x;
  let hx = U32[HI];
  k += (hx >>> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;                                         // (mantissa above √2: halve it)
  U32[HI] = hx | (i ^ 0x3ff00000);
  k += i >>> 20;
  const f = F64[0] - 1, s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7))), R = t2 + t1, hfsq = 0.5 * f * f;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}
function pow(x, y) {
  if (y === 2) return x * x;
  if (y === 0.5 && x >= 0) return Math.sqrt(x);
  if (y === 0) return 1;
  if (y === 1) return x;
  if (y === -1) return 1 / x;
  if (x !== x || y !== y) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {                // (whole powers: by squaring, exact for small ones)
    let r = 1, b = x, n = Math.abs(y);
    while (n) { if (n & 1) r *= b; b *= b; n >>>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const r = exp(y * log(-x));
    return y % 2 ? -r : r;
  }
  return exp(y * log(x));
}

export const M = Object.freeze({ sin, cos, tan, atan, atan2, hypot, exp, log, pow });
