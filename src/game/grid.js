// The starting grid by lap time (2026-10-28; user: "instead of putting the player in a specific position every time …
// use the player's fastest time to determine the start position against the class of drivers", plus qualifying).
// The rivals' times = each one's own lap alone at the race's level (ai-ghosts.js driverLap), yours = your best valid
// lap there (the lap record for your car class and zone layout) or your best in qualifying. Fastest first; no time =
// the back. Qualifying: a timed session alone on the circuit; the rivals' laps come in on the timing screen as the
// session runs (a first run, then their best). Pure: no DOM, no storage; tests/grid.test.js.
import { SIM } from '../sim/index.js';

export const GRID_RULES = Object.freeze({
  // qualifying: each rival sets a first time (slower by `first` s) in the first window of the session, its best in the second
  first: [0.4, 1.4], firstAt: [0.12, 0.42], bestAt: [0.55, 0.92],
});

// the rivals in a race of `cars` cars: the fastest cars − 1 (as they always were)
export const rivalsOf = cars => SIM.DRIVERS.filter(d => !d.player).slice(0, Math.max(0, cars - 1));
// the fastest rival driver of them (their ALIEN pace gap is to this one: SIM race.aiTop)
export const topSkill = rivals => Math.max(0, ...rivals.map(d => d.skill));

const timeOf = t => Number.isFinite(t) && t > 0 ? t : Infinity;
// The grid in order (slot 0 = pole): rivals by time (no time: after the others, fastest driver first), you in front of
// the first rival slower than you (a tie goes to the rival: it set the time first); no time = last.
// times: { code: seconds | null }
export function gridOrder(rivals, times, you, yourTime) {
  const order = [...rivals].sort((a, b) => timeOf(times[a.code]) - timeOf(times[b.code]) || b.skill - a.skill);
  const t = timeOf(yourTime), at = order.findIndex(d => timeOf(times[d.code]) > t);
  order.splice(t === Infinity || at < 0 ? order.length : at, 0, you);
  return order;
}

// small seeded numbers for the qualifying timing (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const within = (r, [a, b]) => a + (b - a) * r();
// When each rival's laps show up in a qualifying session of `duration` s: { code: [{ at, time }, …] } (none without a time)
export function qualiPlan(rivals, times, duration, seed) {
  const r = rng(seed), out = {};
  for (const d of rivals) {
    const t = times[d.code];
    out[d.code] = Number.isFinite(t) && t > 0 ? [{ at: duration * within(r, GRID_RULES.firstAt), time: t + within(r, GRID_RULES.first) },
      { at: duration * within(r, GRID_RULES.bestAt), time: t }] : [];
  }
  return out;
}
// The timing screen at session time `now`: [{ driver, time (best so far or null), gap to P1 }] fastest first, you
// included (your best this session: yourTime)
export function qualiStandings(rivals, plan, now, you, yourTime) {
  const rows = rivals.map(d => {
    const laps = (plan[d.code] || []).filter(l => l.at <= now);
    return { driver: d, time: laps.length ? Math.min(...laps.map(l => l.time)) : null };
  });
  rows.push({ driver: you, time: Number.isFinite(yourTime) && yourTime > 0 ? yourTime : null });
  rows.sort((a, b) => timeOf(a.time) - timeOf(b.time) || (a.driver.player ? 1 : b.driver.player ? -1 : 0) || b.driver.skill - a.driver.skill);
  const pole = rows[0]?.time;
  for (const row of rows) row.gap = row.time !== null && pole ? row.time - pole : null;
  return rows;
}
