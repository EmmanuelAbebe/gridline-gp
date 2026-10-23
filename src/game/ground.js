// The ground of a hilly circuit (track.elev, sim elevation.js): its height anywhere, for the terrain mesh, the
// scenery and anything else standing on it. Render-only: the cars drive on the sim's road surface (SIM.surfaceY),
// and inside the barriers the ground is that surface, flat beyond the road's edges, as the physics has it.
//   near the track: the road's edge height out to the barrier + `flat` m (more beside the pits and the grandstand);
//   then over `blend` m into the land: the track's heights spread out (a Gaussian average, so valleys and hills carry
//   on beside the road) + rolling noise growing with the distance.
// A bridge (a figure of eight): samples of the upper road that pass over another part of the track are `bridge`; the
// ground there follows the road below (world.js draws the deck and its pillars).
// Pure (no Three.js): tests can load it.
import { SIM } from '../sim/index.js';

export const GROUND = Object.freeze({
  flat: 20, pits: 26, stand: 34,   // m of level ground beyond the barrier (everywhere / the pit side of the pits / the grandstand)
  blend: 90,                       // m over which it turns into the land
  spread: 260,                     // m: the Gaussian that spreads the track's heights into the land
  noise: 14, noiseFrom: 60, noiseFull: 170,   // m of rolling hills, growing from noiseFrom to noiseFull m from the track (= the search reach)
  under: 0.12,                     // m the ground stays below the road and run-off (the strips are drawn on top)
  deep: 8,                         // + this × tan(bank) m under a banked road (> the terrain's grid step: world.js TERRAIN)
  every: 2, keep: 1, band: 60, fade: 20,   // the samples blended (every n-th), m behind a barrier where only its part
                                   // counts; only samples within `band` m of the nearest one's distance, their weight fading
                                   // over `fade` m toward that and the search reach (noiseFull)
  bridgeGap: 6, bridgeReach: 34,   // m of height between two parts of the track that makes the upper one a bridge; how far past
                                   // the lower road's barriers the bridge reaches (its earth banks start there)
  cell: 40,
});

// smooth value noise (deterministic: the same hills every time)
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z) => (noise(x / 380, z / 380) - 0.5) + 0.5 * (noise(x / 150 + 17, z / 150 + 5) - 0.5) + 0.2 * (noise(x / 60 + 3, z / 60 + 11) - 0.5);

/** @param {import('../sim/types.js').Track} track */
export function createGround(track) {
  const E = track.elev;
  if (!E) return { flat: true, at: () => 0, inside: () => false, bridge: new Uint8Array(track.N), lo: 0, hi: 0 };
  const { N, PX, PZ, NX, NZ, runoff, landmarks } = track, G = GROUND, at = i => SIM.wrapIdx(i, N);
  // bridges: a sample of the upper road over another part of the track (far along it, close in plan, lower)
  const cells = new Map(), key = (x, z) => Math.floor(x / G.cell) + ',' + Math.floor(z / G.cell);
  for (let i = 0; i < N; i++) { const k = key(PX[i], PZ[i]); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); }
  const nearby = (x, z, r, fn) => {
    const cx = Math.floor(x / G.cell), cz = Math.floor(z / G.cell), n = Math.ceil(r / G.cell);
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (const i of cells.get((cx + a) + ',' + (cz + b)) || []) fn(i);
  };
  // the nearest sample (not on a bridge) within `r` m: ring by ring outward, stopping once no nearer one can follow;
  // `skip(i)` leaves samples out (the other part of the track: away from sample `from` along it)
  const nearest = (x, z, r, skip = null) => {
    const cx = Math.floor(x / G.cell), cz = Math.floor(z / G.cell), n = Math.ceil(r / G.cell);
    let best = r * r, bi = -1;
    for (let ring = 0; ring <= n; ring++) {
      for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
        for (const i of cells.get((cx + a) + ',' + (cz + b)) || []) {
          if (bridge[i] || (skip && skip(i))) continue;
          const d = (x - PX[i]) ** 2 + (z - PZ[i]) ** 2; if (d < best) { best = d; bi = i; }
        }
      }
      if (bi >= 0 && Math.sqrt(best) < ring * G.cell) break;
    }
    return [bi, Math.sqrt(best)];
  };
  const bridge = new Uint8Array(N);
  for (let i = 0; i < N; i++) nearby(PX[i], PZ[i], 60, j => {
    const along = Math.min(at(j - i), at(i - j));
    if (along * track.ds < 200) return;
    const reach = Math.max(runoff[0].wall[j], runoff[1].wall[j]) + G.bridgeReach;
    if (Math.hypot(PX[i] - PX[j], PZ[i] - PZ[j]) < reach && E.Y[i] - E.Y[j] > G.bridgeGap) bridge[i] = 1;
  });
  // how far the level ground reaches on each side of each sample
  const pitFrom = track.pit ? track.pit.entry : 0, pitTo = track.pit ? track.pit.exit : -1;
  const inPit = i => track.pit && at(i - pitFrom) <= pitTo - pitFrom;
  const level = [0, 1].map(side => Float32Array.from({ length: N }, (_, i) => {
    let r = runoff[side].wall[i] + G.flat;
    if (side === 1 && inPit(i)) r = Math.max(r, track.pit.garageLat + G.pits);
    if (side === 0 && landmarks.grandstand !== undefined && Math.min(at(i - landmarks.grandstand), at(landmarks.grandstand - i)) < 45) r = Math.max(r, runoff[0].wall[i] + G.stand);
    return r;
  }));
  // the land's own height: the track's heights spread out (every 4th sample)
  const pts = []; for (let i = 0; i < N; i += 4) if (!bridge[i]) pts.push([PX[i], PZ[i], E.Y[i]]);
  const s2 = 2 * G.spread * G.spread, mid = (E.lo + E.hi) / 2;
  const landExact = (x, z) => { let w = 0, h = 0; for (const [px, pz, y] of pts) { const k = Math.exp(-((x - px) ** 2 + (z - pz) ** 2) / s2); w += k; h += k * y; } return w > 1e-9 ? h / w : mid; };
  // (on a coarse grid, filled as it is needed: it only varies over hundreds of metres)
  const LC = 40, landGrid = new Map();
  const landAt = (gx, gz) => { const k = gx + ',' + gz; let v = landGrid.get(k); if (v === undefined) { v = landExact(gx * LC, gz * LC); landGrid.set(k, v); } return v; };
  const land = (x, z) => {
    const gx = Math.floor(x / LC), gz = Math.floor(z / LC), fx = x / LC - gx, fz = z / LC - gz;
    const a = landAt(gx, gz), b = landAt(gx + 1, gz), c = landAt(gx, gz + 1), d = landAt(gx + 1, gz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  // height at (x, z): a weighted blend of what each track sample nearby (every `every`-th, not a bridge's) says the
  // height is: its road surface at the point's foot (so every sample of one stretch agrees), level ground out to its
  // reach, then over `blend` m into the land. A sample weighs 1 / (u² + 0.01), u = how far past its barrier (+ `keep` m)
  // the point is: inside a part's barriers only that part counts, and between two parts at different heights (a
  // hairpin's legs, the loops of a figure of eight) the ground slopes from one to the other with no step anywhere.
  const cand = [], blendCells = new Map();
  const nkey = (cx, cz) => (cx + 4096) * 8192 + cz + 4096;            // (a number: faster than the string keys)
  for (let i = 0; i < N; i += G.every) if (!bridge[i]) { const k = nkey(Math.floor(PX[i] / G.cell), Math.floor(PZ[i] / G.cell)); if (!blendCells.has(k)) blendCells.set(k, []); blendCells.get(k).push(i); }
  function heightAt(x, z) {
    const far = land(x, z), R = G.noiseFull, cx = Math.floor(x / G.cell), cz = Math.floor(z / G.cell), n = Math.ceil(R / G.cell);
    let dmin = R * R; cand.length = 0;
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (const i of blendCells.get(nkey(cx + a, cz + b)) || []) {
      const d = (x - PX[i]) ** 2 + (z - PZ[i]) ** 2; if (d >= R * R) continue;
      cand.push(i, d); if (d < dmin) dmin = d;
    }
    const noise = G.noise * fbm(x, z);
    if (!cand.length) return far + noise;
    dmin = Math.sqrt(dmin);
    const rough = noise * SIM.smoothstep((dmin - G.noiseFrom) / (G.noiseFull - G.noiseFrom));
    let wsum = 1 / (R * R), hsum = wsum * (far + rough);
    for (let k = 0; k < cand.length; k += 2) {
      const i = cand[k], d2 = cand[k + 1]; if (d2 > (dmin + G.band) ** 2) continue;
      const d = Math.sqrt(d2);
      const along = (x - PX[i]) * track.TX[i] + (z - PZ[i]) * track.TZ[i], lat = (x - PX[i]) * NX[i] + (z - PZ[i]) * NZ[i];
      const side = lat < 0 ? 0 : 1, a = Math.abs(lat), wall = runoff[side].wall[i], reach = level[side][i];
      const edge = SIM.surfaceY(track, i + along / track.ds, lat);
      // (under the road itself deeper on a banked road: the terrain's triangles span its edge, where the tilted road
      // meets the flat run-off, and would poke up through the kerb there)
      const h = a <= reach ? edge - (a < track.HW ? G.under + G.deep * Math.abs(Math.tan(E.BANK[i])) : a <= wall + 0.5 ? G.under : 0)
        : edge + (far + rough - edge) * SIM.smoothstep((a - reach) / G.blend);
      const u = Math.max(0, Math.hypot(Math.max(0, a - wall), along) - G.keep);
      const w = SIM.smoothstep(Math.min(R - d, dmin + G.band - d) / G.fade) / (u * u + 0.01);
      wsum += w; hsum += w * h;
    }
    return hsum / wsum;
  }
  // inside the barriers of a part of the track that is not a bridge (where a bridge's pillar mustn't stand)
  const inside = (x, z) => { const [bi] = nearest(x, z, 60); if (bi < 0) return false;
    const lat = (x - PX[bi]) * NX[bi] + (z - PZ[bi]) * NZ[bi]; return Math.abs(lat) < runoff[lat < 0 ? 0 : 1].wall[bi] + 1; };
  return { flat: false, at: heightAt, inside, bridge, lo: E.lo, hi: E.hi };
}
