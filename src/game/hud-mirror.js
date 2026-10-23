// A rear-view mirror on the HUD (2026-10-21, suggested with look back; pref hudMirror, off by default): a wide strip at
// the top of the screen (#rearMirror, movable in the layout editor) showing what is behind you, flipped like a mirror.
// The race scene goes into a small render target from a camera over the back of the cockpit looking back (its near
// plane cuts your own rear wing away), then that picture is drawn into the strip's place on the main canvas.
import * as THREE from 'three';
import { $ } from './util.js';
import { poseOf } from './pose.js';

export const HUD_MIRROR = Object.freeze({
  back: 1.0, height: 1.3,       // camera: m behind the car's centre, m up
  behind: 60, lookY: 0.9,        // looking at a point this far behind, this high
  fov: 13, near: 2.2, far: 900,  // vertical fov°; near clips your own rear wing
  scale: 1,                      // render target = the strip's size × this (× device pixels)
  perfEvery: 2,                  // Performance mode: redraw every n frames
});

export function createHudMirror(display) {
  const el = $('rearMirror'), M = HUD_MIRROR;
  const cam = new THREE.PerspectiveCamera(M.fov, 4, M.near, M.far);
  let target = null, quad = null, on = false, frame = 0, every = 1;
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function ensure(w, h) {
    const pw = Math.max(32, Math.round(w * M.scale * devicePixelRatio)), ph = Math.max(16, Math.round(h * M.scale * devicePixelRatio));
    if (target && target.width === pw && target.height === ph) return;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(pw, ph);
    if (!quad) {
      quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
      quadScene.add(quad);
    }
    const map = target.texture; map.wrapS = THREE.RepeatWrapping; map.repeat.x = -1;   // a mirror: left and right swapped
    quad.material.map = map; quad.material.needsUpdate = true;
  }

  return {
    setOn(v) { on = v; el.hidden = !v; },
    setPerformance(perf) { every = perf ? M.perfEvery : 1; },
    // after the main render, while racing
    render(car) {
      if (!on || el.hidden || !car) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      ensure(r.width, r.height);
      if (frame++ % every === 0) {
        const p = poseOf(car), dx = Math.cos(p.h), dz = Math.sin(p.h);
        const y = p.y || 0, sl = Math.tan(p.pitch || 0);                 // (a hill: pose.js)
        cam.position.set(p.x - dx * M.back, M.height + y - M.back * sl, p.z - dz * M.back);
        cam.lookAt(p.x - dx * M.behind, M.lookY + y - M.behind * sl, p.z - dz * M.behind);
        if (cam.aspect !== r.width / r.height) { cam.aspect = r.width / r.height; cam.updateProjectionMatrix(); }
        display.renderTo(target, cam);
      }
      display.drawInset(quadScene, quadCam, r);
    },
    dispose() { target?.dispose(); quad?.geometry.dispose(); quad?.material.dispose(); },
  };
}
