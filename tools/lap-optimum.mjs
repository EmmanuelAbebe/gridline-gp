// The fastest lap a stock car can do on a circuit (flying lap, solo, fresh tyres), in two steps:
//  1. Lap-time simulation (quasi-steady state, the same numbers as the sim: grip, downforce, drag, engine + gearbox,
//     brakes, friction circle, active aero in its zones) on a racing line optimised for lap time (coordinate descent
//     on lateral offsets, the car's centre kept on the tarmac: no track-limit cuts, full grip).
//  2. The real physics: a bot drives that line in the full sim (chassis.js, medium assists) and pushes its speed
//     profile as far as it goes without walls, cuts or spins.
// Usage: node tools/lap-optimum.mjs [circuit=northfold] [--no-aero] [--margin=0.3]
import { SIM } from '../src/sim/index.js';
import { CAR, CHASSIS, ACTIVE_AERO as AA, TUNING, ASSISTS } from '../src/sim/tuning.js';

const args = process.argv.slice(2), id = args.find(a => !a.startsWith('--')) || 'northfold';
const aero = !args.includes('--no-aero'), margin = +(args.find(a => a.startsWith('--margin=')) || '=0.3').split('=')[1];
const T = SIM.buildTrack({ ...SIM.CIRCUITS[id], id }), { N, PX, PZ, NX, NZ, HW } = T, S = SIM.STOCK, G = 9.81;
const DT = 1 / 120, W = HW - margin;

// ---------- 1. quasi-steady-state lap ----------
const gears = SIM.VEHICLE.gears, limiter = SIM.VEHICLE.limiter;
const powerAt = v => {          // best wheel force per mass over the gears at speed v
  let best = 0;
  for (let g = 1; g <= gears; g++) { const r = SIM.rpmAt(v, g, S); if (r < limiter && r > 3000) best = Math.max(best, driveAt(r, g)); }
  return best;
};
const P = CAR.engine.power, R_WHEEL = TUNING.WHEEL_RADIUS;
function driveAt(rpm, g) {
  let kw = P[P.length - 1][1];
  for (let i = 1; i < P.length; i++) if (rpm <= P[i][0]) { const [r0, p0] = P[i - 1], [r1, p1] = P[i]; kw = p0 + (p1 - p0) * (rpm - r0) / (r1 - r0); break; }
  return kw * S.power * 1000 / (rpm * 2 * Math.PI / 60) * S.ratio[g] * CAR.engine.efficiency / R_WHEEL / S.mass;
}
const POWER = new Float64Array(1001); for (let i = 0; i <= 1000; i++) POWER[i] = powerAt(i / 10);   // 0..100 m/s
const power = v => POWER[Math.min(1000, Math.max(0, Math.round(v * 10)))];
const cornerV = (k, df) => { const R = 1 / Math.max(k, 1e-6), den = 1 - R * S.grip * df; return den <= 0.02 ? TUNING.V_CAP : Math.min(TUNING.V_CAP, Math.sqrt(R * S.grip * G / den)); };
const dfOpen = S.dfK * (1 - AA.downforceCut), zone = T.aeroZone;

const X = new Float64Array(N), Z = new Float64Array(N), DS = new Float64Array(N), K = new Float64Array(N);
const env = new Float64Array(N), v = new Float64Array(N), open = new Uint8Array(N);
function geometry(off) {
  for (let i = 0; i < N; i++) { X[i] = PX[i] + NX[i] * off[i]; Z[i] = PZ[i] + NZ[i] * off[i]; }
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; DS[i] = Math.hypot(X[j] - X[i], Z[j] - Z[i]); }
  const w = 5;                                   // ±10 m: the car can't follow anything sharper than that anyway
  for (let i = 0; i < N; i++) {
    const a = (i - w + N) % N, b = (i + w) % N;
    const h1 = Math.atan2(Z[i] - Z[a], X[i] - X[a]), h2 = Math.atan2(Z[b] - Z[i], X[b] - X[i]);
    let d = h2 - h1; d = Math.atan2(Math.sin(d), Math.cos(d));
    let L = 0; for (let k = a; k !== b; k = (k + 1) % N) L += DS[k];
    K[i] = Math.abs(d) / (L / 2);
  }
}
function lapTime(off) {
  geometry(off);
  for (let i = 0; i < N; i++) env[i] = cornerV(K[i], S.dfK);
  // braking envelope (backwards, twice round so it closes on itself)
  for (let p = 0; p < 2; p++) for (let i = N - 1; i >= 0; i--) {
    const j = (i + 1) % N, u = env[j], df = S.dfK * u * u, lat = u * u * K[j], latMax = S.grip * (G + df);
    const f = Math.sqrt(Math.max(0, 1 - (lat / latMax) ** 2));
    const dec = Math.min(CHASSIS.brakeSystem, S.grip * CHASSIS.longGrip * (G + df)) * f + S.dragK * u * u + CAR.aero.rolling + CAR.engine.engineBrake * 0.8;
    env[i] = Math.min(env[i], Math.sqrt(u * u + 2 * dec * DS[i]));
  }
  // acceleration (forwards, twice round), straight mode in the zones while it can take the bend with open wings
  v[0] = env[0];
  for (let p = 0; p < 2; p++) for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, u = v[i];
    const op = aero && zone[i] && u <= cornerV(K[i], dfOpen) ? 1 : 0;
    const df = (op ? dfOpen : S.dfK) * u * u, lat = u * u * K[i], latMax = S.grip * (G + df);
    const f = Math.sqrt(Math.max(0, 1 - (lat / latMax) ** 2));
    const traction = S.grip * S.rearGrip * CHASSIS.longGrip * (G * (1 - CHASSIS.frontWeight) + df * (1 - S.aeroFront)) * f;
    const a = Math.min(power(u), traction) - S.dragK * (1 - AA.dragCut * op) * u * u - CAR.aero.rolling;
    v[j] = Math.min(env[j], Math.sqrt(Math.max(1, u * u + 2 * a * DS[i])));
    open[i] = op;
  }
  let t = 0; for (let i = 0; i < N; i++) t += 2 * DS[i] / (v[i] + v[(i + 1) % N]);
  return t;
}

// line: control offsets every STEP samples (within ±W), periodic Catmull-Rom in between (a smooth line: no kinks where
// it meets the edge, which the lap model would read as tight corners)
const STEP = 10, M = Math.ceil(N / STEP), ctrl = new Float64Array(M), off = new Float64Array(N);
const cat = (a, b, c, d, t) => 0.5 * (2*b + (c - a)*t + (2*a - 5*b + 4*c - d)*t*t + (3*b - a - 3*c + d)*t*t*t);
function expand() {
  for (let i = 0; i < N; i++) {
    const s = i / STEP, m = Math.floor(s), t = s - m, at = k => ctrl[((m + k) % M + M) % M];
    off[i] = Math.max(-HW, Math.min(HW, cat(at(-1), at(0), at(1), at(2), t)));   // controls are within ±W; the curve between may bulge a little
  }
  return off;
}
for (let m = 0; m < M; m++) ctrl[m] = Math.max(-W, Math.min(W, T.RO[Math.min(N - 1, m * STEP)]));
const t0 = lapTime(expand());
let best = t0, evals = 0;
console.log(`${T.name}: ${(T.L / 1000).toFixed(2)} km, half width ${HW} m, line kept within ±${W.toFixed(1)} m, active aero ${aero ? 'on' : 'off'}`);
console.log(`QSS on the AI's minimum-curvature line: ${fmt(t0)}`);
for (const step of [2, 1, 0.5, 0.25, 0.12, 0.06]) {
  for (let sweep = 0, improved = true; sweep < 12 && improved; sweep++) {
    improved = false;
    for (let m = 0; m < M; m++) for (const d of [step, -step]) {
      const old = ctrl[m]; ctrl[m] = Math.max(-W, Math.min(W, old + d));
      if (ctrl[m] === old) continue;
      const t = lapTime(expand()); evals++;
      if (t < best - 1e-6) { best = t; improved = true; break; } else ctrl[m] = old;
    }
  }
}
lapTime(expand());
const line = Float64Array.from(off), prof = Float64Array.from(env);
let openShare = 0, top = 0; for (let i = 0; i < N; i++) { openShare += open[i] * DS[i]; top = Math.max(top, v[i]); }
console.log(`QSS on the optimised line: ${fmt(best)}  (${evals} evaluations, top speed ${(top * 3.6).toFixed(0)} km/h, wings open ${(openShare / T.L * 100).toFixed(0)}% of the lap)`);

// ---------- 2. the real physics: a bot on that line ----------
// pure pursuit on the line + the AI's speed logic on the braking envelope × `push`
function drive(push, laps = 3, mult = null) {
  const race = SIM.createRace(laps, { track: T, drivers: SIM.DRIVERS.filter(d => d.player), activeAero: aero, seed: 1 });
  const c = race.cars[0]; c.assists = ASSISTS.medium;
  const vt = j => prof[j] >= TUNING.V_CAP - 1e-3 ? TUNING.V_CAP : prof[j] * (mult ? mult[segOf[j]] : push);
  let trouble = 0, spins = 0, maxLat = 0, offTarmac = 0, lapDist = 0;
  const seen = new Float64Array(N);
  for (let s = 0; s < laps * 120 * 120 && !c.finished; s++) {
    race.t += DT;
    const sp = Math.max(c.v, 0), ti = (c.idx + Math.round((8 + sp * 0.3) / T.ds)) % N;
    const tx = PX[ti] + NX[ti] * line[ti] - c.x, tz = PZ[ti] + NZ[ti] * line[ti] - c.z;
    const alpha = SIM.wrapA(Math.atan2(tz, tx) - c.h - SIM.driftAngle(c)), dist = Math.max(Math.hypot(tx, tz), 4);
    const kappa = 2 * Math.sin(alpha) / dist, v5 = Math.max(sp, 5);
    const delta = CHASSIS.wheelbase * kappa + 0.6 * (sp * kappa - c.yawRate) * CHASSIS.wheelbase / v5;
    const steer = SIM.clamp(delta / SIM.steerLock(c.v, c.assists.steer, c.spec), -1, 1);
    let target = Math.min(vt((c.idx + 2) % N), vt((c.idx + 5) % N)), need = 0;
    for (let k = 2; k <= 120; k += k < 12 ? 2 : 4) { const j = (c.idx + k) % N, w = vt(j); need = Math.max(need, (sp * sp - w * w) / (2 * k * T.ds)); }
    const lim = SIM.brakeLimit(sp, c.spec) * 0.97, over = sp - target;
    let thr = 1, brk = 0;
    if (need > lim * 0.92 || over > 0.8) { thr = 0; brk = SIM.clamp(need / (lim * 1.15) + Math.max(0, over) * 0.3, 0, 1); }
    else if (over > 0) thr = SIM.clamp(1 - over * 0.8, 0, 1);
    SIM.drivePlayer(race, c, { steer, thr, brk, analog: true, steerRate: Infinity }, DT);
    for (const e of c.events) { if (e.type === SIM.EV.WALL || e.type === SIM.EV.CUT) trouble++; }
    c.events.length = 0;
    if (Math.abs(SIM.wrapA(c.h - SIM.headingAt(T, c.idx))) > 1.2) spins++;
    if (c.lap === 2) seen[c.idx] = c.v;
    if (c.lap >= 2) { maxLat = Math.max(maxLat, Math.abs(c.lat)); lapDist += c.v * DT; if (Math.abs(c.lat) > HW) offTarmac += c.v * DT; }
  }
  return { best: c.bestLap, finished: c.finished, trouble, spins: spins > 0, maxLat, offTarmac: offTarmac / Math.max(1, lapDist), seen };
}
console.log('Real physics, bot on the optimised line (medium assists), push = share of the corner/braking profile:');
let fastest = null;
const PUSH = (args.find(a => a.startsWith("--push=")) || "--push=0.96,0.98,1,1.02,1.04,1.06,1.08,1.1,1.12,1.14,1.16").split("=")[1].split(",").map(Number);
for (const push of PUSH) {
  const r = drive(push), clean = r.finished && !r.trouble && !r.spins && Number.isFinite(r.best);
  console.log(`  push ${push.toFixed(2)}: ${Number.isFinite(r.best) ? fmt(r.best) : '—'}  max |lat| ${r.maxLat.toFixed(1)} m, centre off the tarmac ${(r.offTarmac * 100).toFixed(1)}%${clean ? '' : `  (${r.trouble} walls/cuts${r.spins ? ', spun' : ''}${r.finished ? '' : ', did not finish'})`}`);
  if (clean && (!fastest || r.best < fastest.best)) fastest = { push, best: r.best };
}
if (args.includes('--corners')) {
  const r = drive(PUSH[PUSH.length - 1]);
  // apexes of the QSS profile
  for (let i = 0; i < N; i++) { const a = prof[(i + N - 1) % N], b = prof[(i + 1) % N]; if (prof[i] < a && prof[i] <= b && prof[i] < 80)
    console.log(`  sample ${i}: model ${(prof[i] * 3.6).toFixed(0)} km/h (K ${K[i].toFixed(4)}, R ${(1 / K[i]).toFixed(0)} m)  bot ${(r.seen[i] * 3.6).toFixed(0)} km/h`); }
}
// --tune: a push per corner (segments split half-way between the profile's apexes), each raised while the lap stays
// clean and gets faster (coordinate ascent from the best uniform push)
const segOf = new Int32Array(N);
{
  const apex = [];
  for (let i = 0; i < N; i++) { const a = prof[(i + N - 1) % N], b = prof[(i + 1) % N]; if (prof[i] < a && prof[i] <= b && prof[i] < TUNING.V_CAP * 0.9) apex.push(i); }
  const keep = apex.filter((a, k) => k === 0 || a - apex[k - 1] > 40);          // one per corner (≥ 80 m apart)
  for (let i = 0; i < N; i++) {
    let best = 0, bd = Infinity;
    keep.forEach((a, k) => { const d = Math.min(Math.abs(i - a), N - Math.abs(i - a)); if (d < bd) { bd = d; best = k; } });
    segOf[i] = best;
  }
  segOf.count = keep.length;
}
if (args.includes('--tune') && fastest) {
  const mult = new Float64Array(segOf.count).fill(fastest.push);
  let bestT = fastest.best;
  for (const step of [0.08, 0.04, 0.02, 0.01]) for (let sweep = 0, better = true; better && sweep < 8; sweep++) {
    better = false;
    for (let k = 0; k < segOf.count; k++) for (const d of [step, -step]) {
      const old = mult[k]; mult[k] = old + d;
      const r = drive(0, 3, mult);
      if (r.finished && !r.trouble && !r.spins && r.best < bestT - 1e-4) { bestT = r.best; better = true; break; } else mult[k] = old;
    }
  }
  console.log(`Per-corner push (${segOf.count} corners): ${fmt(bestT)}  [${[...mult].map(m => m.toFixed(2)).join(' ')}]`);
}
if (fastest) console.log(`Fastest clean lap in the real physics: ${fmt(fastest.best)} (push ${fastest.push})`);

function fmt(t) { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; }
