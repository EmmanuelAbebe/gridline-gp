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

// A driver who uses the pit lane on their first lap past the entry (from 10 s in): along the pit road onto the fast
// lane, a swing into the box and a stop (stop = false: straight through), full gas while held there (it must not
// move), back out; elsewhere the proportional tester. Steers at a point ahead on that path, speeds by bang-bang pedals.
// limiter: the car's own pit limiter (limiterAuto off) pressed 20 m before the pit wall's start and 5 m after its end;
// arrive = the speed it brakes to for the pit wall's start
function pitDriver(T, { stop = true, lane = 75 / 3.6, arrive = lane, limiter = false, decel = 20 } = {}) {
  const base = tester(T), L = T.pit, box = L.boxes[S.DRIVERS.findIndex(d => d.player)], ds = T.ds;
  const sm = t => S.smoothstep(t);
  const pathLat = (p, served) => {
    if (stop && !served && p > box - 14 / ds && p <= box) return L.lane + (L.boxLat - L.lane) * sm((p - (box - 14 / ds)) / (13 / ds));
    if (stop && served && p > box && p < box + 11 / ds) return L.lane + (L.boxLat - L.lane) * (1 - sm((p - box) / (11 / ds)));
    return S.laneCentre(T, p);
  };
  const state = new WeakMap();
  return (r, c) => {
    const st = state.get(c) || {}; state.set(c, st);
    const p = S.alongLane(T, c);
    if (!st.done && p >= L.entry && p < L.entry + 10 && r.t > 10) st.on = true;
    if (st.on && p < 0) { st.on = false; st.done = true; }
    if (!st.on) return base(r, c);
    if (c.pit?.phase === 'stop') return S.drivePlayer(r, c, { thr: 1, brk: 0, steer: 1, analog: true }, DT);
    const served = c.pitStops > 0;
    let vt = p < L.from ? Math.sqrt(arrive * arrive + 2 * decel * Math.max(0, L.from - p) * ds) : p > L.to ? 80 : lane;
    let press = false;
    if (limiter && !st.in && p >= L.from - 20 / ds) press = st.in = true;
    else if (limiter && !st.out && p >= L.to + 5 / ds) press = st.out = true;
    if (stop && !served) vt = Math.min(vt, Math.sqrt(2 * 3 * Math.max(0, (box - p) * ds)));
    const look = Math.max(2, Math.round(Math.max(4, c.v * 0.35) / ds)), j = (c.idx + look) % T.N, lt = pathLat(p + look, served);
    const diff = S.wrapA(Math.atan2(T.PZ[j] + T.NZ[j] * lt - c.z, T.PX[j] + T.NX[j] * lt - c.x) - c.h), slow = c.v > vt;
    S.drivePlayer(r, c, { thr: slow ? 0 : 1, brk: slow ? Math.min(1, (c.v - vt) * 0.5 + 0.2) : 0, steer: S.clamp(diff * 3, -1, 1), analog: true, limiter: press }, DT);
  };
}

test('you drive the pit lane: 80 km/h limiter, stop in your box, held there until the service is done, then free', () => {
  for (const id of ['elkmoor', 'northfold']) {
    const T = S.buildTrack(S.CIRCUITS[id]), race = S.createRace(3, { track: T, drivers: player(), wear: { fuel: 'normal', tyres: 'normal', damage: true } });
    const c = race.cars[0], events = [];
    let maxLane = 0, held = null, moved = 0, heldFor = 0;
    const drive = pitDriver(T);
    run(S, race, 300, (r, car) => {
      drive(r, car);
      events.push(...car.events.map(e => e.type).filter(t => t.startsWith('pit')));
      if (car.pitLimiter) maxLane = Math.max(maxLane, Math.hypot(car.v, car.vy));
      if (car.pit?.phase === 'stop') { held ??= [car.x, car.z, car.h]; moved = Math.max(moved, Math.hypot(car.x - held[0], car.z - held[1]), Math.abs(car.h - held[2])); heldFor += DT; }
      if (car.pit?.drive) assert.ok(!car.wallHit, `${id}: no wall in the pit lane (p ${S.alongLane(T, car).toFixed(1)}, lat ${car.lat.toFixed(2)})`);
    });
    assert.deepEqual(events, [S.EV.PIT_IN, S.EV.PIT_STOP, S.EV.PIT_READY, S.EV.PIT_OUT], id);
    assert.ok(maxLane <= 80 / 3.6 + 1e-9, `${id}: ${(maxLane * 3.6).toFixed(1)} km/h in the lane`);
    assert.ok(moved === 0, `${id}: full gas in the box moved the car ${moved}`);
    assert.ok(heldFor > 2.3, `${id}: held ${heldFor.toFixed(2)} s for the service`);
    assert.ok(c.finished && c.pitStops === 1 && c.tyreWear < 0.3 && c.cuts === 0, `${id}: finished ${c.finished}, ${c.pitStops} stops, wear ${c.tyreWear}, cuts ${c.cuts}`);
    if (id === 'elkmoor') {                                             // the stop costs time: compare with a race without one
      const plain = S.createRace(3, { track: T, drivers: player() }); run(S, plain, 300, tester(T));
      const loss = c.finishTime - plain.cars[0].finishTime;
      assert.ok(loss > 8 && loss < 30, `the stop cost ${loss.toFixed(1)} s`);
    }
  }
});

test('the pit lane: drive straight through (no stop, no service); arriving too fast, the limiter cuts you to 80', () => {
  const T = S.track, race = S.createRace(3, { drivers: player(), wear: { tyres: 'normal' } }), c = race.cars[0], events = [];
  let atLine = 0, maxLane = 0;
  const drive = pitDriver(T, { stop: false, lane: 140 / 3.6 });
  run(S, race, 300, (r, car) => {
    drive(r, car);
    events.push(...car.events.map(e => e.type).filter(t => t.startsWith('pit')));
    if (car.pitLimiter) { atLine ||= car.v; maxLane = Math.max(maxLane, Math.hypot(car.v, car.vy)); }
  });
  assert.deepEqual(events, [S.EV.PIT_IN, S.EV.PIT_OUT]);
  assert.ok(atLine <= 80 / 3.6 + 1e-9 && maxLane <= 80 / 3.6 + 1e-9, `${(maxLane * 3.6).toFixed(1)} km/h`);
  assert.ok(c.finished && c.pitStops === 0 && c.tyreWear > 0.2);
});

test('your own pit limiter (BUTTON): on before the line = no penalty, held at 80; late or too fast = 5 s once', () => {
  const T = S.track, lap = opts => {
    const race = S.createRace(3, { drivers: player() }), c = race.cars[0], seen = [];
    c.limiterAuto = false;
    let maxLane = 0, atLine = 0;
    const drive = pitDriver(T, { stop: false, ...opts });
    // (decel: the bot plans its braking for the pit wall's start gently, or it arrives up to ~40 km/h too fast)
    run(S, race, 300, (r, car) => {
      drive(r, car);
      seen.push(...car.events.filter(e => [S.EV.PIT_SPEEDING, S.EV.LIMITER].includes(e.type)).map(e => e.type === S.EV.LIMITER ? (e.on ? 'on' : 'off') : 'speeding'));
      if (car.pit?.entered && S.alongLane(T, car) <= T.pit.to) { atLine ||= Math.hypot(car.v, car.vy); maxLane = Math.max(maxLane, Math.hypot(car.v, car.vy)); }
    });
    return { c, seen, maxLane: maxLane * 3.6, atLine: atLine * 3.6 };
  };
  // pressed in time, wanting 140 km/h in the lane: the limiter holds 80, no penalty, off again after the lane
  const good = lap({ lane: 140 / 3.6, arrive: 70 / 3.6, limiter: true, decel: 8 });
  assert.deepEqual(good.seen, ['on', 'off']);
  assert.ok(good.maxLane <= 80 + 1e-6 && good.maxLane > 79, `${good.maxLane.toFixed(2)} km/h`);
  assert.ok(good.c.penalty === 0 && !good.c.limiterOn && good.c.finished);
  // never pressed, 100 km/h in the lane: one penalty
  const none = lap({ lane: 100 / 3.6, arrive: 100 / 3.6 });
  assert.deepEqual(none.seen, ['speeding']);
  assert.ok(none.maxLane > 95, `${none.maxLane.toFixed(1)} km/h`);
  assert.equal(none.c.penalty, S.PIT.speeding.seconds);
  // pressed, but arriving at 110 km/h: the limiter doesn't brake, so that's speeding too (it then holds 80)
  const fast = lap({ lane: 140 / 3.6, arrive: 110 / 3.6, limiter: true });
  assert.deepEqual(fast.seen, ['on', 'speeding', 'off']);
  assert.ok(fast.atLine > 100, `${fast.atLine.toFixed(1)} km/h at the line`);
  assert.equal(fast.c.penalty, S.PIT.speeding.seconds);
  // with the limiter left on, the car can't pass 80 on the track either
  const race = S.createRace(3, { drivers: player() }), c = race.cars[0];
  c.limiterAuto = false;
  let top = 0;
  for (let i = 0; i < 1200; i++) { race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true, limiter: i === 0 }, DT); top = Math.max(top, c.v); c.events.length = 0; }
  assert.ok(top <= 80 / 3.6 + 1e-9 && top > 79 / 3.6, `${(top * 3.6).toFixed(2)} km/h`);
});

test('the pit lane has walls: the pit wall and the garages keep a car in it', () => {
  const T = S.track, L = T.pit;
  for (const [aim, lat] of [[-0.5, L.lane], [0.5, L.boxLat]]) {
    const race = S.createRace(2, { drivers: player() }), c = race.cars[0], i = Math.round((L.from + L.to) / 2) % T.N;
    Object.assign(c, { idx: i, lat, x: T.PX[i] + T.NX[i] * lat, z: T.PZ[i] + T.NZ[i] * lat, h: S.headingAt(T, i) + aim, v: 20, lap: 1 });
    let hit = false;
    for (let k = 0; k < 240; k++) {
      S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT);
      hit ||= c.events.some(e => e.type === S.EV.WALL); c.events.length = 0;
      assert.ok(c.pit?.drive && c.lat > L.wallLat && c.lat < L.garageLat, `${aim}: lat ${c.lat.toFixed(2)}`);
    }
    assert.ok(hit, `${aim}: hit the wall`);
  }
});

test('an AI car in the pit lane: wheels roll, heading follows the path, steering by its curve, clear of the other boxes', () => {
  const T = S.track, L = T.pit, d = S.DRIVERS.find(x => !x.player), k = S.DRIVERS.indexOf(d);
  const race = S.createRace(3, { drivers: [d], wear: { tyres: 'normal' } }), c = race.cars[0];
  let lastPos = null, worstSlip = 0, maxSteer = 0, rollAtStop = 0, worstBox = Infinity, out = false;
  for (let s = 0; s < 120 * 120 && !out; s++) {
    race.t += DT;
    if (c.lap === 1 && !c.pitStops && !c.pit) c.pitRequest = true;
    S.driveAI(race, c, DT);
    out ||= c.events.some(e => e.type === S.EV.PIT_OUT); c.events.length = 0;
    if (c.pit && lastPos && c.v > 1) {                               // moving the way it points (no sideways slide)
      const dir = Math.atan2(c.z - lastPos[1], c.x - lastPos[0]);
      worstSlip = Math.max(worstSlip, Math.abs(S.wrapA(dir - c.h)));
      maxSteer = Math.max(maxSteer, Math.abs(c.steer));
    }
    // over a neighbouring box (7 m long, 3 m wide; the car ~5.6 × 2.1 m): how far its side stays from the box's edge
    if (c.pit) for (const j of [k - 1, k + 1]) if (L.boxes[j] && Math.abs(c.pit.p - L.boxes[j]) * T.ds < 3.5 + 2.8)
      worstBox = Math.min(worstBox, (L.boxLat - 1.5) - (c.lat + 1.05));
    if (c.pit?.phase === 'stop' && !rollAtStop) rollAtStop = c.roll;
    lastPos = c.pit ? [c.x, c.z] : null;
  }
  assert.ok(out && c.pitStops === 1);
  assert.ok(worstSlip < 0.03, `slide ${(worstSlip * 57.3).toFixed(1)}°`);
  assert.ok(maxSteer > 0.05 && maxSteer < 1, `steers into the box (${maxSteer.toFixed(2)})`);
  assert.ok(rollAtStop > 100, 'the wheels rolled down the lane');
  assert.ok(worstBox > 0, `over the next box by ${(-worstBox).toFixed(2)} m`);
  // the crew's jobs add up to the stop
  const steps = S.serviceSteps({ fuel: 24, fuelTo: 60, wing: true, repair: true, tyres: true, time: 2.4 + 2 + 3 + 1.5 });
  assert.deepEqual(steps.map(s => s.job), ['tyres', 'fuel', 'wing', 'repair']);
  assert.ok(Math.abs(steps.at(-1).to - 8.9) < 1e-9);
});

test('driving onto the entry road puts you in the pit lane; the limiter starts at the pit wall', () => {
  const T = S.track, race = S.createRace(2, { drivers: player() }), c = race.cars[0];
  const i = (T.pit.entry + 5 + T.N) % T.N, lat = T.HW + 3;
  Object.assign(c, { idx: i, lat, x: T.PX[i] + T.NX[i] * lat, z: T.PZ[i] + T.NZ[i] * lat, h: S.headingAt(T, i), v: 40, lap: 1 });
  S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT);
  assert.ok(c.pit?.drive && !c.pitLimiter && !c.events.some(e => e.type === S.EV.PIT_IN));
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
