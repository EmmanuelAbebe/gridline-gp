// The garage's data and camera math (src/game/garage-store.js, orbit-camera.js): pure, so tested in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SIM as S } from '../src/sim/index.js';
import { loadGarage, validLivery, colourOf, hexOf, LIVERY_DEFAULTS, playerDriver, playerSpec, loadRecords, recordLap, validStrategy, pitPlanOf, STRATEGY_DEFAULTS } from '../src/game/garage-store.js';
import { orbitState, orbitPosition, turn, zoom, pan, clampOrbit, ORBIT } from '../src/game/orbit-camera.js';

test('garage: nothing saved gives the stock car in its own colours', () => {
  for (const json of [null, '', '{bad', '[]']) {
    const g = loadGarage(json);
    assert.deepEqual(g.livery, { ...LIVERY_DEFAULTS });
    assert.equal(playerSpec(g).modified, false);
    assert.deepEqual(playerSpec(g).setup, S.STOCK.setup);
  }
  const you = S.DRIVERS.find(d => d.player);
  assert.equal(LIVERY_DEFAULTS.color, you.color); assert.equal(LIVERY_DEFAULTS.number, you.number);
});

test('garage: saved values kept, bad ones fall back', () => {
  const g = loadGarage(JSON.stringify({ livery: { color: '#ff0000', accent: 0x00ff00, rims: 'nope', number: 42, finish: 'matte' },
    setup: { wing: 9, mech: 99 }, mods: { power: 150 } }));
  assert.deepEqual(g.livery, { color: 0xff0000, accent: 0x00ff00, rims: LIVERY_DEFAULTS.rims, number: 42, finish: 'matte', model: 'classic' });
  assert.equal(validLivery({ model: '2026' }).model, '2026'); assert.equal(validLivery({ model: 'f1' }).model, 'classic', 'the car model: classic unless 2026');
  assert.equal(g.setup.wing, 9); assert.equal(g.setup.mech, S.SETUP.mech.max);
  assert.equal(playerSpec(g).modified, true);
  assert.deepEqual(validLivery({ number: 100, finish: 'chrome' }).number, LIVERY_DEFAULTS.number);
  assert.equal(validLivery({ finish: 'chrome' }).finish, 'gloss');
  assert.equal(colourOf('12ab9F'), 0x12ab9f); assert.equal(colourOf(-1), null); assert.equal(hexOf(0x00ff0a), '#00ff0a');
  const d = playerDriver(g);
  assert.equal(d.player, true); assert.equal(d.color, 0xff0000); assert.equal(d.number, 42); assert.equal(d.code, 'YOU');
});

test('lap records: per circuit, stock and modified apart, only improvements', () => {
  const r = loadRecords(JSON.stringify({ elkmoor: { stock: 33.5, modified: -2 }, monza: { stock: 80 }, harrow: 'x' }));
  assert.deepEqual(r, { elkmoor: { stock: 33.5 } });
  assert.equal(recordLap(r, 'elkmoor', false, 34), false);
  assert.equal(recordLap(r, 'elkmoor', false, 33.1), true);
  assert.equal(recordLap(r, 'elkmoor', true, 31), true, 'a modified lap never touches the stock record');
  assert.deepEqual(r.elkmoor, { stock: 33.1, modified: 31 });
  assert.equal(recordLap(r, 'marrow', false, Infinity), false);
});

test('orbit camera: turns all the way round, stays above the floor, zoom and pan are bounded', () => {
  const s = orbitState();
  for (let i = 0; i < 100; i++) turn(s, 50, 0);
  assert.ok(Math.abs(s.yaw - (Math.PI / 4 + 100 * 50 * ORBIT.turnPerPx)) < 1e-9, 'yaw has no limit');
  turn(s, 0, 10000); assert.equal(s.pitch, ORBIT.maxPitch);
  turn(s, 0, -10000); assert.equal(s.pitch, ORBIT.minPitch);
  zoom(s, 100); assert.equal(s.dist, ORBIT.maxDist); zoom(s, 0.0001); assert.equal(s.dist, ORBIT.minDist);
  pan(s, 1e6, -1e6); assert.ok(Math.abs(s.target[0]) <= ORBIT.panLimit && Math.abs(s.target[2]) <= ORBIT.panLimit && s.target[1] >= 0.05);
  // drag right = the car turns with the finger: the camera moves to the screen's left, a pan drags the car right
  const s2 = orbitState(), cam = new THREE.PerspectiveCamera();
  cam.position.set(...orbitPosition(s2)); cam.lookAt(...s2.target); cam.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), before = orbitPosition(s2), t0 = [...s2.target];
  turn(s2, 20, 0);
  assert.ok(new THREE.Vector3(...orbitPosition(s2)).sub(new THREE.Vector3(...before)).dot(right) < 0, 'camera goes left = car turns right');
  turn(s2, -20, 0); pan(s2, 20, 0);
  assert.ok(new THREE.Vector3(...s2.target).sub(new THREE.Vector3(...t0)).dot(right) < 0, 'view centre goes left = car moves right');
  const p0 = orbitPosition(s2)[1]; turn(s2, 0, 20); assert.ok(orbitPosition(s2)[1] > p0, 'drag down = from higher up');
  const front = clampOrbit({ yaw: 0, pitch: 0, dist: 5, target: [0, 0.5, 0] });
  assert.deepEqual(orbitPosition(front).map(v => +v.toFixed(9)), [5, 0.5, 0], 'yaw 0 = in front of the nose (+x)');
  const top = orbitPosition({ yaw: 0, pitch: ORBIT.maxPitch, dist: 5, target: [0, 0.5, 0] });
  assert.ok(top[1] > 5, 'from above');
});

test('a car saved before physics 2 with the old stock mass loads as stock', () => {
  const old = loadGarage(JSON.stringify({ mods: { power: 100, mass: 800, grip: 100, downforce: 100, drag: 100, brakes: 100 } }));
  assert.equal(S.isModified(old.mods), false);
  const now = loadGarage(JSON.stringify({ physics: 2, mods: { mass: 800 } }));
  assert.equal(now.mods.mass, 800);                    // saved since: 800 kg is a real mod
});

test('tyres & pit: the starting compound and the pit plan, validated (defaults: medium, AUTO, change the wing, fix)', () => {
  assert.deepEqual(loadGarage(null).tyres, STRATEGY_DEFAULTS);
  assert.deepEqual(validStrategy({ start: 'soft', next: 'hard', wing: false, repair: false }), { start: 'soft', next: 'hard', wing: false, repair: false });
  assert.deepEqual(validStrategy({ start: 'wet', next: 7, wing: 'no', repair: null }), STRATEGY_DEFAULTS);
  assert.deepEqual(pitPlanOf(validStrategy({ next: 'soft', wing: false })), { tyres: 'soft', wing: false, repair: true });
});
