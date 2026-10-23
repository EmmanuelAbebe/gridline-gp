import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Display } from './display.js';
import { markWorldShadows } from './shadows.js';

// The city benchmark (2026-10-23; not in the game: Cobalt Bay's city is on hold, its buildings only measure what big
// textures and meshes cost). tools/blender/city.py makes the building sets; desktop/main.cjs --track-shots=dir
// --bench-city=dir sends each .glb here: `benchCity(buf, count)` scatters `count` buildings round the circuit shown
// (instanced per building type, away from the track like scenery.js's), `clear()` takes them away. Debug builds only.
let city = null;

export function clearCity() {
  if (!city) return;
  Display.scene.remove(city);
  const seen = new Set();
  city.traverse(o => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); m.map?.dispose(); m.dispose(); } });
  city = null;
}

export async function benchCity(track, buf, count) {
  clearCity();
  const t0 = performance.now();
  const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(buf, '', ok, fail));
  const parseMs = performance.now() - t0, types = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (!o.isMesh) return; const [t, role] = o.name.split('-');
    (types[t] ||= {})[role] = { geo: o.geometry.clone().applyMatrix4(o.matrixWorld), map: o.material.map }; });
  // where: a seeded scatter round the circuit, clear of the track (its barriers + 15 m) and of each other
  const { N, PX, PZ, runoff, bounds } = track, keys = Object.keys(types).sort();
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const spots = [], free = (x, z, r) => { for (let i = 0; i < N; i += 3) { const R = Math.max(runoff[0].wall[i], runoff[1].wall[i]) + r + 15;
    if ((x - PX[i]) ** 2 + (z - PZ[i]) ** 2 < R * R) return false; } return spots.every(s => Math.hypot(x - s.x, z - s.z) > r + s.r + 6); };
  for (let tries = 0; spots.length < count && tries < count * 60; tries++) {
    const x = bounds.minX - 500 + rnd() * (bounds.maxX - bounds.minX + 1000), z = bounds.minZ - 500 + rnd() * (bounds.maxZ - bounds.minZ + 1000);
    const t = keys[spots.length % keys.length], g = types[t].facade.geo; if (!g.boundingSphere) g.computeBoundingSphere();
    const r = g.boundingSphere.radius * 0.75;                      // (a square tower's footprint, about)
    if (free(x, z, r)) spots.push({ x, z, r, t });
  }
  city = new THREE.Group(); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const t of keys) {
    const mine = spots.filter(s => s.t === t); if (!mine.length) continue;
    const facade = types[t].facade; facade.map.encoding = THREE.LinearEncoding;
    const meshes = [new THREE.InstancedMesh(facade.geo, new THREE.MeshLambertMaterial({ map: facade.map }), mine.length),
      new THREE.InstancedMesh(types[t].roof.geo, new THREE.MeshLambertMaterial({ vertexColors: true }), mine.length)];
    mine.forEach((s, k) => { q.setFromAxisAngle(up, Math.floor(rnd() * 4) * Math.PI / 2); m4.compose(new THREE.Vector3(s.x, -0.5, s.z), q, one);
      for (const m of meshes) m.setMatrixAt(k, m4); });
    city.add(...meshes);
  }
  markWorldShadows(city); Display.scene.add(city);
  // the first frame with it: uploads every texture and buffer to the GPU
  const t1 = performance.now(); Display.timeRender(1); const uploadMs = performance.now() - t1;
  let tris = 0, texBytes = 0;
  for (const m of city.children) { const g = m.geometry, n = g.index ? g.index.count / 3 : g.attributes.position.count / 3; tris += n * m.count;
    const img = m.material.map?.image; if (img) texBytes += img.width * img.height * 4 * 4 / 3; }   // RGBA + mipmaps
  return { buildings: spots.length, types: keys.length, parseMs: Math.round(parseMs), uploadMs: Math.round(uploadMs),
    triangles: Math.round(tris), textureMB: Math.round(texBytes / 1048576), ...Display.info() };
}
