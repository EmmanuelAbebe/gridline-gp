// Replays (src/sim/replay.js): a race driven again from the player's recorded inputs gives the same race, to the bit,
// including settings changed mid-race (assists, gearbox, the BOX call) and other cars on track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, centreProfile } from './helpers.js';

// a test driver that makes the inputs the game would (proportional steering to the centre line, bang-bang pedals,
// paddles now and then), with some noise so every channel changes often
function driver(T, seed = 3) {
  const VP = centreProfile(S, T);
  let a = seed;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  return car => {
    const ti = (car.idx + 12) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - car.z, T.PX[ti] - car.x) - car.h);
    const slow = car.v > VP[(car.idx + 4) % T.N];
    return { steer: S.clamp(diff * 3 + (rnd() - 0.5) * 0.02, -1, 1), thr: slow ? 0 : 0.97 + rnd() * 0.03, brk: slow ? 0.8 + rnd() * 0.2 : 0,
      analog: true, hb: 0, shift: rnd() < 0.002 ? 1 : 0, steerRate: Infinity, calm: 1, speedSteer: 0.5 };
  };
}
const hashOf = cars => cars.map(c => [c.x, c.z, c.h, c.v, c.vy, c.yawRate, c.lap, c.gear, c.soc].join(',')).join('|');

// the game's loop (main.js simStep) with a recorder: the car's settings changed now and then as the menus would
function drive(T, { cars = 1, seconds = 120, changes = true } = {}) {
  const drivers = [...S.DRIVERS.filter(d => !d.player).slice(0, cars - 1), S.DRIVERS.find(d => d.player)];   // (you at the back)
  const opts = { format: { type: 'unlimited' }, wear: cars > 1 ? { fuel: 'normal', tyres: 'normal', damage: true } : {}, compound: 'medium' };
  const race = S.createRace(opts.format, { track: T, drivers, seed: 77, activeAero: true, tyreTemp: true, wear: opts.wear, compound: opts.compound });
  const car = race.cars.find(c => c.player), input = driver(T);
  car.spec = S.carSpec({ wing: 7 }, {}); S.fitTyres(race, car, 'soft');
  car.autoShift = true; car.assists = { ...S.ASSISTS.off };
  const rec = S.createReplayRecorder(race, { ...opts, finishedAiSkill: 0.62 }, { setup: { wing: 7 }, mods: {}, compound: 'soft' });
  const laps = [];
  for (let step = 0; step < seconds * 120; step++) {
    if (changes && step === 2000) car.assists = { ...S.ASSISTS.medium };            // Settings → Driving, mid-race
    if (changes && step === 4000) { car.autoShift = false; car.autoDown = true; car.downQueue = 0; }   // semi-auto
    if (changes && step === 6000) car.pitRequest = true;                              // BOX
    race.t += DT;
    for (const c of race.cars) {
      if (c.player && !c.finished) { const inp = S.quantizeInput(input(c)); rec.step(c, inp); S.drivePlayer(race, c, inp, DT); }
      else S.driveAI(race, c, DT, c.finished ? 0.62 : 0);
    }
    S.collide(race);
    for (const e of car.events) if (e.type === S.EV.LAP) laps.push({ lap: car.lap - 1, time: e.time, invalid: !!e.invalid });
    for (const c of race.cars) c.events.length = 0;
  }
  return { race, laps, replay: rec.finish() };
}

test('a replay drives the very same race: every lap time and every car\'s state to the last bit', () => {
  for (const [id, cars] of [['elkmoor', 1], ['marrow', 4]]) {
    const T = S.buildTrack(S.CIRCUITS[id]), live = drive(T, { cars, seconds: 150 });
    assert.ok(live.laps.length >= 1, `${id}: laps driven (${live.laps.length})`);
    const json = JSON.parse(JSON.stringify(live.replay));                      // (as it would travel)
    const again = S.replayRun(json, { track: S.buildTrack(S.CIRCUITS[id]) });
    assert.deepEqual(again.laps, live.laps, `${id}: the same laps`);
    assert.equal(hashOf(again.race.cars), hashOf(live.race.cars), `${id}: the same state at the end`);
    assert.ok(json.changes.length >= 3, `${id}: the mid-race changes were recorded (${json.changes.length})`);
  }
});

test('a replay without the mid-race changes would differ (they matter, so they must be recorded)', () => {
  const T = S.buildTrack(S.CIRCUITS.elkmoor), live = drive(T, { seconds: 60 });
  const rp = { ...JSON.parse(JSON.stringify(live.replay)), changes: [] };
  assert.notEqual(hashOf(S.replayRun(rp, { track: S.buildTrack(S.CIRCUITS.elkmoor) }).race.cars), hashOf(live.race.cars));
});

test('quantised inputs; broken or foreign replays are refused', () => {
  const i = S.quantizeInput({ steer: 0.123456, thr: 1.5, brk: -1, analog: 1, shift: -3 });
  assert.equal(i.steer * S.REPLAY.steer, Math.round(0.123456 * S.REPLAY.steer)); assert.equal(i.thr, 1); assert.equal(i.brk, 0); assert.equal(i.shift, -1);
  assert.deepEqual(S.quantizeInput(i), i, 'quantising twice changes nothing');
  const T = S.buildTrack(S.CIRCUITS.elkmoor), { replay } = drive(T, { seconds: 5, changes: false });
  for (const bad of [{ v: 99 }, { physics: 0 }, { circuit: 'mars' }, { tainted: 'autopilot' }])
    assert.throws(() => S.replayRun({ ...replay, ...bad }, { track: T }));
  assert.ok(JSON.stringify(replay).length < 20000, 'small');
});

test('the sim version stamp is up to date (npm run sim-version after changing src/sim)', async () => {
  const { simHash } = await import('../tools/sim-version.mjs');
  assert.equal(S.SIM_VERSION, simHash(), 'src/sim changed: run npm run sim-version');
});
