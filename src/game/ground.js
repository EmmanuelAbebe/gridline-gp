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
  // the nearest sample (not on a bridge) within `r` m: ring by ring outward, stopping once no nearer one can follow
  const nearest = (x, z, r) => {
    const cx = Math.floor(x / G.cell), cz = Math.floor(z / G.cell), n = Math.ceil(r / G.cell);
    let best = r * r, bi = -1;
    for (let ring = 0; ring <= n; ring++) {
      for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
        for (const i of cells.get((cx + a) + ',' + (cz + b)) || []) {
          if (bridge[i]) continue;
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
  // height at (x, z)
  function heightAt(x, z) {
    const [bi, d] = nearest(x, z, 170), far = land(x, z);
    const rough = G.noise * fbm(x, z) * SIM.smoothstep((d - G.noiseFrom) / (G.noiseFull - G.noiseFrom));
    if (bi < 0) return far + G.noise * fbm(x, z);
    const lat = (x - PX[bi]) * NX[bi] + (z - PZ[bi]) * NZ[bi], side = lat < 0 ? 0 : 1, a = Math.abs(lat);
    const edge = SIM.surfaceY(track, bi, lat), reach = level[side][bi];
    if (a <= reach) return edge - (a <= runoff[side].wall[bi] + 0.5 ? G.under : 0);
    return edge + (far + rough - edge) * SIM.smoothstep((a - reach) / G.blend);
  }
  // inside the barriers of a part of the track that is not a bridge (where a bridge's pillar mustn't stand)
  const inside = (x, z) => { const [bi] = nearest(x, z, 60); if (bi < 0) return false;
    const lat = (x - PX[bi]) * NX[bi] + (z - PZ[bi]) * NZ[bi]; return Math.abs(lat) < runoff[lat < 0 ? 0 : 1].wall[bi] + 1; };
  return { flat: false, at: heightAt, inside, bridge, lo: E.lo, hi: E.hi };
}
