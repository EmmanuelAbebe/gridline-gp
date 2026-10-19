// Working mirrors (src/game/mirrors.js): a camera per "mirror glass" part, looking back along the driver's
// reflected line of sight (outward on each side), rendered only when the car can be seen up close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMirrors } from '../src/game/mirrors.js';
import { DESIGN_DEFAULTS } from '../src/game/design-defaults.js';

const parts = DESIGN_DEFAULTS.car.parts.map(p => ({ rot: [0, 0, 0], show: 'always', ...p }));
const EYE = [-0.33, 0.77, 0];

test('one camera per mirror glass, looking back and outward on its side; the picture is flipped', () => {
  const shots = [], car = new THREE.Group();
  const m = createMirrors((target, cam) => shots.push({ target, dir: cam.getWorldDirection(new THREE.Vector3()), pos: cam.position.clone() }));
  m.build(car, parts);
  assert.equal(m.count, parts.filter(p => /mirror glass/.test(p.name)).length);
  m.update(EYE, 'cockpit', new THREE.Vector3(-0.33, 0.77, 0));
  assert.equal(shots.length, 2);
  for (const s of shots) {
    assert.ok(s.dir.x < -0.7, `looks backwards (${s.dir.x.toFixed(2)})`);
    assert.ok(Math.sign(s.dir.z) === Math.sign(s.pos.z), 'and outward, on its own side');
    assert.equal(s.target.texture.repeat.x, -1, 'left-right flipped');
  }
  // far from the car (TV camera): nothing rendered
  shots.length = 0;
  car.position.set(100, 0, 0); m.update(EYE, 'outside', new THREE.Vector3(0, 5, 0));
  assert.equal(shots.length, 0);
  m.dispose();
});

test('the mirror follows the car: turned 90°, it still looks out of the back', () => {
  const shots = [], car = new THREE.Group();
  car.rotation.y = -Math.PI / 2;                   // heading +z in the world (CarModels.place: rotation.y = -h)
  const m = createMirrors((t, cam) => shots.push(cam.getWorldDirection(new THREE.Vector3())));
  m.build(car, parts);
  m.update(EYE, 'cockpit', new THREE.Vector3());
  for (const d of shots) assert.ok(d.z < -0.7, `looks back along -z (${d.z.toFixed(2)})`);
});
