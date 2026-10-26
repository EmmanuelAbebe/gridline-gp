// Sectors, corners and pace (pure: no DOM, no Three.js; tests/lap-analysis.test.js). 2026-10-26, user: "include sectors
// to determine where a player is slow or faster, as well as calculating pace for a new kind of comparison", against
// "the fastest lap from me or the AI and later on from other players".
// A lap trace = one lap at every track sample: the lap time when the car got there (t), its speed (kmh) and pedals
// (thr / brk; null where a source has none). Your laps are recorded live; the AI's come from its ghost lap (ai-ghosts.js
// line); a recorded ghost (yours from before, or another player's file) has a time every GHOST.split samples and its
// pose, which give the same arrays without the pedals. The circuit's split (SIM.buildSectors): corners, mini-sectors
// (a corner's braking point to the next one's), three sectors.
import { SIM } from '../sim/index.js';
import { ghostPose } from './ghost.js';

export const ANALYSIS = Object.freeze({
  version: 1,
  brakeDecel: 6,     // m/s²: braking starts where the speed drops at least this fast (from the speed alone: every source has it)
  brakeLook: 4,      // samples over which that is measured
  apexAfter: 30,     // samples past the apex in which the slowest point may still lie
  exitAfter: 100,    // m after the apex: the exit speed
  fullThr: 0.95,     // full throttle
  within: 0.5,       // s: laps this close to your best count as "on the pace"
  outlier: 1.07,     // laps slower than this × your best don't count for the average (spins, traffic)
  tie: 0.0005,       // s: equal times
});

// ---- traces ----
const nanArray = N => new Float32Array(N).fill(NaN);
// the lap time at sample i: 0 at the line where the lap starts, the lap's time at N (the line again)
export const timeAt = (tr, i) => i <= 0 ? 0 : i >= tr.t.length ? tr.time : tr.t[i];
// Records your lap at every sample: start(lap, c, lapT) when a lap begins (lights out for lap 1: the car is still behind
// the line), sample(c, lapT) every sim step, finish(time, meta) → the trace. Samples behind the line (the grid) and after
// it (the next lap) are not written.
export function createTraceRecorder(N) {
  let tr = null, lap = 0, last = 0;
  // the samples reached since the last step (after `last`, up to the car's): the time the car first got there
  const fill = (c, lapT) => {
    const passed = Math.min(50, SIM.wrapIdx(c.idx - last, N));
    for (let k = 0; k < passed; k++) {
      const i = c.idx - k; if (i < 0) break;
      tr.t[i] = lapT; tr.kmh[i] = SIM.speedOf(c) * 3.6; tr.thr[i] = c.thr; tr.brk[i] = c.brake;
    }
    last = c.idx;
  };
  return {
    get on() { return !!tr; },
    get current() { return tr; },
    start(lapNo, c, lapT) {
      tr = { time: 0, t: nanArray(N), kmh: nanArray(N), thr: nanArray(N), brk: nanArray(N), start: lapNo === 1 && lapT < 0.5, pit: false };
      lap = lapNo; last = c.lap === lapNo ? -1 : c.idx;          // (-1: from the line, sample 0 included)
      if (c.lap === lapNo) fill(c, lapT);
    },
    stop() { tr = null; },
    sample(c, lapT) {
      if (!tr) return;
      if (c.pit) tr.pit = true;
      if (c.lap !== lap) { if (c.lap < lap) last = c.idx; return; }      // (the grid, behind the line; or the lap is over)
      fill(c, lapT);
    },
    finish(time, meta = {}) { const out = tr; tr = null; if (!out) return null; out.time = time; return Object.assign(out, meta); },
  };
}
// an AI ghost lap (ai-ghosts.js aiLap: { time, line })
export const traceFromAi = lap => lap && lap.line?.t ? { time: lap.time, t: lap.line.t, kmh: lap.line.kmh, thr: lap.line.thr, brk: lap.line.brk } : null;
// a recorded ghost (ghost.js): the splits interpolated to every sample, the speed from its pose
export function traceFromGhost(g, N) {
  if (!g || !Array.isArray(g.splits)) return null;
  const t = nanArray(N), kmh = nanArray(N), S = g.split, h = 0.5 / g.hz;
  for (let i = 0; i < N; i++) {
    const k = Math.floor(i / S), a = g.splits[k], b = (k + 1) * S >= N ? g.time : g.splits[k + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    t[i] = i % S === 0 ? a : a + (b - a) * (i - k * S) / Math.min(S, N - k * S);
    // (not from the first frame: it is taken up to a step after the line, so the gap to the next one is short)
    const end = g.frames.length / 3 / g.hz - 1 / g.hz, ta = Math.min(end - 2 * h, Math.max(1 / g.hz, t[i] - h)), tb = Math.min(end, ta + 2 * h);
    const p = ghostPose(g, ta), q = ghostPose(g, tb);
    if (p && q && tb > ta) kmh[i] = Math.hypot(q.x - p.x, q.z - p.z) / (tb - ta) * 3.6;
  }
  return { time: g.time, t, kmh, thr: null, brk: null, start: !!g.start };
}

// ---- times ----
const span = (tr, a, b) => timeAt(tr, b) - timeAt(tr, a);
export const miniTimes = (tr, L) => L.minis.map(m => span(tr, m.from, m.to));
export const sectorTimes = (tr, L) => L.sectors.map(s => span(tr, s.from, s.to));
// which mini-sectors / sectors of a lap count for bests: a lap from the grid (lap 1) leaves out the first sector
export const countsMini = (tr, L, m) => !tr.start || !L.sectors[0].minis.includes(m);
export const countsSector = (tr, s) => !tr.start || s > 0;
// purple = the best anyone has (you or a reference lap), green = your best, else yellow (a time not set: none)
export function colourOf(time, mine, overall) {
  if (!Number.isFinite(time)) return 'none';
  if (time <= overall + ANALYSIS.tie) return 'purple';
  return time <= mine + ANALYSIS.tie ? 'green' : 'yellow';
}

// ---- corners: how each was driven ----
// per corner: time (its mini-sector), brakeAt (m before the apex the braking began; null = taken without braking),
// entry (km/h there), min (the slowest km/h), exit (km/h exitAfter m after the apex), fullAt (m from the apex to full
// throttle again, − = before it; null without pedal data)
export function cornerMetrics(tr, L, ds) {
  const A = ANALYSIS, N = L.N, at = (arr, i) => arr[Math.min(N - 1, Math.max(0, i))];
  return L.corners.map((c, k) => {
    const mi = L.minis.findIndex(m => m.corner === k), m = L.minis[mi], apex = c.apex < m.from ? c.apex + N : c.apex;
    let brakeI = -1;
    for (let i = m.from; i < apex && i + A.brakeLook < N; i++) {
      const dt = tr.t[i + A.brakeLook] - tr.t[i], dv = (tr.kmh[i] - tr.kmh[i + A.brakeLook]) / 3.6;
      if (dt > 0 && dv / dt >= A.brakeDecel) { brakeI = i; break; }
    }
    let minI = m.from;
    for (let i = m.from; i < Math.min(m.to, apex + A.apexAfter); i++) if (at(tr.kmh, i) < at(tr.kmh, minI)) minI = i;
    const exitI = Math.min(m.to - 1, apex + Math.round(A.exitAfter / ds));
    let fullI = -1;
    if (tr.thr) for (let i = minI; i < m.to; i++) if (at(tr.thr, i) >= A.fullThr) { fullI = i; break; }
    return { name: c.name, mini: mi, time: span(tr, m.from, m.to),
      brakeAt: brakeI >= 0 ? (apex - brakeI) * ds : null, entry: at(tr.kmh, brakeI >= 0 ? brakeI : m.from),
      min: at(tr.kmh, minI), exit: at(tr.kmh, exitI), fullAt: fullI >= 0 ? (fullI - apex) * ds : null };
  });
}

// ---- bests: per circuit and car class, across sessions (saved), and the reference ----
// bests = { key (the layout they belong to), sec: [s], mini: [s], best: trace of the fastest valid flying lap }
export const emptyBests = L => ({ key: L.key, sec: L.sectors.map(() => Infinity), mini: L.minis.map(() => Infinity), best: null });
// a valid lap: its sectors and mini-sectors into the bests (and the trace when it is the fastest flying lap); returns
// which improved
export function keepBests(b, L, tr) {
  const out = { sec: [], mini: [], lap: false };
  if (tr.invalid) return out;
  sectorTimes(tr, L).forEach((t, s) => { if (countsSector(tr, s) && t < b.sec[s]) { b.sec[s] = t; out.sec.push(s); } });
  miniTimes(tr, L).forEach((t, m) => { if (countsMini(tr, L, m) && t < b.mini[m]) { b.mini[m] = t; out.mini.push(m); } });
  if (!tr.start && !tr.pit && (!b.best || tr.time < b.best.time)) { b.best = tr; out.lap = true; }
  return out;
}
export const theoretical = b => b.mini.every(Number.isFinite) ? b.mini.reduce((a, t) => a + t, 0) : null;
// The reference lap: the fastest of the candidates ({ name, trace }: your best, the AI's, other players' laps), and per
// sector / mini-sector the best of all of them (purple)
export function referenceOf(L, candidates) {
  const ok = candidates.filter(c => c && c.trace && Number.isFinite(c.trace.time));
  const ref = ok.reduce((a, c) => !a || c.trace.time < a.trace.time ? c : a, null);
  const best = (fn, n) => Array.from({ length: n }, (_, i) => Math.min(...ok.map(c => fn(c.trace, L)[i]).filter(Number.isFinite)));
  return { ref, sec: best(sectorTimes, L.sectors.length), mini: best(miniTimes, L.minis.length) };
}

// ---- pace over a session ----
// laps: this session's traces (invalid, start, pit flags); ai: { [level]: lap time } → your best, the average and
// spread (standard deviation) of your valid flying laps within `outlier` of it, how many within `within`, the
// session's theoretical best (best mini-sectors), and your gap to each AI level in %
export function sessionPace(laps, L, ai = {}) {
  const A = ANALYSIS, valid = laps.filter(l => !l.invalid);
  const best = valid.length ? Math.min(...valid.map(l => l.time)) : null;
  const flying = valid.filter(l => !l.start && !l.pit && best !== null && l.time <= best * A.outlier).map(l => l.time);
  const avg = flying.length ? flying.reduce((a, t) => a + t, 0) / flying.length : null;
  const sd = flying.length > 1 ? Math.sqrt(flying.reduce((a, t) => a + (t - avg) ** 2, 0) / (flying.length - 1)) : null;
  const b = emptyBests(L); for (const l of valid) keepBests(b, L, l);
  const gaps = Object.fromEntries(Object.entries(ai).filter(([, t]) => t > 0).map(([id, t]) => [id, { time: t, pct: best === null ? null : (best - t) / t * 100 }]));
  return { laps: laps.length, valid: valid.length, best, avg, sd, counted: flying.length,
    within: best === null ? 0 : valid.filter(l => !l.start && l.time <= best + A.within).length, theo: theoretical(b), gaps };
}

// ---- storage: { [circuit]: { stock?, modified? } }, the trace kept small (whole ms steps, km/h, pedals in 5 %) ----
export const STORE_VERSION = 1;
const enc = (arr, k) => { let last = 0; return Array.from(arr, v => { if (!Number.isFinite(v)) return null; const q = Math.round(v * k), d = q - last; last = q; return d; }); };
const dec = (arr, k, N) => { const out = nanArray(N); let q = 0; arr.forEach((d, i) => { if (d === null) return; q += d; out[i] = q / k; }); return out; };
export const compactTrace = tr => tr && { time: tr.time, start: !!tr.start, t: enc(tr.t, 1000), kmh: enc(tr.kmh, 1), thr: tr.thr && enc(tr.thr, 20), brk: tr.brk && enc(tr.brk, 20) };
export function expandTrace(c, N) {
  if (!c || !(c.time > 0) || !Array.isArray(c.t) || c.t.length !== N || !Array.isArray(c.kmh) || c.kmh.length !== N) return null;
  const pedal = a => Array.isArray(a) && a.length === N ? dec(a, 20, N) : null;
  return { time: c.time, start: !!c.start, t: dec(c.t, 1000, N), kmh: dec(c.kmh, 1, N), thr: pedal(c.thr), brk: pedal(c.brk) };
}
export const storeSectorsJson = store => JSON.stringify({ v: STORE_VERSION, physics: SIM.TUNING.PHYSICS, circuits: store },
  (k, v) => v && v.t && v.kmh && typeof v.time === 'number' ? compactTrace(v) : v === Infinity ? null : v);
// the saved store: { [circuit]: { [class]: bests } } as saved (bestsOf checks and expands an entry when it is used)
export function loadSectorStore(json) {
  let s; try { s = JSON.parse(json); } catch (e) { return {}; }
  return s && s.v === STORE_VERSION && s.physics === SIM.TUNING.PHYSICS && s.circuits && typeof s.circuits === 'object' ? s.circuits : {};
}
// one circuit's and class's bests, if they belong to this layout (a changed circuit or split starts afresh), else null
export function bestsOf(store, id, cls, L) {
  const b = store[id]?.[cls];
  if (!b || b.key !== L.key || !Array.isArray(b.sec) || !Array.isArray(b.mini) || b.sec.length !== L.sectors.length || b.mini.length !== L.minis.length) return null;
  if (b.best && !(b.best.t instanceof Float32Array)) {                 // (as saved: expand it once)
    const num = v => typeof v === 'number' && v > 0 ? v : Infinity;
    Object.assign(b, { sec: b.sec.map(num), mini: b.mini.map(num), best: expandTrace(b.best, L.N) });
  } else if (!b.best) { b.sec = b.sec.map(v => v ?? Infinity); b.mini = b.mini.map(v => v ?? Infinity); }
  return b;
}
export const putBests = (store, id, cls, b) => { (store[id] ||= {})[cls] = b; };
