// Hills and banking (sim elevation.js): profiles from course() keys, the AI's plan, what the car feels (slopes, crests,
// banking), a bridge's cars never touching the ones below; flat circuits untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { course } from '../src/sim/circuits.js';
import { createGround } from '../src/game/ground.js';
import { DT } from './helpers.js';

const HILLY = ['hautvale', 'saltcross', 'cantera', 'ironvale'];

test('flat circuits have no elevation; hilly ones have smooth profiles that close on themselves', () => {
  for (const id of ['elkmoor', 'harrow', 'cobalt', 'marrow', 'northfold']) assert.equal(S.buildTrack(S.CIRCUITS[id]).elev, null, id);
  for (const id of HILLY) {
    const T = S.buildTrack(S.CIRCUITS[id]), E = T.elev, N = T.N;
    assert.ok(E, id);
    let jump = 0, slope = 0;
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; jump = Math.max(jump, Math.abs(E.Y[j] - E.Y[i])); slope = Math.max(slope, Math.abs(E.SX[i])); }
    assert.ok(jump < 0.5, `${id}: height steps ${jump.toFixed(2)} m per sample`);
    assert.ok(slope < 0.2, `${id}: steepest ${(slope * 100).toFixed(1)}%`);
    assert.ok(id === 'ironvale' ? E.hi - E.lo < 0.01 : E.hi - E.lo > 20, `${id}: ${(E.hi - E.lo).toFixed(1)} m of climb`);
  }
  // course(): every vertex's height, the bank signed by the corner's direction (a right turn rises toward its left)
  const { heights } = course([[0, 0, 0, 5], [200, 0, 40, 7, 10], [200, 200, 40, 9], [0, 200, 40, 9]]);
  const banked = heights.filter(k => k[3] !== 0);
  assert.ok(banked.length === 3 && banked.every(k => k[3] < 0), 'a banked right-hander rises toward −N');
});

test('the AI plans with the hills: a banked corner is faster, a crest corner slower, braking downhill longer', () => {
  const at = (sn, vk = 0, sx = 0) => ({ SN: new Float32Array([sn]), CA: new Float32Array([Math.cos(Math.asin(sn)) * Math.cos(Math.asin(sx))]), VK: new Float32Array([vk]), SX: new Float32Array([sx]) });
  const flat = S.cornerSpeed(1 / 60);
  assert.ok(Math.abs(S.cornerSpeedAt(at(0), 0, 1 / 60) - flat) < 1e-6, 'level = flat');
  assert.ok(S.cornerSpeedAt(at(Math.sin(0.35)), 0, -1 / 60) > flat * 1.05, 'a left banked into the turn (road rising to the right)');
  assert.ok(S.cornerSpeedAt(at(Math.sin(0.35)), 0, 1 / 60) < flat, 'banked the wrong way');
  assert.ok(S.cornerSpeedAt(at(0, -0.004), 0, 1 / 60) < flat && S.cornerSpeedAt(at(0, 0.004), 0, 1 / 60) > flat, 'a crest takes grip, a dip gives it');
  assert.ok(S.brakeLimitAt(at(0, 0, -0.1), 0, 50) < S.brakeLimit(50) && S.brakeLimitAt(at(0, 0, 0.1), 0, 50) > S.brakeLimit(50), 'downhill / uphill braking');
});

test('the car on a hill: slower up the climb, faster down it, and it rolls back from a standstill on a slope only with no brakes', () => {
  const T = S.buildTrack(S.CIRCUITS.hautvale), E = T.elev;
  let up = 0, down = 0; for (let i = 0; i < T.N; i++) { if (E.SX[i] > E.SX[up]) up = i; if (E.SX[i] < E.SX[down]) down = i; }
  const accel = i => {                                           // full throttle in 3rd at 100 km/h on the centre line
    const race = S.createRace(2, { track: T, drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0], lat = 0;
    Object.assign(c, { idx: i, lat, x: T.PX[i] + T.NX[i] * lat, z: T.PZ[i] + T.NZ[i] * lat, h: S.headingAt(T, i), v: 100 / 3.6, gear: 3, lap: 1 });
    const v0 = c.v; for (let k = 0; k < 60; k++) { race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT); }
    return (c.v - v0) / (60 * DT);
  };
  const a0 = accel(0), aUp = accel(up), aDown = accel(down);
  assert.ok(aUp < a0 - 0.6 * 9.81 * E.SX[up] && aDown > a0 + 0.6 * 9.81 * -E.SX[down], `accel flat ${a0.toFixed(1)}, up ${aUp.toFixed(1)}, down ${aDown.toFixed(1)}`);
});

test('banking: through the speedway\'s banked turns flat out, faster than the same corner flat; cars on a bridge never touch those below', () => {
  const T = S.buildTrack(S.CIRCUITS.ironvale), E = T.elev;
  // the tightest sample of the banked turns: flat out there on the centre line, which a flat corner wouldn't be
  let b = -1; for (let i = 0; i < T.N; i++) if (Math.abs(E.BANK[i]) > 0.3 && (b < 0 || Math.abs(T.K[i]) > Math.abs(T.K[b]))) b = i;
  assert.ok(b >= 0 && Math.abs(E.BANK[b]) > 0.33, `bank ${(E.BANK[b] * 57.3).toFixed(1)}°`);
  const banked = S.cornerSpeedAt(E, b, T.K[b]), flat = S.cornerSpeed(Math.abs(T.K[b]));
  assert.ok(banked >= S.TUNING.V_CAP - 1e-6 && flat < banked - 5, `${(banked * 3.6).toFixed(0)} km/h vs flat ${(flat * 3.6).toFixed(0)}`);
  // and the cars really go round faster: the AI's slowest point in the banked end vs the same circuit with no banking
  const slowest = circuit => {
    const X = S.buildTrack(circuit), solo = S.createRace(2, { track: X, drivers: [S.DRIVERS.find(d => !d.player)] }), ai = solo.cars[0];
    let low = Infinity;
    for (let k = 0; k < 120 * 90 && !ai.finished; k++) { solo.t += DT; S.driveAI(solo, ai, DT); ai.events.length = 0; if (ai.lap === 2 && X.PX[ai.idx] < -650) low = Math.min(low, S.speedOf(ai)); }
    return low;
  };
  const C = S.CIRCUITS.ironvale, withBank = slowest(C), noBank = slowest({ ...C, id: 'unbanked', heights: C.heights.map(k => [k[0], k[1], k[2], 0]) });
  assert.ok(withBank > noBank + 2, `slowest in the banked end ${(withBank * 3.6).toFixed(0)} km/h, without the banking ${(noBank * 3.6).toFixed(0)}`);
  // the bridge: two cars at the crossing's plan position, one on each level
  const X = S.buildTrack(S.CIRCUITS.saltcross), g = createGround(X), on = [...g.bridge.keys()].filter(i => g.bridge[i]);
  assert.ok(on.length > 10, `${on.length} bridge samples`);
  const m = on[on.length >> 1]; let lo = -1, best = Infinity;
  for (let j = 0; j < X.N; j++) if (!g.bridge[j] && Math.min(S.wrapIdx(j - m, X.N), S.wrapIdx(m - j, X.N)) > 100) { const d = Math.hypot(X.PX[j] - X.PX[m], X.PZ[j] - X.PZ[m]); if (d < best) { best = d; lo = j; } }
  assert.ok(best < 5 && X.elev.Y[m] - X.elev.Y[lo] > 6, `crossing ${best.toFixed(1)} m apart, ${(X.elev.Y[m] - X.elev.Y[lo]).toFixed(1)} m above`);
  const race = S.createRace(2, { track: X, drivers: S.DRIVERS.slice(0, 2) });
  const [a, c] = race.cars;
  Object.assign(a, { idx: m, x: X.PX[m], z: X.PZ[m], lat: 0, v: 30 }); Object.assign(c, { idx: lo, x: X.PX[lo] + 0.5, z: X.PZ[lo], lat: 0, v: 30 });
  S.collide(race);
  assert.ok(!a.touching && !c.touching && a.v === 30 && c.v === 30, 'no contact across the bridge');
});

// (2026-10-23, the player: "non smooth hill curves that look like they could damage the car", banked straights at
// Ironvale, "a wall in the road": the ground stepped where two parts of the track at different heights met)
test('smooth to drive and to look at: gentle crests and dips, level straights on the speedway, no steps in the ground', () => {
  for (const id of HILLY) {
    const T = S.buildTrack(S.CIRCUITS[id]), E = T.elev, N = T.N;
    let vk = 0; for (let i = 0; i < N; i++) vk = Math.max(vk, Math.abs(E.VK[i]));
    assert.ok(1 / vk > 400, `${id}: a crest or dip of ${(1 / vk).toFixed(0)} m radius`);
    // banking only at the banked turns: wherever the road runs straight for 100 m either way it is level
    for (let i = 0; i < N; i++) {
      let straight = true; for (let o = -50; o <= 50 && straight; o++) straight = Math.abs(T.K[S.wrapIdx(i + o, N)]) < 1 / 2000;
      if (straight) assert.ok(Math.abs(E.BANK[i]) < 0.01, `${id}: banked ${(E.BANK[i] * 180 / Math.PI).toFixed(1)}° on a straight at ${(i * T.ds).toFixed(0)} m`);
    }
    // the ground beside the track, walked outward from every 12th sample in 25 cm steps: never a jump
    const g = createGround(T);
    let worst = 0, where = '';
    for (let i = 0; i < N; i += 12) for (const s of [-1, 1]) {
      let prev = null;
      for (let d = T.runoff[s > 0 ? 1 : 0].wall[i] + 1; d < 120; d += 0.25) {
        const h = g.at(T.PX[i] + T.NX[i] * d * s, T.PZ[i] + T.NZ[i] * d * s);
        if (prev !== null && Math.abs(h - prev) > worst) { worst = Math.abs(h - prev); where = `${(i * T.ds).toFixed(0)} m, ${d.toFixed(0)} m out`; }
        prev = h;
      }
    }
    assert.ok(worst < 0.6, `${id}: the ground steps ${worst.toFixed(2)} m in 25 cm (${where})`);
  }
});
