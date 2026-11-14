// Damage in words and seconds (src/game/damage-info.js): the HUD's card and panel, the pit box's repairs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from '../src/sim/index.js';
import { damageInfo, repairTimes, payback, DAMAGE_UI } from '../src/game/damage-info.js';

globalThis.devicePixelRatio ??= 1;
const race = (lvl) => SIM.createRace(10, { drivers: SIM.DRIVERS.slice(0, 1), wear: { damage: lvl } });

test('the parts, what they cost a lap, what to do', () => {
  const r = race('realistic'), c = r.cars[0];
  c.bestLap = 64;
  assert.deepEqual(damageInfo(r, c), { parts: [], total: 0, minor: true, advice: '', any: false });
  Object.assign(c.damage, { wing: 0.4, floor: 0.12, susp: 0 });
  const I = damageInfo(r, c);
  assert.deepEqual(I.parts.map(p => p.key), ['wing', 'floor']);
  assert.equal(I.parts[0].pct, 40);
  assert.ok(Math.abs(I.parts[0].cost - 64 * (0.014 + (0.0288 - 0.014) * 0.6)) < 1e-9, String(I.parts[0].cost));
  assert.ok(I.parts[0].level === 'bad' && I.parts[1].level === 'minor' && I.advice === 'BOX FOR A NEW NOSE' && !I.minor);
  // a little floor damage: minor, no advice
  Object.assign(c.damage, { wing: 0, floor: 0.06 });
  const m = damageInfo(r, c); assert.ok(m.minor && m.advice === '' && m.total < DAMAGE_UI.minor);
  // LIGHT: the same parts at the car's level of the cost
  const l = race('light'), cl = l.cars[0]; cl.bestLap = 64; Object.assign(cl.damage, { wing: 0.4 });
  Object.assign(c.damage, { wing: 0.4, floor: 0 });
  assert.ok(Math.abs(damageInfo(l, cl).total - 0.3 * damageInfo(r, c).total) < 1e-9);
  // off: nothing
  assert.equal(damageInfo(race(false), c).any, false);
});

test('the repairs at a stop, and when it pays back', () => {
  const r = race('realistic'), c = r.cars[0]; c.bestLap = 64;
  Object.assign(c.damage, { wing: 0.5, floor: 0.2, susp: 0.1 });
  const t = repairTimes(c);
  assert.equal(t.wing, SIM.PIT.wing); assert.ok(Math.abs(t.repair - SIM.PIT.repair * 0.3) < 1e-9);
  const p = payback(r, c);
  assert.ok(Math.abs(p.stop - (DAMAGE_UI.laneLoss + SIM.PIT.base + t.wing + t.repair)) < 1e-9 && p.laps > 1 && p.laps < 30 && p.togo > 0, JSON.stringify(p));
});
