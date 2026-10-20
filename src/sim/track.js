// Track construction: a circuit's control points → closed centripetal Catmull-Rom → N equal-length samples with
// tangents, right-hand normals, signed curvature, bounds, and the AI's speed profile and racing line.
import { AI, TRACK_DEFAULTS, GRID, LIMITS, TUNING, CAR, CHASSIS } from './tuning.js';
import { STOCK } from './spec.js';
import { cornerSpeed, brakeLimit } from './vehicle.js';
import { buildRunoff } from './runoff.js';
import { buildPitLane } from './pit.js';
import { buildAeroZones } from './active-aero.js';
import { RACING_LINES, ALIEN_LINES } from './racing-lines.js';
import { CIRCUITS } from './circuits.js';
import { clamp, wrapA, wrapIdx } from './math.js';
/** @typedef {import('./types.js').Track} Track */

// Closed centripetal Catmull-Rom through the control points, `steps` points per segment.
function catmullRomClosed(ctrl, steps) {
  const out = [], M = ctrl.length;
  const tj = (a, b) => Math.pow(Math.hypot(b[0]-a[0], b[1]-a[1]), 0.5);
  const lerp = (A, B, ta, tb, t) => [A[0]*(tb-t)/(tb-ta) + B[0]*(t-ta)/(tb-ta), A[1]*(tb-t)/(tb-ta) + B[1]*(t-ta)/(tb-ta)];
  for (let i = 0; i < M; i++) {
    const P0 = ctrl[(i-1+M)%M], P1 = ctrl[i], P2 = ctrl[(i+1)%M], P3 = ctrl[(i+2)%M];
    const t0 = 0, t1 = t0 + tj(P0,P1), t2 = t1 + tj(P1,P2), t3 = t2 + tj(P2,P3);
    for (let s = 0; s < steps; s++) {
      const t = t1 + (t2-t1)*s/steps;
      const A1 = lerp(P0,P1,t0,t1,t), A2 = lerp(P1,P2,t1,t2,t), A3 = lerp(P2,P3,t2,t3,t);
      const B1 = lerp(A1,A2,t0,t2,t), B2 = lerp(A2,A3,t1,t3,t);
      out.push(lerp(B1,B2,t1,t2,t));
    }
  }
  return out;
}

// Resample a closed polyline to N points at equal arc-length spacing.
function resampleClosed(dense, N) {
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) { const a = dense[i-1], b = dense[i % dense.length]; cum.push(cum[i-1] + Math.hypot(b[0]-a[0], b[1]-a[1])); }
  const L = cum[cum.length-1], ds = L / N;
  const PX = new Float32Array(N), PZ = new Float32Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = i * ds;
    while (cum[j+1] < d) j++;
    const f = (d - cum[j]) / (cum[j+1] - cum[j] || 1), a = dense[j], b = dense[(j+1) % dense.length];
    PX[i] = a[0] + (b[0]-a[0])*f; PZ[i] = a[1] + (b[1]-a[1])*f;
  }
  return { PX, PZ, L, ds };
}

// AI reference: RO = racing-line offset: the stored time-optimal line (racing-lines.js), else a minimum-curvature one; VP = speed profile along that line (corner limit with
// downforce from the line's own curvature, then braking look-back). Straights are V_CAP: the engine and drag decide.
// The time-optimal line stored for this circuit (racing-lines.js, made by tools/lap-optimum.mjs), as offsets per
// sample, or null when there is none or the circuit changed since (other sample count).
/** @param {string} id @param {number} N @param {number} HW @param {Record<string, any>} [table] @param {number} [edge] */
function storedLine(id, N, HW, table = RACING_LINES, edge = AI.lineEdge) {
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

function buildAiProfile({ id, N, HW, ds, K, PX, PZ, NX, NZ }) {
  // the line: a minimum-curvature path within the road (outside → apex → outside). Each point moves to where it best
  // straightens the line with its neighbours `s` and 2·s samples away (least squared second difference), first on a
  // coarse set of points, then finer, filling in between.
  const stored = storedLine(id, N, HW), RO = new Float64Array(N), lim = HW - AI.lineMargin;
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
  const main = lineProfile({ N, ds, PX, PZ, NX, NZ }, RO);
  // ALIEN (race.aiAlien): its own time-optimal line closer to the edges (ALIEN_LINES; else the full stored line),
  // with its own speed profile
  const own = storedLine(id, N, HW, ALIEN_LINES, AI.alien.lineEdge) || stored;
  const alien = own ? lineProfile({ N, ds, PX, PZ, NX, NZ }, Float64Array.from(own), 1, true) : null;
  return { ...main, alien };
}

// A line's curvature (LK) and speed profile (VP), and per sample the next corner's apex and braking zone (APEX, BRK)
/** @param {any} geo @param {Float64Array} RO @param {number} [brake] @param {boolean} [circle] */
function lineProfile({ N, ds, PX, PZ, NX, NZ }, RO, brake = AI.brake, circle = false) {
  const { grip } = AI;
  // the line: segment lengths and headings, curvature over ±W samples (same window as K)
  const LS = new Float32Array(N), LH = new Float32Array(N), LK = new Float32Array(N), W = 5;
  for (let i = 0; i < N; i++) {
    const j = (i+1)%N, dx = PX[j] + NX[j]*RO[j] - PX[i] - NX[i]*RO[i], dz = PZ[j] + NZ[j]*RO[j] - PZ[i] - NZ[i]*RO[i];
    LS[i] = Math.hypot(dx, dz) || ds; LH[i] = Math.atan2(dz, dx);
  }
  for (let i = 0; i < N; i++) {
    let len = 0; for (let o = -W; o < W; o++) len += LS[wrapIdx(i+o, N)];
    const a = wrapIdx(i-W, N), b = wrapIdx(i+W-1, N);
    LK[i] = wrapA(LH[b] - LH[a]) / (len - LS[b] / 2 - LS[a] / 2 || ds);
  }
  const VP = new Float32Array(N);
  for (let i = 0; i < N; i++) VP[i] = cornerSpeed(Math.abs(LK[i]), grip);
  if (circle) {
    // ALIEN: braking as tools/lap-optimum.mjs's bot plans it: the grip the corner uses leaves less for braking
    // (friction circle), drag, rolling and engine braking help
    const S = STOCK, G = 9.81;
    for (let p = 0; p < 3; p++) for (let i = N-1; i >= 0; i--) {
      const j = (i+1)%N, u = VP[j], df = S.dfK * u * u, latMax = S.grip * (G + df), lat = u * u * Math.abs(LK[j]);
      const f = Math.sqrt(Math.max(0, 1 - (lat / latMax) ** 2));
      const dec = Math.min(CHASSIS.brakeSystem, S.grip * CHASSIS.longGrip * (G + df)) * f + S.dragK * u * u + CAR.aero.rolling + CAR.engine.engineBrake * 0.8;
      VP[i] = Math.min(VP[i], Math.sqrt(u * u + 2 * dec * LS[i]));
    }
  } else for (let p = 0; p < 3; p++) for (let i = N-1; i >= 0; i--) {
    const j = (i+1)%N; VP[i] = Math.min(VP[i], Math.sqrt(VP[j]*VP[j] + 2*brakeLimit(VP[j])*brake*LS[i]));
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

export function buildTrack(circuit, opts = {}) {
  const o = { ...TRACK_DEFAULTS, samples: circuit.samples, ...opts };
  const { halfWidth: HW, kerb: KERB, runoff, kerbK: KERB_K } = o;
  const dense = catmullRomClosed(circuit.ctrl, 200);
  let around = 0; for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i+1) % dense.length]; around += Math.hypot(b[0]-a[0], b[1]-a[1]); }
  const N = o.samples || Math.round(around / o.ds);
  const { PX, PZ, L, ds } = resampleClosed(dense, N);
  const TX = new Float32Array(N), TZ = new Float32Array(N), NX = new Float32Array(N), NZ = new Float32Array(N), K = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrapIdx(i-1, N), b = wrapIdx(i+1, N); let tx = PX[b]-PX[a], tz = PZ[b]-PZ[a]; const l = Math.hypot(tx, tz);
    tx /= l; tz /= l; TX[i] = tx; TZ[i] = tz; NX[i] = -tz; NZ[i] = tx;   // +N is the driver's right
  }
  const W = 5;
  for (let i = 0; i < N; i++) {
    const a = wrapIdx(i-W, N), b = wrapIdx(i+W, N);
    K[i] = Math.atan2(TX[a]*TZ[b] - TZ[a]*TX[b], TX[a]*TX[b] + TZ[a]*TZ[b]) / (2*W*ds); // >0 turns toward +N
  }
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < N; i++) {
    bounds.minX = Math.min(bounds.minX, PX[i]); bounds.maxX = Math.max(bounds.maxX, PX[i]);
    bounds.minZ = Math.min(bounds.minZ, PZ[i]); bounds.maxZ = Math.max(bounds.maxZ, PZ[i]);
  }
  bounds.cx = (bounds.minX + bounds.maxX) / 2; bounds.cz = (bounds.minZ + bounds.maxZ) / 2;
  // CK: the curvature of the corner a sample belongs to (the strongest |K| within ±cornerSpan), for track limits
  const CK = new Float32Array(N);
  for (let i = 0; i < N; i++) for (let o = -LIMITS.cornerSpan; o <= LIMITS.cornerSpan; o++) { const k = K[wrapIdx(i+o, N)]; if (Math.abs(k) > Math.abs(CK[i])) CK[i] = k; }
  // landmarks: sample index, or negative = metres before the line
  const landmarks = Object.fromEntries(Object.entries(circuit.landmarks || {}).map(([k, v]) => [k, v < 0 ? N - Math.round(-v / ds) : v]));
  const shape = { id: circuit.id, name: circuit.name, landmarks, N, HW, KERB, WALL: HW + runoff, KERB_K, L, ds,
    PX, PZ, TX, TZ, NX, NZ, K, CK, bounds };
  // + the AI's line and speeds; what lies beside the road (runoff.js; WALL = the furthest barrier); the pit lane
  const track = { ...shape, ...buildAiProfile(shape), style: circuit.style || o.style, theme: circuit.theme || 'forest',
    runoff: /** @type {import('./runoff.js').Runoff[]} */ (null), pit: /** @type {import('./pit.js').PitLane} */ (null),
    aeroZone: /** @type {Uint8Array} */ (null), aeroZones: /** @type {{ from: number, to: number }[]} */ (null) };
  track.runoff = buildRunoff(track, track.style);
  track.WALL = Math.max(...track.runoff.map(r => Math.max(...r.wall)));
  track.pit = buildPitLane(track);   // pit.js; null without a `pits` landmark
  // straight-mode zones for active aero (active-aero.js): 1 per sample inside one, and the list
  const aero = buildAeroZones(track);
  track.aeroZone = aero.zone; track.aeroZones = aero.zones;
  return track;
}

/** @param {Track} track */
export const headingAt = (track, i) => Math.atan2(track.TZ[i], track.TX[i]);

// Grid slot `slot` (0 = pole). `ahead` shifts the point forward, e.g. for the painted box line.
/** @param {Track} track */
export function gridSlot(track, slot, ahead = 0) {
  const back = GRID.front + slot * GRID.spacing - ahead;
  return { idx: wrapIdx(-Math.round(back / track.ds), track.N), lat: slot % 2 === 0 ? -GRID.lat : GRID.lat };
}

export const DEFAULT_TRACK = buildTrack(CIRCUITS.elkmoor);
