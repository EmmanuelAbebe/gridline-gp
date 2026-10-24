// The car against real Formula 1 (2026-10-24, user: "make the car as realistic as possible"): tools/car-bench.mjs
// measures it as a team would (top speed on a real straight, 0–100 / 0–200, braking from 300 km/h, steady cornering,
// the speed where downforce equals the weight, turn-in stability) and REAL holds the real ranges. A change to the
// physics that leaves reality shows up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { bench, REAL } from '../tools/car-bench.mjs';

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
