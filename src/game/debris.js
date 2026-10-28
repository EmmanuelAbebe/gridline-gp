// Debris (2026-10-28): the pieces that come off a car in a crash (a front wing half, SIM c.wingOff) as copies of the
// car's own meshes that fly off with the car's speed, tumble, bounce on the ground and slide to a stop, then lie where
// they came to rest until the next race (Debris.clear). Looks only: nothing in the sim knows about them.
import * as THREE from 'three';

export const DEBRIS = Object.freeze({
  max: 24,                 // pieces kept at once (the oldest goes)
  keep: 0.75,              // of the car's velocity the piece leaves with, plus `up` m/s upward and `spread` m/s sideways at random
  up: 2.5, spread: 2, spin: 9,   // spin: rad/s at random about each axis
  drag: 0.35,              // per s in the air (a light carbon panel)
  bounce: 0.3, scrub: 0.55, // on hitting the ground: vertical speed × bounce, the rest × scrub (and the spin)
  slide: 6,                // m/s² of sliding friction on the road
  rest: 0.25,              // m/s: slower than this on the ground = at rest
});

const G = 9.81, q = new THREE.Quaternion(), axis = new THREE.Vector3(), box = new THREE.Box3(), m4 = new THREE.Matrix4();

export const Debris = (() => {
  let scene = null;
  const pieces = [];
  return {
    // objs: the car's objects coming off (meshes or groups); vel = the car's world velocity {x, z}; ground = the road's
    // height there (m)
    spawn(sceneIn, objs, vel, ground, rnd = Math.random) {
      scene = sceneIn;
      const holder = new THREE.Group();
      box.makeEmpty();
      for (const o of objs) { o.updateWorldMatrix(true, true); box.expandByObject(o); }
      if (box.isEmpty()) return;
      box.getCenter(holder.position);
      holder.updateMatrixWorld(true);
      const inv = m4.copy(holder.matrixWorld).invert();
      for (const o of objs) {
        const c = o.clone(true);
        new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).decompose(c.position, c.quaternion, c.scale);
        c.visible = true; c.traverse(x => { x.visible = true; x.frustumCulled = false; });
        holder.add(c);
      }
      scene.add(holder);
      const D = DEBRIS, r = () => rnd() * 2 - 1;
      pieces.push({ holder, ground, low: holder.position.y - box.min.y, rest: false,
        v: new THREE.Vector3(vel.x * D.keep + r() * D.spread, D.up * (0.5 + rnd()), vel.z * D.keep + r() * D.spread),
        w: new THREE.Vector3(r() * D.spin, r() * D.spin, r() * D.spin) });
      while (pieces.length > D.max) { const old = pieces.shift(); scene.remove(old.holder); }
    },
    step(dt) {
      const D = DEBRIS;
      for (const p of pieces) {
        if (p.rest) continue;
        const h = p.holder, onGround = h.position.y - p.low <= p.ground + 0.01;
        if (!onGround) { p.v.y -= G * dt; p.v.multiplyScalar(1 - D.drag * dt); }
        h.position.addScaledVector(p.v, dt);
        if (p.w.lengthSq() > 1e-6) { axis.copy(p.w).normalize(); h.quaternion.premultiply(q.setFromAxisAngle(axis, p.w.length() * dt)); }
        if (h.position.y - p.low < p.ground) {                // hit the ground: bounce, scrub, slide
          h.position.y = p.ground + p.low;
          if (p.v.y < 0) p.v.y = -p.v.y * D.bounce;
          p.v.x *= D.scrub; p.v.z *= D.scrub; p.w.multiplyScalar(D.scrub);
          if (p.v.y < 0.5) {
            p.v.y = 0;
            const s = Math.hypot(p.v.x, p.v.z), k = s > 0 ? Math.max(0, s - D.slide * dt) / s : 0;
            p.v.x *= k; p.v.z *= k; p.w.multiplyScalar(k);
            if (s < D.rest) p.rest = true;
          }
        }
      }
    },
    clear() { for (const p of pieces) scene?.remove(p.holder); pieces.length = 0; },
    get count() { return pieces.length; },
  };
})();
