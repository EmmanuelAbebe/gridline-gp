// Is the phone still in the driver's hands? (pure; tested in test/presence.test.ts). 2026-10-21, user: when the phone
// is resting on a table, or the inputs change violently (dropped, thrown), stop streaming inputs and ask "are you
// there?". Fed every devicemotion sample (accelerationIncludingGravity in m/s², rotationRate in °/s):
//   put down (1): lying flat (gravity straight through the screen) AND still (no turning, no shake) for `flatFor` ms.
//                 A phone held as a wheel is upright-ish, and hands always tremble a little.
//   dropped (2):  falling (well under 1 g) for `fallFor` ms, a jolt over `jolt` (3 g), or spinning over `spin` °/s.
//                 Hard steering stays far under these.
// Once away it stays away until the driver taps "I'm here" (back()).
export const PRESENCE = {
  flat: 0.93,           // share of gravity on the screen's axis that counts as lying flat
  stillTurn: 6,         // °/s of rotation below which the phone counts as still
  stillShake: 0.35,     // m/s² of change in the acceleration between samples below which it is still
  flatFor: 1500,        // ms flat and still → put down
  fallBelow: 2.5,       // m/s² total: falling
  fallFor: 80,          // ms
  jolt: 30,             // m/s² (~3 g)
  spin: 720,            // °/s
};
export type Away = 0 | 1 | 2;
export interface MotionSample { ax: number; ay: number; az: number; rate: number }   // rate = |rotation| °/s

export function createPresence(P = PRESENCE) {
  let away: Away = 0, flatSince = -1, fallSince = -1, last: MotionSample | null = null;
  return {
    get away() { return away; },
    sample(m: MotionSample, now: number): Away {
      if (away) return away;
      const g = Math.hypot(m.ax, m.ay, m.az);
      // dropped / thrown
      if (g < P.fallBelow) { if (fallSince < 0) fallSince = now; if (now - fallSince >= P.fallFor) away = 2; } else fallSince = -1;
      if (g > P.jolt || m.rate > P.spin) away = 2;
      // resting flat and still
      const shake = last ? Math.hypot(m.ax - last.ax, m.ay - last.ay, m.az - last.az) : 0;
      last = m;
      const flat = g > 7 && Math.abs(m.az) >= P.flat * g, still = m.rate < P.stillTurn && shake < P.stillShake;
      if (flat && still) { if (flatSince < 0) flatSince = now; if (now - flatSince >= P.flatFor) away = 1; } else flatSince = -1;
      return away;
    },
    // "I'm here"
    back() { away = 0; flatSince = fallSince = -1; last = null; },
  };
}
