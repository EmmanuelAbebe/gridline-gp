// The AI's line and speed profile on a circuit, for a car class (moved from track.js, car classes stage 4): RO (the
// racing line's offset), LK (its curvature), VP (speed profile), APEX / BRK (next apex, samples to its braking zone),
// alien (the ALIEN's own line and profile). buildTrack puts the F1's on the track itself; aiOf(track, cls) = another
// class's, made on first use (the track for the F1: the same arrays).
import { AI, TUNING } from './tuning.js';
import { F1_2026 } from './classes/f1-2026.js';
import { stockOf } from './spec.js';
import { G, cornerSpeed, brakeLimit, tyreGrip, regenBrake } from './vehicle.js';
import { cornerSpeedAt, brakeLimitAt } from './elevation.js';
import { clamp, wrapA, wrapIdx } from './math.js';
import { M as FM } from './fmath.js';   // (deterministic sin, cos, atan2, hypot …: the same race on every engine)
/** @typedef {import('./types.js').Track} Track */
/** @typedef {import('./types.js').CarClass} CarClass */
/** @typedef {ReturnType<typeof buildAiProfile>} AiProfile */

// AI reference: RO = racing-line offset: the stored time-optimal line (racing-lines.js), else a minimum-curvature one; VP = speed profile along that line (corner limit with
// downforce from the line's own curvature, then braking look-back). Straights are V_CAP: the engine and drag decide.
// The time-optimal line stored for this circuit (racing-lines.js, made by tools/lap-optimum.mjs), as offsets per
// sample, or null when there is none or the circuit changed since (other sample count).
/** @param {string} id @param {number} N @param {number} HW @param {Record<string, any>} table @param {number} [edge] */
function storedLine(id, N, HW, table, edge = AI.lineEdge) {
  const L = table[id];
  if (!L || L.N !== N) return null;
  const C = L.offsets, M = C.length, RO = new Float64Array(N), lim = HW - edge;
  const cat = (a, b, c, d, t) => 0.5 * (2*b + (c - a)*t + (2*a - 5*b + 4*c - d)*t*t + (3*b - a - 3*c + d)*t*t*t);
  for (let i = 0; i < N; i++) {
    const s = i / L.step, m = Math.floor(s), at = k => C[((m + k) % M + M) % M];
    RO[i] = clamp(cat(at(-1), at(0), at(1), at(2), s - m), -lim, lim);
  }
  return RO;
}

/** @param {any} geo the track's shape @param {CarClass} [cls] */
export function buildAiProfile({ id, N, HW, ds, K, PX, PZ, NX, NZ, elev }, cls = F1_2026) {
  // the line: a minimum-curvature path within the road (outside → apex → outside). Each point moves to where it best
  // straightens the line with its neighbours `s` and 2·s samples away (least squared second difference), first on a
  // coarse set of points, then finer, filling in between.
  const stored = storedLine(id, N, HW, cls.ai.lines.racing), RO = new Float64Array(N), lim = HW - AI.lineMargin;
  const at = (j, o) => { j = wrapIdx(j, N); return [PX[j] + NX[j]*RO[j], PZ[j] + NZ[j]*RO[j]][o]; };
  for (const s of AI.lineStrides) {
    for (let it = 0; it < AI.lineIterations; it++) for (let i = 0; i < N; i += s) {
      const mx = (4*(at(i-s, 0) + at(i+s, 0)) - at(i-2*s, 0) - at(i+2*s, 0)) / 6;
      const mz = (4*(at(i-s, 1) + at(i+s, 1)) - at(i-2*s, 1) - at(i+2*s, 1)) / 6;
      RO[i] = clamp((mx - PX[i])*NX[i] + (mz - PZ[i])*NZ[i], -lim, lim);
    }
    for (let i = 0; i < N; i++) if (i % s) { const i0 = i - i % s, f = (i % s) / s; RO[i] = RO[i0]*(1-f) + RO[(i0+s)%N]*f; }
  }
  // blend with the stored time-optimal line: AI.lineBlend 0 = minimum curvature (gentle, leaves room in traffic),
  // 1 = the time-optimal line (fastest alone, but its edge-to-edge sweeps make side-by-side racing messy)
  if (stored) for (let i = 0; i < N; i++) RO[i] += (stored[i] - RO[i]) * AI.lineBlend;
  const main = lineProfile({ N, ds, PX, PZ, NX, NZ, elev }, RO, cls);
  // ALIEN (race.aiAlien): its own time-optimal line closer to the edges (the class's alien lines; else the full stored line),
  // with its own speed profile
  const own = storedLine(id, N, HW, cls.ai.lines.alien, AI.alien.lineEdge) || stored;
  const alien = own ? lineProfile({ N, ds, PX, PZ, NX, NZ, elev }, Float64Array.from(own), cls, 1, true) : null;
  return { ...main, alien };
}

// A line's curvature (LK) and speed profile (VP), and per sample the next corner's apex and braking zone (APEX, BRK)
// (with hills: elevation.js corner speeds and braking, the load and gravity included)
/** @param {any} geo @param {Float64Array} RO @param {CarClass} cls @param {number} [brake] @param {boolean} [circle] */
function lineProfile({ N, ds, PX, PZ, NX, NZ, elev }, RO, cls, brake = cls.ai.brake, circle = false) {
  const { grip } = cls.ai, st = stockOf(cls), { car: CAR, chassis: CHASSIS } = cls;
  // the line: segment lengths and headings, curvature over ±W samples (same window as K)
  const LS = new Float32Array(N), LH = new Float32Array(N), LK = new Float32Array(N), W = 5;
  for (let i = 0; i < N; i++) {
    const j = (i+1)%N, dx = PX[j] + NX[j]*RO[j] - PX[i] - NX[i]*RO[i], dz = PZ[j] + NZ[j]*RO[j] - PZ[i] - NZ[i]*RO[i];
    LS[i] = FM.hypot(dx, dz) || ds; LH[i] = FM.atan2(dz, dx);
  }
  for (let i = 0; i < N; i++) {
    let len = 0; for (let o = -W; o < W; o++) len += LS[wrapIdx(i+o, N)];
    const a = wrapIdx(i-W, N), b = wrapIdx(i+W-1, N);
    LK[i] = wrapA(LH[b] - LH[a]) / (len - LS[b] / 2 - LS[a] / 2 || ds);
  }
  const VP = new Float32Array(N);
  for (let i = 0; i < N; i++) VP[i] = elev ? cornerSpeedAt(elev, i, LK[i], grip, st) : cornerSpeed(Math.abs(LK[i]), grip, st);
  if (circle && elev) {
    // (ALIEN on a hilly circuit: as below, with the load the hill leaves and gravity)
    const S = st;
    for (let p = 0; p < 3; p++) for (let i = N-1; i >= 0; i--) {
      const j = (i+1)%N, u = VP[j], df = S.dfK * u * u, n = Math.max(-df, elev.CA[j] * (G + u * u * elev.VK[j]));
      const latMax = Math.max(1, tyreGrip(n + df, S)), lat = u * u * Math.abs(LK[j]), f = Math.sqrt(Math.max(0, 1 - FM.pow(lat / latMax, 2)));
      const dec = regenBrake(Math.min(CHASSIS.brakeSystem, CHASSIS.longGrip * tyreGrip(n + df, S)), u, S) * f + S.dragK * u * u + CAR.aero.rolling
        + CAR.engine.engineBrake * 0.8 + G * elev.SX[j];
      VP[i] = Math.min(VP[i], Math.sqrt(u * u + 2 * Math.max(3, dec) * LS[i]));
    }
  } else if (circle) {
    // ALIEN: braking as tools/lap-optimum.mjs's bot plans it: the grip the corner uses leaves less for braking
    // (friction circle), drag, rolling and engine braking help
    const S = st, G = 9.81;
    for (let p = 0; p < 3; p++) for (let i = N-1; i >= 0; i--) {
      const j = (i+1)%N, u = VP[j], df = S.dfK * u * u, latMax = tyreGrip(G + df, S), lat = u * u * Math.abs(LK[j]);
      const f = Math.sqrt(Math.max(0, 1 - FM.pow(lat / latMax, 2)));
      const dec = regenBrake(Math.min(CHASSIS.brakeSystem, CHASSIS.longGrip * tyreGrip(G + df, S)), u, S) * f + S.dragK * u * u + CAR.aero.rolling + CAR.engine.engineBrake * 0.8;
      VP[i] = Math.min(VP[i], Math.sqrt(u * u + 2 * dec * LS[i]));
    }
  } else if (elev) for (let p = 0; p < 3; p++) for (let i = N-1; i >= 0; i--) {
    const j = (i+1)%N, dec = brakeLimitAt(elev, j, VP[j], st) - G * elev.SX[j];   // gravity at full share, the tyres at `brake`
    VP[i] = Math.min(VP[i], Math.sqrt(VP[j]*VP[j] + 2*Math.max(3, dec*brake + G*elev.SX[j])*LS[i]));
  } else for (let p = 0; p < 3; p++) for (let i = N-1; i >= 0; i--) {
    const j = (i+1)%N; VP[i] = Math.min(VP[i], Math.sqrt(VP[j]*VP[j] + 2*brakeLimit(VP[j], st)*brake*LS[i]));
  }
  // per sample: the next corner's apex (lowest point of the profile in a braking zone) and how many samples away its
  // braking zone starts (0 inside it), for the AI's racecraft
  const APEX = new Int32Array(N), BRK = new Int32Array(N), full = TUNING.V_CAP * 0.97, apexes = [];
  for (let i = 0; i < N; i++) if (VP[i] < full && VP[i] <= VP[wrapIdx(i-1, N)] && VP[i] < VP[wrapIdx(i+1, N)]) apexes.push(i);
  if (!apexes.length) apexes.push(0);
  const starts = apexes.map(a => { let j = a; for (let k = 0; k < N && VP[wrapIdx(j-1, N)] > VP[j] && VP[j] < full; k++) j = wrapIdx(j-1, N); return j; });
  for (let i = 0; i < N; i++) {
    // the first apex at or after i (wrapping)
    let best = 0, bd = Infinity;
    for (let n = 0; n < apexes.length; n++) { const d = wrapIdx(apexes[n] - i, N); if (d < bd) { bd = d; best = n; } }
    APEX[i] = apexes[best];
    const s = starts[best], toStart = wrapIdx(s - i, N);
    BRK[i] = toStart <= bd ? toStart : 0;                    // past the braking point already: 0
  }
  return { VP, RO, LK, APEX, BRK };
}

// The AI's profile for `cls` on this track: the track itself for the F1 (built with it), else made once per track × class
const profiles = new WeakMap();
/** @param {Track} track @param {CarClass} cls @returns {AiProfile} */
export function aiOf(track, cls) {
  if (cls === F1_2026) return track;
  let byClass = profiles.get(track);
  if (!byClass) profiles.set(track, byClass = new Map());
  let p = byClass.get(cls);
  if (!p) byClass.set(cls, p = buildAiProfile(track, cls));
  return p;
}
