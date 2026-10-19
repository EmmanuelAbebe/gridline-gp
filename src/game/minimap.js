import { hexCss } from './util.js';
import { poseOf } from './pose.js';

// A small static outline of a circuit (start menu preview), start line in amber.
export function drawOutline(canvas, track, color = '#e9ebe6') {
  const { N, PX, PZ } = track, { minX, maxX, minZ, maxZ } = track.bounds, P = 6, W = canvas.width, H = canvas.height;
  const s = Math.min((W - 2*P) / (maxX - minX), (H - 2*P) / (maxZ - minZ));
  const x = v => P + (v - minX) * s + (W - 2*P - (maxX - minX) * s) / 2, z = v => P + (v - minZ) * s + (H - 2*P - (maxZ - minZ) * s) / 2;
  const g = canvas.getContext('2d'); g.clearRect(0, 0, W, H); g.lineJoin = 'round';
  g.beginPath(); for (let i = 0; i <= N; i += 4) { const k = i % N; i ? g.lineTo(x(PX[k]), z(PZ[k])) : g.moveTo(x(PX[k]), z(PZ[k])); }
  g.closePath(); g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = '#ffc21a'; g.beginPath(); g.arc(x(PX[0]), z(PZ[0]), 3.5, 0, Math.PI*2); g.fill();
}

// Track outline drawn once to an offscreen canvas; each frame blits it and adds the car dots.
export function createMinimap(canvas, track) {
  const SIZE = canvas.width, PAD = 26, inner = SIZE - PAD*2, { N, PX, PZ, NX, NZ } = track, { minX, maxX, minZ, maxZ } = track.bounds;
  const scale = Math.min(inner / (maxX - minX), inner / (maxZ - minZ));
  const mx = x => PAD + (x - minX) * scale + (inner - (maxX - minX) * scale) / 2;
  const mz = z => PAD + (z - minZ) * scale + (inner - (maxZ - minZ) * scale) / 2;
  const base = document.createElement('canvas'); base.width = base.height = SIZE;
  { const x = base.getContext('2d'); x.lineJoin = 'round';
    x.beginPath(); for (let i = 0; i <= N; i += 4) { const k = i % N; i ? x.lineTo(mx(PX[k]), mz(PZ[k])) : x.moveTo(mx(PX[k]), mz(PZ[k])); }
    x.closePath(); x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 14; x.stroke();
    x.strokeStyle = '#e9ebe6'; x.lineWidth = 4; x.stroke();
    x.save(); x.translate(mx(PX[0]), mz(PZ[0])); x.rotate(Math.atan2(NZ[0], NX[0]));
    x.fillStyle = '#ffc21a'; x.fillRect(-12, -3, 24, 6); x.restore(); }
  const ctx = canvas.getContext('2d');
  return {
    draw(cars) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(base, 0, 0);
      for (const c of cars.slice().sort((a, b) => (a.player ? 1 : 0) - (b.player ? 1 : 0))) {   // player on top
        ctx.beginPath(); const p = poseOf(c); ctx.arc(mx(p.x), mz(p.z), c.player ? 9 : 6.5, 0, Math.PI*2);
        ctx.fillStyle = hexCss(c.color); ctx.fill();
        ctx.lineWidth = c.player ? 3.5 : 2; ctx.strokeStyle = c.player ? '#ffffff' : 'rgba(0,0,0,.7)'; ctx.stroke();
      }
    },
  };
}
