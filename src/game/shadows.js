import * as THREE from 'three';

// Which meshes cast and receive the sun's shadow (Display.js owns the shadow map). See-through meshes (glows, decals,
// overlays, the ghost car) do neither.
// (a car body has one see-through group, the race number decal: it still casts)
const seeThrough = o => [].concat(o.material).every(m => !m || m.transparent);

// a car, the driver, the garage's car: everything solid casts and receives
export function markShadows(obj, on = true) {
  obj.traverse(o => { if (o.isMesh) { const s = on && !seeThrough(o); o.castShadow = s; o.receiveShadow = s; } });
}

// The track world: everything solid receives; only things that stand up cast (trees, stands, barriers, boards,
// buildings): the flat ground, road, kerbs and run-off would only add shadow acne. Meshes outside the sun's shadow
// box are culled from the shadow pass, so far scenery costs nothing.
export function markWorldShadows(group, minHeight = 0.3) {
  group.traverse(o => {
    if (!o.isMesh) return;
    if (seeThrough(o)) { o.castShadow = o.receiveShadow = false; return; }
    o.receiveShadow = true;
    const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
    if (o.isInstancedMesh) instanceBounds(o);
    o.castShadow = (g.boundingBox.max.y - g.boundingBox.min.y) * o.scale.y > minHeight;
  });
}

// Three r128 culls an InstancedMesh by its one geometry's sphere at the mesh's origin, not where the instances are:
// give the geometry a sphere around all of them (trees, crowds, buildings), for the main view and the shadow pass.
function instanceBounds(o) {
  const g = o.geometry, pts = [], m = new THREE.Matrix4(), v = new THREE.Vector3();
  if (!g.boundingSphere) g.computeBoundingSphere();
  const r = g.boundingSphere.radius, n = o.instanceMatrix.count;
  let scale = 1;
  for (let i = 0; i < n; i++) { o.getMatrixAt(i, m); pts.push(v.setFromMatrixPosition(m).clone()); scale = Math.max(scale, m.getMaxScaleOnAxis()); }
  if (!pts.length) return;
  const sphere = new THREE.Sphere().setFromPoints(pts);
  sphere.radius += r * scale;
  g.boundingSphere = sphere;
}
