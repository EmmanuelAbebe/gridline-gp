// The phone page's pure logic: settings (sanitize, profiles), curves, flick to shift, and the tilt → steering angle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUTTONS, DEFAULTS, bitOf, clone, createFlick, loadStore, pedalValue, sanitize, steerCurve, freeLayout, MIN_BOX, forCar, setCarLayout, buttonsOf, CAR_KINDS } from '../src/settings/settings.ts';
import { tiltDegrees, resetTilt } from '../src/engine/engine.ts';

test('button bits match the wire protocol order (phonewheel/protocol.py, desktop/phone-link.cjs)', () => {
  assert.deepEqual(BUTTONS.map((b) => b[0]), ['A', 'B', 'X', 'Y', 'LB', 'RB', 'BACK', 'START', 'GUIDE', 'LS', 'RS', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
  assert.equal(bitOf('RB'), 5);
});

test('sanitize: defaults round-trip, junk and out-of-range values are fixed, old profiles load', () => {
  assert.deepEqual(sanitize(clone(DEFAULTS)), DEFAULTS);
  const s = sanitize({ steer: { sensitivity: 999, smoothing: 'x', invert: 1 }, gas: { mode: 'warp', max: -3 }, buttons: [{ label: 'LONGER', bind: 'Z' }, null], layout: { buttonSize: 'xl' } });
  assert.equal(s.steer.sensitivity, 70); assert.equal(s.steer.smoothing, DEFAULTS.steer.smoothing); assert.equal(s.steer.invert, false);
  assert.equal(s.gas.mode, 'ramp'); assert.equal(s.gas.max, 0.1);
  assert.deepEqual(s.buttons, [{ label: 'LONG', bind: 'A', toggle: false, side: 'race' }, { label: '2', bind: 'A', toggle: false, side: 'race' }]);
  // a button without a side: pit things on the PIT side
  assert.equal(sanitize({ buttons: [{ label: 'PIT', bind: 'Y' }] }).buttons[0].side, 'pit');
  assert.deepEqual(s.layout.labels, { pedals: false, shift: false, gauges: false });
  assert.equal(s.layout.buttonSize, 'm');
  // the old page's store format
  const store = loadStore(JSON.stringify({ active: 'Race', profiles: { Race: { steer: { sensitivity: 50 } }, Default: {} } }));
  assert.equal(store.active, 'Race'); assert.equal(store.profiles.Race.steer.sensitivity, 50);
  assert.equal(loadStore('not json').active, 'Default');
});

test('curves: pedal and steering', () => {
  const p = { ...DEFAULTS.gas };
  assert.equal(pedalValue(0, p), 0.2); assert.equal(pedalValue(1, p), 1); assert.equal(pedalValue(5, p), 1);
  assert.equal(pedalValue(0.3, { ...p, mode: 'instant', max: 0.8 }), 0.8);
  const st = { ...DEFAULTS.steer, deadzone: 10, curve: 2 };
  assert.equal(steerCurve(0.05, st), 0); assert.equal(steerCurve(-1, st), -1);
  assert.ok(Math.abs(steerCurve(0.55, st) - 0.25) < 1e-9);
});

test('flick to shift: a quick sideways flick counts, a slow or vertical one does not', () => {
  const f = createFlick(), c = DEFAULTS.flick;
  assert.equal(f.add(100, 100, 0, 1, c), false);
  assert.equal(f.add(150, 105, 100, 1, c), true, 'fast, sideways, toward the centre');
  f.reset(); f.add(100, 100, 0, 1, c);
  assert.equal(f.add(150, 100, 500, 1, c), false, 'too slow');
  f.reset(); f.add(100, 100, 0, 1, c);
  assert.equal(f.add(130, 200, 50, 1, c), false, 'mostly vertical');
  f.reset(); f.add(100, 100, 0, 1, c);
  assert.equal(f.add(50, 100, 50, 1, c), false, 'away from the centre');
});

test('tilt: level = 0°, the steering angle follows the roll in landscape either way round', () => {
  resetTilt();
  assert.ok(Math.abs(tiltDegrees(1, 0, 90)) < 1e-9, 'landscape, level');
  const r = 20 * Math.PI / 180;
  assert.ok(Math.abs(tiltDegrees(Math.cos(r), Math.sin(r), 90) - 20) < 1e-6);
  resetTilt();
  assert.ok(Math.abs(tiltDegrees(-Math.cos(r), -Math.sin(r), 270) - 20) < 1e-6, 'turned the other way');
  resetTilt();
  assert.ok(Math.abs(tiltDegrees(-Math.cos(r), -Math.sin(r), 90) - 20) < 1e-6, 'a phone reporting gravity the other way');
});

test('tilt: turning the wheel past 90° and 135° keeps turning the same way, even when the screen turns to portrait', () => {
  const up = (deg: number) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)] as const;
  for (const dir of [1, -1]) {
    resetTilt();
    let last = 0;
    for (let d = 0; d <= 170; d += 5) {
      const [x, y] = up(dir * d), screen = d > 80 && d < 120 ? 0 : d >= 120 ? 270 : 90;   // auto-rotate along the way
      const a = tiltDegrees(x, y, screen);
      assert.ok(Math.abs(a - dir * d) < 1e-6, `${dir * d}°: read ${a.toFixed(1)}`);
      assert.ok(dir * a >= dir * last, 'never back the other way'); last = a;
    }
  }
  // held the other way up for a while: still a turn of the wheel (only the Center button moves straight ahead)
  resetTilt(); tiltDegrees(1, 0, 90);
  for (let k = 0; k < 200; k++) assert.ok(Math.abs(Math.abs(tiltDegrees(-1, 0, 270)) - 180) < 1e-6);
});

test('older stores get the REAR (look back) and MAP (ECU map) buttons once; removing them sticks', () => {
  const old = JSON.stringify({ active: 'A', profiles: { A: { buttons: [{ label: 'BOX', bind: 'X' }] } } });
  const s = loadStore(old);
  assert.deepEqual(s.profiles.A.buttons.map((b) => b.bind), ['X', 'RS', 'GUIDE']);
  s.profiles.A.buttons.pop(); s.profiles.A.buttons.pop();
  assert.deepEqual(loadStore(JSON.stringify(s)).profiles.A.buttons.map((b) => b.bind), ['X'], 'not added again');
  // a v2 store (REAR already offered) only gets MAP
  const v2 = JSON.stringify({ v: 2, active: 'A', profiles: { A: { buttons: [{ label: 'BOX', bind: 'X' }] } } });
  assert.deepEqual(loadStore(v2).profiles.A.buttons.map((b) => b.bind), ['X', 'GUIDE']);
  assert.deepEqual(loadStore(null).profiles.Default.buttons.map((b) => b.label), ['BOX', 'LIM', 'REAR', 'DRS', 'OT', 'MAP']);
});

test('v4: the race wheel is the standard layout: an own layout made for the old one is dropped once, groups kept per layout', () => {
  const free = { brake: { x: 0, y: 0, w: 0.2, h: 1 } };
  const v3 = JSON.stringify({ v: 3, active: 'A', profiles: { A: { layout: { free, groups: { brake: 'G' } } } } });
  assert.equal(loadStore(v3).profiles.A.layout.free, null);
  const v4 = JSON.stringify({ v: 4, active: 'A', profiles: { A: { layout: { free, groups: { brake: 'G', 'Bad id!': 'x' } } } } });
  const L = loadStore(v4).profiles.A.layout;
  assert.ok(L.free?.brake); assert.deepEqual(L.groups, { brake: 'G' });
});

test('your own layout: boxes stay on the screen and keep a usable size; anything malformed is dropped', () => {
  assert.equal(freeLayout(null), null); assert.equal(freeLayout([1, 2]), null); assert.equal(freeLayout({}), null);
  const L = freeLayout({ gas: { x: 0.9, y: -0.2, w: 0.3, h: 0.001 }, brake: { x: 0, y: 0, w: 0.2, h: 'tall' }, 'Bad id!': { x: 0, y: 0, w: 0.1, h: 0.1 } })!;
  assert.deepEqual(Object.keys(L), ['gas']);
  assert.ok(Math.abs(L.gas.x - 0.7) < 1e-9 && L.gas.y === 0 && L.gas.h === MIN_BOX, JSON.stringify(L.gas));
  const s = sanitize({ layout: { free: { btn0: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 } } } });
  assert.deepEqual(s.layout.free, { btn0: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 } });
  assert.equal(sanitize({}).layout.free, null, 'the standard layout by default');
});

// the race wheel follows the car (2026-11-10): an old profile gets each other car's defaults; the electric car has no
// shift keys and an ATTACK button, the kart only REAR; a layout saved for one car leaves the others as they were
test('per car: defaults on old profiles, forCar, layouts kept apart', () => {
  const old = sanitize({ buttons: [{ label: 'BOX', bind: 'X' }], layout: { free: { brake: { x: 0, y: 0, w: 0.2, h: 1 } } } });
  assert.equal(old.cars.electric.buttons.find((b) => b.bind === 'BACK')?.label, 'ATK');
  assert.deepEqual(old.cars.kart.buttons.map((b) => b.label), ['REAR']);
  assert.equal(forCar(old, 'hybrid'), old, 'the hybrid is the profile itself');
  const el = forCar(old, 'electric'), kart = forCar(old, 'kart');
  assert.equal(el.layout.shiftButtons, false); assert.equal(el.layout.ecu, true); assert.equal(el.layout.free, null);
  assert.equal(kart.layout.shiftButtons, false); assert.equal(kart.layout.ecu, false);
  assert.deepEqual(el.steer, old.steer, 'steering and pedals are shared');
  const c = clone(old), box = { screen: { x: 0.3, y: 0.1, w: 0.4, h: 0.5 } };
  setCarLayout(c, 'electric', box, { screen: 'mid' });
  assert.deepEqual(c.cars.electric.free, box); assert.deepEqual(c.layout.free, old.layout.free, 'the hybrid\'s own layout untouched');
  assert.equal(c.cars.kart.free, null);
  const again = sanitize(JSON.parse(JSON.stringify(c)));
  assert.deepEqual(again.cars.electric.free, box, 'saved and loaded');
  buttonsOf(again, 'kart').push({ label: 'X', bind: 'X', toggle: false, side: 'pit' });
  assert.equal(again.cars.kart.buttons.length, 2); assert.equal(again.buttons.length, 1);
  assert.deepEqual([...CAR_KINDS], ['hybrid', 'electric', 'kart']);
});

test('the game\'s dash names the car: the wheel follows it while driving, keeps it between races', async () => {
  const engine = await import('../src/engine/engine.ts');
  engine.setDash({ g: '1', c: 'electric', w: 92, j: 74, x: 28, a: 2, u: 1, o: 0 });
  assert.equal(engine.getCar(), 'electric');
  assert.deepEqual([engine.dash.w, engine.dash.j, engine.dash.x, engine.dash.a, engine.dash.u], [92, 7.4, 2.8, 2, 1]);
  engine.setDash({});
  assert.equal(engine.getCar(), 'electric', 'not driving: the last car stays');
  engine.setDash({ g: '4', v: 200 });
  assert.equal(engine.getCar(), 'hybrid', 'an older game (no c): the hybrid');
  engine.setDash({ g: '1', c: 'spaceship' });
  assert.equal(engine.getCar(), 'hybrid');
});
