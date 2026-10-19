// The game's setup and message logic (src/game/setup-store.js, race-messages.js): pure, so tested here in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM as S } from '../src/sim/index.js';
import { RACE_SETUP, PREFS } from '../src/game/config.js';
import { loadSetup, loadPrefs, steerRate, raceFormat, raceWear, buildField, playerSlotOf, assistsOf, setupSummary } from '../src/game/setup-store.js';
import { messageFor, EVENT_MESSAGES, SAY } from '../src/game/race-messages.js';

test('setup: nothing saved, or broken JSON, gives the defaults', () => {
  for (const json of [null, '', '{oops', '[]', '42']) {
    const s = loadSetup(json);
    for (const [k, v] of Object.entries(RACE_SETUP.defaults)) assert.equal(s[k], v, `${json} → ${k}`);
    assert.equal(s.track, S.track.id);
    assert.deepEqual(s.custom, RACE_SETUP.customDefault);
  }
});

test('setup: saved choices are kept, unknown or out-of-range ones fall back', () => {
  const s = loadSetup(JSON.stringify({ cars: 4, type: 'timed', minutes: RACE_SETUP.minutes[0], gearbox: 'manual', assists: 'custom',
    custom: { tc: 'low', abs: 'bogus' }, ai: 'legend', fuel: 'high', tyres: 'off', damage: 'off', track: 'marrow' }));
  assert.deepEqual([s.cars, s.type, s.minutes, s.gearbox, s.assists, s.ai, s.fuel, s.tyres, s.damage, s.track],
    [4, 'timed', RACE_SETUP.minutes[0], 'manual', 'custom', 'legend', 'high', 'off', 'off', 'marrow']);
  assert.equal(s.custom.tc, 'low'); assert.equal(s.custom.abs, RACE_SETUP.customDefault.abs);
  const bad = loadSetup(JSON.stringify({ cars: 99, laps: -3, minutes: 7.5, gearbox: 'cvt', ai: 'god', track: 'monza' }));
  assert.equal(bad.cars, S.DRIVERS.length);
  assert.equal(bad.laps, 1);
  assert.equal(bad.minutes, RACE_SETUP.defaults.minutes);
  assert.equal(bad.gearbox, RACE_SETUP.defaults.gearbox);
  assert.equal(bad.ai, RACE_SETUP.defaults.ai);
  assert.equal(bad.track, S.track.id);
  // every listed choice survives a save and load
  for (const [key, list] of Object.entries(RACE_SETUP.choices)) for (const [v] of list)
    assert.equal(loadSetup(JSON.stringify({ [key]: v }))[key], v, `${key} ${v}`);
});

test('prefs: clamped to their limits, booleans only as booleans', () => {
  assert.deepEqual(loadPrefs(null), { ...PREFS.defaults });
  const [lo, hi] = PREFS.limits.deadZone;
  assert.equal(loadPrefs(JSON.stringify({ deadZone: hi + 50 })).deadZone, hi);
  assert.equal(loadPrefs(JSON.stringify({ deadZone: lo - 50 })).deadZone, lo);
  assert.equal(loadPrefs(JSON.stringify({ deadZone: '' })).deadZone, PREFS.defaults.deadZone);
  assert.equal(loadPrefs(JSON.stringify({ muted: 'yes' })).muted, PREFS.defaults.muted);
  assert.equal(loadPrefs(JSON.stringify({ muted: !PREFS.defaults.muted })).muted, !PREFS.defaults.muted);
  assert.equal(steerRate({ smoothing: 0 }), Infinity);
  assert.equal(steerRate({ smoothing: 2 }), PREFS.smoothingRate / 2);
});

test('race from the setup: format, wear, grid, assists, summary', () => {
  assert.deepEqual(raceFormat({ type: 'laps', laps: 5 }), { type: 'laps', laps: 5 });
  assert.deepEqual(raceFormat({ type: 'timed', minutes: 15 }), { type: 'timed', minutes: 15 });
  assert.deepEqual(raceFormat({ type: 'unlimited', laps: 5 }), { type: 'unlimited' });
  assert.deepEqual(raceWear({ fuel: 'high', tyres: 'off', damage: 'on' }), { fuel: 'high', tyres: 'off', damage: true });
  for (let n = 1; n <= S.DRIVERS.length; n++) {
    const field = buildField(n);
    assert.equal(field.length, n);
    assert.equal(field.filter(d => d.player).length, 1);
    assert.equal(field[playerSlotOf(n)].player, true);
  }
  assert.equal(playerSlotOf(1), 0);
  assert.equal(assistsOf({ assists: 'high' }), S.ASSISTS.high);
  const custom = assistsOf({ assists: 'custom', custom: { steer: 'off', stability: 'on', tc: 'low', abs: 'on' } }), M = S.ASSISTS.medium;
  assert.deepEqual(custom, { steer: 0, stability: M.stability, damping: 0, tc: M.tc * RACE_SETUP.customLevels.low, abs: M.abs });
  const line = setupSummary({ ...RACE_SETUP.defaults, custom: RACE_SETUP.customDefault, assists: 'off' }, { smoothing: 0 }, 'quality');
  assert.match(line, /no traction control/); assert.match(line, /smoothing off/);
});

test('messages: every player event the game reports has one, built from the event itself', () => {
  const race = S.createRace(2, { drivers: S.DRIVERS.slice(0, 2) }), c = race.cars[0], EV = S.EV;
  c.lap = 3;
  assert.deepEqual(messageFor({ type: EV.LAP, time: 61.5, invalid: true }, c, race), { toast: 'Lap 2  1:01.500  invalid', kind: 'warn' });
  c.cuts = 1;
  assert.match(messageFor({ type: EV.CUT, wide: true }, c, race).toast, /ran wide.*warning 1\//);
  c.cuts = S.LIMITS.warnings + 1;
  assert.equal(messageFor({ type: EV.CUT, wide: false }, c, race), null, 'past the warnings the penalty message says it');
  assert.match(messageFor({ type: EV.PENALTY, seconds: 2, total: 4 }, c, race).toast, /\+2 s penalty.*total \+4 s/);
  assert.match(messageFor({ type: EV.DAMAGE, part: 'floor' }, c, race).radio, /Floor damage/);
  const stop = messageFor({ type: EV.PIT_STOP, service: { fuel: 20.4, wing: true, repair: false, time: 4.2 } }, c, race);
  assert.deepEqual(stop, { radio: 'Stop: tyres, 20 kg of fuel, a new front wing. 4.2 s.', secs: 4.7 });
  assert.equal(messageFor({ type: EV.SHIFT }, c, race), null);
  for (const k of [EV.PIT_IN, EV.PIT_GO, EV.PIT_OUT, EV.FUEL_LOW, EV.FUEL_BOX, EV.FUEL_OUT, EV.TYRES_WORN, EV.BEACHED, EV.RECOVERED])
    assert.ok(EVENT_MESSAGES[k] && (messageFor({ type: k }, c, race).radio || messageFor({ type: k }, c, race).toast), k);
  for (const m of Object.values(SAY)) assert.ok(m.radio || m.toast);
});
