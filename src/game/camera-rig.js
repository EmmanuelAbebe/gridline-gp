import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { Display } from './display.js';
import { Design } from './design.js';

const { TUNING } = SIM;

// Reads the camera modes live from Design.data.cameras, so tweak-panel edits apply immediately.
export const CameraRig = (() => {
  const camera = Display.camera;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
  const cams = () => Design.data.cameras;
  let idx = 0;
  function aim(car) {
    const m = cams()[idx], dx = Math.cos(car.rh), dz = Math.sin(car.rh), sx = -dz * m.side, sz = dx * m.side;   // side: + = right
    tPos.set(car.rx - dx*m.back + sx, m.height, car.rz - dz*m.back + sz);
    tLook.set(car.rx + dx*m.ahead + sx, m.lookY, car.rz + dz*m.ahead + sz);
  }
  return {
    get mode() { return cams()[idx]; },
    cycle() { idx = (idx + 1) % cams().length; },
    select(id) { const i = cams().findIndex(c => c.id === id); if (i >= 0) idx = i; },
    snap(car) { aim(car); pos.copy(tPos); look.copy(tLook); },
    update(dt, car, still) {
      const m = cams()[idx];
      if (camera.near !== m.near) { camera.near = m.near; camera.updateProjectionMatrix(); }
      aim(car);
      const k = 1 - Math.exp(-dt * m.k);
      pos.lerp(tPos, m.rigid ? 1 : k); look.lerp(tLook, m.rigid ? 1 : Math.min(1, k*1.6));
      camera.position.copy(pos);
      if (!still) {                                     // surface shake
        if (car.onKerb && Math.abs(car.v) > 12) camera.position.y += (Math.random() - 0.5) * 0.08;
        if (car.offTrack && Math.abs(car.v) > 8) camera.position.y += (Math.random() - 0.5) * 0.14;
      }
      camera.lookAt(look);
      if (m.lean) camera.rotateZ(-car.steer * Math.min(1, Math.abs(car.v) / 40) * m.lean);   // head leans into corners
      const fov = m.fov + Math.max(0, car.v) / TUNING.VMAX * m.fovGain;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt*3); camera.updateProjectionMatrix(); }
    },
  };
})();
