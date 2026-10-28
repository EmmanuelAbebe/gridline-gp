import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { Display } from './display.js';
import { Design } from './design.js';
import { SOUND } from './audio/audio-config.js';
import { poseOf } from './pose.js';

const { TUNING } = SIM;

// Looking around (2026-10-21, user: "a 180° back view to see the cars behind", camera only). back: while held, a
// rear camera over the nose looking back past the rear wing, from any camera view (inside the cockpit the headrest
// would fill the view), switched to at once; side: the chosen camera turned (cockpit: the head) or swung round the car
// (chase / high) by `side` radians, eased in quickly.
export const LOOK = Object.freeze({
  back: { ahead: 4.6, height: 2.1, behind: 40, lookY: 0.6, fov: 64 },   // m in front of the car's centre, m up, m behind looked at
  side: 1.25,           // rad (~72°)
  sideRate: 14,         // 1/s
});

// Reads the camera modes live from Design.data.cameras, so tweak-panel edits apply immediately.
export const CameraRig = (() => {
  const camera = Display.camera;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
  const cams = () => Design.data.cameras;
  let idx = 0, shakeAmp = 0, buffetAmp = 0, shakeScale = 1, jolt = 0, turn = 0, side = 0, back = false, aimNow = false;
  let eyeShift = [0, 0];   // the car model's eye minus the classic car's (CarModels eyeShift): cockpit cameras sit in its seat
  function aim(car) {
    const m = cams()[idx], p = poseOf(car);
    if (back) {                                           // the rear view
      const B = LOOK.back, dx = Math.cos(p.h), dz = Math.sin(p.h);
      const sl = Math.tan(p.roadPitch || 0), y = p.y || 0;
      tPos.set(p.x + dx * B.ahead, B.height + y + B.ahead * sl, p.z + dz * B.ahead); tLook.set(p.x - dx * B.behind, B.lookY + y - B.behind * sl, p.z - dz * B.behind);
      return;
    }
    // side: + = right; turn: looking left / right (the camera swings round the car; in the cockpit the eye stays put)
    const dx = Math.cos(p.h), dz = Math.sin(p.h), sx = -dz * m.side, sz = dx * m.side;
    const lx = Math.cos(p.h + turn), lz = Math.sin(p.h + turn), orbit = m.cockpitBody ? 0 : 1;
    const ox = dx + (lx - dx) * orbit, oz = dz + (lz - dz) * orbit;
    // on a hill (pose.js y, pitch): up with the road, and along its slope (behind the car lower uphill, ahead higher)
    const y = p.y || 0, sl = Math.tan(p.roadPitch || 0);   // (the road's slope: in the air the car's own tilt goes on top, below)
    const mb = m.cockpitBody ? m.back - eyeShift[0] : m.back, mh = m.cockpitBody ? m.height + eyeShift[1] : m.height;
    tPos.set(p.x - ox*mb + sx, mh + y - mb * sl, p.z - oz*mb + sz);
    tLook.set(p.x + lx*m.ahead + sx, m.lookY + y + m.ahead * sl, p.z + lz*m.ahead + sz);
  }
  return {
    get mode() { return cams()[idx]; },
    // [forward, up] metres from the classic car's seat to the current car model's (CarModels.eyeShift)
    setEyeShift(d) { eyeShift = d; },
    cycle() { idx = (idx + 1) % cams().length; },
    select(id) { const i = cams().findIndex(c => c.id === id); if (i >= 0) idx = i; },
    snap(car) { aim(car); pos.copy(tPos); look.copy(tLook); },
    // camera shake: a kick (a car passing close, 0..1) that dies away, and continuous buffeting (dirty air, 0..1);
    // scale = the player's setting (0 = off)
    shake(strength) { shakeAmp = Math.max(shakeAmp, strength); },
    buffet(level) { buffetAmp = level; },
    setShakeScale(s) { shakeScale = s; },
    get lookingBack() { return back; },
    // look = Input.look { back, side }: held each frame (camera only; nothing changes for the car)
    setLook(l) {
      const was = back; back = !!l.back;
      if (back !== was) { aimNow = true; }                // straight there and straight back: a glance, no swoop
      side = back ? 0 : l.side || 0;
    },
    update(dt, car, still) {
      const m = cams()[idx];
      turn += (side * LOOK.side - turn) * Math.min(1, dt * LOOK.sideRate);
      if (camera.near !== m.near) { camera.near = m.near; camera.updateProjectionMatrix(); }
      aim(car);
      const k = 1 - Math.exp(-dt * m.k), rigid = m.rigid;
      if (aimNow) { pos.copy(tPos); look.copy(tLook); aimNow = false; }
      else if (back) { pos.copy(tPos); look.copy(tLook); }
      else { pos.lerp(tPos, rigid ? 1 : k); look.lerp(tLook, rigid ? 1 : Math.min(1, k*1.6)); }
      camera.position.copy(pos);
      if (!still) {                                     // close-pass kick and dirty-air buffeting
        const S = SOUND.shake, a = (shakeAmp * S.passBy + buffetAmp * S.buffet) * shakeScale;
        jolt = a;
        if (a > 1e-4) { camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a; camera.position.z += (Math.random() - 0.5) * a; }
      }
      shakeAmp *= Math.exp(-dt / SOUND.shake.decay);
      if (!still) {                                     // surface shake
        if (car.onKerb && Math.abs(car.v) > 12) camera.position.y += (Math.random() - 0.5) * 0.08;
        if (car.offTrack && SIM.speedOf(car) > 4) camera.position.y += (Math.random() - 0.5) * (car.surface === 'gravel' ? 0.18 : car.surface === 'turf' ? 0.06 : 0.12);
      }
      camera.lookAt(look);
      if (!still && jolt > 1e-4) camera.rotateZ((Math.random() - 0.5) * jolt * 0.35);   // a little roll with the shake
      if (m.lean && !back) camera.rotateZ(-car.steer * Math.min(1, Math.abs(car.v) / 40) * m.lean);   // head leans into corners
      if (m.cockpitBody && !back) { const p = poseOf(car); camera.rotateZ(-(p.roll || 0)); if (p.airPitch) camera.rotateX(p.airPitch); }   // and with the car on a banked road, or tumbling in the air
      const fov = (back ? LOOK.back.fov : m.fov) + Math.max(0, car.v) / TUNING.VMAX * m.fovGain;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt*3); camera.updateProjectionMatrix(); }
    },
  };
})();
