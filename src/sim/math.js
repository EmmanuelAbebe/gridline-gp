export const wrapA = a => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// an index wrapped into 0..N-1 (track samples), for any integer, negative too
export const wrapIdx = (i, N) => (i % N + N) % N;
// 0..1 → 0..1 with zero slope at both ends (t is clamped)
export const smoothstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// seeded random numbers 0..1 (mulberry32): each race has its own (race.rng), so the same seed = the same race
export function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// a car's speed over the ground: forward and sideways (a sliding or spinning car)
export const speedOf = c => Math.hypot(c.v, c.vy || 0);
