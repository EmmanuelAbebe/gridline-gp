// Headless race check for Gridline GP.
// Usage: node tools/sim-test.mjs [path/to/gridline.html]
// Extracts the SIM block (pure JS, no DOM) from the HTML and runs it in Node.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'gridline.html';
const html = readFileSync(file, 'utf8');
const a = html.indexOf('/*SIM-START*/'), b = html.indexOf('/*SIM-END*/');
if (a < 0 || b < 0) { console.error('SIM markers not found in', file); process.exit(1); }
const S = new Function(html.slice(a, b) + '\nreturn SIM;')();
const T = S.track, { N, PX, PZ, K, ds, WALL, VP } = T;
const countWalls = c => { const n = c.events.filter(e => e === S.EV.WALL).length; c.events.length = 0; return n; };

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

// Scripted player lap through drivePlayer: brake to the AI speed profile, steer at a look-ahead point
const r2 = S.createRace(1), p = r2.cars.find(c => c.player);
let pw = 0;
for (let step = 0; step < 120 * 200 && !p.finished; step++) {
  r2.t += dt;
  const ti = (p.idx + 12) % N, diff = S.wrapA(Math.atan2(PZ[ti] - p.z, PX[ti] - p.x) - p.h);
  const slow = p.v > VP[(p.idx + 4) % N];
  S.drivePlayer(r2, p, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: diff < -0.02 ? -1 : diff > 0.02 ? 1 : 0, analog: false }, dt);
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
const timed = runAI(S.createRace({ type: 'timed', minutes: 1.5 }, { drivers: four }), 400, { COS: 0.55 });
console.log(`\ntimed 1.5 min, 4 cars (COS slowed): flag at ${Math.min(...timed.cars.map(c => c.finishTime)).toFixed(1)} s, all finished at ${timed.t.toFixed(1)} s`);
S.order(timed).forEach((c, i) => { const g = S.gapTo(timed, S.order(timed)[0], c);
  console.log(String(i + 1).padStart(2), c.code, `${c.finishLap - 1} laps`, g ? (g.laps ? `+${g.laps} lap` : `+${g.t.toFixed(2)} s`) : 'winner'); });
const open = runAI(S.createRace({ type: 'unlimited' }, { drivers: four.slice(0, 2) }), 200);
console.log(`\nunlimited, 2 cars, 200 s: finished ${open.cars.filter(c => c.finished).length}, laps ${open.cars.map(c => c.code + ' ' + (c.lap - 1)).join(', ')}`);
