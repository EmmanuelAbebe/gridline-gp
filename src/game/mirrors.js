import * as THREE from 'three';

// Working rear-view mirrors on the player's car. Every design part named "mirror glass …" gets a glass face (on the
// side facing the driver) showing a live picture: a small camera at the glass looks along the driver's line of sight
// reflected off the glass (so turning the camera rig doesn't change it: the mirror shows what the driver sees from the
// seat), renders the race scene into a texture, and the glass shows it flipped left-right, like a mirror.
// Rendered only when it can be seen (cockpit view, or the camera near the car); Performance mode: lower resolution and
// one mirror per frame.
export const MIRROR = Object.freeze({
  fov: 11,              // vertical field of view (degrees): a touch wider than a flat mirror (real ones are slightly convex)
  near: 0.05, far: 900,
  pixelsPerMetre: 2900, // render-target width per metre of glass (Quality); Performance halves it
  visibleWithin: 18,    // m: outside the cockpit, render only while the camera is this close to the car
  tint: 0xd6dbe0,       // glass: slightly darker and cooler than the world
});

export function createMirrors(renderTo) {
  const DEG = Math.PI / 180, items = [];
  let root = null, quality = true, frame = 0;
  const C = new THREE.Vector3(), E = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion();

  function clear() {
    for (const m of items) { m.holder.parent?.remove(m.holder); m.target.dispose(); m.plane.material.dispose(); m.plane.geometry.dispose(); }
    items.length = 0;
  }
  // (Re)build the glass faces from the car design's parts, on the car model's root group.
  function build(carRoot, parts) {
    clear(); root = carRoot;
    for (const p of parts) {
      if (!/mirror glass/i.test(p.name) || p.show === 'off' || p.steer) continue;
      const [t, h, w] = p.size.map(v => Math.max(0.001, Math.abs(v)));       // box: thickness (x), height, width (z)
      const holder = new THREE.Object3D();
      holder.position.set(...p.pos); holder.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
      const px = Math.round(w * MIRROR.pixelsPerMetre * (quality ? 1 : 0.5)), py = Math.max(16, Math.round(px * h / w));
      const target = new THREE.WebGLRenderTarget(px, py, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      target.texture.wrapS = THREE.RepeatWrapping; target.texture.repeat.x = -1; target.texture.offset.x = 1;   // left-right flip
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: target.texture, color: MIRROR.tint }));
      plane.rotation.y = -Math.PI / 2;                 // faces -x (back at the driver); its width runs along +z
      plane.position.x = -(t / 2 + 0.0008);            // just off the glass part's face
      plane.visible = false;                           // shown once it has a picture
      holder.add(plane); root.add(holder);
      const cam = new THREE.PerspectiveCamera(MIRROR.fov, w / h, MIRROR.near, MIRROR.far);
      items.push({ holder, plane, target, cam, show: p.show || 'always', rendered: false });
    }
  }
  return {
    build,
    setQuality(on) { quality = on; },
    get count() { return items.length; },
    // eye: the driver's eye in car space [x, y, z]; view: 'cockpit' | 'outside'; camPos: the main camera (world)
    update(eye, view, camPos) {
      if (!root || !items.length) return;
      frame++;
      const near = view === 'cockpit' || camPos.distanceTo(root.position) < MIRROR.visibleWithin;
      root.updateMatrixWorld(true);
      E.set(eye[0], eye[1], eye[2]).applyMatrix4(root.matrixWorld);
      for (const m of items) m.plane.visible = false;       // never in its own (or the other mirror's) picture
      items.forEach((m, i) => {
        const shown = root.visible && (m.show === 'always' || m.show === view);
        if (!shown || !near || (!quality && frame % items.length !== i)) return;
        m.plane.getWorldPosition(C); m.plane.getWorldQuaternion(q);
        n.set(0, 0, 1).applyQuaternion(q);                   // the glass's normal, toward the driver
        d.subVectors(C, E).normalize();
        d.addScaledVector(n, -2 * d.dot(n));                 // the line of sight, reflected
        m.cam.position.copy(C).addScaledVector(d, 0.01);
        m.cam.up.set(0, 1, 0); m.cam.lookAt(C.x + d.x, C.y + d.y, C.z + d.z);
        m.cam.updateMatrixWorld();
        renderTo(m.target, m.cam);
        m.rendered = true;
      });
      for (const m of items) m.plane.visible = m.rendered && root.visible && (m.show === 'always' || m.show === view) && near;
    },
    dispose: clear,
  };
}
