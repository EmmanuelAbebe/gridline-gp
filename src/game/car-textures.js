import * as THREE from 'three';
import { COLORS } from './config.js';
import { TYRE_BANDS } from './car-shapes.js';

// Canvas-drawn textures for the cars: carbon weave, tyre sidewalls, a sky reflection, the brake-light glow and race
// numbers. Drawn once at start (numbers once per car); nothing is loaded from files.
const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; };
const texture = (c, repeat) => {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
};

// 2×2 twill: diagonal steps of light and dark tows, each tow shaded across its width.
export function carbonTexture() {
  return texture(canvas(64, 64, (g, W) => {
    const n = 8, s = W / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const over = ((x + y) >> 1) % 2 === 0, grd = over ? g.createLinearGradient(x*s, 0, x*s + s, 0) : g.createLinearGradient(0, y*s, 0, y*s + s);
      grd.addColorStop(0, over ? '#7c8088' : '#4c5057'); grd.addColorStop(0.5, over ? '#c7cbd2' : '#80858d'); grd.addColorStop(1, over ? '#7c8088' : '#4c5057');
      g.fillStyle = grd; g.fillRect(x*s, y*s, s, s);
    }
  }), true);
}

// Tyre: u around the tyre, v across it (see TYRE_BANDS). Black rubber, a coloured compound ring and lettering on both
// sidewalls; the lettering is what shows the wheels turning.
export function tyreTexture(stripe = '#f2c200') {
  return texture(canvas(1024, 128, (g, W, H) => {
    const yOf = v => (1 - v) * H, side = TYRE_BANDS.side;
    g.fillStyle = '#1d1d1f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#141415'; g.fillRect(0, yOf(1 - side), W, yOf(side) - yOf(1 - side));           // tread: darker, worn
    for (const [v0, v1, flip] of [[0, side, false], [1 - side, 1, true]]) {
      const top = yOf(v1), h = yOf(v0) - top;
      g.save(); g.translate(0, top); if (flip) { g.translate(0, h); g.scale(1, -1); }
      g.fillStyle = stripe; g.fillRect(0, h * 0.5, W, h * 0.12);                                   // compound ring
      g.fillStyle = '#d9d9d6'; g.font = `bold ${Math.round(h * 0.34)}px sans-serif`; g.textBaseline = 'middle';
      for (let i = 0; i < 2; i++) { g.fillText('GRIDLINE  RACING', i * W / 2 + 40, h * 0.27); g.fillRect(i * W / 2 + 400, h * 0.18, 60, h * 0.16); }
      g.restore();
    }
  }), true);
}

// Reflection: sky above, a bright horizon, grass below, and a sun patch, as a small cube map.
export function skyEnvironment() {
  const S = 64, face = (kind, sun) => canvas(S, S, (g) => {
    if (kind === 'up') { g.fillStyle = '#8fb8e0'; g.fillRect(0, 0, S, S); return; }
    if (kind === 'down') { g.fillStyle = '#3d5530'; g.fillRect(0, 0, S, S); return; }
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, '#8fb8e0'); grd.addColorStop(0.47, '#e9f0f4'); grd.addColorStop(0.53, '#9aa59a'); grd.addColorStop(1, '#3d5530');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    if (sun) { const r = g.createRadialGradient(S * 0.35, S * 0.2, 0, S * 0.35, S * 0.2, S * 0.3); r.addColorStop(0, '#ffffff'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, S, S); }
  });
  const t = new THREE.CubeTexture([face('side'), face('side', true), face('up'), face('down'), face('side'), face('side')]);
  t.needsUpdate = true;
  return t;
}

// Soft round glow for the lit brake lights (drawn additively).
export function glowTexture() {
  return texture(canvas(64, 64, (g, W) => {
    const r = g.createRadialGradient(W/2, W/2, 0, W/2, W/2, W/2);
    r.addColorStop(0, 'rgba(255,90,70,1)'); r.addColorStop(0.25, 'rgba(255,30,20,0.55)'); r.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, W);
  }));
}

// Race number on a transparent square, white with a dark outline so it reads on every livery.
export function numberTexture(number) {
  return texture(canvas(128, 128, (g, W) => {
    g.font = `italic 800 ${W * 0.7}px "Saira Condensed", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = W * 0.08; g.strokeStyle = '#' + COLORS.carDark.toString(16).padStart(6, '0');
    g.strokeText(String(number), W / 2, W * 0.54); g.fillStyle = '#ffffff'; g.fillText(String(number), W / 2, W * 0.54);
  }));
}
