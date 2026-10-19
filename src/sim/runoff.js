// Run-off layout: what lies beside the road at every sample, on each side (0 = left, −N; 1 = right, +N), as lateral
// distances from the centre line. The physics (car.js: surface, walls) and the renderer (world.js) both read it.
//   kerb    outer edge of the painted kerb (= HW where there is none)
//   sausage 1 = a raised sausage kerb right behind the kerb (chicanes)
//   turf    outer edge of the artificial-grass strip (= kerb where there is none)
//   gravel  where the gravel starts (Infinity = none); between turf and gravel lies `zone` (ZONE: grass / tarmac)
//   wall    the barrier line; `barrier` its type (BARRIER)
// Built from the corners (RUNOFF: their apex speed and braking zone pick the kind of run-off), ramped smoothly along
// the track, and kept from reaching into the run-off of another part of the track or folding over inside a corner.
import { RUNOFF, BARRIER, ZONE, OFFTRACK, PIT } from './tuning.js';

// The pit lane's span in samples (unwrapped: may run past N), from the `pits` landmark: entry road from `entry`, pit
// wall from `from` to `to`, exit road until `exit`. null without pits.
export function pitRange(track) {
  const p = track.landmarks.pits; if (p === undefined) return null;
  const from = p - RUNOFF.landmarkSpan, to = p + RUNOFF.landmarkSpan;
  return { entry: from - PIT.entry, from, to, exit: to + PIT.exit };
}
// pit roads: entry and exit, on the right; the outer barrier beyond the road (m from the centre line)
const pitRoadWall = HW => HW + RUNOFF.pitWall + PIT.fast + 4;

const CLASSES = ['straight', 'inside', 'fast', 'medium', 'slow'];

export function buildRunoff(track, style = 'permanent') {
  const { N, ds, HW, KERB, K, CK, KERB_K, VP, landmarks } = track, S = RUNOFF[style] || RUNOFF.permanent;
  const at = i => (i % N + N) % N;
  // per sample: the corner's apex speed (lowest planned speed within the corner span) and the speed scrubbed before it
  const span = 20, apex = new Float32Array(N), scrub = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let lo = Infinity; for (let o = -span; o <= span; o++) lo = Math.min(lo, VP[at(i + o)]);
    let hi = 0; for (let o = -100; o <= 0; o++) hi = Math.max(hi, VP[at(i + o)]);
    apex[i] = lo; scrub[i] = Math.max(0, hi - lo);
  }
  const corner = i => Math.abs(CK[i]) > KERB_K;
  const chicane = i => { if (!corner(i)) return false;
    for (let o = -RUNOFF.chicane; o <= RUNOFF.chicane; o++) { const k = CK[at(i + o)]; if (Math.abs(k) > KERB_K && k * CK[i] < 0) return true; } return false; };

  const sides = [0, 1].map(side => {
    const s = side ? 1 : -1;
    const kerb = new Float32Array(N), turf = new Float32Array(N), gravel = new Float32Array(N), wall = new Float32Array(N);
    const zone = new Uint8Array(N), barrier = new Uint8Array(N), sausage = new Uint8Array(N), cls = new Uint8Array(N);
    // 1. the wanted layout from the corner class
    for (let i = 0; i < N; i++) {
      const outside = corner(i) && s * CK[i] < 0, inside = corner(i) && !outside;
      const c = !corner(i) ? 'straight' : inside ? 'inside' : apex[i] > RUNOFF.fast ? 'fast' : apex[i] > RUNOFF.slow ? 'medium' : 'slow';
      cls[i] = CLASSES.indexOf(c);
      wall[i] = HW + S[c].wall + (outside ? S.heavy * scrub[i] : 0);
    }
    // 2. ramps: the barrier distance changes at most `slope` m per m before a corner and `exitSlope` after it (cars
    //    leave the track on the exit); a sample reached by a corner's ramp takes that corner's kind of run-off
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < N; k++) { const i = at(k), p = at(k - 1), w = wall[p] - RUNOFF.exitSlope * ds; if (w > wall[i]) { wall[i] = w; cls[i] = cls[p]; } }
      for (let k = N - 1; k >= 0; k--) { const i = at(k), n = at(k + 1), w = wall[n] - RUNOFF.slope * ds; if (w > wall[i]) { wall[i] = w; cls[i] = cls[n]; } }
    }
    // 3. the main straight: pit wall beside the pits (and the pit roads before / after it: their outer barrier, set
    //    again after the smoothing), concrete + debris fence in front of the grandstand
    const near = (l, i) => l !== undefined && Math.min(at(i - l), at(l - i)) <= RUNOFF.landmarkSpan;
    const pr = pitRange(track), within = (i, a, b) => pr && at(i - a) <= b - a;
    const fixed = i => s > 0 && pr ? within(i, pr.from, pr.to) ? HW + RUNOFF.pitWall : within(i, pr.entry, pr.exit) ? pitRoadWall(HW) : 0 : 0;
    for (let i = 0; i < N; i++) {
      if (s > 0 && pr && within(i, pr.entry, pr.exit)) { wall[i] = fixed(i); cls[i] = within(i, pr.from, pr.to) ? 255 : 253; }
      else if (s < 0 && near(landmarks.grandstand, i)) { wall[i] = Math.min(wall[i], HW + RUNOFF.standWall); cls[i] = 254; }
    }
    // 4. room: never past the half-way line to another part of the track, never folding over inside a tight corner
    const free = freeDistance(track, side, wall);
    for (let i = 0; i < N; i++) {
      let w = Math.min(wall[i], free[i]);
      let kmax = 0; for (let o = -12; o <= 12; o++) { const k = K[at(i + o)]; if (s * k > 0) kmax = Math.max(kmax, Math.abs(k)); }
      if (kmax > 0) w = Math.min(w, 0.9 / kmax);
      wall[i] = Math.max(HW + KERB + 1.5, w);
    }
    for (let pass = 0; pass < 2; pass++) {                                  // smooth the cuts back into ramps
      for (let k = 0; k < N; k++) { const i = at(k), p = at(k - 1); wall[i] = Math.min(wall[i], wall[p] + 0.5 * ds); }
      for (let k = N - 1; k >= 0; k--) { const i = at(k), n = at(k + 1); wall[i] = Math.min(wall[i], wall[n] + 0.5 * ds); }
    }
    for (let i = 0; i < N; i++) if (fixed(i)) wall[i] = Math.min(fixed(i), Math.max(free[i], HW + RUNOFF.pitWall));   // the pit wall starts with a nose
    // 5. the strips
    for (let i = 0; i < N; i++) {
      // kerbs where the road curves, and on the outside they run on past the corner exit (as on real circuits)
      let kerbed = Math.abs(K[i]) > KERB_K;
      for (let o = 1; o <= RUNOFF.exitKerb && !kerbed; o++) { const k = K[at(i - o)]; if (Math.abs(k) > KERB_K && s * k < 0) kerbed = true; }
      const c = cls[i];
      if (c === 253) kerbed = false;                                         // the pit roads leave / join the track flat
      kerb[i] = kerbed ? HW + KERB : HW;
      sausage[i] = style !== 'street' && corner(i) && s * CK[i] > 0 && chicane(i) && Math.abs(K[i]) > 0.6 * Math.abs(CK[i]) ? 1 : 0;
      const pit = c >= 253, def = pit ? { zone: 'tarmac', barrier: 'concrete' } : S[CLASSES[c]];
      turf[i] = kerbed && style !== 'street' && !pit ? Math.min(wall[i] - 1, kerb[i] + RUNOFF.turf) : kerb[i];
      zone[i] = ZONE[def.zone];
      gravel[i] = def.gravel !== undefined ? turf[i] + def.gravel : wall[i];   // wall = no gravel (for now)
      barrier[i] = BARRIER[def.barrier];
    }
    // the gravel's inner edge as a smooth line (no steps where the kind of run-off changes); a strip under 2 m: none
    const g0 = Float32Array.from(gravel), W = RUNOFF.gravelSmooth;
    for (let i = 0; i < N; i++) {
      let sum = 0; for (let o = -W; o <= W; o++) sum += Math.min(g0[at(i + o)], wall[at(i + o)]);
      const g = Math.max(turf[i], sum / (2 * W + 1));
      gravel[i] = g0[i] < wall[i] && wall[i] - g >= 2 ? g : Infinity;
    }
    return { kerb, sausage, turf, zone, gravel, wall, barrier, cls };
  });
  return sides;
}

// For each sample of one side: how far out from the centre line the barrier may go before it is closer to another
// part of the track (more than `win` metres along it) than to this one. Uses a grid of the samples.
function freeDistance(track, side, wanted) {
  const { N, ds, PX, PZ, NX, NZ, HW } = track, s = side ? 1 : -1, CELL = 32, grid = new Map();
  const key = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  for (let j = 0; j < N; j++) { const k = key(PX[j], PZ[j]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(j); }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let d = HW, ok = HW;
    for (; d <= wanted[i] + 0.01; d += 1) {
      const x = PX[i] + NX[i] * s * d, z = PZ[i] + NZ[i] * s * d, win = (2 * d + 10) / ds;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      let clash = false;
      for (let a = -1; a <= 1 && !clash; a++) for (let b = -1; b <= 1 && !clash; b++) {
        for (const j of grid.get((cx + a) + ',' + (cz + b)) || []) {
          const along = Math.min((j - i + N) % N, (i - j + N) % N);
          if (along <= win) continue;
          if (Math.hypot(x - PX[j], z - PZ[j]) < d + 1) { clash = true; break; }
        }
      }
      if (clash) break;
      ok = d;
    }
    out[i] = d > wanted[i] ? wanted[i] : ok;
  }
  return out;
}

// The run-off at one point: side and lateral distance → surface name and, in gravel, how deep the car is in it.
export function surfaceAt(track, i, lat) {
  const R = track.runoff[lat < 0 ? 0 : 1], a = Math.abs(lat);
  if (a <= track.HW) return { surface: 'track', depth: 0 };
  if (a <= R.kerb[i]) return { surface: 'kerb', depth: 0 };
  if (R.sausage[i] && a <= R.kerb[i] + OFFTRACK.sausageWidth) return { surface: 'sausage', depth: 0 };
  if (a <= R.turf[i]) return { surface: 'turf', depth: 0 };
  if (a <= R.gravel[i]) return { surface: R.zone[i] === ZONE.tarmac ? 'tarmac' : 'grass', depth: 0 };
  return { surface: 'gravel', depth: a - R.gravel[i] };
}
