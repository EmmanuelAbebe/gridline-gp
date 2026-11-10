// Replaying two laps side by side (2026-11-10; user: "ghost car comparison or virtual lap comparison similar to how they
// show it in broadcasts", a 2D and a 3D view; analysis-screen.js COMPARE). Pure: no DOM, no Three.js
// (tests/lap-replay.test.js).
// A lap (lap-analysis.js trace: t, kmh, thr, brk at every track sample, + x / z / h / gear where recorded) becomes a
// replay: where the car was and what it did any time into its lap. Positions come from the trace's own x / z (your laps
// this session, the AI's), else a recorded ghost's pose (your best ever, a loaded file), else the middle of the road.
// Two laps are compared BY TIME (both the same time into their laps: a ghost race, the gap = who is ahead) or BY
// DISTANCE (the other car at your spot: how each took it, the gap in time only).
import { ghostPose } from './ghost.js';

export const REPLAY = Object.freeze({
  rates: [0.25, 0.5, 1, 2, 4],   // playback speeds
  wheelbase: 3.4,                // m: the front wheels' angle from the path's curvature (the model's steering)
  lock: 0.3,                     // rad: full steering on the model
  wheelR: 0.36,                  // m: wheel radius (the wheels' spin)
  turnSpan: 0.6,                 // s: the heading change over this much of the lap gives the curvature
});

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

// trace → replay. N = the track's samples; track (PX, PZ, TX, TZ) for the middle-of-the-road fallback; ghost = a
// recorded ghost of this very lap (ghost.js), for its positions
export function replayOf(trace, track, ghost = null) {
  const N = track.N, ti = new Float64Array(N + 1);
  // the time at each sample, never going back (a sample not reached keeps the last time)
  let last = 0;
  for (let i = 0; i < N; i++) { const v = trace.t[i]; if (Number.isFinite(v) && v >= last) last = v; ti[i] = last; }
  ti[N] = Math.max(last, trace.time);
  const time = ti[N];
  // the (fractional) sample the car was at T s into its lap
  function sampleAt(T) {
    if (!(T > ti[0])) return 0;
    if (T >= time) return N;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ti[m] <= T) lo = m; else hi = m; }
    const d = ti[lo + 1] - ti[lo];
    return lo + (d > 0 ? (T - ti[lo]) / d : 0);
  }
  // the time into the lap at (fractional) sample s
  const timeAt = s => { s = clamp(s, 0, N); const i = Math.min(N - 1, Math.floor(s)); return ti[i] + (ti[i + 1] - ti[i]) * (s - i); };
  // a per-sample value at s (null where the source has none)
  function valueAt(a, s) {
    if (!a) return null;
    const i = Math.min(N - 1, Math.floor(clamp(s, 0, N))), j = (i + 1) % N, u = s - i, x = a[i], y = a[j];
    if (!Number.isFinite(x)) return Number.isFinite(y) ? y : null;
    return Number.isFinite(y) ? x + (y - x) * u : x;
  }
  const hasXZ = !!(trace.x && trace.z) && Number.isFinite(trace.x[0]);
  function centre(s) {
    const i = Math.min(N - 1, Math.floor(clamp(s, 0, N))), j = (i + 1) % N, u = s - i;
    return { x: track.PX[i] + (track.PX[j] - track.PX[i]) * u, z: track.PZ[i] + (track.PZ[j] - track.PZ[i]) * u, h: Math.atan2(track.TZ[i], track.TX[i]) };
  }
  function fromTrace(s) {
    const x = valueAt(trace.x, s), z = valueAt(trace.z, s);
    if (x === null || z === null) return null;
    let h;
    if (trace.h) { const i = Math.min(N - 1, Math.floor(s)), a = trace.h[i], b = trace.h[(i + 1) % N]; h = Number.isFinite(b) ? a + wrapA(b - a) * (s - i) : a; }
    else { const a = Math.max(0, s - 1), b = Math.min(N - 0.001, s + 1); h = Math.atan2(valueAt(trace.z, b) - valueAt(trace.z, a), valueAt(trace.x, b) - valueAt(trace.x, a)); }
    return Number.isFinite(h) ? { x, z, h } : null;
  }
  // { x, z, h, s } where the car was T s into its lap
  function poseAt(T) {
    T = clamp(T, 0, time);
    const s = sampleAt(T);
    const p = (ghost && ghostPose(ghost, T)) || (hasXZ && fromTrace(s)) || centre(s);
    return { ...p, s };
  }
  return { time, ti, N, sampleAt, timeAt, valueAt, poseAt, source: ghost ? 'ghost' : hasXZ ? 'trace' : 'centre',
    kmh: s => valueAt(trace.kmh, s), thr: s => valueAt(trace.thr, s), brk: s => valueAt(trace.brk, s),
    gear: s => { const g = trace.gear?.[Math.min(N - 1, Math.round(clamp(s, 0, N - 1)))]; return Number.isFinite(g) && g > 0 ? g : null; } };
}

// The two laps T s into yours: your sample, the other car's sample and its time into its lap, the delta (+ = you slower:
// the time you took to your spot minus what the other lap took), and its distance ahead along the track in samples
// (+ = ahead of you; by distance always 0)
export function compareAt(me, ref, T, sync = 'time') {
  const sMe = me.sampleAt(Math.min(T, me.time));
  const tRef = sync === 'distance' ? ref.timeAt(sMe) : Math.min(T, ref.time);
  const sRef = sync === 'distance' ? sMe : ref.sampleAt(tRef);
  return { sMe, sRef, tRef, delta: me.timeAt(sMe) - ref.timeAt(sMe), ahead: sRef - sMe };
}

// the delta at every sample (+ = you slower), for the trace under the map
export function deltaSeries(me, ref) {
  const out = new Float32Array(me.N + 1);
  for (let i = 0; i <= me.N; i++) out[i] = me.ti[i] - ref.ti[i];
  return out;
}

// what a car model needs to show a replayed car (its sync(car, pose)): wheels turning, steering from the path's
// curvature, brake lights from the pedal (ds: metres per track sample)
export function modelState(R, T, ds) {
  const h = REPLAY.turnSpan / 2, a = R.poseAt(T - h), b = R.poseAt(T + h), p = R.poseAt(T);
  const dist = Math.hypot(b.x - a.x, b.z - a.z), k = dist > 1 ? wrapA(b.h - a.h) / dist : 0;
  const kmh = R.kmh(p.s) ?? 0;
  return { pose: p, car: { v: kmh / 3.6, roll: p.s * ds / REPLAY.wheelR, steer: clamp(Math.atan(REPLAY.wheelbase * k) / REPLAY.lock, -1, 1),
    brake: R.brk(p.s) ?? 0, aeroOpen: 0, attackOn: false, wingOff: null, ay: 0, air: null } };
}
