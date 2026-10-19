// Ghost laps and time trial (pure: no DOM, no Three.js; main.js stores them through Settings, tests/ghost.test.js).
// A ghost = one valid lap: the car's pose sampled at GHOST.hz from the line to the line, plus the lap time at every
// GHOST.split track samples (for the live delta). Kept per circuit and car class (stock / modified, like the lap
// records): your best, and one loaded from a file (a friend's).
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
      return { v: GHOST.version, time, ...meta, date: meta.date ?? null, hz: GHOST.hz, split: GHOST.split, frames, splits };
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

// ---- storage: { [circuit]: { stock?: ghost, modified?: ghost } }, the same for the loaded ones ----
export function validGhost(g, circuits) {
  if (!g || typeof g !== 'object' || g.v !== GHOST.version || !(g.time > 0) || !Object.hasOwn(circuits, g.circuit)) return false;
  if (!Array.isArray(g.frames) || g.frames.length % 3 || g.frames.length < 9 || !g.frames.every(Number.isFinite)) return false;
  return Array.isArray(g.splits) && g.hz > 0 && g.split > 0;
}
export function loadGhosts(json, circuits) {
  let s; try { s = JSON.parse(json); } catch (e) { return {}; }
  const out = {};
  if (s && typeof s === 'object') for (const [id, r] of Object.entries(s)) for (const k of ['stock', 'modified'])
    if (r && validGhost(r[k], circuits) && r[k].circuit === id) (out[id] ||= {})[k] = r[k];
  return out;
}
const cls = modified => modified ? 'modified' : 'stock';
export const ghostOf = (store, circuit, modified) => store[circuit]?.[cls(modified)] ?? null;
// keeps `g` when it is the first or faster; true when it was kept
export function keepGhost(store, g) {
  const k = cls(g.modified), old = store[g.circuit]?.[k];
  if (old && old.time <= g.time) return false;
  (store[g.circuit] ||= {})[k] = g;
  return true;
}
export function dropGhost(store, circuit, modified) { if (store[circuit]) delete store[circuit][cls(modified)]; }

// ---- files (export / import a ghost: send your lap to a friend) ----
export const ghostFile = g => JSON.stringify({ gridlineGhost: GHOST.version, ...g });
export function readGhostFile(text, circuits) {
  let g; try { g = JSON.parse(text); } catch (e) { return null; }
  if (!g || g.gridlineGhost !== GHOST.version) return null;
  delete g.gridlineGhost;
  return validGhost(g, circuits) ? g : null;
}
