// Sectors and corners of a circuit (2026-10-26; SECTORS in tuning.js): where a lap is split for timing. Found from the
// ALIEN line's speed profile (the main AI line where a circuit has none), so every circuit gets them without data:
// corners = the slow points of the profile, a corner's mini-sector = its braking point to the next corner's (the
// fastest point of the lap between them: the end of a straight), and the sectors split at the braking points nearest
// equal shares of the lap. The lap starts at sample 0 (the line), so the piece from the line to the first braking point
// is a mini-sector of its own ('start').
import { SECTORS, CAR, ERS } from './tuning.js';
import { STOCK } from './spec.js';
import { wrapIdx } from './math.js';
/** @typedef {import('./types.js').Track} Track */

/**
 * @typedef {{ n: number, name: string, apex: number, from: number }} Corner   (from = its braking point's sample)
 * @typedef {{ name: string, corner: number, from: number, to: number }} Mini  (samples from..to, to may be N = the line)
 * @typedef {{ from: number, to: number, minis: number[] }} Sector
 * @typedef {{ corners: Corner[], minis: Mini[], sectors: Sector[], key: string, N: number }} Layout
 */
const cache = new WeakMap();

/** @param {Track} track @returns {Layout} */
export function buildSectors(track) {
  if (cache.has(track)) return cache.get(track);
  const { N, ds } = track, P = (track.alien || track).VP, S = SECTORS;
  // the speed the car really reaches: the profile is only a cap (V_CAP on straights), so an acceleration pass with the
  // power unit's full power and the drag (twice round: the lap's start depends on its end) leaves the bends the car
  // takes flat out above the profile's dips, which are then no corners
  const power = Math.max(...CAR.engine.power.map(p => p[1])) * CAR.engine.efficiency + ERS.kw, VP = Float64Array.from(P), full = Infinity;
  for (let p = 0; p < 2; p++) for (let i = 0; i < N; i++) {
    const j = wrapIdx(i - 1, N), v = Math.max(5, VP[j]), a = Math.min(S.launch, power * 1000 / (STOCK.mass * v)) - STOCK.dragK * v * v;
    VP[i] = Math.min(P[i], Math.sqrt(Math.max(0, v * v + 2 * a * ds)));
  }
  // the profile's slow points
  let mins = [];
  for (let i = 0; i < N; i++) if (VP[i] < full && VP[i] <= VP[wrapIdx(i - 1, N)] && VP[i] < VP[wrapIdx(i + 1, N)]) mins.push(i);
  // the fastest point between two slow points (going forward from a to b)
  const peak = (a, b) => { let m = 0; for (let j = a; j !== b; j = wrapIdx(j + 1, N)) m = Math.max(m, VP[j]); return m; };
  // merge neighbours the car barely accelerates between (one corner: the slower apex, braking from the first one's)
  let groups = mins.map(i => ({ apex: i, first: i }));
  for (let changed = true; changed && groups.length > 1;) {
    changed = false;
    for (let k = 0; k < groups.length; k++) {
      const a = groups[k], b = groups[(k + 1) % groups.length];
      if (a === b || peak(a.apex, b.apex) - Math.max(VP[a.apex], VP[b.apex]) >= S.merge) continue;
      const keep = { apex: VP[b.apex] < VP[a.apex] ? b.apex : a.apex, first: a.first };
      groups.splice(k, 1, keep); groups.splice(groups.indexOf(b), 1); changed = true; break;
    }
  }
  // no corner where the speed hardly drops (from the fastest point since the corner before)
  groups = groups.filter((g, k) => groups.length < 2 || peak(groups[wrapIdx(k - 1, groups.length)].apex, g.first) - VP[g.apex] >= S.minDrop);
  if (!groups.length) groups = [{ apex: 0, first: 0 }];
  // braking point: back from the group's first apex while the speed keeps rising backwards
  const corners = groups.map(g => { let j = g.first;
    for (let k = 0; k < N && VP[wrapIdx(j - 1, N)] > VP[j] && VP[j] < full; k++) j = wrapIdx(j - 1, N);
    return { apex: g.apex, from: j }; })
    .sort((a, b) => a.from - b.from).map((c, k) => ({ n: k + 1, name: 'T' + (k + 1), ...c }));
  // mini-sectors: line → first braking point, then corner by corner to the line
  const minis = [];
  if (corners[0].from > 0) minis.push({ name: 'start', corner: -1, from: 0, to: corners[0].from });
  corners.forEach((c, k) => minis.push({ name: c.name, corner: k, from: c.from, to: k + 1 < corners.length ? corners[k + 1].from : N }));
  // sectors: split at the mini boundaries nearest equal shares of the profile's lap time
  const T = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) T[i + 1] = T[i] + ds / Math.max(1, VP[i]);
  const cuts = [];
  for (let s = 1; s < S.count; s++) {
    const want = T[N] * s / S.count;
    let best = -1;
    for (let m = 1; m < minis.length; m++) if (!cuts.includes(m) && (best < 0 || Math.abs(T[minis[m].from] - want) < Math.abs(T[minis[best].from] - want))) best = m;
    if (best > 0) cuts.push(best);
  }
  cuts.sort((a, b) => a - b);
  const edges = [0, ...cuts, minis.length], sectors = [];
  for (let s = 0; s + 1 < edges.length; s++) {
    const ids = []; for (let m = edges[s]; m < edges[s + 1]; m++) ids.push(m);
    if (ids.length) sectors.push({ from: minis[ids[0]].from, to: minis[ids[ids.length - 1]].to, minis: ids });
  }
  // (key: saved best sector times only compare with the same layout)
  const layout = { corners, minis, sectors, N, key: `${N}:${minis.map(m => m.from).join('.')}:${cuts.join('.')}` };
  cache.set(track, layout);
  return layout;
}
