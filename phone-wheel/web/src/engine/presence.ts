// Is the phone still in the driver's hands? (pure; tested in test/presence.test.ts). 2026-10-21, user: when the phone
// is resting on a table, stop streaming inputs and ask "are you there?". Then (user: spinning the phone set off the
// first "dropped / thrown" check) only these two, each after 10 s:
//   on a table:  lying flat (gravity straight through the screen) and still (no turning, no shake) for `flatFor` ms.
//   left alone:  in any position, stiller than any hand can hold a phone (stand, lap, propped up) for `idleFor` ms.
// Fed every devicemotion sample (accelerationIncludingGravity in m/s², rotationRate in °/s). Once away it stays away
// until the driver taps "I'm here" (back()).
export const PRESENCE = {
  flat: 0.93,           // share of gravity on the screen's axis that counts as lying flat
  stillTurn: 6,         // flat: °/s of rotation below which the phone counts as still
  stillShake: 0.35,     // flat: m/s² of change in the acceleration between samples below which it is still
  flatFor: 10000,       // ms flat and still → on the table
  idleTurn: 1.2,        // any position: stiller than this (°/s) ... (a held phone trembles at a few °/s)
  idleShake: 0.12,      // ... and this (m/s² between samples)
  idleFor: 10000,       // ms → left alone
};
export type Away = 0 | 1;
export interface MotionSample { ax: number; ay: number; az: number; rate: number }   // rate = |rotation| °/s

export function createPresence(P = PRESENCE) {
  let away: Away = 0, flatSince = -1, idleSince = -1, last: MotionSample | null = null;
  const since = (cond: boolean, t: number, now: number) => (cond ? (t < 0 ? now : t) : -1);
  return {
    get away() { return away; },
    sample(m: MotionSample, now: number): Away {
      if (away) return away;
      const g = Math.hypot(m.ax, m.ay, m.az);
      const shake = last ? Math.hypot(m.ax - last.ax, m.ay - last.ay, m.az - last.az) : 0;
      last = m;
      const flat = g > 7 && Math.abs(m.az) >= P.flat * g;
      flatSince = since(flat && m.rate < P.stillTurn && shake < P.stillShake, flatSince, now);
      idleSince = since(m.rate < P.idleTurn && shake < P.idleShake, idleSince, now);
      if ((flatSince >= 0 && now - flatSince >= P.flatFor) || (idleSince >= 0 && now - idleSince >= P.idleFor)) away = 1;
      return away;
    },
    // "I'm here"
    back() { away = 0; flatSince = idleSince = -1; last = null; },
  };
}
