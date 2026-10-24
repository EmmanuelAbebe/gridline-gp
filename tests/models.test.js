// The Blender models (tools/blender/*.py → src/game/models/*.glb): every tree the scenery expects is there, the right
// size, within its triangle budget, with the attributes the game's materials use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIM } from '../src/sim/index.js';

function glbJson(file) {
  const b = readFileSync(new URL(file, import.meta.url));
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  return JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
}

test('trees.glb: two spruces and two broadleaf trees, each bark + leaves', () => {
  const j = glbJson('../src/game/models/trees.glb'), names = j.nodes.map(n => n.name).sort();
  assert.deepEqual(names, ['broad_a', 'broad_b', 'spruce_a', 'spruce_b'].flatMap(t => [t + '-bark', t + '-leaves']));
  let tris = 0;
  for (const n of j.nodes) {
    const p = j.meshes[n.mesh].primitives[0], pos = j.accessors[p.attributes.POSITION];
    for (const a of ['NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(a in p.attributes, `${n.name} has ${a}`);
    const tall = n.name.startsWith('spruce') ? [14, 20] : [11, 17];
    if (n.name.endsWith('-leaves')) assert.ok(pos.max[1] > tall[0] && pos.max[1] < tall[1], `${n.name} is ${pos.max[1].toFixed(1)} m tall`);
    assert.ok(pos.min[1] > -0.6, `${n.name} stays out of the ground (${pos.min[1].toFixed(2)} m)`);   // (trunks sink 0.25 m)
    tris += j.accessors[p.indices].count / 3;
  }
  assert.ok(tris < 12000, `${tris} triangles in all`);   // ~760 trees on Marrow Hill
  assert.equal(j.images.length, 2);
});

test('pits.glb: the pit building\'s modules, a bay as wide as a garage (where pit.js stops the cars)', () => {
  const j = glbJson('../src/game/models/pits.glb'), G = SIM.PIT.garages, mods = {};
  for (const n of j.nodes) { const [m, role] = n.name.split('-'); (mods[m] ||= {})[role] = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION]; }
  assert.deepEqual(Object.keys(mods).sort(), ['bay', 'end_a', 'end_b', 'stand']);
  for (const r of ['solid', 'inside', 'team', 'glass', 'panel']) assert.ok(mods.bay[r], `bay has ${r}`);
  const b = mods.bay.glass;                                   // (the glass front spans exactly one bay)
  assert.ok(Math.abs(b.max[0] - b.min[0] - G.step) < 0.01, `bay ${(b.max[0] - b.min[0]).toFixed(2)} m wide, garages ${G.step} m apart`);
  assert.equal(G.step * SIM.DRIVERS.length, G.building, 'a bay per team fills the building');
  // (z = away from the track: the roof's overhang ends before the boxes the cars stop in)
  assert.ok(mods.bay.solid.min[2] > -(SIM.PIT.garage - SIM.PIT.box), `roof overhang ${(-mods.bay.solid.min[2]).toFixed(1)} m`);
  assert.ok(mods.end_a.solid.min[0] >= -0.01 && mods.end_b.solid.max[0] <= 0.01, 'the end blocks start at the building\'s ends');
});

test('stands.glb: grandstand bays with their seat layout, end walls, two kinds of seated fan', () => {
  const j = glbJson('../src/game/models/stands.glb'), mods = {};
  for (const n of j.nodes) { const [m, role] = n.name.split('-'); (mods[m] ||= {})[role] = n; }
  for (const k of ['main', 'small']) {
    for (const m of [k, `${k}_end_a`, `${k}_end_b`]) assert.ok(mods[m]?.solid, `${m} is there`);
    const L = mods[k].solid.extras, pos = j.accessors[j.meshes[mods[k].seat.mesh].primitives[0].attributes.POSITION];
    assert.ok(L && L.rows > 0 && L.seats > 0 && L.width > 0, `${k} carries its seat layout`);
    // the layout describes the seats really modelled: the last row's pans are where the seats end
    const top = L.y0 + (L.rows - 1) * L.riser + L.panY, back = (L.rows - 1) * L.rowDepth + L.panZ;
    assert.ok(Math.abs(pos.max[1] - (top + 0.46)) < 0.05 && Math.abs(pos.max[2] - (back + 0.22)) < 0.05, `${k}: seats match the layout`);
    assert.ok(pos.min[0] >= -L.width / 2 && pos.max[0] <= L.width / 2, `${k}: seats inside the bay`);
  }
  for (const f of ['fan_sit', 'fan_cheer']) for (const r of ['shirt', 'skin', 'legs']) assert.ok(mods[f]?.[r], `${f} ${r}`);
});
