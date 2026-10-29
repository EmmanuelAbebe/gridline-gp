// Hills and banking. A circuit made with course() (circuits.js) carries height / bank keys; buildElevation turns them
// into smooth profiles per track sample. Flat circuits have none (track.elev = null) and every function here falls
// back to the flat-ground numbers exactly, so their physics stay bit-identical.
//
// The sim stays a plan view (x, z): positions, speeds and distances are measured flat, which is within 0.5% on the
// slopes used here. What the hills add (chassis.js, per mass):
//  - gravity in the road's plane: −G·(SX along the track + SN across it), in the car's frame (slower uphill, faster
//    downhill, a banked road pulls the car down toward its inside);
//  - the tyres' load: CA·(G + v²·VK − (sideways acceleration)·SN): a crest (VK < 0) makes the car light, a dip
//    (compression, VK > 0) presses it down, a road banked into the corner carries part of the cornering itself;
//  - on a banked road the plan view sees only cos(bank) of the cornering the tyres have to give (see chassis.js).
import { ELEVATION, CHASSIS, TUNING } from './tuning.js';
import { G, brakeLimit, cornerSpeed, cornerU, tyreGrip } from './vehicle.js';
import { STOCK } from './spec.js';
import { clamp, wrapIdx } from './math.js';
import { M as FM } from './fmath.js';   // (deterministic sin, cos, atan2, hypot …: the same race on every engine)
/** @typedef {import('./spec.js').Spec} Spec */

/** Per track sample: Y height of the centre line (m), BANK road tilt (rad, + = rising toward +N), SX = sin of the
 * slope along the track (+ = uphill), SN = sin(BANK), CA = cos of the whole tilt (the share of the weight on the
 * tyres), VK = vertical curvature along the track (1/m, + = a dip / compression, − = a crest).
 * @typedef {{ Y: Float32Array, BANK: Float32Array, SX: Float32Array, SN: Float32Array, CA: Float32Array,
 *   VK: Float32Array, lo: number, hi: number }} Elevation */

// circular Gaussian blur of a per-sample profile, sigma in samples
function blur(a, sigma) {
  const N = a.length, R = Math.ceil(sigma * 3), w = [];
  let sum = 0; for (let o = -R; o <= R; o++) { const k = FM.exp(-o * o / (2 * sigma * sigma)); w.push(k); sum += k; }
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) { let v = 0; for (let o = -R; o <= R; o++) v += a[wrapIdx(i + o, N)] * w[o + R]; out[i] = v / sum; }
  return out;
}

// keys [x, z, height | null, bank] in track order → each key's sample (searching forward from the last one, so a
// figure of eight's crossing finds the right pass)
function keySamples({ N, PX, PZ }, keys) {
  const near = (x, z, from, span) => {
    let best = Infinity, bi = from;
    for (let o = 0; o < span; o++) { const i = wrapIdx(from + o, N), d = FM.pow(PX[i] - x, 2) + FM.pow(PZ[i] - z, 2); if (d < best) { best = d; bi = from + o; } }
    return bi;
  };
  const out = [];
  let at = near(keys[0][0], keys[0][1], 0, N);
  for (const [x, z] of keys) { at = near(x, z, at, Math.ceil(N * 0.4)); out.push(at); }
  return out;                                                    // unwrapped: increasing
}

// a periodic profile through (sample position, value) keys: a cubic Hermite curve with each key's slope from its
// neighbours by their real distances (no overshoot from unevenly spaced keys); linear when `linear`
function profile(N, pos, val, linear = false) {
  const M = pos.length, out = new Float64Array(N);
  const P = k => pos[wrapIdx(k, M)] + Math.floor(k / M) * N, V = k => val[wrapIdx(k, M)];
  const slope = k => (V(k + 1) - V(k - 1)) / (P(k + 1) - P(k - 1));
  let k = 0;
  for (let s = pos[0]; s < pos[0] + N; s++) {
    while (P(k + 1) <= s) k++;
    const h = P(k + 1) - P(k), t = (s - P(k)) / h, t2 = t * t, t3 = t2 * t;
    out[wrapIdx(s, N)] = linear ? V(k) + (V(k + 1) - V(k)) * t
      : (2 * t3 - 3 * t2 + 1) * V(k) + (t3 - 2 * t2 + t) * h * slope(k) + (-2 * t3 + 3 * t2) * V(k + 1) + (t3 - t2) * h * slope(k + 1);
  }
  return out;
}

/** The track's height and bank profiles from course() keys, or null for a flat circuit.
 * @param {{ N: number, ds: number, PX: Float32Array, PZ: Float32Array }} track @returns {Elevation} */
export function buildElevation(track, keys) {
  if (!keys?.length) return null;
  const { N, ds } = track, E = ELEVATION, at = keySamples(track, keys);
  const hk = keys.map((k, n) => [at[n], k[2]]).filter(([, y]) => y !== null && y !== undefined);
  const Yr = blur(profile(N, hk.map(k => k[0]), hk.map(k => k[1])), E.heightBlur / ds);
  const Br = blur(profile(N, at, keys.map(k => k[3] || 0), true), E.bankBlur / ds);
  const Y = new Float32Array(N), BANK = new Float32Array(N), SX = new Float32Array(N), SN = new Float32Array(N);
  const CA = new Float32Array(N), VK = new Float32Array(N), w = Math.max(1, Math.round(E.curveSpan / ds)), raw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const gr = (Yr[wrapIdx(i + 1, N)] - Yr[wrapIdx(i - 1, N)]) / (2 * ds), a = FM.atan(gr);
    Y[i] = Yr[i]; BANK[i] = Br[i]; SX[i] = FM.sin(a); SN[i] = FM.sin(Br[i]); CA[i] = FM.cos(a) * FM.cos(Br[i]);
    raw[i] = (Yr[wrapIdx(i + w, N)] - 2 * Yr[i] + Yr[wrapIdx(i - w, N)]) / FM.pow(w * ds, 2);
  }
  VK.set(blur(raw, w / 2));
  let lo = Infinity, hi = -Infinity; for (const y of Y) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  return { Y, BANK, SX, SN, CA, VK, lo, hi };
}

// ---------- where things are ----------
// height of the surface at sample position p (fractional, any) and lateral offset lat: the road tilted by its bank,
// flat beyond its edges (run-off, pit lane at the edge's height). 0 on a flat circuit.
/** @param {import('./types.js').Track} track */
export function surfaceY(track, p, lat = 0) {
  const E = track.elev; if (!E) return 0;
  const N = track.N, i = Math.floor(p), f = p - i, a = wrapIdx(i, N), b = wrapIdx(i + 1, N), l = clamp(lat, -track.HW, track.HW);
  return E.Y[a] + (E.Y[b] - E.Y[a]) * f + FM.tan(E.BANK[a] + (E.BANK[b] - E.BANK[a]) * f) * l;
}
// a car's position along the track as a fractional sample (its sample + how far past it)
/** @param {import('./types.js').Track} track */
export const samplePos = (track, i, x, z) => i + ((x - track.PX[i]) * track.TX[i] + (z - track.PZ[i]) * track.TZ[i]) / track.ds;

// ---------- the AI's plan ----------
// Steady corner speed at sample i through curvature k (signed, > 0 = a right turn) with `share` of the grip: the tyres
// give v²k·cos(bank) − G·sin(bank into the turn) ≤ μ·(CA·(G + v²·VK + v²|k|·sin(bank into the turn)) + downforce).
// Flat: vehicle.js cornerSpeed, exactly.
/** @param {Elevation} E @param {Spec} [s] */
export function cornerSpeedAt(E, i, k, share = 1, s = STOCK) {
  const ak = Math.abs(k);
  if (!E) return cornerSpeed(ak, share, s);
  const into = -Math.sign(k) * E.SN[i], cb = Math.sqrt(1 - E.SN[i] * E.SN[i]), ca = E.CA[i];
  // asked: u·|k|·cb − G·into; load: ca·G + u·(ca·(VK + |k|·into) + dfK) (a crest: VK < 0 takes load away with speed)
  const u = cornerU(Math.max(ak * cb, 1e-6), G * into, ca * G, ca * (E.VK[i] + ak * into) + s.dfK, share, s);
  if (!(u < TUNING.V_CAP * TUNING.V_CAP)) return TUNING.V_CAP;
  return clamp(Math.sqrt(Math.max(0, u)), ELEVATION.minCorner, TUNING.V_CAP);
}
// Straight-line braking the tyres allow at sample i and speed v (as vehicle.js brakeLimit, with the load the hill
// leaves and gravity: uphill helps, downhill takes some away). Flat: brakeLimit, exactly.
/** @param {Elevation} E @param {Spec} [s] */
export function brakeLimitAt(E, i, v, s = STOCK) {
  if (!E) return brakeLimit(v, s);
  const n = Math.max(0, E.CA[i] * (G + v * v * E.VK[i]) + s.dfK * v * v);      // weight (less over a crest) + downforce
  return Math.max(ELEVATION.minBrake, Math.min(s.brakeSystem, CHASSIS.longGrip * tyreGrip(n, s)) + G * E.SX[i]);
}
