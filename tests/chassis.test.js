// Tyre model tests (chassis.js): laps with different steering styles, wheel spin and traction control,
// lock-ups and ABS, the stability assist, dirty air (surfaces: offtrack.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, run, centreProfile } from './helpers.js';

// (lap times: real-F1 physics since 2026-10-24, the bots ~47–49 s on Elkmoor; ~38–41 s before)
const T = S.track, { N, PX, PZ } = T, VP = centreProfile(S, T);
const solo = assists => { const race = S.createRace(1, { drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0]; c.assists = S.ASSISTS[assists]; return { race, c }; };

// A test driver: aims at the centre line 12 samples ahead, brakes to a centre-line speed profile.
//   analog: proportional steering (phone tilt), tap: keyboard tapping (key held for a share of each 0.12 s),
//   bang: full lock whenever the error passes 0.02 rad (the crudest keyboard driving)
function lap(assists, style, steerRate, calm, speedSteer) {
  const { race, c } = solo(assists);
  let step = 0;
  const seen = run(S, race, 120, (r, car) => {
    const ti = (car.idx + 12) % N, diff = S.wrapA(Math.atan2(PZ[ti] - car.z, PX[ti] - car.x) - car.h), want = S.clamp(diff * 3, -1, 1);
    const steer = style === 'analog' ? want : style === 'tap' ? ((step % 14) / 14 < Math.abs(want) ? Math.sign(want) : 0)
      : diff < -0.02 ? -1 : diff > 0.02 ? 1 : 0;
    const slow = car.v > VP[(car.idx + 4) % N];
    S.drivePlayer(r, car, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer, analog: style === 'analog', steerRate, calm, speedSteer }, DT);
    step++;
  });
  return { c, walls: seen.get(c)[S.EV.WALL] || 0 };
}

for (const [assists, style] of [['medium', 'analog'], ['medium', 'tap'], ['low', 'analog'], ['high', 'bang']]) {
  test(`lap: ${style} steering on ${assists} assists is clean and quick`, () => {
    const { c, walls } = lap(assists, style);
    assert.ok(c.finished, 'finished');
    assert.ok(c.finishTime < 50, `lap ${c.finishTime.toFixed(2)} s`);
    assert.equal(walls, 0);
  });
}

// the game sends controllers unsmoothed by default (Settings: steering smoothing off)
test('lap: analog steering with no smoothing (steerRate Infinity) on medium is clean, and the wheel follows at once', () => {
  const { c, walls } = lap('medium', 'analog', Infinity);
  assert.ok(c.finished, 'finished');
  assert.ok(c.finishTime < 50, `lap ${c.finishTime.toFixed(2)} s`);
  assert.equal(walls, 0);
  const { race, c: d } = solo('medium');
  S.drivePlayer(race, d, { thr: 0, brk: 0, steer: 0.8, analog: true, steerRate: Infinity }, DT);
  assert.equal(d.steer, 0.8);
});

test('calm steering at speed: a small tilt turns gently, full tilt still reaches the grip limit; laps clean', () => {
  const { c, walls } = lap('medium', 'analog', Infinity, 1);
  assert.ok(c.finished && c.finishTime < 50 && walls === 0, `lap ${c.finishTime?.toFixed(2)} s, ${walls} wall hits`);
  const v = 300 / 3.6;
  // (the real-grip car has less to give at 300 km/h than the old one, so calm takes less off: 0.57 × the tilt)
  assert.ok(Math.abs(S.calmSteer(0.1, v, 1)) < 0.06, `0.1 tilt -> ${S.calmSteer(0.1, v, 1).toFixed(3)}`);
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
      // (0.8 pedal ≈ 0.7 of the torque through the torque map: 0.6 as with the old linear pedal)
      race.t += DT; S.drivePlayer(race, c, { thr: 0.8, brk: 0, steer: 1, analog: true }, DT);
      assert.equal(c.surface, 'track'); maxDrift = Math.max(maxDrift, Math.abs(S.driftAngle(c)));
    }
    return maxDrift;
  };
  const medium = drift('medium'), off = drift('off');
  assert.ok(medium < 0.12, `medium drift ${medium.toFixed(3)} rad`);
  assert.ok(off > medium, `off ${off.toFixed(3)} vs medium ${medium.toFixed(3)}`);
});

test('spins: with no assists, full lock and full throttle spins the car right round, keeping its speed through 90°', () => {
  // (until 2026-10-17 a car past ~60–90° counted as crawling, by its speed along its heading, and the slide was wiped out)
  const race = S.createRace(1, { track: OPEN, drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0];
  c.assists = S.ASSISTS.off; c.v = 120 / 3.6; c.gear = 4;
  let maxSlide = 0, prev = Math.hypot(c.v, c.vy), maxDrop = 0;
  for (let i = 0; i < 120 * 2; i++) {
    race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 1, analog: true, steerRate: Infinity }, DT);
    maxSlide = Math.max(maxSlide, Math.abs(Math.atan2(c.vy, c.v)));
    const sp = Math.hypot(c.v, c.vy); maxDrop = Math.max(maxDrop, (prev - sp) / DT); prev = sp;
  }
  assert.ok(maxSlide > 2.5, `slid ${(maxSlide * 57.3).toFixed(0)}° (past 140°: the car goes round)`);
  assert.ok(maxDrop < 40, `speed never drops faster than the tyres can slow it (${maxDrop.toFixed(0)} m/s²)`);
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
  // the pedal sets the brake pressure, the same at any speed (as on a real car, since 2026-10-24): half of it holds at
  // 280 km/h, where the downforce gives the tyres a lot, but locks them at 120 km/h; full pedal locks without ABS
  assert.ok(!trail('off', 280, 0.5, 0).lock, 'half pedal at 280 km/h does not lock');
  assert.ok(trail('off', 120, 0.5, 0).lock, 'half pedal at 120 km/h locks: ease it off as the car slows');
  assert.ok(trail('off', 120, 1, 0).lock, 'full pedal locks without ABS');
});


// the handbrake (inp.hb, player only): locks the rears, so a car turning at hairpin speed rotates much more
test('handbrake: the rears lock and the car rotates in a turn; it stops a crawling car; off changes nothing', () => {
  const turn = (hb, assists = 'low') => {
    const { race, c } = solo(assists);
    c.v = 60 / 3.6;
    let maxYaw = 0, slid = 0;
    for (let i = 0; i < 120; i++) {
      race.t += DT;
      S.drivePlayer(race, c, { thr: 0, brk: 0, steer: 0.6, analog: true, steerRate: Infinity, hb: i > 20 && i < 80 ? hb : 0 }, DT);
      maxYaw = Math.max(maxYaw, Math.abs(c.yawRate)); slid = Math.max(slid, c.slideR);
    }
    return { maxYaw, slid, h: c.h };
  };
  const plain = turn(0), pulled = turn(1);
  assert.ok(pulled.slid > 0.9 && plain.slid < 0.5, `rear slide ${pulled.slid.toFixed(2)} vs ${plain.slid.toFixed(2)}`);
  assert.ok(pulled.maxYaw > plain.maxYaw * 1.3, `yaw ${pulled.maxYaw.toFixed(2)} vs ${plain.maxYaw.toFixed(2)} rad/s`);
  assert.equal(turn(undefined).h, plain.h, 'no hb field = hb 0');
  const { race, c } = solo('medium');
  c.v = 1.5;
  for (let i = 0; i < 120; i++) { race.t += DT; S.drivePlayer(race, c, { thr: 0, brk: 0, steer: 0, hb: 1 }, DT); }
  assert.ok(Math.abs(c.v) < 0.01, `crawl stopped: ${c.v}`);
});

// speed-sensitive steering (a controller mapping, SPEED_STEER): with assists OFF the tilt range matches the grip at
// every speed, the last part of the travel still reaches the full lock, and it does nothing when the car's own
// steering help is already as strong
test('speed-sensitive steering: with it, LOW assists lap as clean as medium for a tilt driver; full travel = full lock; no effect on medium', () => {
  const k = S.ASSISTS.medium.steer;
  const { c, walls } = lap('low', 'analog', Infinity, 1, k);
  assert.ok(c.finished && c.finishTime < 50 && walls === 0, `lap ${c.finishTime?.toFixed(2)} s, ${walls} wall hits`);
  const v = 300 / 3.6, raw = S.steerLock(v, 0), use = S.steerLock(v, k);
  assert.ok(Math.abs(S.speedSteer(S.SPEED_STEER.catchFrom, v, k, 0) * raw - use) < 1e-9, 'the usable angle at catchFrom of the travel');
  assert.equal(S.speedSteer(1, v, k, 0), 1, 'full travel = full lock (opposite lock for slides)');
  assert.equal(S.speedSteer(-1, v, k, 0), -1);
  assert.equal(S.speedSteer(0.5, v, k, k), 0.5, 'medium already has it');
  assert.ok(Math.abs(S.speedSteer(0.5, 5, k, 0) - 0.5 / S.SPEED_STEER.catchFrom) < 0.05, 'little change at walking pace');
});

// (2026-10-24: LOW's ABS / traction control let the tyres go 4.5 % / 9.5 % past their grip, so they locked and spun
// exactly as with none)
test('low assists: full brake never locks the fronts, full throttle from a standstill never spins the rears', () => {
  const { race, c } = solo('low'), i = 60;
  Object.assign(c, { idx: i, lat: 0, x: PX[i], z: PZ[i], h: S.headingAt(T, i), v: 280 / 3.6, gear: 8, lap: 1 });
  let lock = false; straight(race, c, { thr: 0, brk: 1, steer: 0, analog: true }, 1.2, car => { lock ||= car.lockF; });
  assert.ok(!lock, 'no front lock-up under full brake');
  const s = solo('low'); let spin = false; Object.assign(s.c, { lap: 1 });
  straight(s.race, s.c, { thr: 1, brk: 0, steer: 0, analog: true }, 3, car => { spin ||= car.spinR; });
  assert.ok(!spin, 'no wheel spin pulling away at full throttle');
});
