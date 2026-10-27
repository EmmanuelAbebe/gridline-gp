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

test('trackside.glb: the gantry, bridge, marshal post, TV tower and board frames; the start lights in five columns', () => {
  const j = glbJson('../src/game/models/trackside.glb'), names = new Set(j.nodes.map(n => n.name));
  for (const m of ['post', 'truss', 'lights', 'marshal', 'tvtower', 'brakeboard', 'advert']) assert.ok(names.has(`${m}-solid`), `${m} is there`);
  for (const m of ['brakeboard', 'advert']) assert.ok(names.has(`${m}-panel`), `${m} has a panel for its sign`);
  // one lamp object per column of lights (world.js lights them one by one), from the grid's left (−z) to its right
  const lamps = [0, 1, 2, 3, 4].map(k => j.nodes.find(n => n.name === `lights-lamp${k}`));
  assert.ok(lamps.every(Boolean), 'five lamp columns');
  const z = lamps.map(n => { const a = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION]; return (a.min[2] + a.max[2]) / 2; });
  assert.ok(z.every((v, k) => !k || v > z[k - 1]), `columns in order across the track: ${z.map(v => v.toFixed(2))}`);
  // the truss is a 2 m section along z, the post 10 m tall (the game scales both by these)
  const size = (n, i) => { const a = j.accessors[j.meshes[j.nodes.find(x => x.name === n).mesh].primitives[0].attributes.POSITION]; return a.max[i] - a.min[i]; };
  assert.ok(Math.abs(size('truss-solid', 2) - 2) < 0.15 && Math.abs(size('post-solid', 1) - 10) < 0.1);
});

test('car.glb: the 2026 car on the physics\' wheelbase, the parts the game moves, within its triangle budget', () => {
  const j = glbJson('../src/game/models/car.glb'), byName = new Map(j.nodes.map(n => [n.name, n]));
  for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'fw_flap1', 'fw_flap2', 'rw_flap', 'steer', 'grip_l', 'grip_r', 'screen',
    'eye', 'mirror_glass_l', 'mirror_glass_r', 'rain_light']) assert.ok(byName.has(name), `${name} is there`);
  const at = n => byName.get(n).translation ?? [0, 0, 0];
  assert.ok(Math.abs(at('wheel_fl')[0] - at('wheel_rl')[0] - SIM.CHASSIS.wheelbase) < 1e-4, 'the wheelbase is the physics\' one');
  assert.ok(Math.abs(at('wheel_fr')[2] + at('wheel_fl')[2]) < 1e-6 && at('wheel_fr')[2] > 0, 'wheels mirrored, right = +z');
  for (const n of ['fw_flap1', 'fw_flap2', 'rw_flap']) assert.ok(byName.get(n).extras?.open > 0, `${n} opens in straight mode`);
  // the tyres: 2026 widths, 720 mm across
  const size = mesh => { const a = j.accessors[j.meshes[mesh].primitives[0].attributes.POSITION]; return a.max.map((v, i) => v - a.min[i]); };
  const tyre = n => size(byName.get(n).mesh);
  assert.ok(Math.abs(tyre('tyre_fl')[0] - 0.72) < 0.01 && Math.abs(tyre('tyre_fl')[2] - 0.275) < 0.005, `front tyre ${tyre('tyre_fl')}`);
  assert.ok(Math.abs(tyre('tyre_rl')[2] - 0.375) < 0.005, `rear tyre ${tyre('tyre_rl')}`);
  const roles = new Set(j.materials.map(m => m.name));
  for (const r of ['paint_main', 'paint_accent', 'carbon', 'rubber', 'metal', 'light']) assert.ok(roles.has(r), `material ${r}`);
  const tris = j.meshes.reduce((t, m) => t + m.primitives.reduce((s, p) => s + j.accessors[p.indices].count / 3, 0), 0);
  assert.ok(tris < 60000, `${tris} triangles`);
});
