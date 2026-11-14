// Damage in words and seconds (pure; tests/damage-info.test.js). 2026-11-14, the user's pick of the canvas "Gridline damage
// display": E1 = a card at the hit (what broke, what it costs, what to do), E2 = a panel on the right for the rest of the
// race (a car outline, the parts, the cost), D = the pit box's repairs and their time.
// What a part costs a lap: as a share of the lap, measured with the AI driving to the grip it has left (2026-11-14, Harrow,
// VOS, no pit stop: front wing 25 % +0.9 s, 50 % +1.8, 100 % +4.5 of 63.9 s; floor 100 % +1.0; suspension 50 % +0.6,
// 100 % +1.3), × the race's level (LIGHT: the car's dmgK).
import { SIM } from '../sim/index.js';

export const DAMAGE_UI = Object.freeze({
  // [damage, share of the lap] points (straight lines between)
  cost: Object.freeze({ wing: [[0, 0], [0.25, 0.014], [0.5, 0.0288], [1, 0.07]], floor: [[0, 0], [1, 0.016]], susp: [[0, 0], [0.5, 0.0094], [1, 0.02]] }),
  shown: 0.02,          // a part shows from this much damage
  minor: 0.2,           // s a lap: below it the panel is a slim strip
  bad: 0.5,             // s a lap: a part this costly is red (else amber)
  card: 4,              // s the card stays after a hit
  laneLoss: 18,         // s a stop costs in the pit lane beyond the work (a guess for the payback line)
});
const NAMES = { wing: 'Front wing', floor: 'Floor', susp: 'Suspension' };
const at = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (x - a) / (b - a); } return pts[pts.length - 1][1]; };
// a lap's length in s for the costs: your best lap, else your last, else the circuit at the class's guessed speed
export const lapTimeOf = (race, c) => Number.isFinite(c.bestLap) && c.bestLap > 0 ? c.bestLap : c.lastLap > 0 ? c.lastLap : race.track.L / c.spec.cls.wear.lapSpeed;

// { parts: [{ key, name, pct, cost (s a lap), what, level 'minor' | 'bad' }], total, minor, advice, any }
export function damageInfo(race, c) {
  const d = c.damage, k = c.dmgK ?? 1, lap = lapTimeOf(race, c);
  if (!race.wear?.damage || !d) return { parts: [], total: 0, minor: true, advice: '', any: false };
  const what = { wing: 'understeer', floor: 'less downforce', susp: `the car pulls ${c.pullSide > 0 ? 'right' : 'left'}` };
  const parts = ['wing', 'floor', 'susp'].filter(p => d[p] >= DAMAGE_UI.shown).map(p => {
    const cost = at(DAMAGE_UI.cost[p], d[p]) * lap * k;
    return { key: p, name: NAMES[p], pct: Math.round(d[p] * 100), cost, what: what[p], level: cost >= DAMAGE_UI.bad ? 'bad' : 'minor' };
  });
  const total = parts.reduce((a, p) => a + p.cost, 0);
  const wingOff = c.wingOff?.some(Boolean);
  const advice = (d.wing > SIM.PIT.wingFrom || wingOff) && total >= DAMAGE_UI.minor ? 'BOX FOR A NEW NOSE' : total >= DAMAGE_UI.bad ? 'BOX TO FIX IT' : '';
  return { parts, total, minor: total < DAMAGE_UI.minor, advice, any: parts.length > 0 };
}
// what the repairs at a stop take (pit.js service): a new nose, the floor and suspension; s each
export function repairTimes(c) {
  const d = c.damage || { wing: 0, floor: 0, susp: 0 }, P = SIM.PIT;
  return { wing: d.wing > P.wingFrom || c.wingOff?.some(Boolean) ? P.wing : 0, repair: d.floor + d.susp > P.repairFrom ? P.repair * Math.min(1, d.floor + d.susp) : 0 };
}
// a stop for the damage: what it takes, and after how many laps it pays back (null: it never does)
export function payback(race, c, info = damageInfo(race, c)) {
  const r = repairTimes(c), stop = DAMAGE_UI.laneLoss + SIM.PIT.base + r.wing + r.repair;
  const togo = SIM.lapsToGo(race, c);
  return { stop, laps: info.total > 0.05 ? stop / info.total : null, togo };
}
