// Headless race check for Gridline GP: prints track stats, a full AI race, a scripted player lap and race formats.
// Usage: node tools/sim-test.mjs [path/to/sim/index.js]   (default: the source modules in src/sim)
import { loadSim } from './load-sim.mjs';
import { centreProfile } from '../tests/helpers.js';

const S = await loadSim(process.argv[2]);
const T = S.track, { N, PX, PZ, K, ds, WALL } = T;
const CP = centreProfile(S, T);   // the scripted lap drives the centre line
const countWalls = c => { const n = c.events.filter(e => e.type === S.EV.WALL).length; c.events.length = 0; return n; };

console.log(`${T.name}: track length ${T.L.toFixed(0)} m, sample spacing ${ds.toFixed(2)} m`);
let maxK = 0; for (let i = 0; i < N; i++) maxK = Math.max(maxK, Math.abs(K[i]));
console.log(`tightest corner radius ${(1 / maxK).toFixed(1)} m (walls at ±${WALL} m)`);
let minSep = Infinity;
for (let i = 0; i < N; i += 2) for (let j = 0; j < N; j += 2) {
  let g = Math.abs(i - j); g = Math.min(g, N - g); if (g * ds < 120) continue;
  minSep = Math.min(minSep, Math.hypot(PX[i] - PX[j], PZ[i] - PZ[j]));
}
console.log(`closest approach between distant track parts ${minSep.toFixed(1)} m (needs > ${2 * WALL})`);

// Full AI race (the player car is driven by the AI at 95% skill)
const dt = 1 / 120, race = S.createRace(3);
let walls = 0;
for (let step = 0; step < 120 * 600 && !race.cars.every(c => c.finished); step++) {
  race.t += dt;
  for (const c of race.cars) S.driveAI(race, c, dt, c.player ? 0.95 : 0);
  S.collide(race);
  for (const c of race.cars) walls += countWalls(c);
}
console.log(`\nAI race: ${race.t.toFixed(1)} s, wall hits ${walls}`);
S.order(race).forEach((c, i) => console.log(
  String(i + 1).padStart(2), c.code, c.finished ? c.finishTime.toFixed(2) + ' s' : 'DNF', ' best', c.bestLap.toFixed(2)));

// Scripted player lap through drivePlayer (tyre model, medium assists): brake to a centre-line speed profile, steer at a
// look-ahead point on the centre line
const r2 = S.createRace(1), p = r2.cars.find(c => c.player);
let pw = 0;
for (let step = 0; step < 120 * 200 && !p.finished; step++) {
  r2.t += dt;
  const ti = (p.idx + 12) % N, diff = S.wrapA(Math.atan2(PZ[ti] - p.z, PX[ti] - p.x) - p.h);
  const slow = p.v > CP[(p.idx + 4) % N];
  S.drivePlayer(r2, p, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true }, dt);   // proportional, like tilt
  pw += countWalls(p);
}
console.log(`\nscripted player lap: ${p.finished ? p.finishTime.toFixed(2) + ' s' : 'did not finish'}, wall hits ${pw}`);

// Race formats: a timed race with a 4-car grid (one slow car gets lapped) and an unlimited session.
function runAI(r, maxSeconds, skills = {}) {
  for (let step = 0; step < 120 * maxSeconds && !r.cars.every(c => c.finished); step++) {
    r.t += dt;
    for (const c of r.cars) S.driveAI(r, c, dt, skills[c.code] || (c.player ? 0.95 : 0));
    S.collide(r);
    for (const c of r.cars) c.events.length = 0;
  }
  return r;
}
const four = S.DRIVERS.filter(d => ['VOS', 'MAR', 'YOU', 'COS'].includes(d.code));
const timed = runAI(S.createRace({ type: 'timed', minutes: 1.5 }, { drivers: four }), 400, { COS: 0.4 });
console.log(`\ntimed 1.5 min, 4 cars (COS slowed): flag at ${Math.min(...timed.cars.map(c => c.finishTime)).toFixed(1)} s, all finished at ${timed.t.toFixed(1)} s`);
S.order(timed).forEach((c, i) => { const g = S.gapTo(timed, S.order(timed)[0], c);
  console.log(String(i + 1).padStart(2), c.code, `${c.finishLap - 1} laps`, g ? (g.laps ? `+${g.laps} lap` : `+${g.t.toFixed(2)} s`) : 'winner'); });
const open = runAI(S.createRace({ type: 'unlimited' }, { drivers: four.slice(0, 2) }), 200);
console.log(`\nunlimited, 2 cars, 200 s: finished ${open.cars.filter(c => c.finished).length}, laps ${open.cars.map(c => c.code + ' ' + (c.lap - 1)).join(', ')}`);

// Corner report: one car alone on the AI line at full skill, second lap. Minimum speed and gear in each corner
// (curvature peaks merged within 80 m), top speed before it, and the limit the old constant-grip model had there.
{
  const r = S.createRace(3, { drivers: S.DRIVERS.filter(d => d.code === 'VOS') }), c = r.cars[0];
  const log = [];
  for (let step = 0; step < 120 * 200 && c.lap < 3; step++) {
    r.t += dt; S.driveAI(r, c, dt, 1); c.events.length = 0;
    if (c.lap === 2) log.push({ d: c.idx * ds, v: c.v, gear: c.gear, rpm: c.rpm });
  }
  const peaks = [];
  for (let i = 0; i < N; i++) {
    const k = Math.abs(K[i]); if (k < 1 / 250) continue;
    let max = true; for (let o = -25; o <= 25; o++) if (o && Math.abs(K[(i + o + N) % N]) > k) { max = false; break; }
    if (!max) continue;
    if (peaks.length && i * ds - peaks.at(-1).d < 80) { if (k > peaks.at(-1).k) Object.assign(peaks.at(-1), { k, d: i * ds }); }
    else peaks.push({ k, d: i * ds });
  }
  const kmh = v => Math.round(v * 3.6);
  console.log(`\ncorner report (VOS alone, lap ${fmt(c.lastLap)}):`);
  console.log('   at      radius  min speed  gear | before   | old model');
  for (const p of peaks) {
    const near = log.filter(s => Math.abs(s.d - p.d) < 60);
    if (!near.length) continue;
    const lo = near.reduce((a, b) => b.v < a.v ? b : a);
    const before = log.filter(s => s.d > p.d - 250 && s.d < p.d).reduce((m, s) => Math.max(m, s.v), 0);
    console.log(`  ${String(Math.round(p.d)).padStart(5)} m  ${String(Math.round(1 / p.k)).padStart(4)} m  ${String(kmh(lo.v)).padStart(5)} km/h   ${lo.gear}  | ${String(kmh(before)).padStart(3)} km/h | ${kmh(Math.min(92, Math.sqrt(37 / p.k)))} km/h`);
  }
  const top = log.reduce((a, b) => b.v > a.v ? b : a);
  console.log(`  top speed ${kmh(top.v)} km/h in gear ${top.gear} at ${Math.round(top.d)} m`);
}
function fmt(t) { return t.toFixed(2) + ' s'; }
