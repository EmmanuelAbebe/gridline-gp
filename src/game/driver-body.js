import * as THREE from 'three';

// The driver as seen from the cockpit: torso, arms reaching the steering-wheel grips (two-bone IK, elbows down and
// out, so they follow the wheel as it turns) and legs down into the footwell (the right foot presses with the
// throttle, the left with the brake). Car space, metres: +x forward, +y up, +z right. Shown in cockpit view only.
export const BODY = {
  shoulder: [-0.36, 0.5, 0.2], hip: [-0.12, 0.22, 0.09], foot: [0.78, 0.33, 0.09],
  upperArm: 0.3, forearm: 0.31, thigh: 0.48, shin: 0.48, pedalTravel: 0.05,
  radius: { upperArm: 0.04, forearm: 0.033, thigh: 0.06, shin: 0.048, torso: 0.17 },
};
const UNIT = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
const HAND = new THREE.SphereGeometry(1, 12, 8);
const Y = new THREE.Vector3(0, 1, 0);

// Joint between a and c for segment lengths l1, l2, bent toward `pole` (stretched if c is out of reach).
const tmp = { d: new THREE.Vector3(), p: new THREE.Vector3() };
function solve(a, c, l1, l2, pole, out) {
  const d = tmp.d.subVectors(c, a), dist = Math.max(1e-4, d.length()), k = Math.max(1, dist / ((l1 + l2) * 0.995));
  l1 *= k; l2 *= k; d.divideScalar(dist);
  const along = (l1*l1 - l2*l2 + dist*dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1*l1 - along*along));
  const p = tmp.p.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
  return out.copy(a).addScaledVector(d, along).addScaledVector(p, h);
}
const mid = new THREE.Vector3(), dir = new THREE.Vector3();
function span(mesh, a, b, r) {
  dir.subVectors(b, a); const len = dir.length();
  mesh.position.copy(mid.addVectors(a, b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(Y, dir.divideScalar(Math.max(1e-4, len)));
  mesh.scale.set(r, len, r);
}

export function createDriverBody(driver) {
  // race suit: the team colour, a little deeper than the paint (cloth, not clearcoat)
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(driver.color).multiplyScalar(0.72), roughness: 0.85 });
  const glove = new THREE.MeshStandardMaterial({ color: driver.accent, roughness: 0.6 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 });
  const group = new THREE.Group(), R = BODY.radius;
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); group.add(m); return m; };
  const v = a => new THREE.Vector3(...a);
  const torso = mesh(UNIT, suit);
  const sides = [1, -1].map(s => ({
    s, shoulder: v([BODY.shoulder[0], BODY.shoulder[1], s * BODY.shoulder[2]]), hip: v([BODY.hip[0], BODY.hip[1], s * BODY.hip[2]]),
    elbow: new THREE.Vector3(), knee: new THREE.Vector3(), foot: new THREE.Vector3(), press: 0,
    upper: mesh(UNIT, suit), fore: mesh(UNIT, suit), hand: mesh(HAND, glove), thigh: mesh(UNIT, suit), shin: mesh(UNIT, suit), shoe: mesh(HAND, boot),
    armPole: new THREE.Vector3(0, -1, s * 0.7).normalize(), legPole: new THREE.Vector3(0.2, 1, s * 0.15).normalize(),
  }));
  const neck = new THREE.Vector3().addVectors(sides[0].shoulder, sides[1].shoulder).multiplyScalar(0.5);
  const pelvis = new THREE.Vector3().addVectors(sides[0].hip, sides[1].hip).multiplyScalar(0.5);
  span(torso, pelvis, neck, R.torso); torso.scale.z = R.torso * 1.25;

  return {
    group,
    // hands: car-space grip positions [right, left]; thr/brk 0..1 move the feet on the pedals
    update(hands, thr, brk, dt) {
      for (const sd of sides) {
        const want = sd.s > 0 ? thr : brk;
        sd.press += (want - sd.press) * Math.min(1, dt * 12);
        sd.foot.set(BODY.foot[0] + sd.press * BODY.pedalTravel, BODY.foot[1] - sd.press * 0.02, sd.s * BODY.foot[2]);
        const hand = hands[sd.s > 0 ? 0 : 1];
        solve(sd.shoulder, hand, BODY.upperArm, BODY.forearm, sd.armPole, sd.elbow);
        span(sd.upper, sd.shoulder, sd.elbow, R.upperArm); span(sd.fore, sd.elbow, hand, R.forearm);
        sd.hand.position.copy(hand); sd.hand.scale.set(0.045, 0.06, 0.045);
        solve(sd.hip, sd.foot, BODY.thigh, BODY.shin, sd.legPole, sd.knee);
        span(sd.thigh, sd.hip, sd.knee, R.thigh); span(sd.shin, sd.knee, sd.foot, R.shin);
        sd.shoe.position.copy(sd.foot); sd.shoe.scale.set(0.12, 0.06, 0.055);
      }
    },
  };
}
