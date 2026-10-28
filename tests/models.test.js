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

test('car.glb: the 2026 car (Qvist_designs, CC-BY) on the physics\' wheelbase, the parts the game moves, within budget', () => {
  const j = glbJson('../src/game/models/car.glb'), byName = new Map(j.nodes.map(n => [n.name, n]));
  for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'rw_flap', 'rw_flap2', 'fw_flap_l', 'fw_flap_r', 'steer', 'grip_l', 'grip_r',
    'screen', 'eye', 'mirror_glass_l', 'mirror_glass_r', 'rain_light', 'helmet']) assert.ok(byName.has(name), `${name} is there`);
  const at = n => byName.get(n).translation ?? [0, 0, 0];
  assert.ok(Math.abs(at('wheel_fl')[0] - at('wheel_rl')[0] - SIM.CHASSIS.wheelbase) < 0.02, `wheelbase ${at('wheel_fl')[0] - at('wheel_rl')[0]}`);
  assert.ok(Math.abs(at('wheel_fr')[2] + at('wheel_fl')[2]) < 0.01 && at('wheel_fr')[2] > 0, 'wheels mirrored, right = +z');
  assert.ok(Math.abs(at('wheel_fl')[1] - 0.36) < 0.02, 'axles at the tyres\' radius');
  for (const n of ['rw_flap', 'rw_flap2', 'fw_flap_l', 'fw_flap_r']) {
    const e = byName.get(n).extras ?? {};
    assert.ok(e.open > 0 && Array.isArray(e.axis) && Math.abs(Math.hypot(...e.axis) - 1) < 1e-3, `${n} opens about its hinge`);
  }
  assert.ok(at('eye')[1] > 0.65 && at('eye')[1] < 0.95, 'the eye at a driver\'s height');
  const size = node => { const m = j.meshes[node.mesh]; const a = m.primitives.map(p => j.accessors[p.attributes.POSITION]);
    return [0, 1, 2].map(i => Math.max(...a.map(x => x.max[i])) - Math.min(...a.map(x => x.min[i]))); };
  for (const n of ['tyre_fl', 'tyre_rl']) { const d = size(byName.get(n)); assert.ok(Math.abs(d[1] - 0.72) < 0.02 && d[2] > 0.25 && d[2] < 0.45, `${n} ${d}`); }
  const roles = new Set(j.materials.map(m => m.name));
  for (const r of ['paint_main', 'paint_accent', 'carbon', 'rubber', 'metal', 'light']) assert.ok(roles.has(r), `material ${r}`);
  const tris = j.meshes.reduce((t, m) => t + m.primitives.reduce((s, p) => s + j.accessors[p.indices].count / 3, 0), 0);
  assert.ok(tris < 80000, `${tris} triangles`);
  assert.match(JSON.stringify(j.asset), /Qvist_designs|CC-BY/, 'the credit travels with the file');
});

test('driver.glb: the driver (skinned, a steering clip), the helmet and the steering wheel, in the 2026 car\'s seat', () => {
  const j = glbJson('../src/game/models/driver.glb'), byName = new Map(j.nodes.map(n => [n.name, n]));
  for (const name of ['helmet', 'wheel', 'wheel_screen', 'Head_06', 'LeftHand_013', 'RightHand_036']) assert.ok(byName.has(name), `${name} is there`);
  assert.equal(j.skins.length, 1);
  const clip = j.animations.find(a => a.name === 'steer');
  assert.ok(clip, 'the steer clip');
  // its keys: −lock … +lock in 9 steps (car-glb.js maps the wheel's angle onto them)
  // (the still bones' channels are cut to their ends by the exporter)
  assert.equal(Math.max(...clip.samplers.map(sm => j.accessors[sm.input].count)), 9);
  const car = glbJson('../src/game/models/car.glb'), steer = car.nodes.find(n => n.name === 'steer').translation;
  const wheel = byName.get('wheel').translation;
  assert.ok(wheel.every((v, i) => Math.abs(v - steer[i]) < 1e-3), `the wheel at the car's steer node (${wheel} vs ${steer})`);
  assert.ok(byName.get('helmet').extras?.show === 'outside', 'the helmet is hidden from the cockpit');
  const tris = j.meshes.reduce((t, m) => t + m.primitives.reduce((s, p) => s + j.accessors[p.indices].count / 3, 0), 0);
  assert.ok(tris < 45000, `${tris} triangles`);       // (one per car on the grid)
  assert.match(JSON.stringify(j.asset), /BELAZ.*MizuCorp.*OscarContrerasLithgow/, 'the credits travel with the file');
});

test('car.glb: the cars\' hitbox (SIM HITBOX) follows the body and tyres seen from above, within ~10 cm', () => {
  const b = readFileSync(new URL('../src/game/models/car.glb', import.meta.url)), jl = b.readUInt32LE(12), bin = b.subarray(20 + jl + 8), j = glbJson('../src/game/models/car.glb');
  const parent = {}; j.nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const at = i => { let t = [0, 0, 0]; for (let k = i; k !== undefined; k = parent[k]) { const u = j.nodes[k].translation || [0, 0, 0]; t = t.map((v, q) => v + u[q]); } return t; };
  const pts = [];                 // plan view [x forward, z right] of the body, wings and tyres
  j.nodes.forEach((n, i) => {
    if (n.mesh === undefined || !/^(body|tyre_|fw_flap|rw_flap)/.test(n.name)) return;
    const t = at(i);
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION], v = j.bufferViews[a.bufferView], o = (v.byteOffset || 0) + (a.byteOffset || 0), st = v.byteStride || 12;
      for (let k = 0; k < a.count; k++) pts.push([bin.readFloatLE(o + k * st) + t[0], bin.readFloatLE(o + k * st + 8) + t[2]]);
    }
  });
  const width = (x, d = 0.05) => Math.max(0, ...pts.filter(p => Math.abs(p[0] - x) < d).map(p => Math.abs(p[1])));
  const hitbox = x => { let w = 0; for (const { pts: P } of SIM.HITBOX.parts) for (let i = 0; i < P.length; i++) {
    const [a0, b0] = P[i], [a1, b1] = P[(i + 1) % P.length];
    if (a0 !== a1 && (a0 - x) * (a1 - x) <= 0) w = Math.max(w, Math.abs(b0 + (b1 - b0) * (x - a0) / (a1 - a0)));
  } return w; };
  const xs = pts.map(p => p[0]), lo = Math.min(...xs), hi = Math.max(...xs);
  for (let x = lo + 0.05; x < hi - 0.05; x += 0.1) {
    const h = hitbox(x), near = [-0.1, 0, 0.1].map(d => width(x + d));   // (the model's width steps at its edges)
    assert.ok(h > Math.min(...near) - 0.12 && h < Math.max(...near) + 0.1, `x ${x.toFixed(2)}: hitbox ±${h.toFixed(2)} m, the car ±${near[1].toFixed(2)}`);
  }
  for (const { pts: P } of SIM.HITBOX.parts) assert.ok(P.every(([a]) => a > lo - 0.05 && a < hi + 0.05), 'within the car\'s length');
});
