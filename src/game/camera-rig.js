import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { Display } from './display.js';
import { Design } from './design.js';
import { SOUND } from './audio/audio-config.js';
import { poseOf } from './pose.js';

const { TUNING } = SIM;

// Reads the camera modes live from Design.data.cameras, so tweak-panel edits apply immediately.
export const CameraRig = (() => {
  const camera = Display.camera;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
  const shotPos = new THREE.Vector3(), shotLook = new THREE.Vector3();
  const cams = () => Design.data.cameras;
  let idx = 0, shakeAmp = 0, buffetAmp = 0, shakeScale = 1, jolt = 0, shot = null, blend = 0;
  function aim(car) {
    const m = cams()[idx], p = poseOf(car), dx = Math.cos(p.h), dz = Math.sin(p.h), sx = -dz * m.side, sz = dx * m.side;   // side: + = right
    tPos.set(p.x - dx*m.back + sx, m.height, p.z - dz*m.back + sz);
    tLook.set(p.x + dx*m.ahead + sx, m.lookY, p.z + dz*m.ahead + sz);
  }
  return {
    get mode() { return cams()[idx]; },
    cycle() { idx = (idx + 1) % cams().length; },
    select(id) { const i = cams().findIndex(c => c.id === id); if (i >= 0) idx = i; },
    snap(car) { aim(car); pos.copy(tPos); look.copy(tLook); },
    // camera shake: a kick (a car passing close, 0..1) that dies away, and continuous buffeting (dirty air, 0..1);
    // scale = the player's setting (0 = off)
    shake(strength) { shakeAmp = Math.max(shakeAmp, strength); },
    buffet(level) { buffetAmp = level; },
    setShakeScale(s) { shakeScale = s; },
    // a fixed shot (the pit stop camera): { pos: [x, y, z], look: [x, y, z], fov } or null = back to the chosen camera;
    // the camera glides between them
    setShot(s) { shot = s; },
    get onShot() { return blend > 0.5; },
    update(dt, car, still) {
      const m = cams()[idx];
      if (camera.near !== m.near) { camera.near = m.near; camera.updateProjectionMatrix(); }
      aim(car);
      blend += ((shot ? 1 : 0) - blend) * Math.min(1, dt * 2.2);
      if (shot) { tPos.lerp(shotPos.set(...shot.pos), blend); tLook.lerp(shotLook.set(...shot.look), blend); }
      const k = 1 - Math.exp(-dt * (shot || blend > 0.02 ? 2.6 : m.k)), rigid = m.rigid && !shot && blend < 0.02;
      pos.lerp(tPos, rigid ? 1 : k); look.lerp(tLook, rigid ? 1 : Math.min(1, k*1.6));
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
      if (m.lean && !shot) camera.rotateZ(-car.steer * Math.min(1, Math.abs(car.v) / 40) * m.lean);   // head leans into corners
      const fov = (shot ? shot.fov : m.fov) + Math.max(0, car.v) / TUNING.VMAX * m.fovGain;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt*3); camera.updateProjectionMatrix(); }
    },
  };
})();
