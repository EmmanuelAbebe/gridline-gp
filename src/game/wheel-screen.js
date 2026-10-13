import * as THREE from 'three';
import { Design } from './design.js';

// Live display on the steering wheel: rev lights on top, speed in the middle, gear at the bottom.
// A canvas texture on a plane, redrawn at up to 30 Hz and only while it is visible and the values changed.
export const WheelScreen = (() => {
  const W = 512, H = 300, LEDS = 15, LED_GREEN = 5, LED_RED = 10;   // first 5 green, next 5 red, last 5 blue
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture }));
  let wait = 0, lastKey = '';

  function draw({ gear, kmh, rpm }) {
    const t = Design.data.hud.theme, font = t.font.includes(' ') ? `"${t.font}"` : t.font;
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
    // top: rev lights
    const lit = Math.round(rpm * LEDS), step = W / (LEDS + 1);
    for (let i = 0; i < LEDS; i++) {
      ctx.beginPath(); ctx.arc(step * (i + 1), 34, 13, 0, Math.PI * 2);
      ctx.fillStyle = i >= lit ? '#1a1f26' : i < LED_GREEN ? '#36d27f' : i < LED_RED ? '#ff2b2b' : '#4a7dff';
      ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    // middle: speed
    const speed = String(kmh);
    ctx.font = `800 118px ${font}, "Arial Narrow", Arial, sans-serif`; ctx.fillStyle = t.text;
    ctx.fillText(speed, W / 2, 172);
    const half = ctx.measureText(speed).width / 2;
    ctx.font = `600 22px ${font}, Arial, sans-serif`; ctx.fillStyle = t.muted; ctx.textAlign = 'left';
    ctx.fillText('KM/H', W / 2 + half + 10, 172);
    ctx.fillStyle = '#1a1f26'; ctx.fillRect(40, 192, W - 80, 3);
    // bottom: gear
    ctx.textAlign = 'center'; ctx.font = `800 96px ${font}, "Arial Narrow", Arial, sans-serif`; ctx.fillStyle = t.accent;
    ctx.fillText(gear, W / 2, 285);
    texture.needsUpdate = true;
  }
  return {
    mesh,
    update(dt, data) {
      if (!mesh.visible || !mesh.parent) return;
      if ((wait -= dt) > 0) return;
      const key = `${data.gear}|${data.kmh}|${Math.round(data.rpm * LEDS)}|${JSON.stringify(Design.data.hud.theme)}`;
      if (key === lastKey) return;
      wait = 1 / 30; lastKey = key; draw(data);
    },
  };
})();
