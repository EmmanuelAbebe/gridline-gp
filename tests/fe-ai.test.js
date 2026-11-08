// Formula E's AI (car classes step 2 stage 6, docs/formula-e-plan.md): its own time-optimal lines (racing-lines-fe.js),
// ALIEN paces, and racecraft numbers for its grip (defending only into slow corners, off-line speeds from the road's
// curve, smaller mistakes); full fields race clean. The F1's AI keeps its own (sim-trace identical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { RACING_LINES, ALIEN_LINES } from '../src/sim/racing-lines-fe.js';

const DT = 1 / 120, FE = S.classOf('fe'), F1 = S.classOf('f1');

test('fe ai: its own lines on every circuit (the circuit as it is now), its profile on them', () => {
  for (const id of Object.keys(S.CIRCUITS)) {
    const T = S.buildTrack(S.CIRCUITS[id]);
    assert.equal(RACING_LINES[id]?.N, T.N, `${id}: racing line`);
    assert.equal(ALIEN_LINES[id]?.N, T.N, `${id}: ALIEN line`);
    const P = S.aiOf(T, FE);
    assert.notEqual(P, S.aiOf(T, F1));
    assert.ok(P.RO.some((r, i) => Math.abs(r - T.RO[i]) > 0.5), `${id}: not the F1's line`);
  }
  assert.equal(F1.ai.defendBelow, Infinity); assert.equal(F1.ai.offRoad, false); assert.equal(F1.ai.mistakeK, 1); assert.equal(F1.ai.alienHold, false);
});

test('fe ai: full fields race clean: everyone finishes, no walls, few hard contacts or cuts', () => {
  for (const id of ['saltcross', 'hautvale', 'harrow']) {
    const T = S.buildTrack(S.CIRCUITS[id]), race = S.createRace(5, { carClass: FE, track: T, drivers: S.DRIVERS.filter(d => !d.player), seed: 6, activeAero: true });
    let walls = 0, hard = 0, cuts = 0;
    for (let k = 0; k < 120 * 900 && !race.cars.every(c => c.finished); k++) {
      race.t += DT; for (const c of race.cars) if (!c.finished) S.driveAI(race, c, DT); S.collide(race);
      for (const c of race.cars) { for (const e of c.events) { if (e.type === S.EV.WALL) walls++; if (e.type === S.EV.CONTACT && e.impact > 3) hard++; if (e.type === S.EV.CUT) cuts++; } c.events.length = 0; }
    }
    assert.ok(race.cars.every(c => c.finished), `${id}: all finished`);
    assert.equal(walls, 0, `${id}: walls`);
    assert.ok(hard <= 16 && cuts <= 4, `${id}: ${hard} hard contacts (both cars count), ${cuts} cuts`);
  }
});

test('fe ai: the ALIEN alone is clean at its pace in a race (energy, attack mode), with and without assists, and quicker than LEGEND', () => {
  for (const id of ['elkmoor', 'northfold']) {
    const T = S.buildTrack(S.CIRCUITS[id]), lap = (alien, off) => {
      const race = S.createRace(5, { carClass: FE, track: T, drivers: S.DRIVERS.filter(d => !d.player), seed: 1, aiAlien: alien, aiAssists: off ? S.ASSISTS.off : null, activeAero: true });
      race.cars = [race.cars.reduce((a, b) => b.skill > a.skill ? b : a)]; const c = race.cars[0];
      let bad = 0, best = Infinity;
      for (let k = 0; k < 120 * 600 && !c.finished; k++) {
        race.t += DT; S.driveAI(race, c, DT);
        for (const e of c.events) { if (e.type === S.EV.WALL || e.type === S.EV.CUT) bad++; if (e.type === S.EV.LAP && c.lap > 1 && !e.invalid) best = Math.min(best, e.time); }
        c.events.length = 0; if (Math.abs(S.driftAngle(c)) > 0.5) bad++;
      }
      return { bad, best };
    };
    const legend = lap(false, false), med = lap(true, false), off = lap(true, true);
    assert.equal(med.bad + off.bad, 0, `${id}: ALIEN clean`);
    assert.ok(med.best < legend.best, `${id}: ALIEN ${med.best.toFixed(2)} s vs LEGEND ${legend.best.toFixed(2)} s`);
  }
});
