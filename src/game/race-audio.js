// Per frame: turns the race into the sound engine's frame state (audio/sound-engine.js) and fires the close-pass
// whoosh + camera shake. The listener is the camera; its velocity (for Doppler) comes from how it moved.
import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { Display } from './display.js';
import { Sound } from './sound.js';
import { CameraRig } from './camera-rig.js';
import { createProximity } from './proximity.js';

const V = SIM.VEHICLE;
export function createRaceAudio() {
  const proximity = createProximity(), prevPos = new THREE.Vector3(), vel = new THREE.Vector3(), step = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3();
  const grid = new Map();   // rivals revving on the grid: code → { rpm, target, next }
  let started = false;
  function gridRpm(c, dt) {   // waiting for the lights: blips of throttle around 7–11k
    let g = grid.get(c.code); if (!g) { g = { rpm: V.idle, target: 7000, next: 0 }; grid.set(c.code, g); }
    if ((g.next -= dt) <= 0) { g.target = 6500 + Math.random() * 4800; g.next = 0.25 + Math.random() * 0.9; }
    g.rpm += (g.target - g.rpm) * Math.min(1, dt * 6);
    return g;
  }
  return {
    reset() { proximity.reset(); started = false; },
    // o: { race, player, cam (camera mode), running, onLights, thr, brk (player pedals), prefs }
    frame(dt, o) {
      const { race, player, prefs } = o, cam = Display.camera;
      cam.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      if (!started) { prevPos.copy(cam.position); vel.set(0, 0, 0); started = true; }
      if (dt > 0) vel.lerp(step.subVectors(cam.position, prevPos).divideScalar(dt), Math.min(1, dt * 10));
      prevPos.copy(cam.position);
      const P = player, rpm = o.onLights ? V.idle + o.thr * (V.redline - V.idle) * 0.95 : P.rpm;
      const rivals = [];
      for (const c of race.cars) {
        if (c === P) continue;
        const ch = Math.cos(c.rh), sh = Math.sin(c.rh), g = o.onLights ? gridRpm(c, dt) : null;
        rivals.push({ id: c.code, x: c.rx, y: 0.6, z: c.rz, vx: ch * c.v - sh * (c.vy || 0), vz: sh * c.v + ch * (c.vy || 0),
          rpm: g ? g.rpm : c.rpm, thr: g ? (g.target > g.rpm ? 0.8 : 0.1) : c.thr || 0, gear: o.onLights ? 0 : c.gear });
      }
      Sound.frame({
        mix: o.cam.cockpitBody ? 'driver' : 'tv', active: o.running, dt, doppler: prefs.doppler, shiftBeep: prefs.shiftBeep,
        listener: { x: cam.position.x, y: cam.position.y, z: cam.position.z, fx: fwd.x, fy: fwd.y, fz: fwd.z, ux: up.x, uy: up.y, uz: up.z, vx: vel.x, vy: vel.y, vz: vel.z },
        player: { rpm, thr: P.finished ? 0 : o.thr, brk: o.brk, speed: Math.abs(P.v), gear: o.onLights ? 0 : P.gear,
          limiter: rpm >= V.limiter - 120, slideF: P.slideF, slideR: P.slideR, lockF: P.lockF, spinR: P.spinR,
          surface: P.surface, onKerb: P.onKerb, slip: P.slip, beepRpm: P.autoShift ? 0 : V.autoUp },
        rivals,
      });
      // close passes: whoosh on that side + a camera kick; following in dirty air: buffeting
      CameraRig.setShakeScale(prefs.shake / 100);
      if (o.running && !o.onLights) for (const e of proximity.update(race, P)) { Sound.whoosh(e.side, e.strength); CameraRig.shake(e.strength); }
      CameraRig.buffet(o.running ? (P.slip || 0) * Math.min(1, Math.abs(P.v) / 60) : 0);
    },
  };
}
