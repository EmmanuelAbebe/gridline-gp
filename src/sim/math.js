export const wrapA = a => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// an index wrapped into 0..N-1 (track samples), for any integer, negative too
export const wrapIdx = (i, N) => (i % N + N) % N;
// 0..1 → 0..1 with zero slope at both ends (t is clamped)
export const smoothstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// a car's speed over the ground: forward and sideways (a sliding or spinning car)
export const speedOf = c => Math.hypot(c.v, c.vy || 0);
