// Track construction: a circuit's control points → closed centripetal Catmull-Rom → N equal-length samples with
// tangents, right-hand normals, signed curvature, bounds, and the AI's speed profile and racing line.
import { TRACK_DEFAULTS, GRID, LIMITS } from './tuning.js';
import { buildAiProfile } from './ai-profile.js';
import { buildRunoff } from './runoff.js';
import { buildPitLane } from './pit.js';
import { buildAeroZones } from './active-aero.js';
import { buildElevation } from './elevation.js';
import { CIRCUITS } from './circuits.js';
import { wrapIdx } from './math.js';
import { M as FM } from './fmath.js';   // (deterministic sin, cos, atan2, hypot …: the same race on every engine)
/** @typedef {import('./types.js').Track} Track */

// Closed centripetal Catmull-Rom through the control points, `steps` points per segment.
function catmullRomClosed(ctrl, steps) {
  const out = [], M = ctrl.length;
  const tj = (a, b) => FM.pow(FM.hypot(b[0]-a[0], b[1]-a[1]), 0.5);
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
  for (let i = 1; i <= dense.length; i++) { const a = dense[i-1], b = dense[i % dense.length]; cum.push(cum[i-1] + FM.hypot(b[0]-a[0], b[1]-a[1])); }
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

export function buildTrack(circuit, opts = {}) {
  const o = { ...TRACK_DEFAULTS, samples: circuit.samples, ...opts };
  const { halfWidth: HW, kerb: KERB, runoff, kerbK: KERB_K } = o;
  const dense = catmullRomClosed(circuit.ctrl, 200);
  let around = 0; for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i+1) % dense.length]; around += FM.hypot(b[0]-a[0], b[1]-a[1]); }
  const N = o.samples || Math.round(around / o.ds);
  const { PX, PZ, L, ds } = resampleClosed(dense, N);
  const TX = new Float32Array(N), TZ = new Float32Array(N), NX = new Float32Array(N), NZ = new Float32Array(N), K = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrapIdx(i-1, N), b = wrapIdx(i+1, N); let tx = PX[b]-PX[a], tz = PZ[b]-PZ[a]; const l = FM.hypot(tx, tz);
    tx /= l; tz /= l; TX[i] = tx; TZ[i] = tz; NX[i] = -tz; NZ[i] = tx;   // +N is the driver's right
  }
  const W = 5;
  for (let i = 0; i < N; i++) {
    const a = wrapIdx(i-W, N), b = wrapIdx(i+W, N);
    K[i] = FM.atan2(TX[a]*TZ[b] - TZ[a]*TX[b], TX[a]*TX[b] + TZ[a]*TZ[b]) / (2*W*ds); // >0 turns toward +N
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
    PX, PZ, TX, TZ, NX, NZ, K, CK, bounds, elev: /** @type {import('./elevation.js').Elevation} */ (null) };
  shape.elev = buildElevation(shape, circuit.heights);    // hills and banking (elevation.js); null = flat
  // + the AI's line and speeds (ai-profile.js: the F1's; another car class's: aiOf); what lies beside the road (runoff.js; WALL = the furthest barrier); the pit lane
  const track = { ...shape, ...buildAiProfile(shape), style: circuit.style || o.style, theme: circuit.theme || 'forest',
    runoff: /** @type {import('./runoff.js').Runoff[]} */ (null), pit: /** @type {import('./pit.js').PitLane} */ (null),
    aeroZone: /** @type {Uint8Array} */ (null), aeroZones: /** @type {{ from: number, to: number }[]} */ (null),
    // (active-aero.js setAeroZones: the automatic zones kept while the player's own are in use; which ones; safe samples)
    aeroAuto: /** @type {{ zone: Uint8Array, zones: { from: number, to: number }[] }} */ (null), aeroKey: 'auto',
    aeroSafe: /** @type {Uint8Array} */ (null), aeroPlans: /** @type {Record<string, Float32Array>} */ (null) };
  track.runoff = buildRunoff(track, track.style);
  track.WALL = Math.max(...track.runoff.map(r => Math.max(...r.wall)));
  track.pit = buildPitLane(track);   // pit.js; null without a `pits` landmark
  // straight-mode zones for active aero (active-aero.js): 1 per sample inside one, and the list
  const aero = buildAeroZones(track);
  track.aeroZone = aero.zone; track.aeroZones = aero.zones;
  return track;
}

/** @param {Track} track */
export const headingAt = (track, i) => FM.atan2(track.TZ[i], track.TX[i]);

// Grid slot `slot` (0 = pole). `ahead` shifts the point forward, e.g. for the painted box line.
/** @param {Track} track */
export function gridSlot(track, slot, ahead = 0) {
  const back = GRID.front + slot * GRID.spacing - ahead;
  return { idx: wrapIdx(-Math.round(back / track.ds), track.N), lat: slot % 2 === 0 ? -GRID.lat : GRID.lat };
}

export const DEFAULT_TRACK = buildTrack(CIRCUITS.elkmoor);
