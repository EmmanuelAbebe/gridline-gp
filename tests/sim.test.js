// Simulation tests: track geometry, a full AI race, the player driving model and the race formats.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, seeded, run, aiDriver } from './helpers.js';

const T = S.track;

test('track: Elkmoor geometry is drivable', () => {
  assert.ok(Math.abs(T.L - 2473) < 5, `length ${T.L}`);
  let maxK = 0; for (let i = 0; i < T.N; i++) maxK = Math.max(maxK, Math.abs(T.K[i]));
  assert.ok(1 / maxK > T.HW * 2, `tightest radius ${1 / maxK} m is wider than the road`);
  // separate parts of the circuit never come within two runoff widths of each other
  let minSep = Infinity;
  for (let i = 0; i < T.N; i += 2) for (let j = 0; j < T.N; j += 2) {
    let g = Math.abs(i - j); g = Math.min(g, T.N - g); if (g * T.ds < 120) continue;
    minSep = Math.min(minSep, Math.hypot(T.PX[i] - T.PX[j], T.PZ[i] - T.PZ[j]));
  }
  assert.ok(minSep > 2 * T.WALL, `closest approach ${minSep} m`);
});

test('track: a new circuit only needs control points', () => {
  const square = S.buildTrack({ name: 'Test', ctrl: [[0, 0], [400, 0], [400, 400], [0, 400]] });
  assert.ok(Math.abs(square.ds - 2.06) < 0.02, `a sample every ${square.ds} m`);   // sample count follows the length
  assert.ok(square.L > 1500 && square.L < 1800, `length ${square.L}`);   // the spline bulges past a 4-point square's 1600 m
  assert.equal(square.VP.length, square.N);
});

test('race: 10-car AI race finishes cleanly in skill order', () => seeded(() => {
  const race = S.createRace(3), seen = run(S, race, 600, aiDriver(S));
  assert.ok(race.cars.every(c => c.finished), 'every car finished');
  const walls = race.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0);
  assert.equal(walls, 0, 'no wall hits');
  const ord = S.order(race);
  assert.equal(ord[0].code, 'VOS', 'fastest driver wins');
  assert.ok(ord[0].finishTime > 95 && ord[0].finishTime < 135, `winning time ${ord[0].finishTime}`);
  for (const c of race.cars) { assert.equal(c.finishLap, 4); assert.ok(c.bestLap > 30 && c.bestLap < 45, `${c.code} best ${c.bestLap}`); }
  assert.equal(race.fastestBy, ord.find(c => c.bestLap === race.fastest));
}));

test('player: top speed is VMAX and the brakes stop the car', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.filter(d => d.player) }), p = race.cars[0];
  // put the car on a long straight heading along the track
  const drive = inp => { for (let i = 0; i < 120 * 30; i++) { race.t += DT; S.drivePlayer(race, p, inp, DT); p.x = T.PX[p.idx]; p.z = T.PZ[p.idx]; p.h = S.headingAt(T, p.idx); } };
  drive({ thr: 1, brk: 0, steer: 0, analog: false });
  assert.ok(p.v > S.TUNING.VMAX * 0.98 && p.v <= S.TUNING.VMAX, `top speed ${p.v}`);
  drive({ thr: 0, brk: 1, steer: 0, analog: false });
  assert.ok(p.v <= 0 && p.v >= -S.TUNING.REVERSE_MAX, `after braking ${p.v}`);
});

test('formats: timed race flags the leader after time is up; lapped cars finish a lap down', () => seeded(() => {
  const four = S.DRIVERS.filter(d => ['VOS', 'MAR', 'YOU', 'COS'].includes(d.code));
  const race = S.createRace({ type: 'timed', minutes: 1.5 }, { drivers: four });
  run(S, race, 400, aiDriver(S, { COS: 0.4 }));
  assert.ok(race.cars.every(c => c.finished));
  const ord = S.order(race), leader = ord[0];
  assert.ok(leader.finishTime >= 90, 'flag only after the clock ran out');
  assert.deepEqual(S.gapTo(race, leader, ord.at(-1)), { laps: 1 });
  assert.equal(ord.at(-1).code, 'COS');
  assert.equal(race.laps, Infinity);
}));

test('formats: unlimited never finishes; plain numbers mean laps', () => seeded(() => {
  const race = S.createRace({ type: 'unlimited' }, { drivers: S.DRIVERS.slice(0, 2) });
  run(S, race, 150, aiDriver(S));
  assert.ok(race.cars.every(c => !c.finished && c.lap >= 3));
  assert.equal(race.duration, Infinity);
  assert.deepEqual(S.createRace(5).format, { type: 'laps', laps: 5 });
  assert.deepEqual(S.createRace({ type: 'laps', laps: 0 }).format, { type: 'laps', laps: 3 });   // invalid → default
}));

// the hitbox's extents (m from the car's origin): front, rear, half the width
const HB = (() => { const p = S.HITBOX.parts.flatMap(q => q.pts); return { front: Math.max(...p.map(q => q[0])), rear: -Math.min(...p.map(q => q[0])), half: Math.max(...p.map(q => Math.abs(q[1]))) }; })();
test('contact: a nose-to-tail hit pushes apart, trades speed and reports the impact once', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars, C = HB;
  const reach = C.front + C.rear;                           // centre distance at which the bodies touch, in line
  a.h = b.h = 0; b.z = a.z; b.x = a.x + reach - 0.3; a.v = 20; b.v = 5;
  S.collide(race);
  assert.ok(S.carGap(a, b) >= -1e-6, 'separated');
  assert.deepEqual(a.events.map(e => e.type), [S.EV.CONTACT]);
  assert.ok(a.events[0].impact > 10 && a.events[0].with === b.code, `impact ${a.events[0].impact}`);
  assert.ok(a.v < 20 && b.v > 5 && Math.abs(a.v + b.v - 25) < 1e-6, `speeds ${a.v} ${b.v}: the hit car is shoved, momentum kept`);
  a.events.length = 0;
  S.collide(race);
  assert.deepEqual(a.events, [], 'still touching: no second event');
});

test('contact: an off-centre tap turns the cars only as much as their inertia allows, momentum kept', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars, C = HB;
  a.h = b.h = 0; b.x = a.x + C.front + C.rear - 0.6; b.z = a.z + 1.4; a.v = 60; b.v = 45;   // 15 m/s, corner to corner
  for (const c of [a, b]) { c.vy = 0; c.yawRate = 0; }
  S.collide(race);
  assert.ok(Math.abs(a.v + b.v - 105) < 1e-6 && Math.abs(a.vy + b.vy) < 1e-6, 'momentum kept');
  assert.ok(Math.abs(a.yawRate) < 1.5 && Math.abs(b.yawRate) < 1.5, `yaw ${a.yawRate.toFixed(2)} / ${b.yawRate.toFixed(2)} rad/s`);
  assert.ok(b.v - 45 < 0.6 * 15, `shove ${(b.v - 45).toFixed(1)} m/s`);
});

test('contact: hit from behind on a rear corner: half the front wing breaks off, then the nose shoves the car forward, hardly sideways', () => {
  // (as capsules with round ends this shoved it ~25° sideways and spun cars hit in braking zones)
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2), wear: { damage: true } }), [a, b] = race.cars, C = HB;
  // on the grid straight, pointing along it: b runs into a's left rear
  const h = S.headingAt(race.track, b.idx), fx = Math.cos(h), fz = Math.sin(h), L = C.front + C.rear - 0.1;
  a.h = b.h = h; a.x = b.x + fx * L - fz * 0.9; a.z = b.z + fz * L + fx * 0.9; a.v = 40; b.v = 49;
  for (const c of [a, b]) { c.vy = 0; c.yawRate = 0; }
  const mom = () => [a, b].reduce((m, c) => [m[0] + Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy, m[1] + Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy], [0, 0]);
  let gave = false, drift = 0;
  for (let k = 0; k < 30; k++) {        // (no tyres here: the bodies alone, moving on as they go)
    const m0 = mom(); S.collide(race); const m1 = mom(); drift = Math.max(drift, Math.hypot(m1[0] - m0[0], m1[1] - m0[1]));
    gave ||= b.wingOff[1];                            // (its right half: the one that hit)
    for (const c of [a, b]) { c.x += (Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy) / 120; c.z += (Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy) / 120; c.h += c.yawRate / 120; }
  }
  const dv = a.v - 40;
  assert.ok(gave && b.damage.wing >= 0.5, `b's right wing half broke off (damage ${b.damage.wing.toFixed(2)})`);
  assert.ok(dv > 3 && drift < 1e-9, `shoved ${dv.toFixed(2)} m/s, momentum kept (${drift})`);
  assert.ok(Math.abs(a.vy) < 0.2 * dv, `sideways ${a.vy.toFixed(3)} m/s`);
  assert.ok(Math.abs(a.yawRate) < 1, `yaw ${a.yawRate.toFixed(2)} rad/s`);
});

test('airborne: a front tyre into the back of a rear tyre climbs it: a hop at 10 m/s, a flight and a flip at 30 m/s', () => {
  const T = S.track, fly = dv => {
    const race = S.createRace({ type: 'unlimited' }, { drivers: S.DRIVERS.slice(0, 2), seed: 1, wear: { damage: true } }), [a, b] = race.cars;
    let i0 = 0; for (let i = 0, run = 0; i < T.N; i++) { run = Math.abs(T.K[i]) < 0.002 ? run + 1 : 0; if (run > 60) { i0 = i - 40; break; } }
    const put = (c, i, lat, v) => { c.idx = i; c.x = T.PX[i] + T.NX[i] * lat; c.z = T.PZ[i] + T.NZ[i] * lat; c.h = S.headingAt(T, i); c.v = v; c.vy = 0; c.yawRate = 0; c.lap = 1; c.gear = 7; };
    put(a, i0, -0.7, 60); put(b, i0 - 4, 0.79, 60 + dv);         // b's left front tyre behind a's right rear one
    let top = 0; const seen = [];
    for (let k = 0; k < 480; k++) {
      race.t += DT;
      for (const c of [a, b]) S.drivePlayer(race, c, { thr: 0.3, brk: 0, steer: 0, analog: true }, DT);
      S.collide(race);
      top = Math.max(top, b.air?.y || 0);
      for (const c of [a, b]) { for (const e of c.events) if (c === b) seen.push(e); c.events.length = 0; }
    }
    return { top, seen, b };
  };
  const tap = fly(10), crash = fly(30);
  assert.ok(tap.top > 0.02 && tap.top < 0.5 && tap.seen.some(e => e.type === S.EV.LANDED && !e.flipped), `10 m/s: ${tap.top.toFixed(2)} m up, back on its wheels`);
  assert.ok(crash.top > 2 && crash.seen.some(e => e.type === S.EV.LANDED && e.flipped) && crash.b.beached, `30 m/s: ${crash.top.toFixed(2)} m up, landed upside down, stuck`);
  assert.ok(tap.seen.some(e => e.type === S.EV.WING_OFF), 'its front wing broke');
  // nobody flies in a race without contact
  const solo = S.createRace(2, { drivers: S.DRIVERS.slice(0, 1) }); run(S, solo, 200, aiDriver(S));
  assert.equal(solo.cars[0].air, null);
});

test('contact: cars fit side by side a car width apart; a side swipe pushes sideways', () => {
  const race = S.createRace(1, { drivers: S.DRIVERS.slice(0, 2) }), [a, b] = race.cars;
  a.h = b.h = 0; a.v = b.v = 50; b.x = a.x; b.z = a.z + 2 * HB.half + 0.2;   // +z is to the right at h = 0
  S.collide(race);
  assert.deepEqual(a.events, [], 'no contact alongside');
  a.vy = 3;                                                     // a drifts into b
  b.z = a.z + 2 * HB.half - 0.1;
  S.collide(race);
  assert.deepEqual(b.events.map(e => e.type), [S.EV.CONTACT]);
  assert.ok(b.vy > 0 && a.vy < 3, `b pushed right (${b.vy.toFixed(2)}), a slowed sideways (${a.vy.toFixed(2)})`);
  assert.ok(Math.abs(a.v - 50) < 0.01 && Math.abs(b.v - 50) < 0.01, 'forward speeds untouched');
});

test('seed: the same seed gives the same race, another seed a different one (race.rng)', () => {
  const finish = seed => { const race = S.createRace(2, { seed }); run(S, race, 300, aiDriver(S));
    return race.cars.map(c => `${c.code} ${c.finishTime.toFixed(4)} ${c.bias.toFixed(4)}`).join(' | '); };
  const a = finish(42);
  assert.equal(finish(42), a);
  assert.notEqual(finish(43), a);
  assert.equal(S.createRace(1, { seed: 7 }).seed, 7);
});
