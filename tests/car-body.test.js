// The one-piece car body (src/game/car-body.js) and the design migration that brings older saves to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyShell } from '../src/game/car-body.js';
import { DESIGN_DEFAULTS } from '../src/game/design-defaults.js';
import { Design } from '../src/game/design.js';

const BODY = DESIGN_DEFAULTS.car.parts.find(p => p.shape === 'body');

test('body: one closed skin over the whole length, with dark openings and an accent nose', () => {
  const g = bodyShell([1, 1, 1], BODY), P = g.attributes.position.array, N = g.attributes.normal.array, R = g.attributes.role.array;
  assert.ok(P.every(Number.isFinite) && N.every(Number.isFinite), 'no NaN');
  g.computeBoundingBox();
  const b = g.boundingBox, xs = BODY.tub.map(s => s[0]);
  assert.ok(Math.abs(b.max.x - Math.max(...xs)) < 1e-6 && Math.abs(b.min.x - Math.min(...xs)) < 1e-6, 'nose tip to crash structure');
  assert.ok(b.max.z > 0.7 && Math.abs(b.max.z + b.min.z) < 1e-6, 'sidepods, mirrored');
  // closed: every edge is shared by exactly two faces (counting both directions)
  const key = (i) => [P[i], P[i + 1], P[i + 2]].map(v => Math.round(v * 1e4)).join(',');
  const edges = new Map();
  for (let t = 0; t < P.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let k = 0; k < 3; k++) { const e = v[k] + '>' + v[(k + 1) % 3]; edges.set(e, (edges.get(e) || 0) + 1); }
  }
  let open = 0;
  for (const [e, n] of edges) { const [a, c] = e.split('>'); if (n !== 1 || edges.get(c + '>' + a) !== 1) open++; }
  assert.equal(open, 0, 'watertight');
  const count = r => R.filter(x => x === r).length / 3;
  assert.ok(count(1) > 50, 'cockpit, sidepod inlets and intake are dark');
  assert.ok(count(2) > 50, 'accent nose tip');
  // the cockpit is a real opening: at the driver's seat the top of the body is the cockpit floor
  let top = -1;
  for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i] + 0.2) < 0.03 && Math.abs(P[i + 2]) < 0.1) top = Math.max(top, P[i + 1]);
  assert.ok(top < BODY.cockpit.floor + 0.01, `seat area open (top ${top})`);
  // cached: the same design builds once
  assert.notEqual(bodyShell([1, 1, 1], BODY), g, 'a copy each time');
});

test('design v5 saves: the separate body shapes become the one-piece body, other parts are kept', () => {
  const old = ['monocoque', 'monocoque (cockpit view)', 'front bulkhead', 'cockpit side R', 'cockpit side L', 'nose tip', 'cockpit opening',
    'engine cover', 'airbox', 'airbox inlet', 'sidepod R', 'sidepod L', 'sidepod inlet R', 'sidepod inlet L']
    .map(name => ({ name, shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'body', sections: [] }));
  const mine = { name: 'my winglet', shape: 'box', size: [0.1, 0.1, 0.1], pos: [1, 0.5, 0], color: 'accent' };
  Design.replace({ version: 5, car: { parts: [...old, mine, { name: 'shark fin', shape: 'loft', size: [1, 1, 1], pos: [0, 0, 0], color: 'body' }] } });
  const names = Design.data.car.parts.map(p => p.name);
  assert.equal(names.filter(n => n === 'body').length, 1, 'one body');
  assert.ok(names.includes('my winglet'), 'own part kept');
  assert.equal(names.filter(n => n === 'shark fin').length, 1, 'no duplicates');
  for (const o of old) if (o.name !== 'body') assert.ok(!names.includes(o.name), `${o.name} gone`);
  assert.equal(Design.data.car.parts.find(p => p.name === 'body').shape, 'body');
  Design.reset();
});

test('design v6 saves: the new rear and moving wings replace the default parts, own parts and the steering wheel stay', () => {
  const v6 = [{ name: 'diffuser', shape: 'box' }, { name: 'wing pylon', shape: 'rounded' }, { name: 'rear wing flap', shape: 'wing', rot: [0, 0, -40] },
    { name: 'my camera', shape: 'box', size: [0.1, 0.1, 0.1], pos: [0, 1.2, 0] }, { name: 'wheel body', shape: 'rounded', steer: true, size: [0.05, 0.2, 0.3] }];
  Design.replace({ version: 6, car: { parts: v6 } });
  const parts = Design.data.car.parts, names = parts.map(p => p.name);
  assert.ok(!names.includes('diffuser') && !names.includes('wing pylon'), 'old rear parts gone');
  assert.equal(parts.find(p => p.name === 'rear wing flap').open, 24, 'the flap moves');
  assert.ok(names.includes('my camera'));
  assert.deepEqual(parts.filter(p => p.steer).map(p => p.name), ['wheel body'], 'the player\'s steering wheel kept');
  Design.reset();
});
