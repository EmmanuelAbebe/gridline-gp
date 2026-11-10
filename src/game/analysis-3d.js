// The lap comparison in 3D (2026-11-10, analysis-screen.js COMPARE · 3D): your lap and the other one replayed in the
// circuit itself, broadcast style. Your car in its livery, the other lap as the see-through ghost car; the race's cars
// are hidden meanwhile and the camera is ours: CHASE (behind your car), TV (trackside cameras, cutting from one to the
// next as you pass), HELI (high behind, both cars in view), ONBOARD (your cockpit). Leaving puts everything back.
import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { Display } from './display.js';
import { Design } from './design.js';
import { CarModels } from './car-models.js';
import { roadPose } from './pose.js';
import { modelState } from './lap-replay.js';

export const REPLAY_3D = Object.freeze({
  chase: { back: 6.2, height: 2.2, ahead: 10, lookY: 1.0, fov: 62, k: 9 },
  heli: { back: 30, height: 34, fov: 40, k: 3, both: 140 },       // both: m: frames both cars while the other is this close
  tv: { every: 240, out: 8, height: 5, past: 45, width: 22, fov: [5, 50], both: 70 },   // m apart; past the barrier; m up; cut
                                                                  // once you are this far past; m of road in view; fov range
  snap: 40,          // m: a jump (scrubbing, the lap's end) puts the camera straight there
  tagY: 1.7,         // m above the other car: its tag
});
const CAMERAS = ['chase', 'tv', 'heli', 'onboard'];

export function createReplay3d() {
  const cam = Display.camera, pos = new THREE.Vector3(), look = new THREE.Vector3(), tPos = new THREE.Vector3(), tLook = new THREE.Vector3(), v = new THREE.Vector3();
  let me = null, ref = null, saved = null, hidden = [], spots = null, spotsOf = null, first = true, liveries = null;

  // the trackside TV cameras: every `every` m, outside the bend there, past the barrier
  function tvSpots(track) {
    if (spotsOf === track) return spots;
    const C = REPLAY_3D.tv, step = Math.max(20, Math.round(C.every / track.ds)), out = [];
    for (let i = 0; i < track.N; i += step) {
      let k = 0; for (let j = -40; j <= 40; j++) k += track.K[SIM.wrapIdx(i + j, track.N)];
      const side = k > 0 ? 0 : 1, lat = (side ? 1 : -1) * (track.runoff[side].wall[i] + C.out);   // (K > 0 turns right: the outside is left)
      out.push({ i, x: track.PX[i] + track.NX[i] * lat, z: track.PZ[i] + track.NZ[i] * lat, y: SIM.surfaceY(track, i, lat) + C.height });
    }
    spotsOf = track; spots = out; return out;
  }

  return {
    get on() { return !!saved; },
    // into the 3D view: our two cars, every other car (`others`: car models) hidden, the camera saved
    enter(others, design) {
      if (saved) return;
      if (!me) {
        me = CarModels.create(Display.scene, SIM.DRIVERS.find(d => d.player), design);
        ref = CarModels.create(Display.scene, SIM.DRIVERS.find(d => d.player), design);
        ref.setMaterials(CarModels.ghostMaterials()); ref.setShadows(false);
        if (liveries) { me.setLivery(liveries[0]); ref.setLivery(liveries[1]); }
      }
      hidden = others.filter(m => m.object.visible); for (const m of hidden) m.setVisible(false);
      me.setVisible(true); ref.setVisible(true);
      saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, near: cam.near };
      first = true;
    },
    leave() {
      if (!saved) return;
      me.setVisible(false); ref.setVisible(false); me.useCockpitView(false);
      for (const m of hidden) m.setVisible(true); hidden = [];
      cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat); cam.fov = saved.fov; cam.near = saved.near; cam.updateProjectionMatrix();
      saved = null;
    },
    rebuild(design) { me?.rebuild(design); ref?.rebuild(design); },
    setLiveries(mine, other) { liveries = [mine, other]; me?.setLivery(mine); ref?.setLivery(other); },
    cameras: CAMERAS,
    // one frame: the cars at their replayed poses, the camera, the scene drawn; → where the other car's tag goes on the
    // screen ({ x, y } in CSS px, or null when it is out of view) and whether it is behind the camera
    frame(dt, { track, me: RM, ref: RR, T, cmp, camera, jump }) {
      const sm = modelState(RM, T, track.ds), sr = modelState(RR, cmp.tRef, track.ds);
      const pm = roadPose(sm.pose.x, sm.pose.z, sm.pose.h, sm.pose.s), pr = roadPose(sr.pose.x, sr.pose.z, sr.pose.h, sr.pose.s);
      const onboard = camera === 'onboard';
      me.useCockpitView(onboard);
      me.sync(sm.car, pm, dt); ref.sync(sr.car, pr, dt);
      const dx = Math.cos(pm.h), dz = Math.sin(pm.h), gap = Math.hypot(pr.x - pm.x, pr.z - pm.z);
      let k = 1, fov = cam.fov, near = 0.5;
      if (camera === 'onboard') {
        const C = Design.data.cameras.find(c => c.id === 'cockpit'), es = CarModels.eyeShift, back = C.back - es[0], up = C.height + es[1];
        tPos.set(pm.x - dx * back, pm.y + up, pm.z - dz * back); tLook.set(pm.x + dx * C.ahead, pm.y + C.lookY, pm.z + dz * C.ahead);
        fov = C.fov; near = C.near;
      } else if (camera === 'tv') {
        const C = REPLAY_3D.tv, S = tvSpots(track), past = C.past / track.ds;
        // the next camera along the road (you are coming toward it, until `past` m beyond it)
        let best = S[0], bd = Infinity;
        for (const s of S) { const rel = SIM.wrapIdx(s.i - Math.round(sm.pose.s) + past, track.N); if (rel < bd) { bd = rel; best = s; } }
        const both = gap < C.both, mx = both ? (pm.x + pr.x) / 2 : pm.x, mz = both ? (pm.z + pr.z) / 2 : pm.z, my = both ? (pm.y + pr.y) / 2 : pm.y;
        tPos.set(best.x, best.y, best.z); tLook.set(mx, my + 0.6, mz);
        const d = tPos.distanceTo(tLook), w = C.width + (both ? gap : 0);
        fov = Math.max(C.fov[0], Math.min(C.fov[1], 2 * Math.atan(w / 2 / d) * 180 / Math.PI));
        k = 0;                                        // (a fixed camera: no swing)
      } else if (camera === 'heli') {
        const C = REPLAY_3D.heli, both = gap < C.both, mx = both ? (pm.x + pr.x) / 2 : pm.x, mz = both ? (pm.z + pr.z) / 2 : pm.z;
        tPos.set(mx - dx * C.back, pm.y + C.height, mz - dz * C.back); tLook.set(mx + dx * 6, pm.y, mz + dz * 6);
        fov = C.fov + (both ? Math.min(25, gap * 0.25) : 0); k = 1 - Math.exp(-dt * C.k);
      } else {
        const C = { ...REPLAY_3D.chase, ...(Design.data.cameras.find(c => c.id === 'chase') ?? {}) };
        tPos.set(pm.x - dx * C.back, pm.y + C.height, pm.z - dz * C.back); tLook.set(pm.x + dx * C.ahead, pm.y + C.lookY, pm.z + dz * C.ahead);
        fov = REPLAY_3D.chase.fov; k = 1 - Math.exp(-dt * REPLAY_3D.chase.k);
      }
      if (first || jump || camera === 'onboard' || camera === 'tv' || pos.distanceTo(tPos) > REPLAY_3D.snap) { pos.copy(tPos); look.copy(tLook); first = false; }
      else { pos.lerp(tPos, k); look.lerp(tLook, Math.min(1, k * 1.6)); }
      if (camera === 'tv') look.copy(tLook);
      cam.position.copy(pos); cam.lookAt(look);
      if (onboard) cam.rotateZ(-(pm.roll || 0));
      if (Math.abs(cam.fov - fov) > 0.01 || cam.near !== near) { cam.fov = fov; cam.near = near; cam.updateProjectionMatrix(); }
      Display.render();
      // the other car's tag
      v.set(pr.x, pr.y + REPLAY_3D.tagY, pr.z).project(cam);
      const behind = v.z > 1 || v.z < -1, out = behind || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      return { tag: out ? null : { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }, gap };
    },
  };
}
