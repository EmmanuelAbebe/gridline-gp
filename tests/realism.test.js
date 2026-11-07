// The car against real Formula 1 (2026-10-24, user: "make the car as realistic as possible"): tools/car-bench.mjs
// measures it as a team would (top speed on a real straight, 0–100 / 0–200, braking from 300 km/h, steady cornering,
// the speed where downforce equals the weight, turn-in stability) and REAL holds the real ranges. A change to the
// physics that leaves reality shows up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { bench, REAL, REAL_FE } from '../tools/car-bench.mjs';

test('the car measures like a real F1 car (2026 rules): speed, acceleration, braking, cornering, downforce, stability', () => {
  const r = bench(S);
  for (const [k, [lo, hi]] of Object.entries(REAL)) assert.ok(r[k] >= lo && r[k] <= hi, `${k}: ${(+r[k]).toFixed(2)} (real ${lo}–${hi})`);
});

test('real-car behaviour: the fronts lock first; the lock point falls with speed; the battery clips a long straight', () => {
  const DT = 1 / 120, T = S.buildTrack(S.CIRCUITS.harrow);
  const car = (assists, kmh, gear = 8) => { const race = S.createRace(3, { track: T, drivers: [S.DRIVERS.find(d => d.player)], seed: 1 }), c = race.cars[0];
    c.assists = S.ASSISTS[assists]; c.autoShift = true; const i = 60;
    Object.assign(c, { idx: i, lat: 0, x: T.PX[i], z: T.PZ[i], h: S.headingAt(T, i), v: kmh / 3.6, gear, lap: 1 }); return { race, c }; };
  const lockAt = kmh => { let lo = 0, hi = 1, first = null;
    for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2, { race, c } = car('off', kmh); let lock = null;
      for (let t = 0; t < 0.4 && !lock; t += DT) { race.t += DT; S.drivePlayer(race, c, { thr: 0, brk: m, steer: 0, analog: true }, DT); if (c.lockF || c.lockR) lock = c.lockR ? 'rear' : 'front'; }
      if (lock) { hi = m; first = lock; } else lo = m; }
    return { pedal: lo, first }; };
  const fast = lockAt(320), slow = lockAt(90);
  assert.ok(fast.first === 'front' && slow.first === 'front', 'brake balance: the fronts go first (understeer, not a spin)');
  assert.ok(fast.pedal > 0.65 && slow.pedal < 0.45, `lock point ${(fast.pedal * 100).toFixed(0)} % pedal at 320 km/h, ${(slow.pedal * 100).toFixed(0)} % at 90`);
  // a long straight flat out: the battery empties and the car slows (super clipping), as 2026 cars do
  const { race, c } = car('medium', 200, 6); let top = 0;
  for (let t = 0; t < 40; t += DT) { race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT);
    c.h = S.headingAt(T, c.idx); c.vy = 0; c.yawRate = 0; c.lat = 0; top = Math.max(top, c.v);
    if (c.idx > 400) { const i = 60; Object.assign(c, { idx: i, x: T.PX[i], z: T.PZ[i] }); } }
  assert.ok(c.soc < 0.05 * S.ERS.store && c.v < top - 8, `after 40 s: ${(c.v * 3.6).toFixed(0)} km/h (peak ${(top * 3.6).toFixed(0)}), battery ${(c.soc / 1e6).toFixed(2)} MJ`);
});

// Formula E (car classes step 2, docs/formula-e-plan.md): the Gen3 Evo against its real (and estimated: car-bench) ranges
test('Formula E measures like a Gen3 Evo: top speed, 0–60 mph, cornering, downforce', () => {
  const r = bench(S, S.classOf('fe'));
  for (const [k, [lo, hi]] of Object.entries(REAL_FE)) assert.ok(r[k] >= lo && r[k] <= hi, `${k}: ${(+r[k]).toFixed(2)} (real ${lo}–${hi})`);
});

test('Formula E\'s electric drivetrain: one gear, the battery pays for every metre, an empty battery drives nothing', () => {
  const DT = 1 / 120, T = S.buildTrack(S.CIRCUITS.harrow), FE = S.classOf('fe');
  const race = S.createRace(3, { carClass: FE, track: T, drivers: [S.DRIVERS.find(d => d.player)], seed: 1 }), c = race.cars[0];
  c.assists = S.ASSISTS.medium; c.autoShift = true;
  assert.equal(c.soc, FE.ers.store, 'a full battery: 38.5 kWh');
  let gears = new Set(), work = 0;
  for (let t = 0; t < 8; t += DT) {
    race.t += DT; const v0 = c.v; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true, shift: t > 2 && t < 2.1 ? 1 : 0 }, DT);
    c.h = S.headingAt(T, c.idx); c.yawRate = 0; c.vy = 0; c.lat = 0; gears.add(c.gear); work += c.drive * S.stockOf(FE).mass * v0 * DT;
  }
  assert.deepEqual([...gears], [1], 'one gear (a paddle press changes nothing)');
  const used = FE.ers.store - c.soc, eff = FE.car.motor.efficiency;
  assert.ok(Math.abs(used * eff - work) / work < 0.02, `the battery paid for the drive: ${(used / 1e6).toFixed(2)} MJ for ${(work / 1e6).toFixed(2)} MJ at the wheels`);
  assert.ok(c.ersKw > 250 && c.ersKw <= FE.car.motor.race + 1e-6, `flat out: ${c.ersKw.toFixed(0)} kW out of the battery (race mode ${FE.car.motor.race})`);
  c.soc = 0; const v = c.v;
  for (let t = 0; t < 2; t += DT) { race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT); }
  assert.ok(c.v < v - 2 && c.drive === 0, `empty: no drive, the car coasts (${(v * 3.6).toFixed(0)} → ${(c.v * 3.6).toFixed(0)} km/h in 2 s)`);
});

test('Formula E brakes with its motors: no rear hydraulics, the rear\'s regen weak at speed, the battery charged back', () => {
  const DT = 1 / 120, T = S.buildTrack(S.CIRCUITS.harrow), FE = S.classOf('fe'), R = FE.car.motor.regen;
  const race = S.createRace(3, { carClass: FE, track: T, drivers: [S.DRIVERS.find(d => d.player)], seed: 1 }), c = race.cars[0];
  c.assists = S.ASSISTS.medium; const i = 60;
  Object.assign(c, { idx: i, lat: 0, x: T.PX[i], z: T.PZ[i], h: S.headingAt(T, i), v: 280 / 3.6, gear: 1, lap: 1 });
  const st = S.stockOf(FE), soc0 = c.soc; let most = 0;
  // the rear's share: its regen (force = P / v) is far below the rear's tyres at speed, close to them slow
  assert.ok(S.regenRear(250 / 3.6, st) < 0.4 * S.brakeLimit(250 / 3.6, st), 'at 250 km/h the rear motor brakes little');
  assert.ok(S.regenRear(80 / 3.6, st) > S.regenRear(250 / 3.6, st) * 2.5, 'slower, it brakes much harder');
  assert.ok(S.brakeLimit(250 / 3.6, st) < st.cls.chassis.longGrip * S.tyreGrip(9.81 + st.dfK * (250 / 3.6) ** 2, st), 'so the car stops shorter than its tyres would');
  while (c.v * 3.6 > 80) { race.t += DT; S.drivePlayer(race, c, { thr: 0, brk: 1, steer: 0, analog: true }, DT);
    c.h = S.headingAt(T, c.idx); c.yawRate = 0; c.vy = 0; c.lat = 0; most = Math.max(most, -c.ersKw); }
  assert.ok(most <= (R.front + R.rear) * R.efficiency + 1e-6 && most > 400, `regeneration ${most.toFixed(0)} kW (at most ${(R.front + R.rear) * R.efficiency})`);
  assert.ok(c.soc - soc0 > 0.3 * 3.6e6, `a stop from 280 km/h puts ${((c.soc - soc0) / 3.6e3).toFixed(0)} Wh back`);
  // lifting off charges a little (and slows the car through the rears), braking doesn't stack lift-off regen on top
  const v = c.v, s1 = c.soc;
  for (let t = 0; t < 1; t += DT) { race.t += DT; S.drivePlayer(race, c, { thr: 0, brk: 0, steer: 0, analog: true }, DT); c.h = S.headingAt(T, c.idx); c.yawRate = 0; c.vy = 0; c.lat = 0; }
  assert.ok(c.soc > s1 && c.v < v, 'lift and coast: charged, slower');
});
