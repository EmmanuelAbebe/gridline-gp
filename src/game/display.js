import * as THREE from 'three';
import { CONFIG } from './config.js';
import { $ } from './util.js';

export function detectGpu(renderer) {
  let name = '';
  try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) {}
  const short = ((name.match(/(Intel\(R\)[^,(]*|Intel[^,(]*Graphics[^,(]*|NVIDIA[^,(]*|GeForce[^,(]*|Radeon[^,(]*|AMD[^,(]*|Mali[^,(]*|Adreno[^,(]*|Apple[^,(]*|llvmpipe|SwiftShader)/i) || [])[1] || '')
    .replace(/\(R\)|\(TM\)/g, '').trim();
  return { name, short, weak: /Intel|llvmpipe|SwiftShader|Mali|Adreno|PowerVR|Software/i.test(name) };
}

// Owns the WebGL renderer, scene, camera and render resolution.
export const Display = (() => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.sky);
  scene.fog = new THREE.Fog(CONFIG.sky, 220, 1500);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 3000);
  // sky light + sun: 2026-10-20 the sun went lower (44° up, was 52°) and stronger against the sky so shadows read
  scene.add(new THREE.HemisphereLight(0xe2efff, 0x47662f, 0.68));
  const sun = new THREE.DirectionalLight(0xfff0d4, 1.08); sun.position.set(-300, 380, 250); scene.add(sun, sun.target);
  // Sun shadows (GFX profile `shadows` { size, range } or null): one shadow map over a `range` m box around where the
  // camera looks, moved in whole shadow-map texels (no shimmering edges as it follows), drawn once per frame
  // (mirrors reuse it). shadows.js decides which meshes cast and receive.
  const SUN_DIR = sun.position.clone().normalize();
  let shadowCfg = null;
  const sv = { fwd: new THREE.Vector3(), c: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
  function followSun() {
    if (!shadowCfg) return;
    const { fwd, c, right, up } = sv, R = shadowCfg.range;
    camera.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); fwd.normalize();
    c.copy(camera.position).addScaledVector(fwd, R * 0.55); c.y = 0;
    right.crossVectors(SUN_DIR, THREE.Object3D.DefaultUp).normalize(); up.crossVectors(right, SUN_DIR).normalize();
    const texel = 2 * R / shadowCfg.size, a = c.dot(right), b = c.dot(up);
    c.addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(up, Math.round(b / texel) * texel - b);
    sun.target.position.copy(c); sun.position.copy(c).addScaledVector(SUN_DIR, 800);
    renderer.shadowMap.needsUpdate = true;
  }
  function setShadows(cfg) {
    const was = !!shadowCfg; shadowCfg = cfg || null;
    sun.castShadow = !!shadowCfg; renderer.shadowMap.enabled = !!shadowCfg;
    if (shadowCfg) {
      const sc = sun.shadow.camera, R = shadowCfg.range;
      Object.assign(sc, { left: -R, right: R, top: R, bottom: -R, near: 500, far: 1100 }); sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.5;
      if (sun.shadow.mapSize.x !== shadowCfg.size) { sun.shadow.mapSize.set(shadowCfg.size, shadowCfg.size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    }
    if (was !== !!shadowCfg) scene.traverse(o => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });   // shaders change
  }

  let renderer = null, antialias = null, scales = [1], scaleIdx = 0;
  function createRenderer(aa) {
    let canvas = $('gl');
    if (renderer) {                       // antialiasing can only be set at creation, so swap in a fresh canvas
      renderer.dispose(); renderer.forceContextLoss();
      const fresh = document.createElement('canvas'); fresh.id = 'gl'; canvas.replaceWith(fresh); canvas = fresh;
    }
    renderer = new THREE.WebGLRenderer({ canvas, antialias: aa, powerPreference: 'high-performance' });
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.enabled = !!shadowCfg;
    antialias = aa;
  }
  createRenderer(true);
  const gpu = detectGpu(renderer);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function setScale(i) { scaleIdx = i; renderer.setPixelRatio(scales[i]); resize(); }
  function applyProfile(p) {
    if (antialias !== p.antialias) createRenderer(p.antialias);
    scales = p.renderScales;
    setScale(Math.max(0, scales.findIndex(v => v <= p.startScale)));
    scene.fog.near = p.fog[0]; scene.fog.far = p.fog[1];
    camera.far = p.far; camera.updateProjectionMatrix();
    setShadows(p.shadows);
  }
  // One render-resolution step down; false when already at the lowest.
  function stepDown() { if (scaleIdx >= scales.length - 1) return false; setScale(scaleIdx + 1); return true; }

  addEventListener('resize', resize); resize();
  return { scene, camera, gpu, applyProfile, stepDown, render: () => { followSun(); renderer.render(scene, camera); },
    // (tests) ms per frame of this view, the GPU included: n renders, each waited for with a 1-pixel read
    timeRender(n = 30) { const gl = renderer.getContext(), px = new Uint8Array(4), t0 = performance.now();
      for (let i = 0; i < n; i++) { followSun(); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return (performance.now() - t0) / n; }, get scale() { return scales[scaleIdx]; },
    // another scene through another camera on the same canvas (the garage)
    renderWith: (sc, cam) => { renderer.shadowMap.needsUpdate = true; renderer.render(sc, cam); },
    get shadows() { return !!shadowCfg; },
    shadowInfo() { let cast = 0, recv = 0; scene.traverse(o => { if (o.castShadow) cast++; if (o.receiveShadow) recv++; });
      return { on: renderer.shadowMap.enabled, sun: sun.castShadow, size: sun.shadow.mapSize.x, cast, recv, map: !!sun.shadow.map }; },
    // the race scene into a texture (the player's mirrors)
    renderTo(target, cam) { renderer.setRenderTarget(target); renderer.render(scene, cam); renderer.setRenderTarget(null); },
    // draw `sc` through `cam` into a rectangle of the canvas (CSS px from the top left, a DOMRect) over what is there
    // (the HUD mirror)
    drawInset(sc, cam, r) {
      const y = innerHeight - r.bottom, auto = renderer.autoClear;
      renderer.setViewport(r.left, y, r.width, r.height); renderer.setScissor(r.left, y, r.width, r.height); renderer.setScissorTest(true);
      renderer.autoClear = false; renderer.render(sc, cam); renderer.autoClear = auto;
      renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
    } };
})();

export function createFpsMonitor(windowSec) {
  let n = 0, sum = 0;
  return {
    // returns the average fps when a window completes, else null
    sample(dt) {
      if (dt <= 0 || dt >= 0.1 || document.hidden) return null;
      n++; sum += dt;
      if (sum < windowSec) return null;
      const fps = n / sum; n = 0; sum = 0; return fps;
    },
  };
}
