// The car on a test bench, measured as a team would, against real Formula 1 figures (2026 rules where known):
//   npm run car-bench            (prints the table; tests/realism.test.js checks the same numbers)
// Every number comes from the real physics (drivePlayer / stepChassis on a long straight held straight), not from the
// formulas, except the steady cornering limit (lateralGrip) and the downforce / weight speed (the aero numbers).
// REAL = [low, high] ranges, from the sources noted in CLAUDE.md ("Real F1 physics").
import { pathToFileURL } from 'node:url';

export const REAL = Object.freeze({
  topClosed: [318, 342],   // km/h, wings in cornering mode, full electrical power where it is allowed
  topOpen: [338, 362],     // km/h, straight mode (2026 X-mode)
  t100: [2.3, 3.0], t200: [4.3, 5.6],     // s from a standstill, traction control (a perfect launch)
  brakePeak: [4.8, 6.2],   // g at 300 km/h (Brembo: ~5–5.8 g into Monza's first chicane)
  brakeDist: [85, 115],    // m from 300 to 80 km/h with ABS (Monza T1 349 → 87 km/h in ~137 m, ~3.3 g average)
  corner80: [1.8, 2.5], corner150: [2.5, 3.5], corner250: [3.8, 5.0], corner300: [4.8, 6.0],   // g, steady
  dfWeight: [160, 205],    // km/h where the downforce equals the car's weight (~150 before 2026, 30 % less since)
  spins: [0, 2],           // turn-in grid (brake ≤ 0.5, steering ≤ 0.9, 90 … 260 km/h, no assists) combinations that spin
});
// Formula E, Gen3 Evo (docs/formula-e-plan.md): `npm run car-bench -- --class=fe`. ~ = estimates (no published figure).
// Car classes step 2 stage 1: rear-wheel drive (AWD comes with attack mode, stage 4: then 0–60 mph 1.82 s).
export const REAL_FE = Object.freeze({
  topClosed: [285, 315],   // km/h ~ at the end of a 1.2 km straight from 200 km/h, race mode 300 kW (322 theoretical at 350)
  t60: [2.5, 3.2],         // s 0–60 mph (96.6 km/h), rear-wheel drive (Gen3: ~2.8 s)
  corner80: [1.2, 1.6], corner150: [1.4, 1.9], corner250: [1.8, 2.5],   // g ~ steady (all-weather tyres, low downforce)
  dfWeight: [300, 360],    // km/h ~ (a fraction of the F1's downforce)
});
export const REAL_OF = { f1: REAL, fe: REAL_FE };

export function bench(S, cls = S.DEFAULT_CLASS) {
  const DT = 1 / 120, T = S.buildTrack(S.CIRCUITS.harrow), out = {}, stock = S.stockOf(cls), gears = stock.top.length - 1;
  const solo = (a, aero = false) => { const race = S.createRace(3, { carClass: cls, track: T, drivers: [S.DRIVERS.find(d => d.player)], seed: 1, activeAero: aero }), c = race.cars[0];
    c.assists = S.ASSISTS[a]; c.autoShift = true; return { race, c }; };
  const place = (c, kmh, gear) => { const i = 60; Object.assign(c, { idx: i, lat: 0, x: T.PX[i], z: T.PZ[i], h: S.headingAt(T, i), v: kmh / 3.6, gear: Math.min(gear, gears), lap: 1 }); };
  const pin = c => { c.h = S.headingAt(T, c.idx); c.yawRate = 0; c.vy = 0; c.lat = 0; };
  // top speed (an endless straight: the car is put back on the same sample) and the launch
  // (top speed as on a real straight of ~1.2 km: entered at 200 km/h with a charged battery, as a real top speed is
  // measured at the end of one; on an endless straight the battery empties and the car clips: ERS)
  for (const aero of [false, true]) {
    const { race, c } = solo('medium', aero); let top = 0, dist = 0; place(c, 200, 6); c.soc = cls.ers.store;
    for (let t = 0; t < 30 && dist < 1200; t += DT) { race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT); pin(c);
      dist += c.v * DT; top = Math.max(top, c.v * 3.6); if (c.idx > 400) { const i = 60; Object.assign(c, { idx: i, x: T.PX[i], z: T.PZ[i] }); } }
    out[aero ? 'topOpen' : 'topClosed'] = top;
  }
  { const { race, c } = solo('medium');
    for (let t = 0; t < 40; t += DT) {
      race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT); pin(c);
      if (!out.t60 && c.v * 3.6 >= 96.56) out.t60 = t + DT; if (!out.t100 && c.v * 3.6 >= 100) out.t100 = t + DT; if (!out.t200 && c.v * 3.6 >= 200) out.t200 = t + DT;
      if (c.idx > 400) { const i = 60; Object.assign(c, { idx: i, x: T.PX[i], z: T.PZ[i] }); }   // (back to the start of the straight)
    }
    out.flat = c.v * 3.6;                  // after 40 s flat out: the battery empty, clipping (information)
  }
  // braking 300 → 80 km/h with ABS: distance, peak deceleration
  { const { race, c } = solo('medium'); place(c, 300, 8); let d = 0, x = c.x, z = c.z, v0 = c.v, peak = 0;
    while (c.v * 3.6 > 80) { race.t += DT; S.drivePlayer(race, c, { thr: 0, brk: 1, steer: 0, analog: true }, DT); pin(c);
      peak = Math.max(peak, (v0 - c.v) / DT / 9.81); v0 = c.v; d += Math.hypot(c.x - x, c.z - z); x = c.x; z = c.z; }
    out.brakeDist = d; out.brakePeak = peak; }
  for (const v of [80, 150, 250, 300]) out['corner' + v] = S.lateralGrip(v / 3.6, stock) / 9.81;
  { let lo = 0, hi = 120; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; stock.dfK * m * m < 9.81 ? lo = m : hi = m; } out.dfWeight = lo * 3.6; }
  // turn-in with the brakes on, no assists: how many combinations of speed / brake / steering spin (> 30° of drift)
  { let n = 0, spins = 0; const which = [];
    for (const v of [260, 200, 140, 90]) for (const b of [0, 0.15, 0.3, 0.5]) for (const s of [0.3, 0.5, 0.7, 0.9]) {
      const { race, c } = solo('off'); place(c, v, 6); let drift = 0; n++;
      for (let t = 0; t < 1.8; t += DT) { race.t += DT; const st = t < 0.5 ? 0 : s * Math.min(1, (t - 0.5) / 0.3);
        S.drivePlayer(race, c, { steer: st, thr: 0, brk: t < 0.5 ? 0.6 * S.brakeLimit(c.v, c.spec) / S.brakeMax(c.v, c.spec) : b, analog: true, steerRate: Infinity, calm: 1, speedSteer: S.ASSISTS.medium.steer }, DT);
        drift = Math.max(drift, Math.abs(S.driftAngle(c)) * 57.3); }
      if (drift > 30) { spins++; which.push(`${v}/${b}/${s}`); }
    }
    out.spins = spins; out.spinCases = which; out.entryCases = n; }
  return out;
}

const LABELS = { topClosed: 'top speed, cornering mode', topOpen: 'top speed, straight mode', t60: '0–60 mph', t100: '0–100 km/h', t200: '0–200 km/h',
  brakePeak: 'braking at 300 km/h', brakeDist: 'braking 300 → 80 km/h', corner80: 'cornering at 80 km/h', corner150: 'cornering at 150 km/h',
  corner250: 'cornering at 250 km/h', corner300: 'cornering at 300 km/h', dfWeight: 'downforce = weight at', spins: 'turn-in spins (of 64)' };
const UNITS = { topClosed: 'km/h', topOpen: 'km/h', t60: 's', t100: 's', t200: 's', brakePeak: 'g', brakeDist: 'm', corner80: 'g', corner150: 'g', corner250: 'g', corner300: 'g', dfWeight: 'km/h', spins: '' };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // [another copy of the game's folder] [--class=<id>]
  const dir = process.argv.slice(2).find(a => !a.startsWith('--')), id = process.argv.slice(2).find(a => a.startsWith('--class='))?.slice(8) ?? 'f1';
  const root = dir ? pathToFileURL(dir + '/src/sim/index.js').href : new URL('../src/sim/index.js', import.meta.url).href;
  const { SIM } = await import(root), cls = SIM.classOf ? SIM.classOf(id) : null, R = REAL_OF[id];
  if (SIM.classOf && (!cls || !R)) { console.error(`unknown car class ${id}`); process.exit(1); }
  const r = cls ? bench(SIM, cls) : bench(SIM);
  if (id !== 'f1') console.log(`${cls.name}:`);
  for (const k of Object.keys(R)) {
    const [lo, hi] = R[k], v = r[k], ok = v >= lo && v <= hi;
    console.log(`${ok ? '  ' : '✗ '}${LABELS[k].padEnd(28)} ${(+v).toFixed(k.startsWith('t') || k.startsWith('corner') || k === 'brakePeak' ? 2 : 0).padStart(7)} ${UNITS[k].padEnd(5)} real ${lo}–${hi}`);
  }
  console.log(`  (an endless straight: ${r.flat.toFixed(0)} km/h after 40 s flat out${id === 'f1' ? ', the battery empty' : ''})`);
  if (r.spinCases.length) console.log('  spins at (speed / brake / steering):', r.spinCases.join(' '));
}
