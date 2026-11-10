// The steering assist for a phone or a pad (src/sim/steer-assist.js, adapted from LibreCorsa / AC Advanced Gamepad
// Assist): full tilt = the front tyres just under their peak slip angle, a full countersteer in a slide is caught, and
// nothing changes without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT } from './helpers.js';

const D = 180 / Math.PI;
const OPEN = S.buildTrack({ name: 'Pad', ctrl: [[0, 0], [1500, 0], [1500, 1500], [0, 1500]] }, { halfWidth: 160 });
function onOpen(kmh, gear) {
  const race = S.createRace(1, { track: OPEN, drivers: S.DRIVERS.filter(d => d.player) }), c = race.cars[0];
  Object.assign(c, { assists: S.ASSISTS.off, v: kmh / 3.6, gear, movedOff: true, lap: 1 });
  return { race, c };
}
const step = (race, c, inp) => { race.t += DT; S.drivePlayer(race, c, { thr: 0, brk: 0, analog: true, steerRate: Infinity, ...inp }, DT); };
// the front axle's slip angle (deg): its direction of travel vs where the wheels point
const frontSlip = c => (Math.atan2(c.vy + 3.4 * (1 - S.CHASSIS.frontWeight) * c.yawRate, c.v) - c.steer * S.steerLock(c.v, 0)) * D;

test('full tilt: the fronts just under their peak slip angle at any speed, more cornering than scrubbing them at full lock', () => {
  const peak = S.CHASSIS.peakSlip * D;
  for (const [kmh, gear] of [[120, 4], [200, 6], [280, 8]]) {
    const run = padAssist => { const { race, c } = onOpen(kmh, gear); let g = 0;
      for (let i = 0; i < 240; i++) { step(race, c, { steer: 1, padAssist }); g = Math.max(g, c.ay / 9.81); }
      return { c, g }; };
    const a = run('balanced'), d = run('');
    const slip = Math.abs(frontSlip(a.c));
    assert.ok(slip > 0.75 * peak && slip < 1.02 * peak, `${kmh} km/h: front slip ${slip.toFixed(2)}° (peak ${peak.toFixed(2)}°)`);
    assert.ok(a.g > d.g, `${kmh} km/h: ${a.g.toFixed(2)} g with it, ${d.g.toFixed(2)} g scrubbing at full lock`);
    assert.ok(a.c.steer < 0.5, `${kmh} km/h: far from the full lock (${a.c.steer.toFixed(2)})`);
  }
});

test('a slide: full opposite lock 0.15 s in spins the car without it, the assist catches it', () => {
  for (const [kmh, gear, slipK, yaw] of [[140, 4, 0.3, 1.2], [220, 6, 0.3, 0.9], [280, 8, 0.15, 0.7]]) {
    const run = padAssist => {
      const { race, c } = onOpen(kmh, gear);
      for (let i = 0; i < 120; i++) step(race, c, { thr: 0.3, steer: 0, padAssist });
      c.vy = -slipK * c.v; c.yawRate = yaw;                          // the rear steps out (turning right, sliding left)
      let mx = 0;
      for (let i = 0; i < 360; i++) { step(race, c, { thr: 0.3, steer: i > 18 ? -1 : 0.4, padAssist }); mx = Math.max(mx, Math.abs(S.driftAngle(c)) * D); }
      return mx;
    };
    const without = run(''), with_ = run('balanced');
    assert.ok(without > 30, `${kmh}: without the assist full opposite lock spins it (${without.toFixed(0)}°)`);
    assert.ok(with_ < 25, `${kmh}: caught (${with_.toFixed(0)}°)`);
  }
});

test('only with an analog controller and a preset; the keyboard, and no preset, steer as before', () => {
  for (const inp of [{ steer: 0.6, padAssist: '' }, { steer: 0.6, padAssist: 'balanced', analog: false }]) {
    const a = onOpen(200, 6), b = onOpen(200, 6);
    for (let i = 0; i < 60; i++) { step(a.race, a.c, inp); step(b.race, b.c, { steer: 0.6, analog: inp.analog ?? true }); }
    assert.equal(a.c.h, b.c.h); assert.equal(a.c.padAssist, '');
  }
  const { race, c } = onOpen(200, 6); step(race, c, { steer: 0.6, padAssist: 'stable' });
  assert.equal(c.padAssist, 'stable');
  assert.deepEqual(Object.keys(S.STEER_ASSIST), ['loose', 'balanced', 'stable']);
});
