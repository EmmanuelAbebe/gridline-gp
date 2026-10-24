// AI driver tests (driving.js driveAI on the tyre model): racing line, pace, racecraft, mistakes, recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { DT, seeded, run } from './helpers.js';

const T = S.track, { N, HW, K, LK, RO } = T;
const field = codes => S.DRIVERS.filter(d => codes.includes(d.code)).sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));
const hard = (race, seen) => race.cars.reduce((n, c) => n + (seen.get(c).hard || 0), 0) / 2;
// like run(), also counting contacts harder than 3 m/s
function race(r, seconds, skills = {}) {
  const seen = new Map(r.cars.map(c => [c, {}]));
  for (let step = 0; step < seconds * 120 && !r.cars.every(c => c.finished); step++) {
    r.t += DT;
    for (const c of r.cars) S.driveAI(r, c, DT, skills[c.code] || 0);
    S.collide(r);
    for (const c of r.cars) { const s = seen.get(c); for (const e of c.events) { s[e.type] = (s[e.type] || 0) + 1; if (e.type === S.EV.CONTACT && e.impact > 3) s.hard = (s.hard || 0) + 1; } c.events.length = 0; }
  }
  return seen;
}

test('racing line: inside the road, and straighter than the centre line', () => {
  let sumK = 0, sumLK = 0;
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(RO[i]) <= HW - S.AI.lineEdge + 1e-6);
    sumK += K[i] * K[i]; sumLK += LK[i] * LK[i];
  }
  assert.ok(sumLK < sumK * 0.9, `line curvature² ${sumLK.toFixed(4)} vs centre ${sumK.toFixed(4)}`);
});

test('AI: a clean lap on the tyre model, and the pace setting orders lap times', () => seeded(() => {
  const lap = pace => {
    const r = S.createRace(2, { drivers: field(['VOS']), aiPace: pace }), seen = race(r, 120), c = r.cars[0];
    assert.ok(c.finished, `finished at pace ${pace}`);
    assert.equal(seen.get(c)[S.EV.WALL] || 0, 0, 'no wall hits');
    return c.bestLap;
  };
  const times = [0.8, 0.9, 1].map(lap);
  assert.ok(times[0] > times[1] && times[1] > times[2], `lap times ${times.map(t => t.toFixed(2))}`);
  assert.ok(times[2] > 37 && times[2] < 43, `full pace ${times[2].toFixed(2)} s`);   // (real-F1 physics since 2026-10-24; ~32 s before)
}));

test('AI: drives through its tyres (the car slides a little at the limit, never spins)', () => seeded(() => {
  const r = S.createRace(2, { drivers: field(['VOS']) }), c = r.cars[0];
  let maxDrift = 0;
  for (let i = 0; i < 120 * 70 && !c.finished; i++) {
    r.t += DT; S.driveAI(r, c, DT, 1); c.events.length = 0;
    if (c.v > 20) maxDrift = Math.max(maxDrift, Math.abs(S.driftAngle(c)));
  }
  assert.ok(maxDrift > 0.01 && maxDrift < 0.2, `max drift ${maxDrift.toFixed(3)} rad`);
}));

test('racecraft: a full field races 3 laps without wall hits and with few hard contacts', () => seeded(() => {
  const r = S.createRace(3, { aiPace: 0.92 }), seen = race(r, 400);
  assert.ok(r.cars.every(c => c.finished));
  assert.equal(r.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0), 0, 'no wall hits');
  assert.ok(hard(r, seen) <= 6, `${hard(r, seen)} hard contacts`);
}));

test('racecraft: a faster car gets past a slower one', () => seeded(() => {
  const r = S.createRace(4, { drivers: field(['KIM', 'VOS']) }), [slow, fast] = r.cars, seen = race(r, 300, { KIM: 0.85 });
  assert.ok(fast.finished && slow.finished);
  assert.ok(fast.finishTime < slow.finishTime, 'the faster car finished ahead');
  assert.ok(hard(r, seen) <= 1, `${hard(r, seen)} hard contacts`);
}));

test('mistakes: drivers sometimes brake too late, the weaker ones more often; none when driven at a set skill', () => seeded(() => {
  const r = S.createRace(5, { aiPace: 0.92 }), count = new Map(r.cars.map(c => [c, 0]));
  for (let step = 0; step < 120 * 400 && !r.cars.every(c => c.finished); step++) {
    r.t += DT;
    for (const c of r.cars) { const before = c.mistake; S.driveAI(r, c, DT, c.player ? 0.9 : 0); if (!before && c.mistake) count.set(c, count.get(c) + 1); }
    S.collide(r); for (const c of r.cars) c.events.length = 0;
  }
  const by = code => count.get(r.cars.find(c => c.code === code));
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  assert.ok(total >= 5, `${total} mistakes in 5 laps`);
  assert.equal(by('YOU'), 0, 'skill override: no mistakes');
  const top = ['VOS', 'MAR', 'OKA'].reduce((n, k) => n + by(k), 0), bottom = ['BRA', 'KIM', 'COS'].reduce((n, k) => n + by(k), 0);
  assert.ok(bottom > top, `weakest three ${bottom} vs strongest three ${top}`);
}));

test('recovery: pointing the wrong way, the AI turns round and carries on', () => {
  const r = S.createRace(1, { drivers: field(['VOS']) }), c = r.cars[0];
  c.idx = 300; c.x = T.PX[300]; c.z = T.PZ[300]; c.h = S.headingAt(T, 300) + Math.PI; c.v = 0; c.lap = 1; c.lastCp = 1e9;
  run(S, r, 12, (race, car) => S.driveAI(race, car, DT, 1));
  assert.ok(Math.cos(c.h - S.headingAt(T, c.idx)) > 0.9, 'facing along the track');
  assert.ok(c.v > 30, `moving at ${c.v.toFixed(1)} m/s`);
});

test('ALIEN: faster than a great lap, clean, and it hunts down a car at that pace', () => {
  // its own line and profile exist on every circuit; on Northfold the fastest driver laps under 75 s (real-F1 physics
  // since 2026-10-24; the user's best on the old car was 59.975 s) under 77 s, every lap valid, no walls
  for (const T2 of Object.entries(S.CIRCUITS).map(([id, c]) => S.buildTrack({ ...c, id }))) assert.ok(T2.alien, `${T2.id}: ALIEN line`);
  const NF = S.buildTrack({ ...S.CIRCUITS.northfold, id: 'northfold' });
  const solo = S.createRace(3, { track: NF, drivers: field(['VOS']), activeAero: true, aiFollow: 6, aiAlien: true, seed: 3 }), seen = race(solo, 300);
  const v = solo.cars[0];
  assert.ok(v.finished && v.bestLap < 77, `ALIEN lap ${v.bestLap.toFixed(2)}`);
  assert.ok(!seen.get(v)[S.EV.WALL] && !seen.get(v)[S.EV.CUT], 'clean');
  // the player's car (driven here at a fixed pace, a little slower than the ALIEN alone) starts ahead: the ALIEN hunts it down,
  // gets past and finishes ahead, without hard contact
  const chase = S.createRace(4, { track: NF, drivers: field(['YOU', 'VOS']), activeAero: true, aiFollow: 6, aiAlien: true, seed: 1 });
  const [m, a] = chase.cars, seen2 = race(chase, 400, { YOU: 0.975 * 1.03 });
  assert.ok(m.bestLap > v.bestLap && a.finished && a.finishTime < m.finishTime, `stand-in ${m.bestLap.toFixed(2)}, ALIEN ahead`);
  assert.ok(hard(chase, seen2) === 0, 'no hard contact');
});

// (2026-10-24, the player drives with no assists: "the braking is not the same between me and the AI". The AI's
// all-or-nothing pedals only worked with ABS and traction control; with the player's assists off it drives by feel,
// driving.js feelPedals, and counter-steers its own slides.)
test('without ABS / traction control the AI drives by feel: clean laps, close to its pace with them', () => {
  const lapsOf = (id, alien, assists) => {
    const track = S.buildTrack(S.CIRCUITS[id]), race = S.createRace({ type: 'unlimited' }, { track, drivers: [S.DRIVERS[0]],
      aiAlien: alien, aiFollow: alien ? 6 : 1, seed: 11, activeAero: true, aiAssists: S.ASSISTS[assists] });
    const c = race.cars[0], laps = []; let walls = 0, spins = 0, spun = false, locked = 0;
    while (laps.length < 3 && race.t < 300) { race.t += DT; S.driveAI(race, c, DT); if (c.lockF) locked += DT;
      const off = Math.abs(S.wrapA(c.h - S.headingAt(track, c.idx))); if (off > 1.2 && !spun) { spins++; spun = true; } if (off < 0.3) spun = false;
      for (const e of c.events) { if (e.type === S.EV.WALL) walls++; if (e.type === S.EV.LAP) laps.push(e.time); } c.events.length = 0; }
    return { best: Math.min(...laps.slice(1)), walls, spins, locked };
  };
  for (const [id, alien] of [['elkmoor', false], ['harrow', true], ['marrow', true]]) {
    const off = lapsOf(id, alien, 'off'), on = lapsOf(id, alien, 'medium');
    assert.ok(off.walls === 0 && off.spins === 0, `${id}${alien ? ' ALIEN' : ''}: ${off.spins} spins, ${off.walls} wall hits`);
    // (traction control matters more on real grip: corner exits are traction-limited up to 4th gear)
    assert.ok(off.best < on.best * 1.1, `${id}: ${off.best.toFixed(2)} s without assists vs ${on.best.toFixed(2)} s with them`);
    assert.ok(off.locked > 0, 'it still locks a wheel now and then (it brakes by feel, not with ABS)');
  }
});
