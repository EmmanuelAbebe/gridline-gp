// Tyre model tests (chassis.js): laps with different steering styles, wheel spin and traction control,
// lock-ups and ABS, the stability assist, surfaces, dirty air.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, run, centreProfile } from './helpers.js';

const T = S.track, { N, PX, PZ } = T, VP = centreProfile(S, T);
const solo = assists => { const race = S.createRace(1, { drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0]; c.assists = S.ASSISTS[assists]; return { race, c }; };

// A test driver: aims at the centre line 12 samples ahead, brakes to a centre-line speed profile.
//   analog: proportional steering (phone tilt), tap: keyboard tapping (key held for a share of each 0.12 s),
//   bang: full lock whenever the error passes 0.02 rad (the crudest keyboard driving)
function lap(assists, style, steerRate, calm) {
  const { race, c } = solo(assists);
  let step = 0;
  const seen = run(S, race, 120, (r, car) => {
    const ti = (car.idx + 12) % N, diff = S.wrapA(Math.atan2(PZ[ti] - car.z, PX[ti] - car.x) - car.h), want = S.clamp(diff * 3, -1, 1);
    const steer = style === 'analog' ? want : style === 'tap' ? ((step % 14) / 14 < Math.abs(want) ? Math.sign(want) : 0)
      : diff < -0.02 ? -1 : diff > 0.02 ? 1 : 0;
    const slow = car.v > VP[(car.idx + 4) % N];
    S.drivePlayer(r, car, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer, analog: style === 'analog', steerRate, calm }, DT);
    step++;
  });
  return { c, walls: seen.get(c)[S.EV.WALL] || 0 };
}

for (const [assists, style] of [['medium', 'analog'], ['medium', 'tap'], ['low', 'analog'], ['high', 'bang']]) {
  test(`lap: ${style} steering on ${assists} assists is clean and quick`, () => {
    const { c, walls } = lap(assists, style);
    assert.ok(c.finished, 'finished');
    assert.ok(c.finishTime < 42, `lap ${c.finishTime.toFixed(2)} s`);
    assert.equal(walls, 0);
  });
}

// the game sends controllers unsmoothed by default (Settings: steering smoothing off)
test('lap: analog steering with no smoothing (steerRate Infinity) on medium is clean, and the wheel follows at once', () => {
  const { c, walls } = lap('medium', 'analog', Infinity);
  assert.ok(c.finished, 'finished');
  assert.ok(c.finishTime < 42, `lap ${c.finishTime.toFixed(2)} s`);
  assert.equal(walls, 0);
  const { race, c: d } = solo('medium');
  S.drivePlayer(race, d, { thr: 0, brk: 0, steer: 0.8, analog: true, steerRate: Infinity }, DT);
  assert.equal(d.steer, 0.8);
});

test('calm steering at speed: a small tilt turns gently, full tilt still reaches the grip limit; laps clean', () => {
  const { c, walls } = lap('medium', 'analog', Infinity, 1);
  assert.ok(c.finished && c.finishTime < 42 && walls === 0, `lap ${c.finishTime?.toFixed(2)} s, ${walls} wall hits`);
  const v = 300 / 3.6;
  assert.ok(Math.abs(S.calmSteer(0.1, v, 1)) < 0.05, `0.1 tilt -> ${S.calmSteer(0.1, v, 1).toFixed(3)}`);
  assert.equal(S.calmSteer(1, v, 1), 1);
  assert.equal(S.calmSteer(0.1, v, 0), 0.1);
  assert.ok(Math.abs(S.calmSteer(0.1, 60 / 3.6, 1) - 0.1) < 0.02, 'little change at low speed');
});

test('lap: with no assists the crude keyboard driver loses the car (assists matter)', () => {
  const { c } = lap('off', 'bang');
  assert.ok(!c.finished || c.finishTime > 50);
});

// on a straight: heading pinned along the track, as in the vehicle tests
const pin = c => { c.h = S.headingAt(T, c.idx) + S.clamp(-c.lat * 0.1, -0.2, 0.2); c.yawRate = 0; c.vy = 0; };
function straight(race, c, inp, seconds, each = () => {}) {
  for (let i = 0; i < seconds * 120; i++) { race.t += DT; S.drivePlayer(race, c, inp, DT); pin(c); each(c); }
}

test('traction control: full throttle from a standstill spins the rears only without it', () => {
  for (const [assists, expectSpin] of [['off', true], ['medium', false]]) {
    const { race, c } = solo(assists); let spun = false;
    straight(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, 3, c => { spun ||= c.spinR; });
    assert.equal(spun, expectSpin, assists);
  }
});

test('ABS: a full stop from 120 km/h locks the fronts only without it, and ABS stops shorter', () => {
  const stop = assists => {
    const { race, c } = solo(assists); c.v = 120 / 3.6; c.gear = 4; let locked = false, dist = 0;
    straight(race, c, { thr: 0, brk: 1, steer: 0, analog: true }, 4, c => { locked ||= c.lockF; if (c.gear !== -1) dist += Math.max(0, c.v) * DT; });
    return { locked, dist };
  };
  const off = stop('off'), on = stop('medium');
  assert.ok(off.locked, 'locks without ABS');
  assert.ok(!on.locked, 'no lock with ABS');
  assert.ok(on.dist < off.dist, `ABS ${on.dist.toFixed(1)} m vs locked ${off.dist.toFixed(1)} m`);
});

// a circuit 160 m wide, so a car can turn as hard as it likes without leaving the asphalt
const OPEN = S.buildTrack({ name: 'Pad', ctrl: [[0, 0], [1500, 0], [1500, 1500], [0, 1500]] }, { halfWidth: 160 });
test('stability: full lock held at 250 km/h stays controlled on medium, rotates the car more with assists off', () => {
  const drift = assists => {
    const race = S.createRace(1, { track: OPEN, drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0];
    c.assists = S.ASSISTS[assists]; c.v = 250 / 3.6; c.gear = 6; let maxDrift = 0;
    for (let i = 0; i < 120 * 1.2; i++) {
      race.t += DT; S.drivePlayer(race, c, { thr: 0.6, brk: 0, steer: 1, analog: true }, DT);
      assert.equal(c.surface, 'track'); maxDrift = Math.max(maxDrift, Math.abs(S.driftAngle(c)));
    }
    return maxDrift;
  };
  const medium = drift('medium'), off = drift('off');
  assert.ok(medium < 0.12, `medium drift ${medium.toFixed(3)} rad`);
  assert.ok(off > medium, `off ${off.toFixed(3)} vs medium ${medium.toFixed(3)}`);
});

test('trail braking: on OFF and LOW, braking while turning in stays controllable; a stamp on the pedal still locks without ABS', () => {
  // brake straight 0.3 s, then ease the steering in over 0.3 s while still braking
  const trail = (assists, kmh, brk, steer) => {
    const race = S.createRace(1, { track: OPEN, drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0];
    c.assists = S.ASSISTS[assists]; c.v = kmh / 3.6; c.gear = 6; let drift = 0, lock = false;
    for (let i = 0; i < 156 && c.v > 15; i++) {
      race.t += DT; S.drivePlayer(race, c, { thr: 0, brk, steer: i < 36 ? 0 : steer * Math.min(1, (i - 36) / 36), analog: true, calm: 1, steerRate: Infinity }, DT);
      drift = Math.max(drift, Math.abs(S.driftAngle(c))); lock ||= c.lockF;
    }
    return { drift, lock };
  };
  for (const assists of ['off', 'low']) for (const kmh of [120, 200, 280]) {
    const { drift } = trail(assists, kmh, 0.3, 0.3);
    assert.ok(drift < 0.08, `${assists} ${kmh} km/h: drift ${(drift * 57.3).toFixed(0)}°`);
  }
  for (const kmh of [120, 200, 280]) assert.ok(trail('off', kmh, 0.5, 0.5).drift < 0.1, `off ${kmh}: half brake + half tilt does not spin`);
  assert.ok(!trail('off', 120, 0.5, 0).lock, 'half pedal in a straight line does not lock');
  assert.ok(trail('off', 120, 1, 0).lock, 'full pedal locks without ABS');
});

test('surfaces: off the track the car is slowed to about 60 km/h, firmly but not like a wall, and can drive at that', () => {
  const drive = (surface, v0, thr, seconds) => {
    const { race, c } = solo('medium'); c.v = v0; c.gear = v0 ? 7 : 1;
    for (let i = 0; i < seconds * 120; i++) { race.t += DT; c.surface = surface; S.drivePlayer(race, c, { thr, brk: 0, steer: 0, analog: true }, DT); pin(c); }
    return c.v * 3.6;
  };
  for (const surface of ['grass', 'sand']) {
    const top = drive(surface, 0, 1, 6);
    assert.ok(top > 55 && top < 72, `${surface}: full throttle settles at ${top.toFixed(0)} km/h`);
    assert.ok(drive(surface, 300 / 3.6, 0, 1) > 120, `${surface}: one second after running wide at 300 km/h`);
    assert.ok(drive(surface, 300 / 3.6, 1, 4) < 80, `${surface}: slowed to near 60 km/h even on the throttle`);
  }
  assert.ok(drive('sand', 300 / 3.6, 0, 1) < drive('grass', 300 / 3.6, 0, 1), 'gravel slows harder than grass');
});

test('surfaces: the car knows kerb, sand and grass where they are painted', () => {
  const { c } = solo('medium');
  // a corner sample: kerbs painted, gravel on the outside
  const i = [...T.K].findIndex(k => Math.abs(k) > T.SAND_K), outside = T.K[i] > 0 ? -1 : 1;
  const surface = lat => { c.idx = i; c.x = T.PX[i] + T.NX[i] * lat; c.z = T.PZ[i] + T.NZ[i] * lat; const r = S.createRace(1); r.cars = [c]; S.drivePlayer(r, c, { thr: 0, brk: 0, steer: 0, analog: true }, 0); return c.surface; };
  assert.equal(surface(0), 'track');
  assert.equal(surface(outside * (T.HW + 0.7)), 'kerb');
  assert.equal(surface(outside * (T.HW + T.KERB + 2)), 'sand');
  assert.equal(surface(-outside * (T.HW + T.KERB + 2)), 'grass', 'no gravel on the inside');
});
