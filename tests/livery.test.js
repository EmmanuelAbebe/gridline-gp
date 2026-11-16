// The free livery (src/game/livery.js): zones, layers, spray and parts, validated; where a point of the car sits on the
// zones and the paint texture's panels.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.devicePixelRatio ??= 1;
const { zoneAt, MAT, MODELS, panelOf, planeOf, toPixel, panelRect, pixelsPerMetre, twinOf, PANELS, validLayer, newLayer, validStroke, liveryExtras, validZones,
  PRESETS, applyPreset, MAX_LAYERS, MAX_SPRAY_POINTS, EXHAUSTS, ZONE_IDS } = await import('../src/game/livery.js');
const { loadGarage, validLivery, LIVERY_DEFAULTS } = await import('../src/game/garage-store.js');

test('zones: the parts of the 2026 car by where they are, and which materials each paints', () => {
  const at = (x, y, z, m = MAT.main) => zoneAt('f1', { x, y, z }, m);
  assert.equal(at(1.6, 0.45, 0), 'nose');
  assert.equal(at(2.5, 0.2, 0.6, MAT.carbon), 'fwing');
  assert.equal(at(0.5, 0.5, 0.2), 'cell');
  assert.equal(at(-0.4, 0.45, 0.7), 'pods');
  assert.equal(at(-1.2, 0.7, 0.3), 'cover');
  assert.equal(at(0.5, 0.95, 0.3, MAT.carbon), 'halo');
  assert.equal(at(0.9, 0.8, 0, MAT.main), 'halo', 'its centre pillar');
  assert.equal(at(0.6, 0.7, 0.57), 'mirrors');
  assert.equal(at(-2.2, 0.9, 0.2, MAT.carbon), 'rwing');
  assert.equal(at(-2.2, 0.7, 0.55), 'plates');
  assert.equal(at(-2.05, 0.5, 0.02), 'exhaust');
  assert.equal(at(-1.8, 0.5, 0.1), 'foil');
  assert.equal(at(1.6, 0.45, 0, MAT.carbon), null, 'the nose zone paints the paint, not the carbon on it');
  assert.equal(at(-0.2, 1.0, 0, MAT.accent), 'tcam');
  for (const m of Object.values(MODELS)) for (const b of m.boxes) assert.ok(ZONE_IDS.includes(b[0]) && b[1] < b[2] && b[3] < b[4] && b[5] < b[6], String(b));
});

test('panels: a surface paints the panel it faces; every point of the car lands inside its panel, mirrored for the left', () => {
  assert.equal(panelOf({ x: 0, y: 0, z: 1 }), 'right'); assert.equal(panelOf({ x: 0, y: 0.2, z: -1 }), 'left');
  assert.equal(panelOf({ x: 0, y: 1, z: 0.3 }), 'top'); assert.equal(panelOf({ x: 1, y: 0, z: 0.2 }), 'front'); assert.equal(panelOf({ x: -1, y: 0.1, z: 0 }), 'rear');
  assert.equal(panelOf({ x: 0, y: -1, z: 0.1 }), null, 'the underside is not painted');
  for (const model of ['f1', 'fe']) {
    const P = MODELS[model].panels;
    for (const panel of PANELS) {
      const [rx, ry, rw, rh] = panelRect(panel);
      for (const p of [{ x: P.x[0] + 0.01, y: P.y[0] + 0.01, z: -P.z + 0.01 }, { x: P.x[1] - 0.01, y: P.y[1] - 0.01, z: P.z - 0.01 }, { x: 0.3, y: 0.5, z: 0.2 }]) {
        const [px, py] = toPixel(model, panel, ...planeOf(panel, p));
        assert.ok(px >= rx && px <= rx + rw && py >= ry && py <= ry + rh, `${model} ${panel} ${JSON.stringify(p)} → ${px}, ${py}`);
      }
      const [kx, ky] = pixelsPerMetre(model, panel);
      assert.ok(Math.abs(kx / ky - 1) < 0.12, `${model} ${panel}: square pixels (${kx.toFixed(0)} × ${ky.toFixed(0)} per m)`);
    }
    // seen from the right the nose is to the right, from the left to the left; up is up
    assert.ok(toPixel(model, 'right', 1, 0.5)[0] > toPixel(model, 'right', 0, 0.5)[0]);
    assert.ok(toPixel(model, 'left', 1, 0.5)[0] < toPixel(model, 'left', 0, 0.5)[0]);
    assert.ok(toPixel(model, 'right', 0, 0.8)[1] < toPixel(model, 'right', 0, 0.2)[1]);
  }
  assert.deepEqual(twinOf('right', 100, 200), ['left', 100, 200]); assert.deepEqual(twinOf('top', 100, 200), ['top', 100, -200]); assert.deepEqual(twinOf('front', 100, 200), ['front', -100, 200]);
});

test('layers, spray and parts: validated, kept within bounds', () => {
  const s = newLayer('stripe', 0xff0000, 3);
  assert.equal(s.kind, 'stripe'); assert.equal(s.c, 0xff0000); assert.equal(s.id, 3);
  assert.equal(validLayer({ kind: 'laser' }), null);
  const t = validLayer({ kind: 'text', text: 'A'.repeat(40) + '\n', w: 99, o: 3, view: 'under', c: '#00ff00' });
  assert.equal(t.text.length, 24); assert.equal(t.w, 6); assert.equal(t.o, 1); assert.equal(t.view, 'side'); assert.equal(t.c, 0x00ff00);
  assert.equal(validLayer({ kind: 'shape', shape: 'blob' }).shape, 'chevron');
  const st = validStroke({ k: 's', c: '#123456', r: 9999, p: [0, 100, 200, 9, 1, 1, 2, 'x', 3, 1, -50, 400] });
  assert.equal(st.r, 600); assert.equal(st.c, 0x123456); assert.deepEqual(st.p, [0, 100, 200, 1, -50, 400], 'bad points dropped');
  assert.equal(validStroke({ k: 'q', p: [0, 1, 2] }), null);
  const big = Array.from({ length: 10 }, () => ({ k: 's', p: Array(MAX_SPRAY_POINTS / 4).fill(0) }));
  const X = liveryExtras({ layers: Array(60).fill({ kind: 'fade' }), spray: big, parts: { exhaust: 'gold', foil: false }, zones: { nose: { c: '#ff0000' }, halo: { ref: 'body' }, bogus: { c: 1 } }, name: 'A\u0007BC' });
  assert.equal(X.layers.length, MAX_LAYERS);
  assert.ok(X.spray.reduce((a, s) => a + s.p.length, 0) <= MAX_SPRAY_POINTS, 'the spray stays within its room');
  assert.deepEqual(X.parts, { carbon: 'gloss', exhaust: 'worn', foil: false, glow: true });
  assert.deepEqual(X.zones, { nose: { c: 0xff0000, f: null }, halo: { c: null, f: null, ref: 'body' } });
  assert.equal(X.name, 'ABC');
  assert.deepEqual(validZones({ fin: { f: 'carbon' } }), { fin: { c: null, f: 'carbon' } });
  for (const e of Object.values(EXHAUSTS)) assert.equal(e.stops.length, 4);
});

test('the garage keeps the free livery; presets keep your number, name and spray', () => {
  const l = validLivery({ color: '#ff0000', layers: [{ kind: 'stripe', c: '#ffffff' }], spray: [{ k: 's', p: [0, 1, 2] }], name: 'REY' });
  const g = loadGarage(JSON.stringify({ livery: l }));
  assert.equal(g.livery.layers.length, 1); assert.equal(g.livery.spray.length, 1); assert.equal(g.livery.name, 'REY');
  assert.deepEqual(validLivery({}), { ...LIVERY_DEFAULTS });
  const p = applyPreset({ ...g.livery, number: 42 }, PRESETS[1]);
  assert.equal(p.number, 42); assert.equal(p.name, 'REY'); assert.equal(p.spray.length, 1); assert.equal(p.color, PRESETS[1].color);
  assert.equal(p.layers.length, PRESETS[1].layers.length);
  assert.ok(p.layers.every(x => x && x.id > 0));
});
