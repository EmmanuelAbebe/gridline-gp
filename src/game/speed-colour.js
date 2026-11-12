// Lines coloured by speed (the lap comparison's 2D map, the practice analysis): slow → fast, lightness rising
// (perceptual, plasma-like; not the laps' own amber / cyan). The CSS keys' gradients use the same five stops.
export const SPEED_RAMP = Object.freeze([[123, 77, 255], [196, 69, 201], [242, 97, 90], [249, 162, 60], [246, 230, 91]]);
export function speedColour(kmh, lo, hi) {
  const u = Math.max(0, Math.min(1, (kmh - lo) / ((hi - lo) || 1))) * (SPEED_RAMP.length - 1), k = Math.min(SPEED_RAMP.length - 2, Math.floor(u)), f = u - k;
  const a = SPEED_RAMP[k], b = SPEED_RAMP[k + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
const BINS = 24;
// a line through samples a..b (pt(i) = canvas [x, y] or null), its colour changing with kmhAt(i): one path per colour step.
// The last path stays open, so a caller can lineTo the car and stroke again.
export function strokeBySpeed(g, pt, a, b, kmhAt, lo, hi) {
  let bin = -1, prev = null;
  for (let i = a; i <= b; i++) {
    const p = pt(i);
    if (!p) { if (bin !== -1) g.stroke(); bin = -1; prev = null; continue; }
    const v = kmhAt(i), nb = Number.isFinite(v) ? Math.round(Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1))) * BINS) : -2;
    if (nb !== bin) {
      if (bin !== -1) g.stroke();
      g.beginPath(); g.strokeStyle = nb === -2 ? '#5b6573' : speedColour(lo + nb / BINS * (hi - lo), lo, hi);
      g.moveTo(...(prev ?? p)); bin = nb;
    }
    g.lineTo(p[0], p[1]); prev = p;
  }
  if (bin !== -1) g.stroke();
}
