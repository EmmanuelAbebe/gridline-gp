// Ghost laps and time trial (pure: no DOM, no Three.js; main.js stores them through Settings, tests/ghost.test.js).
// A ghost = one valid lap: the car's pose sampled at GHOST.hz from the line to the line, plus the lap time at every
// GHOST.split track samples (for the live delta). Kept per circuit and car class (stock / modified, like the lap
// records): your best, and one loaded from a file (a friend's).
import { SIM } from '../sim/index.js';

export const GHOST = Object.freeze({ hz: 20, split: 20, version: 1, maxFrames: 20 * 600 });

// Records the lap in progress; start() at each crossing of the line, sample() every sim step, lap() when the lap is
// done → a ghost (or null for a lap too short to be real).
export function createRecorder() {
  let frames = [], splits = [], t0 = 0, next = 0, lastSplit = -1, on = false;
  return {
    start(t) { frames = []; splits = []; t0 = t; next = 0; lastSplit = -1; on = true; },
    stop() { on = false; },
    get recording() { return on; },
    // c: the car (x, z, h, idx); t: race time
    sample(c, t) {
      if (!on) return;
      const lt = t - t0, k = Math.floor(c.idx / GHOST.split);
      if (k > lastSplit && k - lastSplit < 50) { for (let j = lastSplit + 1; j <= k; j++) splits[j] = lt; lastSplit = k; }
      if (lt + 1e-9 >= next && frames.length < GHOST.maxFrames * 3) {
        const r = (v, k) => Math.round(v * k) / k + 0;        // (+ 0: no -0, which a file can't keep)
        frames.push(r(c.x, 100), r(c.z, 100), r(c.h, 1000));
        next += 1 / GHOST.hz;
      }
    },
    // the lap just completed: time (s), meta { circuit, modified, driver, livery }
    lap(time, meta) {
      on = false;
      if (frames.length < 3 * GHOST.hz * 5 || !(time > 0)) return null;
      return { v: GHOST.version, physics: SIM.TUNING.PHYSICS, time, ...meta, date: meta.date ?? null, hz: GHOST.hz, split: GHOST.split, frames, splits };
    },
  };
}

// The ghost's pose `t` seconds into its lap (interpolated; heading the short way round), or null outside the lap.
export function ghostPose(g, t) {
  const n = g.frames.length / 3, f = t * g.hz;
  if (!(f >= 0) || f > n - 1) return null;
  const i = Math.min(n - 2, Math.floor(f)), u = f - i, F = g.frames;
  let dh = F[i * 3 + 5] - F[i * 3 + 2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return { x: F[i * 3] + (F[i * 3 + 3] - F[i * 3]) * u, z: F[i * 3 + 1] + (F[i * 3 + 4] - F[i * 3 + 1]) * u, h: F[i * 3 + 2] + dh * u };
}

// Live delta: your lap time now minus the ghost's at the same split (+ = slower), or null before the first split.
export function ghostDelta(g, idx, lapTime) {
  const k = Math.floor(idx / g.split), at = g.splits[k];
  return Number.isFinite(at) && k > 0 ? lapTime - at : null;
}

// ---- compact form (2026-10-20, user: smaller laps, to put players' best laps online): what is saved and sent ----
// The pose is already rounded (x, z to 1 cm, h to 1 mrad), so it is kept in whole units as the change of each frame's
// step from the last one (second differences: the car's speed changes slowly, so these are small integers, mostly
// under ±75, which gzip packs well; `d` = d²x, d²z, d²h, ... after the first pose `p0`), and the splits as whole-
// millisecond steps (`ds`). Lossless for the pose; splits within 0.5 ms. In memory a ghost stays the plain form.
// (First differences were tried first: gzipped laps 1.8× bigger.)
const POSE_UNITS = [100, 100, 1000];
export function compactGhost(g) {
  const { frames, splits, ...meta } = g, d = new Array(frames.length - 3);
  const q = frames.map((v, i) => Math.round(v * POSE_UNITS[i % 3]));
  for (let i = 3; i < q.length; i++) d[i - 3] = q[i] - q[i - 3] - (i >= 6 ? q[i - 3] - q[i - 6] : 0);
  let last = 0;
  const ds = splits.map(t => { if (!Number.isFinite(t)) return null; const ms = Math.round(t * 1000), step = ms - last; last = ms; return step; });
  return { ...meta, enc: 'delta2', p0: q.slice(0, 3), d, ds };
}
export function expandGhost(c) {
  if (!c || c.enc !== 'delta2') return c;          // already plain (old saves and files)
  const { p0, d, ds, ...meta } = c; delete meta.enc;
  if (!Array.isArray(p0) || p0.length !== 3 || !Array.isArray(d) || d.length % 3 || !Array.isArray(ds)) return null;
  const q = p0.slice(), step = [0, 0, 0], frames = p0.map((v, i) => v / POSE_UNITS[i]);
  for (let i = 0; i < d.length; i++) { const k = i % 3; step[k] += d[i]; q[k] += step[k]; frames.push(q[k] / POSE_UNITS[k] + 0); }
  let ms = 0;
  const splits = ds.map(step => step === null ? undefined : (ms += step) / 1000);
  return { ...meta, frames, splits };
}

// ---- storage: { [circuit]: { stock?, modified?, 'stock:start'?, 'modified:start'? } } (compact JSON), the same for the
// loaded ones. Two bests per car class (2026-10-21, user: their ghost and they started out of step): the fastest lap
// from a standing start (lap 1, from the grid at lights out: `start: true`) and the fastest flying lap. Lap 1 of a race
// is raced against the first, every later lap against the second.
export function validGhost(g, circuits) {
  if (!g || typeof g !== 'object' || g.v !== GHOST.version || !(g.time > 0) || !Object.hasOwn(circuits, g.circuit)) return false;
  if ((g.physics ?? 1) !== SIM.TUNING.PHYSICS) return false;         // (driven on other physics: it doesn't compare)
  if (!Array.isArray(g.frames) || g.frames.length % 3 || g.frames.length < 9 || !g.frames.every(Number.isFinite)) return false;
  return Array.isArray(g.splits) && g.hz > 0 && g.split > 0;
}
// a lap from the grid: the car still in its first two frames (saves from before the `start` flag)
const fromStill = g => Math.hypot(g.frames[3] - g.frames[0], g.frames[4] - g.frames[1]) < 0.1;   // (from still: ~1 cm; flying: > 0.7 m)
const SLOTS = ['stock', 'modified', 'stock:start', 'modified:start'];
const slot = (modified, start) => (modified ? 'modified' : 'stock') + (start ? ':start' : '');
export function loadGhosts(json, circuits) {
  let s; try { s = JSON.parse(json); } catch (e) { return {}; }
  const out = {};
  if (s && typeof s === 'object') for (const [id, r] of Object.entries(s)) for (const k of SLOTS) {
    const g = r && expandGhost(r[k]);
    if (!validGhost(g, circuits) || g.circuit !== id) continue;
    g.start = typeof g.start === 'boolean' ? g.start : fromStill(g);
    keepGhost(out, g);                             // (an old save's standing lap moves to its own slot)
  }
  return out;
}
export const storeJson = store => JSON.stringify(store, (k, v) => v && v.frames && v.splits ? compactGhost(v) : v);
// start: the standing-start best (lap 1), else the flying one
export const ghostOf = (store, circuit, modified, start = false) => store[circuit]?.[slot(modified, start)] ?? null;
// keeps `g` when it is the first or faster in its slot; true when it was kept
export function keepGhost(store, g) {
  const k = slot(g.modified, g.start), old = store[g.circuit]?.[k];
  if (old && old.time <= g.time) return false;
  (store[g.circuit] ||= {})[k] = g;
  return true;
}
// both laps of a class
export function dropGhost(store, circuit, modified) { if (store[circuit]) for (const k of [slot(modified, false), slot(modified, true)]) delete store[circuit][k]; }

// ---- files (export / import a ghost: send your lap to a friend; the same bytes would go to a server) ----
// ghostFile = compact JSON text: a lap, and with it your standing-start lap there (`standing`) when you have one;
// packGhost = that, gzipped (the browser's own CompressionStream: no library). readGhostFile reads the compact text
// and the old plain files (gridlineGhost: 1); unpackGhost reads either, gzipped or not (a .json file from before).
// The lap read comes back with `.standing` (or without it).
export const FILE_VERSION = 2;
export const ghostFile = (g, standing = null) => JSON.stringify({ gridlineGhost: FILE_VERSION, ...compactGhost(g),
  ...(standing ? { standing: compactGhost(standing) } : {}) });
export function readGhostFile(text, circuits) {
  let g; try { g = JSON.parse(text); } catch (e) { return null; }
  if (!g || (g.gridlineGhost !== 1 && g.gridlineGhost !== FILE_VERSION)) return null;
  const { gridlineGhost, standing, ...lap } = g; void gridlineGhost;
  const out = expandGhost(lap), st = standing && expandGhost(standing);
  if (!validGhost(out, circuits)) return null;
  out.start = typeof out.start === 'boolean' ? out.start : fromStill(out);
  if (validGhost(st, circuits) && st.circuit === out.circuit && !out.start) out.standing = { ...st, start: true, modified: out.modified };
  return out;
}
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export const packGhost = (g, standing = null) => pipe(new TextEncoder().encode(ghostFile(g, standing)), new CompressionStream('gzip'));
export async function unpackGhost(bytes, circuits) {
  try {
    const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = new TextDecoder().decode(gz ? await pipe(bytes, new DecompressionStream('gzip')) : bytes);
    return readGhostFile(text, circuits);
  } catch (e) { return null; }
}
