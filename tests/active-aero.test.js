// Active aero (straight mode / corner mode) and overtake mode (active-aero.js): the zones on every circuit, that it
// is off unless asked for, that every car uses it safely, and the overtake boost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { ACTIVE_AERO, OVERTAKE } from '../src/sim/tuning.js';
import { gapAhead, updateActiveAero } from '../src/sim/active-aero.js';
import { DT, run, seeded, aiDriver, centreProfile } from './helpers.js';

const tracks = Object.fromEntries(Object.entries(S.CIRCUITS).map(([id, c]) => [id, S.buildTrack(c)]));

test('every circuit has straight-mode zones, all flat out and closing before any braking', () => {
  for (const [id, T] of Object.entries(tracks)) {
    assert.ok(T.aeroZones.length >= 1, `${id}: a zone`);
    const ahead = Math.round(ACTIVE_AERO.zone.closeAhead / T.ds);
    for (let i = 0; i < T.N; i++) if (T.aeroZone[i]) {
      for (let o = 0; o <= ahead; o++) assert.ok(T.VP[(i + o) % T.N] >= S.TUNING.V_CAP - 1e-3, `${id}: no braking within ${ahead} samples of ${i}`);
    }
    for (const z of T.aeroZones) assert.ok(((z.to - z.from + T.N) % T.N) * T.ds >= ACTIVE_AERO.zone.minLength - T.ds, `${id}: zone long enough`);
  }
});

test('off by default: the wings never open and nobody gets a boost', () => seeded(() => {
  const r = S.createRace(2, { track: tracks.harrow, drivers: S.DRIVERS.slice(0, 4) });
  let open = 0, boost = 0;
  run(S, r, 60, (race, c) => { aiDriver(S)(race, c); open = Math.max(open, c.aeroOpen); boost = Math.max(boost, c.boostLeft); });
  assert.equal(open, 0); assert.equal(boost, 0);
}));

test('straight mode: wings open on the straights, more top speed, faster laps, no walls or cuts', () => {
  for (const id of ['harrow', 'elkmoor']) {
    const lap = activeAero => {
      const r = S.createRace(2, { track: tracks[id], drivers: [S.DRIVERS.find(d => !d.player)], activeAero, seed: 3 });
      let top = 0, openSteps = 0, steps = 0;
      const seen = run(S, r, 300, (race, c) => { aiDriver(S)(race, c); top = Math.max(top, c.v); steps++; if (c.aeroOpen === 1) openSteps++; });
      const s = seen.get(r.cars[0]);
      return { best: r.cars[0].bestLap, top, open: openSteps / steps, trouble: (s[S.EV.WALL] || 0) + (s[S.EV.CUT] || 0) };
    };
    const off = lap(false), on = lap(true);
    assert.ok(on.open > 0.15, `${id}: open ${(on.open * 100).toFixed(0)}% of the time`);
    assert.ok(on.top > off.top + 4, `${id}: top speed ${off.top.toFixed(1)} → ${on.top.toFixed(1)} m/s`);
    assert.ok(on.best < off.best - 0.2, `${id}: lap ${off.best.toFixed(2)} → ${on.best.toFixed(2)} s`);
    assert.equal(on.trouble, 0, `${id}: clean`);
  }
});

test('straight mode: a full field races clean, and the proportional test driver gets round with it', () => seeded(() => {
  for (const id of ['northfold', 'cobalt']) {
    const T = tracks[id], r = S.createRace(2, { track: T, aiPace: 0.95, activeAero: true }), seen = run(S, r, 400, aiDriver(S));
    assert.ok(r.cars.every(c => c.finished), `${id}: all finished`);
    const walls = r.cars.reduce((n, c) => n + (seen.get(c)[S.EV.WALL] || 0), 0);
    assert.ok(walls <= 2, `${id}: ${walls} wall hits`);
    const solo = S.createRace(1, { track: T, drivers: S.DRIVERS.filter(d => d.player), activeAero: true }), VP = centreProfile(S, T);
    let opened = 0;
    const s2 = run(S, solo, 200, (race, car) => {
      const ti = (car.idx + 12) % T.N, diff = S.wrapA(Math.atan2(T.PZ[ti] - car.z, T.PX[ti] - car.x) - car.h);
      const slow = car.v > VP[(car.idx + 4) % T.N];
      S.drivePlayer(race, car, { thr: slow ? 0 : 1, brk: slow ? 1 : 0, steer: S.clamp(diff * 3, -1, 1), analog: true }, DT);
      opened = Math.max(opened, car.aeroOpen);
    });
    assert.ok(solo.cars[0].finished && opened === 1, `${id}: test driver finished, wings opened`);
    assert.equal(s2.get(solo.cars[0])[S.EV.WALL] || 0, 0, `${id}: test driver no wall hits`);
  }
}));

test('overtake mode: within a second of the car ahead at the line → boost for the lap; full electric power to 337 km/h', () => {
  const T = tracks.harrow, r = S.createRace(5, { track: T, drivers: S.DRIVERS.slice(0, 2), activeAero: true, seed: 1 });
  const [a, b] = r.cars;
  // b passed the sample a is on 0.6 s ago, and a is starting lap 2
  r.t = 100; a.lap = 2; a.boostLap = 1; b.trailT[a.idx] = r.t - 0.6;
  assert.ok(Math.abs(gapAhead(r, a) - 0.6) < 1e-4);   // trail times are Float32
  a.player = true; a.v = 315 / 3.6; a.gear = 8;           // (past 290 km/h, where the MGU-K's power tapers: ERS)
  S.drivePlayer(r, a, { steer: 0, thr: 1, brk: 0 }, DT);
  assert.equal(a.events.filter(e => e.type === S.EV.BOOST_READY).length, 1);
  assert.ok(a.boostLeft > OVERTAKE.seconds - 0.1 && !a.boostOn, 'ready, not on until pressed');
  const before = a.drive;
  S.drivePlayer(r, a, { steer: 0, thr: 1, brk: 0, boost: true }, DT);
  assert.ok(a.boostOn && a.boostLeft < OVERTAKE.seconds, 'on and counting down');
  assert.ok(a.drive > before * 1.15, `drive ${before.toFixed(2)} → ${a.drive.toFixed(2)}`);   // (2026: the taper starts at 337 km/h)
  // too far behind at the next line: no boost
  a.lap = 3; b.trailT[a.idx] = r.t - 2.5;
  S.drivePlayer(r, a, { steer: 0, thr: 1, brk: 0 }, DT);
  assert.equal(a.boostLeft, 0); assert.equal(a.boostOn, false);
});

test('straight mode on a button (aeroAuto off): opens only when asked inside a zone, closes on the brakes, the zone\'s end or the button', () => {
  const T = tracks.harrow, r = S.createRace(2, { track: T, drivers: S.DRIVERS.filter(d => d.player), activeAero: true }), c = r.cars[0];
  const z = T.aeroZones[0], N = T.N, at = k => { c.idx = (z.from + k) % N; };
  c.aeroAuto = false; c.v = 70; c.steer = 0.5;              // (part throttle and steering: the auto rules would keep it shut)
  const step = (inp, n = 1) => { for (let i = 0; i < n; i++) updateActiveAero(r, c, { thr: 0.5, brk: 0, ...inp }, DT); };
  const aero = () => c.events.filter(e => e.type === S.EV.AERO).map(e => `${e.on ? 'on' : 'off'}${e.zone ? '' : ' (no zone)'}`);
  at(-20); step({ aero: true });                             // before the zone: nothing
  step({}, 60);
  assert.equal(c.aeroOpen, 0);
  at(5); step({}, 60);                                       // in the zone, not asked: shut
  assert.equal(c.aeroOpen, 0);
  step({ aero: true }); step({}, 60);                        // asked: open
  assert.equal(c.aeroOpen, 1);
  step({ brk: 0.3 }, 30);                                    // the brakes shut them, and they stay shut
  step({}, 30);
  assert.ok(c.aeroOpen === 0 && !c.aeroWant);
  step({ aero: true }); step({}, 60); step({ aero: true }); step({}, 60);   // on, then off by the button
  assert.equal(c.aeroOpen, 0);
  step({ aero: true }); step({}, 60);
  at(((z.to - z.from + N) % N) + 3); step({}, 60);           // past the zone's end
  assert.ok(c.aeroOpen === 0 && !c.aeroWant);
  assert.deepEqual(aero(), ['off (no zone)', 'on', 'off', 'on', 'off', 'on', 'off (no zone)']);
});

test('your own zones (setAeroZones): round trip, merging, over the line, back to automatic; the risk of a zone in a bend', () => {
  const T = S.buildTrack(S.CIRCUITS.harrow), auto = T.aeroZones, L = T.N * T.ds;
  S.setAeroZones(T, S.aeroZonesInMetres(T));
  assert.deepEqual(T.aeroZones, auto);
  assert.equal(T.aeroKey.length > 0 && T.aeroKey !== 'auto', true);
  for (const z of S.aeroZonesInMetres(T)) assert.equal(S.zoneRisk(T, z), 0, 'the automatic zones are safe');
  // two overlapping zones merge; one over the line wraps
  S.setAeroZones(T, [{ from: 100, to: 400 }, { from: 300, to: 600 }, { from: L - 150, to: 50 }]);
  const m = S.aeroZonesInMetres(T);
  assert.equal(m.length, 2);
  assert.ok(Math.abs(m[0].from - 100) < T.ds && Math.abs(m[0].to - 600) < T.ds, JSON.stringify(m));
  assert.ok(T.aeroZone[0] && T.aeroZone[T.N - 2] && !T.aeroZone[Math.round(700 / T.ds)]);
  // a zone through the slowest corner: mostly unsafe
  let slow = 0; for (let i = 0; i < T.N; i++) if (T.VP[i] < T.VP[slow]) slow = i;
  assert.ok(S.zoneRisk(T, { from: slow * T.ds - 50, to: slow * T.ds + 50 }) > 0.9);
  S.setAeroZones(T, []);
  assert.ok(T.aeroZones.length === 0 && T.aeroKey === 'none');
  S.setAeroZones(T, null);
  assert.ok(T.aeroZones === auto && T.aeroKey === 'auto');
});

test('your own zones: the AI opens its wings in them, never in the automatic ones you took away', () => {
  const T = S.buildTrack(S.CIRCUITS.harrow), longest = T.aeroZones.reduce((a, z) => ((z.to - z.from + T.N) % T.N) > ((a.to - a.from + T.N) % T.N) ? z : a);
  const keep = { from: longest.from * T.ds, to: longest.to * T.ds };
  S.setAeroZones(T, [keep]);
  const r = S.createRace(2, { track: T, drivers: [S.DRIVERS.find(d => !d.player)], activeAero: true, seed: 3 });
  let inside = 0, outside = 0;
  run(S, r, 200, (race, c) => { aiDriver(S)(race, c); if (c.aeroOpen > 0.99) (T.aeroZone[c.idx] ? inside++ : outside++); });
  assert.ok(inside > 100 && outside < 30, `open ${inside} steps in the zone, ${outside} past its end (closing)`);
});

test('the AI\'s own call on long zones of your own: open through the bends that take its speed, shut for the ones that don\'t; the ALIEN without assists stays clean', () => {
  const T = S.buildTrack(S.CIRCUITS.hautvale);
  S.setAeroZones(T, [{ from: 259.6, to: 1281.5 }, { from: 1864, to: 103 }]);   // (the user's: 83 % of the lap, through the esses)
  const bend = S.aiAeroPlan(T, true), slow = T.alien.LK.reduce((m, k, i) => Math.abs(k) > Math.abs(T.alien.LK[m]) ? i : m, 0);
  assert.ok(bend[slow] < 30, 'the tightest corner: never open there at racing speed');
  assert.ok(Math.max(...bend) > 90, 'straights: open at any speed');
  const r = S.createRace({ type: 'unlimited' }, { track: T, drivers: [S.DRIVERS[0]], aiPace: 1, aiAlien: true, seed: 20261020, activeAero: true,
    aiAssists: { ...S.ASSISTS[S.AI.assists], abs: 0, tc: 0, stability: 0 }, tyreTemp: true, compound: 'soft' });
  const c = r.cars[0]; let open = 0, steps = 0, clean = 0, walls = 0;
  while (c.lap <= 3 && r.t < 400) {
    r.t += DT; S.driveAI(r, c, DT); steps++;
    if (c.aeroOpen > 0.5) open++;
    for (const e of c.events) { if (e.type === S.EV.LAP && c.lap > 2 && !e.invalid) clean++; if (e.type === S.EV.WALL) walls++; }
    c.events.length = 0;
  }
  assert.ok(clean >= 1 && walls === 0, `a clean flying lap (${clean}), no walls (${walls})`);
  assert.ok(open / steps > 0.25, `open a good part of the time: ${(open / steps * 100).toFixed(0)} %`);
});
