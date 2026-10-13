// Shared test helpers: seeded randomness and race runners on the fixed 120 Hz sim step.
export const DT = 1 / 120;

export function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Runs fn with Math.random seeded, so AI line biases (set in createCar) are the same every run.
export function seeded(fn, seed = 1) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = real; }
}

// Steps a race with every car driven by `drive(race, car)` until all have finished or `maxSeconds` pass.
// Returns per-car counts of events seen (the queue is drained each step, as the game does).
export function run(S, race, maxSeconds, drive) {
  const seen = new Map(race.cars.map(c => [c, {}]));
  for (let step = 0; step < maxSeconds * 120 && !race.cars.every(c => c.finished); step++) {
    race.t += DT;
    for (const c of race.cars) drive(race, c);
    S.collide(race);
    for (const c of race.cars) { const s = seen.get(c); for (const e of c.events) s[e] = (s[e] || 0) + 1; c.events.length = 0; }
  }
  return seen;
}
export const aiDriver = (S, skills = {}) => (race, c) => S.driveAI(race, c, DT, skills[c.code] || (c.player ? 0.95 : 0));
