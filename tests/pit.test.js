// Pit lane and pit stops (pit.js): the lane on every circuit, a stop from request to rejoining (limiter, box,
// service), fuel / tyres / damage and what they do, the AI's strategy, and that all of it is off unless asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, run, seeded, aiDriver, centreProfile } from './helpers.js';

const player = () => S.DRIVERS.filter(d => d.player);
// the proportional test driver (centre line, braking to a centre-line profile); `box` = ask to pit on that lap
function tester(T, box = 0) {
  const VP = centreProfile(S, T);
  return (r, car) => {
    if (box && car.lap === box && !car.pitStops) car.pitRequest = true;
    const ti = (car.idx + 12) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - car.z, T.PX[ti] - car.x) - car.h);
    const slow = car.v > VP[(car.idx + 4) % T.N];
    S.drivePlayer(r, car, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true }, DT);
  };
}

test('every circuit has a pit lane: entry road, pit wall, a box per team in order, exit road', () => {
  for (const [id, circuit] of Object.entries(S.CIRCUITS)) {
    const T = S.buildTrack(circuit), L = T.pit;
    assert.ok(L, `${id}: pit lane`);
    assert.ok(L.entry < L.from && L.from < L.to && L.to < L.exit, `${id}: in order`);
    for (const b of L.boxes) assert.ok(b > L.from + 5 && b < L.to - 5, `${id}: box ${b.toFixed(0)} within the lane`);
    assert.ok(L.lane > L.wallLat + 1 && L.boxLat > L.lane + 3 && L.garageLat > L.boxLat + 3, `${id}: wall, fast lane, boxes, garages`);
  }
});

test('a pit stop: request, 80 km/h limiter, stop in the box, service, back on track, then the race goes on', () => {
  const T = S.track, race = S.createRace(3, { drivers: player(), wear: { fuel: 'normal', tyres: 'normal', damage: true } }), c = race.cars[0];
  const events = []; let maxLane = 0, stopIdx = -1;
  run(S, race, 200, (r, car) => {
    tester(T, 1)(r, car);
    events.push(...car.events.map(e => e.type).filter(t => t.startsWith('pit')));
    if (car.pit?.phase === 'stop') stopIdx = car.idx;
    if (car.pit && car.pit.p > T.pit.from && car.pit.p < T.pit.to) maxLane = Math.max(maxLane, car.v);
  });
  assert.deepEqual([...new Set(events)], [S.EV.PIT_IN, S.EV.PIT_STOP, S.EV.PIT_READY, S.EV.PIT_GO, S.EV.PIT_OUT]);
  assert.ok(maxLane <= 80 / 3.6 + 0.01, `${(maxLane * 3.6).toFixed(1)} km/h in the lane`);
  const box = T.pit.boxes[S.DRIVERS.findIndex(d => d.player)] % T.N;
  assert.ok(Math.abs(stopIdx - box) <= 1, `stopped at ${stopIdx}, box ${box.toFixed(1)}`);
  assert.ok(c.finished && c.pitStops === 1 && c.tyreWear < 0.3, `finished ${c.finished}, ${c.pitStops} stops, wear ${c.tyreWear}`);
  // the stop costs time: compare with a race without one
  const plain = S.createRace(3, { drivers: player() }); run(S, plain, 200, tester(T));
  const loss = c.finishTime - plain.cars[0].finishTime;
  assert.ok(loss > 8 && loss < 30, `the stop cost ${loss.toFixed(1)} s`);
});

test('in the pit lane the car drives: wheels roll, heading follows the path, steering by its curve; it waits for the gas', () => {
  const T = S.track, race = S.createRace(3, { drivers: player(), wear: { tyres: 'normal' } }), c = race.cars[0];
  let lastPos = null, worstSlip = 0, maxSteer = 0, readyAt = -1, left = -1, rollAtStop = 0;
  const drive = tester(T, 1);
  for (let s = 0; s < 120 * 120 && left < 0; s++) {
    race.t += DT;
    if (c.pit?.done) {                                               // serviced: no gas for 2 s, then gas
      if (readyAt < 0) readyAt = race.t;
      S.drivePlayer(race, c, { thr: race.t - readyAt > 2 ? 1 : 0, brk: 0, steer: 0, analog: true }, DT);
    } else drive(race, c);
    for (const e of c.events) if (e.type === S.EV.PIT_GO) left = race.t;
    c.events.length = 0;
    if (c.pit && lastPos && c.v > 1) {                               // moving the way it points (no sideways slide)
      const dir = Math.atan2(c.z - lastPos[1], c.x - lastPos[0]);
      worstSlip = Math.max(worstSlip, Math.abs(S.wrapA(dir - c.h)));
      maxSteer = Math.max(maxSteer, Math.abs(c.steer));
    }
    if (c.pit?.phase === 'stop' && !rollAtStop) rollAtStop = c.roll;
    lastPos = c.pit ? [c.x, c.z] : null;
  }
  assert.ok(left > 0 && left - readyAt >= 2 - 1e-6, `waited ${(left - readyAt).toFixed(2)} s for the gas`);
  assert.ok(worstSlip < 0.03, `slide ${(worstSlip * 57.3).toFixed(1)}°`);
  assert.ok(maxSteer > 0.05 && maxSteer < 1, `steers into the box (${maxSteer.toFixed(2)})`);
  assert.ok(rollAtStop > 100, 'the wheels rolled down the lane');
  // the crew's jobs add up to the stop
  const steps = S.serviceSteps({ fuel: 24, fuelTo: 60, wing: true, repair: true, tyres: true, time: 2.4 + 2 + 3 + 1.5 });
  assert.deepEqual(steps.map(s => s.job), ['tyres', 'fuel', 'wing', 'repair']);
  assert.ok(Math.abs(steps.at(-1).to - 8.9) < 1e-9);
});

test('driving onto the entry road is a pit stop too', () => {
  const T = S.track, race = S.createRace(2, { drivers: player() }), c = race.cars[0];
  const i = (T.pit.entry + 5 + T.N) % T.N, lat = T.HW + 3;
  Object.assign(c, { idx: i, lat, x: T.PX[i] + T.NX[i] * lat, z: T.PZ[i] + T.NZ[i] * lat, h: S.headingAt(T, i), v: 40, lap: 1 });
  S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT);
  assert.ok(c.pit && c.events.some(e => e.type === S.EV.PIT_IN));
});

test('fuel: a short race needs no stop, a long one does; warnings; an empty tank leaves the car limping', () => {
  const T = S.track;
  const short = S.createRace(3, { drivers: player(), wear: { fuel: 'normal' } });
  assert.ok(S.fuelLaps(short, short.cars[0]) > 3 && S.fuelLaps(short, short.cars[0]) < 4, 'just enough for 3 laps');
  const long = S.createRace(12, { drivers: player(), wear: { fuel: 'high' } }), c = long.cars[0], seen = [];
  assert.ok(Math.abs(S.fuelLaps(long, c) - 4) < 1e-9, 'a full tank: 4 laps');
  run(S, long, 200, (r, car) => { tester(T)(r, car); seen.push(...car.events.map(e => e.type)); if (car.lap >= 6) car.finished = true; });
  assert.ok(seen.includes(S.EV.FUEL_LOW) && seen.includes(S.EV.FUEL_BOX) && seen.includes(S.EV.FUEL_OUT), 'warned, then ran dry');
  const v = c.v; for (let k = 0; k < 120; k++) S.drivePlayer(long, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT);
  assert.ok(c.fuel === 0 && c.v < v + 10, 'empty: barely accelerates');
});

test('damage: a nose-first wall hit breaks the front wing (understeer); off by default', () => {
  const T = S.track, hit = wear => {
    const race = S.createRace(1, { drivers: player(), wear }), c = race.cars[0], i = 300, R = T.runoff[1];
    const lat = R.wall[i] - 1.5;
    Object.assign(c, { idx: i, x: T.PX[i] + T.NX[i] * lat, z: T.PZ[i] + T.NZ[i] * lat, h: S.headingAt(T, i) + 1.2, v: 35, lap: 1 });
    S.drivePlayer(race, c, { thr: 0, brk: 0, steer: 0, analog: true }, DT);
    return c;
  };
  assert.equal(hit({}).damage.wing, 0, 'off by default');
  const c = hit({ damage: true });
  assert.ok(c.damage.wing > 0.5, `wing ${c.damage.wing.toFixed(2)}`);
  assert.ok(c.events.some(e => e.type === S.EV.DAMAGE));
  assert.ok(S.carCondition(c).front < 0.8, 'front downforce lost');
});

test('tyres wear out over the laps (and sliding wears them faster); worn tyres grip less', () => {
  const T = S.track, race = S.createRace(5, { drivers: player(), wear: { tyres: 'high' } }), c = race.cars[0];
  run(S, race, 200, tester(T));
  assert.ok(c.tyreWear > 0.8, `wear ${c.tyreWear.toFixed(2)} after 5 laps`);
  assert.ok(S.carCondition(c).grip < 0.9);
});

test('AI strategy: on a long race with thirsty cars every AI car stops once and nobody runs dry', () => seeded(() => {
  // (a car that comes in with a broken front wing, e.g. from a lap-1 incident, may stop once more for it)
  const race = S.createRace(6, { aiPace: 0.95, wear: { fuel: 'high', tyres: 'normal', damage: true } }), wingStops = new Map();
  const seen = run(S, race, 700, (r, c) => { aiDriver(S)(r, c); if (c.events.some(e => e.type === S.EV.PIT_IN) && c.damage.wing > S.PIT.ai.wing) wingStops.set(c, (wingStops.get(c) || 0) + 1); });
  assert.ok(race.cars.every(c => c.finished), 'all finished');
  for (const c of race.cars) {
    const wing = wingStops.get(c) || 0, other = c.pitStops - wing;     // a wing stop refuels too, so it may be the only one
    assert.ok(other === 1 || (other === 0 && wing >= 1), `${c.code}: ${c.pitStops} stops (${wing} for the wing)`);
    assert.ok(!seen.get(c)[S.EV.FUEL_OUT], `${c.code} ran dry`);
  }
  const walls = race.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0);
  assert.ok(walls <= 2, `${walls} wall hits`);
}));
