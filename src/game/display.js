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
  scene.add(new THREE.HemisphereLight(0xe2efff, 0x47662f, 0.8));
  const sun = new THREE.DirectionalLight(0xfff0d4, 0.95); sun.position.set(-300, 500, 250); scene.add(sun);

  let renderer = null, antialias = null, scales = [1], scaleIdx = 0;
  function createRenderer(aa) {
    let canvas = $('gl');
    if (renderer) {                       // antialiasing can only be set at creation, so swap in a fresh canvas
      renderer.dispose(); renderer.forceContextLoss();
      const fresh = document.createElement('canvas'); fresh.id = 'gl'; canvas.replaceWith(fresh); canvas = fresh;
    }
    renderer = new THREE.WebGLRenderer({ canvas, antialias: aa, powerPreference: 'high-performance' });
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
  }
  // One render-resolution step down; false when already at the lowest.
  function stepDown() { if (scaleIdx >= scales.length - 1) return false; setScale(scaleIdx + 1); return true; }

  addEventListener('resize', resize); resize();
  return { scene, camera, gpu, applyProfile, stepDown, render: () => renderer.render(scene, camera), get scale() { return scales[scaleIdx]; },
    // another scene through another camera on the same canvas (the garage)
    renderWith: (sc, cam) => renderer.render(sc, cam) };
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
