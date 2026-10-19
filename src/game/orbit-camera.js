// A free orbit camera around a point (the garage's car): drag to turn all the way round (yaw has no limit), up over the
// top and down to just above the floor; scroll / pinch to zoom; right-drag, shift-drag or two fingers to move the
// point. The state and its math are pure (tests/garage-store.test.js); attach() wires the pointer to an element.
//   state: { yaw, pitch, dist, target: [x, y, z] }   yaw 0 = looking at the car's nose from the front (+x)
export const ORBIT = Object.freeze({ minPitch: -0.05, maxPitch: 1.52, minDist: 2.2, maxDist: 16, panLimit: 4, turnPerPx: 0.008, zoomPerWheel: 0.0012,
  views: { front: [0, 0.18], side: [Math.PI / 2, 0.12], rear: [Math.PI, 0.2], top: [Math.PI / 2, 1.52], three: [Math.PI / 4, 0.32] } });

export const orbitState = (dist = 9.5) => ({ yaw: Math.PI / 4, pitch: 0.32, dist, target: [0, 0.45, 0] });

export function clampOrbit(s) {
  s.pitch = Math.min(ORBIT.maxPitch, Math.max(ORBIT.minPitch, s.pitch));
  s.dist = Math.min(ORBIT.maxDist, Math.max(ORBIT.minDist, s.dist));
  for (const i of [0, 2]) s.target[i] = Math.min(ORBIT.panLimit, Math.max(-ORBIT.panLimit, s.target[i]));
  s.target[1] = Math.min(2.5, Math.max(0.05, s.target[1]));
  return s;
}
// camera position for a state (the car's frame: x forward, y up, z right)
export function orbitPosition(s) {
  const c = Math.cos(s.pitch) * s.dist;
  return [s.target[0] + Math.cos(s.yaw) * c, s.target[1] + Math.sin(s.pitch) * s.dist, s.target[2] + Math.sin(s.yaw) * c];
}
export const turn = (s, dx, dy) => { s.yaw -= dx * ORBIT.turnPerPx; s.pitch += dy * ORBIT.turnPerPx; return clampOrbit(s); };
export const zoom = (s, factor) => { s.dist *= factor; return clampOrbit(s); };
// move the target in the view plane by screen pixels (scaled with the distance, so it feels the same at any zoom)
export function pan(s, dx, dy) {
  const k = s.dist * 0.0016, rx = -Math.sin(s.yaw), rz = Math.cos(s.yaw);       // screen-right in the ground plane
  s.target[0] -= rx * dx * k; s.target[2] -= rz * dx * k;
  s.target[1] += dy * k;
  return clampOrbit(s);
}

// Pointer / wheel / keys on `el` → onChange() after each move; onUser() whenever the player touches the view.
export function attachOrbit(el, s, { onChange = () => {}, onUser = () => {} } = {}) {
  const pts = new Map();
  let last = null;
  const mid = () => { const p = [...pts.values()]; return [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)]; };
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey });
    last = pts.size === 2 ? mid() : null; onUser();
  });
  el.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) {                           // two fingers: pinch = zoom, move = pan
      const m = mid(); if (last) { zoom(s, last[2] / Math.max(1, m[2])); pan(s, m[0] - last[0], m[1] - last[1]); } last = m;
    } else if (p.b === 2 || p.b === 1 || p.shift) pan(s, dx, dy);
    else turn(s, dx, dy);
    onChange();
  });
  const up = e => { pts.delete(e.pointerId); last = pts.size === 2 ? mid() : null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { e.preventDefault(); zoom(s, Math.exp(e.deltaY * ORBIT.zoomPerWheel)); onUser(); onChange(); }, { passive: false });
  el.tabIndex = 0;
  el.addEventListener('keydown', e => {
    const k = { ArrowLeft: [-30, 0], ArrowRight: [30, 0], ArrowUp: [0, 20], ArrowDown: [0, -20] }[e.key];
    if (k) { e.preventDefault(); turn(s, k[0], k[1]); onUser(); onChange(); }
    else if (e.key === '+' || e.key === '=') { zoom(s, 0.9); onUser(); onChange(); }
    else if (e.key === '-') { zoom(s, 1.1); onUser(); onChange(); }
  });
}
