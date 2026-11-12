// Practice mode, the pure part (2026-11-12; user: "practise specific turns and sections of a circuit, timed, against the AI
// or yourself", built from their pick of the canvas mock-ups "Gridline practice mode": all four screens as drawn).
// No DOM, no Three.js (tests/practice.test.js). The game side (placing the car, the HUD, the screens): practice.js.
// A section = a stretch of the circuit from the ring (`from`, a track sample) to the square (`to`; it may run over the
// line: to < from). It is timed in parts, split where the circuit's mini-sectors start (SIM.buildSectors: a corner's
// braking point to the next one's), each part named by its corner. A run starts PRACTICE.lead m before the ring.
import { SIM } from '../sim/index.js';
import { miniTimes, cornerMetrics } from './lap-analysis.js';
import { createTelemetry, writeTelemetry, packTelemetry, unpackTelemetry, packSeries, unpackSeries, CHANNELS } from './telemetry.js';

export const PRACTICE = Object.freeze({
  version: 1,
  lead: 300,          // m before the ring: where a rolling run starts (at your best lap's speed and gear there)
  standing: 6,        // m before the ring: a standing start, from rest
  resetAfter: 1.4,    // s after the square (BACK TO THE START) before the next run
  offReset: 0.8,      // s after going off before the next run
  weakest: 3,         // corners in "MY WEAKEST" (the stretch where you lose the most to the ALIEN)
  hz: 20,             // frames a second of your best run's ghost
  listed: 7,          // runs on the HUD's list
  tie: 0.0005,        // s
});

const wrap = (i, N) => SIM.wrapIdx(i, N);
// samples from the ring to sample i, along the lap (0 .. N − 1)
export const relOf = (sec, i, N) => wrap(i - sec.from, N);
// the section's length in samples (a whole lap: N)
export const lengthOf = (sec, N) => wrap(sec.to - sec.from, N) || N;
export const leadSamples = (track, standing = false) => Math.max(1, Math.round((standing ? PRACTICE.standing : PRACTICE.lead) / track.ds));
export const sectionKey = sec => `${sec.from}-${sec.to}`;
const miniOfCorner = (L, k) => L.minis.findIndex(m => m.corner === k);

// corners a..b (indices into L.corners, in lap order; b < a = over the line) as a section: the first one's braking
// point to the end of the last one's mini-sector
export function sectionFromCorners(L, a, b) {
  const ma = L.minis[miniOfCorner(L, a)], mb = L.minis[miniOfCorner(L, b)];
  return { from: wrap(ma.from, L.N), to: wrap(mb.to, L.N) };
}
// the corners whose mini-sector lies (mostly) inside the section, in lap order
export function cornersIn(L, sec) {
  const N = L.N, len = lengthOf(sec, N), out = [];
  L.minis.forEach(m => {
    if (!(m.corner >= 0)) return;
    const a = relOf(sec, m.from, N), n = wrap(m.to - m.from, N) || N;
    const inside = Math.max(0, Math.min(len, a + n) - a) + (a + n > N ? Math.max(0, Math.min(len, a + n - N)) : 0);
    if (a < len && inside >= n / 2) out.push(m.corner);
  });
  return out.sort((x, y) => relOf(sec, L.minis[miniOfCorner(L, x)].from, N) - relOf(sec, L.minis[miniOfCorner(L, y)].from, N));
}
// the parts a run is timed in: split where a mini-sector starts inside the section, named by the corner whose
// mini-sector each part starts in ('Line' for the stretch from the line to the first braking point)
export function partsOf(L, sec) {
  const N = L.N, len = lengthOf(sec, N), cuts = [0];
  for (const m of L.minis) { const r = relOf(sec, m.from, N); if (r > 0 && r < len) cuts.push(r); }
  cuts.sort((a, b) => a - b); cuts.push(len);
  const parts = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    if (cuts[k + 1] - cuts[k] < 3 && parts.length) { parts[parts.length - 1].b = cuts[k + 1]; continue; }   // (a sliver: joined)
    const i = wrap(sec.from + cuts[k], N);
    const mi = L.minis.findIndex(m => relOf({ from: m.from }, i, N) < (wrap(m.to - m.from, N) || N));
    const corner = mi >= 0 ? L.minis[mi].corner : -1;
    parts.push({ a: cuts[k], b: cuts[k + 1], corner, name: corner >= 0 ? L.corners[corner].name : 'Line' });
  }
  return parts;
}
// "T3 – T5", "T4", "Sector 2" (L.sectors), "Whole lap"
export function sectionName(L, sec, ds = 2) {
  const N = L.N;
  if (lengthOf(sec, N) === N) return 'Whole lap';
  const s = L.sectors.findIndex(x => wrap(x.from, N) === sec.from && wrap(x.to, N) === sec.to);
  if (s >= 0) return `Sector ${s + 1}`;
  const c = cornersIn(L, sec);
  if (!c.length) return `${Math.round(lengthOf(sec, N) * ds)} m`;
  const a = L.corners[c[0]].name, b = L.corners[c[c.length - 1]].name;
  return a === b ? a : `${a} – ${b}`;
}

// ---- a full lap's trace (lap-analysis.js: t from the line) over a section ----
// its time from sample a to sample b along the lap (over the line: + the lap's time); NaN where it has none
export function lapSpan(tr, a, b, N) {
  a = wrap(a, N); b = wrap(b, N);
  const ta = a === 0 ? 0 : tr.t[a], tb = b === 0 ? tr.time : tr.t[b];
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return NaN;
  const d = tb - ta;
  return d > 0 ? d : d + tr.time;
}
// each part's time on that lap, and the whole section's
export function lapParts(tr, sec, parts, N) {
  if (!tr) return null;
  const at = r => wrap(sec.from + r, N), times = parts.map(p => lapSpan(tr, at(p.a), at(p.b), N));
  return { parts: times, time: times.reduce((s, t) => s + t, 0) };
}
// the lap's time at sample i counted from the ring (− before it: the lead-in), for a ghost of an AI lap
export function lapTimeFromRing(tr, sec, i, N) {
  const ring = sec.from === 0 ? 0 : tr.t[sec.from], t = i === 0 ? 0 : tr.t[i];
  if (!Number.isFinite(ring) || !Number.isFinite(t)) return NaN;
  let d = t - ring;
  const before = relOf(sec, i, N) > N / 2;
  if (before && d > 0) d -= tr.time; else if (!before && d < 0) d += tr.time;
  return d;
}

// ---- runs ----
// Records a run at every track sample from the start: per sample the time from the ring (− = the lead-in), km/h,
// pedals, gear, where the car was; and the frames for its ghost (PRACTICE.hz). sample(c, t) every sim step; t = s
// since the run started (the ring's time is found when the car first passes it).
export function createRunRecorder(track, sec, lead) {
  const N = track.N, len = lengthOf(sec, N), W = lead + len + 1;
  const arr = () => new Float32Array(W).fill(NaN);
  const run = { t: arr(), kmh: arr(), thr: arr(), brk: arr(), x: arr(), z: arr(), h: arr(), gear: arr(), tel: createTelemetry(W), frames: [], ring: NaN, lead, len, N };
  let last = -1, nextFrame = 0;
  // window index of sample i: 0 = the start, lead = the ring, lead + len = the square; −1 outside
  const win = i => { const r = relOf(sec, i, N), w = r >= N - lead ? r - (N - lead) : r + lead; return w >= 0 && w < W ? w : -1; };
  return {
    run, win,
    sample(c, t) {
      const w = win(c.idx);
      if (w < 0 || w < last) return;                   // (outside the window, or gone backwards)
      for (let k = Math.max(0, last + 1); k <= w; k++) {
        run.t[k] = t; run.kmh[k] = SIM.speedOf(c) * 3.6; run.thr[k] = c.thr; run.brk[k] = c.brake; run.gear[k] = c.gear;
        run.x[k] = c.x; run.z[k] = c.z; run.h[k] = c.h; writeTelemetry(run.tel, k, c);
      }
      if (last < lead && w >= lead) run.ring = t;
      last = w;
      if (t >= nextFrame) { run.frames.push(t, c.x, c.z, c.h); nextFrame = t + 1 / PRACTICE.hz; }
    },
    get last() { return last; },
  };
}
// the run's time from the ring at window index w (NaN before the car got there)
export const runTime = (run, w) => Number.isFinite(run.ring) && Number.isFinite(run.t[w]) ? run.t[w] - run.ring : NaN;
// each part's time on a run (NaN for a part not finished)
export const runParts = (run, parts) => parts.map(p => runTime(run, run.lead + p.b) - runTime(run, run.lead + p.a));
// where a run's ghost was t s after its start ({ x, z, h }), null outside it
export function framePose(F, t) {
  const n = F.length / 4;
  if (n < 2 || !(t >= F[0]) || t > F[(n - 1) * 4]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (F[m * 4] <= t) lo = m; else hi = m; }
  const d = F[hi * 4] - F[lo * 4], u = d > 0 ? (t - F[lo * 4]) / d : 0;
  const dh = Math.atan2(Math.sin(F[hi * 4 + 3] - F[lo * 4 + 3]), Math.cos(F[hi * 4 + 3] - F[lo * 4 + 3]));
  return { x: F[lo * 4 + 1] + (F[hi * 4 + 1] - F[lo * 4 + 1]) * u, z: F[lo * 4 + 2] + (F[hi * 4 + 2] - F[lo * 4 + 2]) * u, h: F[lo * 4 + 3] + dh * u };
}
// a run as a full-lap trace (NaN outside its window), for corner metrics (lap-analysis.js cornerMetrics): the times from
// the ring, shifted so every one is ≥ 0 (only differences are used)
// (and where it went, its gear and its telemetry when the run has them: the practice analysis)
export function runAsTrace(run, sec, n = run.N) {
  const N = n, f = () => new Float32Array(N).fill(NaN), tr = { time: NaN, t: f(), kmh: f(), thr: f(), brk: f() };
  const more = ['x', 'z', 'h', 'gear'].filter(k => run[k]);
  for (const k of more) tr[k] = f();
  if (run.tel) tr.tel = Object.fromEntries(CHANNELS.map(([id]) => [id, f()]));
  const t0 = run.t[0];
  for (let w = 0; w < run.t.length; w++) {
    if (!Number.isFinite(run.t[w])) continue;
    const i = wrap(sec.from - run.lead + w, N);
    tr.t[i] = run.t[w] - t0; tr.kmh[i] = run.kmh[w]; tr.thr[i] = run.thr[w]; tr.brk[i] = run.brk[w];
    for (const k of more) tr[k][i] = run[k][w];
    if (run.tel) for (const [id] of CHANNELS) tr.tel[id][i] = run.tel[id][w];
  }
  return tr;
}

// ---- the session's runs: { time (null = off), parts [s], off (the part's name), run } ----
// colour of part p on run k: purple = the session's best of that part, green = quicker than the run before, else yellow
export function partColour(runs, k, p) {
  const t = runs[k].parts[p];
  if (!Number.isFinite(t)) return runs[k].off ? 'off' : 'none';
  const best = Math.min(...runs.map(r => r.parts[p]).filter(Number.isFinite));
  if (t <= best + PRACTICE.tie) return 'purple';
  const prev = k > 0 ? runs[k - 1].parts[p] : NaN;
  return Number.isFinite(prev) && t < prev - PRACTICE.tie ? 'green' : 'yellow';
}
// the summary's numbers: best run, average and spread (fastest to slowest) of the clean runs, how close the last three
// were, the best of each part put together and which run set it
export function sessionStats(runs) {
  const clean = runs.filter(r => Number.isFinite(r.time));
  if (!clean.length) return { runs: runs.length, clean: 0, best: null, bestIndex: -1, avg: null, spread: null, last3: null, ofEach: null, ofEachRuns: [] };
  const best = clean.reduce((a, r) => r.time < a.time ? r : a);
  const times = clean.map(r => r.time), avg = times.reduce((a, t) => a + t, 0) / times.length;
  const last = times.slice(-3);
  const P = runs[0].parts.length, ofEachRuns = [], ofEach = [];
  for (let p = 0; p < P; p++) {
    let k = -1; runs.forEach((r, i) => { if (Number.isFinite(r.parts[p]) && (k < 0 || r.parts[p] < runs[k].parts[p])) k = i; });
    ofEachRuns.push(k); ofEach.push(k >= 0 ? runs[k].parts[p] : NaN);
  }
  return { runs: runs.length, clean: clean.length, best: best.time, bestIndex: runs.indexOf(best), avg,
    spread: Math.max(...times) - Math.min(...times), last3: last.length >= 3 ? Math.max(...last) - Math.min(...last) : null,
    ofEach: ofEach.every(Number.isFinite) ? ofEach.reduce((a, t) => a + t, 0) : null, ofEachRuns };
}

// ---- where you lose time: your best lap against a reference lap, corner by corner (their mini-sectors) ----
export function cornerTable(L, mine, ref, ds) {
  const mt = mine && miniTimes(mine, L), rt = ref && miniTimes(ref, L);
  const mm = mine && cornerMetrics(mine, L, ds), rm = ref && cornerMetrics(ref, L, ds);
  return L.corners.map((c, k) => {
    const mi = miniOfCorner(L, k), you = mt ? mt[mi] : NaN, other = rt ? rt[mi] : NaN;
    return { k, name: c.name, you, ref: other, gap: you - other, youMin: mm?.[k].min ?? NaN, refMin: rm?.[k].min ?? NaN, me: mm?.[k] ?? null, other: rm?.[k] ?? null };
  });
}
// the n corners in a row (over the line too) where you lose the most: [first, last] corner indices, or null
export function weakestStretch(rows, n = PRACTICE.weakest) {
  const C = rows.length; if (!C || !rows.some(r => Number.isFinite(r.gap))) return null;
  n = Math.min(n, C);
  let best = null, most = -Infinity;
  for (let a = 0; a < C; a++) {
    let s = 0; for (let j = 0; j < n; j++) { const g = rows[(a + j) % C].gap; s += Number.isFinite(g) ? g : 0; }
    if (s > most) { most = s; best = [a, (a + n - 1) % C]; }
  }
  return best;
}
// the corner of these (indices) where your best lap loses the most to the reference (the summary's "what changed")
export const weakestOf = (rows, ks) => ks.reduce((a, k) => a === null || (rows[k].gap > rows[a].gap) ? k : a, null);
// "Brakes 14 m earlier" etc.: you against the other (cornerMetrics), the three lines of the corner box
export function cornerWords(me, other) {
  if (!me || !other) return [];
  const out = [];
  if (me.brakeAt !== null && other.brakeAt !== null) { const d = Math.round(me.brakeAt - other.brakeAt); out.push(['Brakes', d === 0 ? 'at the same spot' : `${Math.abs(d)} m ${d > 0 ? 'earlier' : 'later'}`]); }
  if (Number.isFinite(me.min) && Number.isFinite(other.min)) { const d = Math.round(me.min - other.min); out.push(['Slowest', d === 0 ? 'the same speed' : `${Math.abs(d)} km/h ${d < 0 ? 'slower' : 'faster'}`]); }
  if (me.fullAt !== null && other.fullAt !== null) { const d = Math.round(me.fullAt - other.fullAt); out.push(['Full gas', d === 0 ? 'at the same spot' : `${Math.abs(d)} m ${d > 0 ? 'later' : 'sooner'}`]); }
  return out;
}
// the summary's sentence: the biggest step from your first run to your best, then what the other still does better
export function changeSentence(name, first, best, other, otherName = 'The ALIEN') {
  if (!best) return '';
  const steps = [];
  if (first && best !== first) {
    if (first.brakeAt !== null && best.brakeAt !== null) steps.push([(first.brakeAt - best.brakeAt) / 10, `braking ${Math.round(Math.abs(first.brakeAt - best.brakeAt))} m ${best.brakeAt < first.brakeAt ? 'later' : 'earlier'}`]);
    steps.push([(best.min - first.min) / 5, `${Math.round(Math.abs(best.min - first.min))} km/h ${best.min > first.min ? 'more' : 'less'} at the slowest point`]);
    if (first.fullAt !== null && best.fullAt !== null) steps.push([(first.fullAt - best.fullAt) / 10, `full gas ${Math.round(Math.abs(first.fullAt - best.fullAt))} m ${best.fullAt < first.fullAt ? 'sooner' : 'later'}`]);
  }
  const top = steps.filter(s => s[0] > 0.05).sort((a, b) => b[0] - a[0])[0];
  const said = [top ? `Biggest step: ${top[1]} in ${name}.` : `${name}: no clear step yet.`];
  if (other) {
    const more = [];
    if (other.brakeAt !== null && best.brakeAt !== null && other.brakeAt < best.brakeAt - 2) more.push(`brakes another ${Math.round(best.brakeAt - other.brakeAt)} m later`);
    if (other.min > best.min + 1) more.push(`carries ${Math.round(other.min - best.min)} km/h more`);
    if (other.fullAt !== null && best.fullAt !== null && other.fullAt < best.fullAt - 2) more.push(`is on full gas ${Math.round(best.fullAt - other.fullAt)} m sooner`);
    if (more.length) said.push(`${otherName} ${more.slice(0, 2).join(' and ')}.`);
  }
  return said.join(' ');
}

// ---- saved: your best run per circuit, car class and section; the screen's choices; the last section per circuit ----
// { v, physics, opts: { start, against, after }, last: { [circuit]: { from, to } }, best: { [key]: { time, parts, ts, frames } } }
export const DEFAULT_OPTS = Object.freeze({ start: 'rolling', against: 'best', after: 'reset' });
export const OPTION_VALUES = Object.freeze({ start: ['rolling', 'standing'], against: ['best', 'alien', 'legend', 'none'], after: ['reset', 'drive'] });
export function loadPractice(json) {
  let s = null; try { s = JSON.parse(json); } catch (e) { /* none yet */ }
  const ok = s && s.v === PRACTICE.version && s.physics === SIM.TUNING.PHYSICS;
  const opts = { ...DEFAULT_OPTS };
  if (s?.opts) for (const k in OPTION_VALUES) if (OPTION_VALUES[k].includes(s.opts[k])) opts[k] = s.opts[k];
  return { opts, last: s?.last && typeof s.last === 'object' ? s.last : {}, best: ok && s.best && typeof s.best === 'object' ? s.best : {} };
}
export const practiceJson = P => JSON.stringify({ v: PRACTICE.version, physics: SIM.TUNING.PHYSICS, opts: P.opts, last: P.last, best: P.best });
// the key of a best: circuit, car class + layout (aero-zones.js lapClass), the section, the circuit's split (its key)
export const bestKey = (circuit, cls, sec, L) => `${circuit}|${cls}|${sectionKey(sec)}|${L.key}`;
// a run kept as a best: its times per window sample (ms, from the run's start) and its ghost frames (cm, mrad)
export function packRun(r) {
  const run = r.run, t0 = run.t[0], q = (v, k) => Number.isFinite(v) ? Math.round(v * k) : null;
  return { time: r.time, parts: r.parts, ring: q(run.ring - t0, 1000), lead: run.lead, ts: Array.from(run.t, v => q(v - t0, 1000)),
    frames: run.frames.map((v, i) => q(i % 4 === 0 ? v - t0 : v, i % 4 === 3 ? 1000 : i % 4 === 0 ? 1000 : 100)),
    // (2026-11-12: the whole run per sample, for its analysis: speed, pedals, where it went, gear, the car's state)
    s: Object.fromEntries(Object.entries(RUN_SERIES).map(([k, qq]) => [k, packSeries(run[k], qq)])), tel: packTelemetry(run.tel) };
}
const RUN_SERIES = { kmh: 0.1, thr: 0.01, brk: 0.01, x: 0.01, z: 0.01, h: 0.001, gear: 1 };
// back: { time, parts, lead, ts (s from the ring per window sample), frames (t from the ring) }; null if it doesn't fit
export function unpackRun(b, lead, len) {
  if (!b || !(b.time > 0) || !Array.isArray(b.ts) || b.ts.length !== lead + len + 1 || b.lead !== lead || !Array.isArray(b.frames) || b.frames.length % 4) return null;
  const ring = b.ring / 1000;
  const ts = Float32Array.from(b.ts, v => v === null ? NaN : v / 1000 - ring);
  const frames = b.frames.map((v, i) => i % 4 === 0 ? v / 1000 - ring : i % 4 === 3 ? v / 1000 : v / 100);
  const out = { time: b.time, parts: b.parts, lead, ts, frames };
  // its run per sample (runs saved before 2026-11-12: only the times and the ghost): t from the ring, as recorded
  const W = lead + len + 1;
  if (b.s && typeof b.s === 'object') {
    const run = { t: ts, lead, len, ring: 0, frames };
    for (const [k, qq] of Object.entries(RUN_SERIES)) run[k] = unpackSeries(b.s[k], qq, W) ?? new Float32Array(W).fill(NaN);
    run.tel = unpackTelemetry(b.tel, W);
    out.run = run;
  }
  return out;
}

// ---- the practice analysis (practice-analysis.js): every run, your saved best and the AI's lap as the same thing ----
// A series = one drive over the run's window (lead-in + section): per window sample w the time from the ring (t, s; − on
// the lead-in), km/h, pedals, x / z / h, gear and the car's telemetry (telemetry.js; null where none was recorded).
const SERIES_KEYS = ['kmh', 'thr', 'brk', 'x', 'z', 'h', 'gear'];
// a run (createRunRecorder's, or a saved best's unpacked run) as a series
export function seriesOfRun(run) {
  const W = run.t.length, t = new Float32Array(W);
  for (let w = 0; w < W; w++) t[w] = run.t[w] - run.ring;
  const s = { t, tel: run.tel ?? null };
  for (const k of SERIES_KEYS) s[k] = run[k] ?? new Float32Array(W).fill(NaN);
  return s;
}
// a full-lap trace (the AI's, lap-analysis.js) cut to a run's window, its times from the ring (over the line: + the lap)
export function traceWindow(tr, sec, lead, len, N) {
  const W = lead + len + 1, f = () => new Float32Array(W).fill(NaN), t0 = tr.t[sec.from] ?? 0;
  const s = { t: f(), tel: tr.tel ? createTelemetry(W) : null };
  for (const k of SERIES_KEYS) s[k] = f();
  for (let w = 0; w < W; w++) {
    const i = wrap(sec.from - lead + w, N);
    let t = (i === 0 && w > lead ? tr.time : tr.t[i]) - t0;
    if (w > lead && t < 0) t += tr.time; else if (w < lead && t > 0) t -= tr.time;
    s.t[w] = t;
    for (const k of SERIES_KEYS) if (tr[k]) s[k][w] = tr[k][i];
    if (s.tel) for (const [id] of CHANNELS) s.tel[id][w] = tr.tel[id][i];
  }
  return s;
}
// the window sample of track sample i (−1 outside the window)
export const windowOf = (sec, lead, len, i, N) => { const w = wrap(i - (sec.from - lead), N); return w <= lead + len ? w : -1; };
// where a series is T s from the ring: the window sample (fractional, s) and the car's place (x, z, h), null where not driven
export function seriesAt(S, T) {
  const t = S.t, W = t.length;
  let lo = -1, hi = -1;
  for (let w = 0; w < W; w++) if (Number.isFinite(t[w])) { if (lo < 0) lo = w; hi = w; }
  if (lo < 0) return null;
  T = Math.max(t[lo], Math.min(t[hi], T));
  let a = lo; while (a < hi && !(t[a + 1] > T)) a++;
  const b = Math.min(hi, a + 1), u = b > a && t[b] > t[a] ? (T - t[a]) / (t[b] - t[a]) : 0;
  const L = (arr) => Number.isFinite(arr[a]) && Number.isFinite(arr[b]) ? arr[a] + (arr[b] - arr[a]) * u : arr[a];
  return { s: a + u, x: L(S.x), z: L(S.z), h: S.h[a] };
}
// a value of a series at a fractional window sample (NaN where none)
export const seriesValue = (arr, s) => { if (!arr) return NaN; const a = Math.floor(s), b = Math.min(arr.length - 1, a + 1), u = s - a;
  return Number.isFinite(arr[a]) && Number.isFinite(arr[b]) ? arr[a] + (arr[b] - arr[a]) * u : arr[a]; };
