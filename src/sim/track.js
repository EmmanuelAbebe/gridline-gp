// Track construction: a circuit's control points → closed centripetal Catmull-Rom → N equal-length samples with
// tangents, right-hand normals, signed curvature, bounds, and the AI's speed profile and racing line.
import { TUNING, TRACK_DEFAULTS, GRID } from './tuning.js';
import { cornerSpeed, brakeLimit } from './vehicle.js';
import { CIRCUITS } from './circuits.js';
import { clamp } from './math.js';

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

// AI reference: VP = speed profile (corner limit with downforce + braking look-back), RO = racing-line offset toward
// corner insides. Straights are V_CAP, so there the engine and drag decide the speed.
function buildAiProfile({ N, HW, ds, K }) {
  const { grip, brake } = TUNING.AI;
  const VP = new Float32Array(N), RO = new Float32Array(N);
  for (let i = 0; i < N; i++) VP[i] = cornerSpeed(Math.abs(K[i]), grip);
  for (let p = 0; p < 3; p++) for (let i = N-1; i >= 0; i--) {
    const j = (i+1)%N; VP[i] = Math.min(VP[i], Math.sqrt(VP[j]*VP[j] + 2*brakeLimit(VP[j])*brake*ds));
  }
  const raw = new Float32Array(N), S = 40;
  for (let i = 0; i < N; i++) raw[i] = clamp(K[i]*120, -1, 1) * (HW - 2.6);
  for (let i = 0; i < N; i++) { let s = 0; for (let o = -S; o <= S; o++) s += raw[(i+o+N)%N]; RO[i] = s / (2*S+1); }
  return { VP, RO };
}

export function buildTrack(circuit, opts = {}) {
  const { samples: N, halfWidth: HW, kerb: KERB, runoff } = { ...TRACK_DEFAULTS, ...opts };
  const { PX, PZ, L, ds } = resampleClosed(catmullRomClosed(circuit.ctrl, 200), N);
  const TX = new Float32Array(N), TZ = new Float32Array(N), NX = new Float32Array(N), NZ = new Float32Array(N), K = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i-1+N)%N, b = (i+1)%N; let tx = PX[b]-PX[a], tz = PZ[b]-PZ[a]; const l = Math.hypot(tx, tz);
    tx /= l; tz /= l; TX[i] = tx; TZ[i] = tz; NX[i] = -tz; NZ[i] = tx;   // +N is the driver's right
  }
  const W = 5;
  for (let i = 0; i < N; i++) {
    const a = (i-W+N)%N, b = (i+W)%N;
    K[i] = Math.atan2(TX[a]*TZ[b] - TZ[a]*TX[b], TX[a]*TX[b] + TZ[a]*TZ[b]) / (2*W*ds); // >0 turns toward +N
  }
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < N; i++) {
    bounds.minX = Math.min(bounds.minX, PX[i]); bounds.maxX = Math.max(bounds.maxX, PX[i]);
    bounds.minZ = Math.min(bounds.minZ, PZ[i]); bounds.maxZ = Math.max(bounds.maxZ, PZ[i]);
  }
  bounds.cx = (bounds.minX + bounds.maxX) / 2; bounds.cz = (bounds.minZ + bounds.maxZ) / 2;
  const track = { name: circuit.name, landmarks: circuit.landmarks || {}, N, HW, KERB, WALL: HW + runoff, L, ds,
    PX, PZ, TX, TZ, NX, NZ, K, bounds };
  return Object.assign(track, buildAiProfile(track));
}

export const headingAt = (track, i) => Math.atan2(track.TZ[i], track.TX[i]);

// Grid slot `slot` (0 = pole). `ahead` shifts the point forward, e.g. for the painted box line.
export function gridSlot(track, slot, ahead = 0) {
  const back = GRID.front + slot * GRID.spacing - ahead;
  return { idx: (track.N - Math.round(back / track.ds)) % track.N, lat: slot % 2 === 0 ? -GRID.lat : GRID.lat };
}

export const DEFAULT_TRACK = buildTrack(CIRCUITS.elkmoor);
