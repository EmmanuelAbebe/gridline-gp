// Attack mode and the all-wheel drive start (src/sim/attack.js; car classes step 2 stage 4, docs/formula-e-plan.md):
// armed, then taken by driving through the activation zone off the racing line: 350 kW and the front motor driving for
// its share of the race, twice. The F1 has none of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { updateAttack } from '../src/sim/attack.js';
import { drivetrain } from '../src/sim/vehicle.js';

const DT = 1 / 120, FE = S.classOf('fe'), VOS = () => [S.DRIVERS.find(d => d.code === 'VOS')];

test('attack: the F1 has none (overtake mode stays its own), a time trial neither', () => {
  const race = S.createRace(5, { track: S.buildTrack(S.CIRCUITS.elkmoor), activeAero: true });
  assert.equal(race.attack, null);
  assert.ok(race.cars.every(c => !c.awdStart && c.attackUses === 0));
  const trial = S.createRace({ type: 'unlimited' }, { carClass: FE, track: S.buildTrack(S.CIRCUITS.elkmoor), drivers: VOS(), activeAero: true });
  assert.equal(trial.attack, null);
  assert.equal(trial.cars[0].awdStart, true, 'the AWD start still');
});

test('attack: every circuit has a zone on the outside of a slow corner\'s apex, away from the line and the pits', () => {
  for (const id of Object.keys(S.CIRCUITS)) {
    const T = S.buildTrack(S.CIRCUITS[id]), Z = S.attackZone(T, FE), P = S.aiOf(T, FE);
    assert.ok(Z, `${id}: a zone`);
    assert.equal(Z.side, -Math.sign(P.RO[Z.apex]), `${id}: the far side from the line`);
    assert.ok(Math.abs(P.RO[Z.apex] - Z.side * Z.lat) > 5, `${id}: ${Math.abs(P.RO[Z.apex] - Z.side * Z.lat).toFixed(1)} m off the line`);
    assert.ok(Math.min(Z.apex, T.N - Z.apex) * T.ds > FE.attack.zone.clear, `${id}: away from the line`);
    assert.equal(Z.loops.length, 3);
  }
});

test('attack: the loops: armed and through all three on the zone\'s side = on (350 kW, AWD); one missed = still armed', () => {
  const T = S.buildTrack(S.CIRCUITS.harrow), race = S.createRace(6, { carClass: FE, track: T, drivers: VOS(), activeAero: true });
  const c = race.cars[0], Z = race.attack.zone, drive = (lat, from = Z.from - 20, to = Z.to + 10) => {
    for (let i = from; i <= to; i++) { c.idx = i; c.lat = lat; updateAttack(race, c, {}, DT); }
  };
  Object.assign(c, { lap: 2, v: 30, awdStart: false, attackArmed: true, player: true, boostAuto: false });
  drive(-Z.side * 2);
  assert.ok(c.attackArmed && !c.attackOn, 'on the line: nothing');
  drive(Z.side * (Z.lat + 0.5), Z.from - 20, Z.apex + 1); drive(0, Z.apex + 2, Z.to + 10);
  assert.ok(c.attackArmed && !c.attackOn && c.events.some(e => e.type === S.EV.ATTACK_MISSED), 'the last loop missed');
  c.events.length = 0;
  drive(Z.side * (Z.lat + 0.5));
  assert.ok(c.attackOn && c.awd && !c.attackArmed && c.attackUses === 1);
  assert.ok(Math.abs(c.attackLeft - race.attack.seconds) < 1);
  assert.ok(Math.abs(race.attack.seconds * 2 - 6 * S.lapEnergy(T, FE).time * FE.attack.share) < 1e-6, 'its share of the race in two');
  // the power: 350 kW from the battery at speed, 300 without (a player with the ECU off AUTO: no saving cut)
  const kw = on => { c.attackOn = on; c.awd = on; c.v = 50; c.gear = 1; drivetrain(c, { thr: 1, brk: 0 }, DT); return c.ersKw; };
  assert.ok(Math.abs(kw(true) - 350) < 1 && Math.abs(kw(false) - 300) < 1, `${kw(true).toFixed(0)} / ${kw(false).toFixed(0)} kW`);
  // the player's button arms and disarms it
  c.attackOn = false; c.attackArmed = false;
  updateAttack(race, c, { boost: true }, DT); assert.ok(c.attackArmed);
  updateAttack(race, c, { boost: true }, DT); assert.ok(!c.attackArmed);
});

test('attack: a full field takes both, clean, and the energy still lasts; the AWD start pulls away harder', () => {
  for (const id of ['cobalt', 'hautvale']) {
    const T = S.buildTrack(S.CIRCUITS[id]), race = S.createRace(5, { carClass: FE, track: T, drivers: S.DRIVERS.filter(d => !d.player), seed: 5, activeAero: true });
    let walls = 0, empty = 0;
    for (let k = 0; k < 120 * 900 && !race.cars.every(c => c.finished); k++) {
      race.t += DT; for (const c of race.cars) if (!c.finished) S.driveAI(race, c, DT); S.collide(race);
      for (const c of race.cars) { walls += c.events.filter(e => e.type === S.EV.WALL).length; c.events.length = 0; if (c.soc <= 0 && !c.finished) empty++; }
    }
    assert.ok(race.cars.every(c => c.finished), `${id}: all finished`);
    assert.deepEqual(race.cars.map(c => c.attackUses), race.cars.map(() => 0), `${id}: both taken by every car`);
    assert.equal(walls, 0, `${id}: no walls`); assert.equal(empty, 0, `${id}: nobody ran dry`);
  }
  // from the grid: 100 km/h with the front motor driving vs the rear alone
  const T = S.buildTrack(S.CIRCUITS.harrow), t100 = awd => {
    const race = S.createRace(3, { carClass: FE, track: T, drivers: [S.DRIVERS.find(d => d.player)], seed: 1 }), c = race.cars[0];
    c.assists = S.ASSISTS.medium; let t = 0;
    for (; c.v < 100 / 3.6 && t < 10; t += DT) { if (!awd) c.awdStart = false; race.t += DT; S.drivePlayer(race, c, { thr: 1, brk: 0, steer: 0, analog: true }, DT); }
    return t;
  };
  const a = t100(true), r = t100(false);
  assert.ok(a < r * 0.8, `0–100 km/h ${a.toFixed(2)} s AWD vs ${r.toFixed(2)} s`);
});
