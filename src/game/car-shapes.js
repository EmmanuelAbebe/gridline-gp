import * as THREE from 'three';
import { bodyShell } from './car-body.js';

// Geometry for one car part (Design.data.car.parts), before it is moved to `pos` / turned by `rot`.
// box, rounded, sphere, cylinder, torus: plain primitives. loft: a smooth body through cross-sections. wing: an
// airfoil. rod: a tube from `pos` to `pos + size`. decal: a flat face-up square for a texture (the race number).
// body: the whole body as one surface (car-body.js).
const DEG = Math.PI / 180;

// Box with rounded corners on its y-z face (the face you see from the cockpit): an extruded rounded rectangle.
function roundedBox(len, hgt, wid, radius) {
  const r = Math.max(0, Math.min(radius || 0, hgt / 2 - 1e-4, wid / 2 - 1e-4));
  const x0 = -wid / 2, x1 = wid / 2, y0 = -hgt / 2, y1 = hgt / 2, sh = new THREE.Shape();
  sh.moveTo(x0 + r, y0);
  sh.lineTo(x1 - r, y0); sh.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
  sh.lineTo(x1, y1 - r); sh.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2);
  sh.lineTo(x0 + r, y1); sh.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
  sh.lineTo(x0, y0 + r); sh.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
  return new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -len / 2).rotateY(Math.PI / 2);
}

// Loft: sections [x, y, halfWidth, halfHeight, roundness, z] (roundness: 2 = ellipse, higher = squarer; z optional),
// joined by Catmull-Rom curves so the body flows between them; both ends are closed. size = [x, y, z] scale.
const catmull = (a, b, c, d, t) => 0.5 * (2*b + (c - a)*t + (2*a - 5*b + 4*c - d)*t*t + (3*b - a - 3*c + d)*t*t*t);
function loft(size, p) {
  let S = (Array.isArray(p.sections) ? p.sections : []).filter(s => Array.isArray(s) && s.length >= 4)
    .map(s => [+s[0] || 0, +s[1] || 0, Math.max(0, +s[2] || 0), Math.max(0, +s[3] || 0), Math.max(0.5, +s[4] || 2), +s[5] || 0]);
  if (S.length < 2) S = [[0.5, 0, 0.001, 0.001, 2, 0], [0.25, 0, 0.5, 0.5, 2, 0], [-0.25, 0, 0.5, 0.5, 2, 0], [-0.5, 0, 0.001, 0.001, 2, 0]];
  const AROUND = p.around || 28, SUB = p.smooth || 4, rows = [];
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i - 1] || S[i], b = S[i], c = S[i + 1], d = S[i + 2] || S[i + 1];
    for (let k = 0; k < SUB; k++) rows.push(b.map((_, j) => catmull(a[j], b[j], c[j], d[j], k / SUB)));
  }
  rows.push(S[S.length - 1]);
  const pos = [], uv = [], idx = [];
  const ring = r => {
    const [x, y, w, h, n, z] = r, e = 2 / n, out = [];
    for (let i = 0; i <= AROUND; i++) {
      const a = -Math.PI / 2 + i / AROUND * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      out.push([x * size[0], (y + Math.sign(s) * Math.abs(s) ** e * h) * size[1], (z + Math.sign(c) * Math.abs(c) ** e * Math.max(0, w)) * size[2]]);
    }
    return out;
  };
  const rings = rows.map(ring);
  rings.forEach((r, j) => r.forEach((v, i) => { pos.push(...v); uv.push(i / AROUND, j / (rings.length - 1)); }));
  const W = AROUND + 1;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < AROUND; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // end caps: own vertices, so their edges stay sharp
  for (const [j, flip] of [[0, false], [rings.length - 1, true]]) {
    const r = rings[j], start = pos.length / 3, cx = rows[j][0] * size[0], cy = rows[j][1] * size[1], cz = rows[j][5] * size[2];
    if (rows[j][2] < 0.002 || rows[j][3] < 0.002) continue;
    pos.push(cx, cy, cz); uv.push(0.5, 0.5);
    r.forEach(v => { pos.push(...v); uv.push(0.5, 0.5); });
    for (let i = 0; i < AROUND; i++) flip ? idx.push(start, start + 2 + i, start + 1 + i) : idx.push(start, start + 1 + i, start + 2 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // the front cap faces forward, and sections listed back to front would wind the other way
  if (rows[0][0] < rows[rows.length - 1][0]) { const I = g.index.array; for (let i = 0; i < I.length; i += 3) [I[i + 1], I[i + 2]] = [I[i + 2], I[i + 1]]; g.computeVertexNormals(); }
  return g;
}

// Wing: an inverted cambered airfoil (leading edge at +x), size [chord, thickness, span] (span along z).
function wing(size, p) {
  const [chord, th, span] = size, camber = (p.camber ?? 0.05) * chord, sh = new THREE.Shape(), M = 14;
  const at = t => {
    const yt = th / 2 * (0.2969*Math.sqrt(t) - 0.126*t - 0.3516*t*t + 0.2843*t**3 - 0.1036*t**4) / 0.1;   // NACA 00xx
    return [chord / 2 - t * chord, -camber * 4 * t * (1 - t), yt];
  };
  for (let i = 0; i <= M; i++) { const t = (1 - Math.cos(i / M * Math.PI)) / 2, [x, yc, yt] = at(t); i ? sh.lineTo(x, yc + yt) : sh.moveTo(x, yc + yt); }
  for (let i = M - 1; i > 0; i--) { const t = (1 - Math.cos(i / M * Math.PI)) / 2, [x, yc, yt] = at(t); sh.lineTo(x, yc - yt); }
  return new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false }).translate(0, 0, -span / 2);
}

// Rod: a round tube from the part's position to position + size (car-space metres), radius = p.radius.
function rod(size, p) {
  const dir = new THREE.Vector3(size[0], size[1], size[2]), len = Math.max(0.001, dir.length());
  const g = new THREE.CylinderGeometry(p.radius || 0.012, p.radius || 0.012, len, 6, 1, true).translate(0, len / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())));
  return g;
}

export const SHAPES = {
  box:      (s)    => new THREE.BoxGeometry(s[0], s[1], s[2]),
  sphere:   (s)    => new THREE.SphereGeometry(s[0], 20, 14),
  cylinder: (s, p) => new THREE.CylinderGeometry(s[0], s[0], s[1], p.segments || 16),
  rounded:  (s, p) => roundedBox(s[0], s[1], s[2], p.radius),
  torus:    (s)    => { const arc = Math.min(360, Math.max(1, s[2])); return new THREE.TorusGeometry(s[0], s[1], 8, Math.max(8, Math.round(arc / 8)), arc * DEG); },
  loft, wing, rod,
  body: bodyShell,
  decal:    (s)    => new THREE.PlaneGeometry(s[0], s[1]).rotateX(-Math.PI / 2),
};
// Shapes whose size may be negative (rod: a direction) or is a scale (loft); the rest are clamped to > 0.
export const SIGNED_SIZE = new Set(['rod', 'loft', 'body']);
// Shapes that bring their own texture coordinates (the rest get a projected carbon-weave mapping).
export const OWN_UV = new Set(['decal']);

// Tyre: a lathe with rounded shoulders, axle along z. Texture v runs across it: 0..0.25 one sidewall, then shoulder,
// tread, shoulder, 0.75..1 the other sidewall; the tyre texture paints those bands.
export const TYRE_BANDS = { side: 0.25 };
export function tyreGeometry(R, w) {
  const rim = R * 0.64, c = Math.min(w * 0.22, R * 0.2), bulge = w * 0.04, pts = [], SIDE = 9, ARC = 6, TREAD = 6;
  const side = (y0, sgn) => { for (let i = 0; i < SIDE; i++) { const t = i / SIDE, r = rim + (R - c - rim) * t; pts.push(new THREE.Vector2(r, y0 + sgn * bulge * Math.sin(t * Math.PI))); } };
  // inner sidewall (-w/2) up to the shoulder, shoulder arc, tread, arc, outer sidewall back down
  side(-w / 2, -1);
  for (let i = 0; i < ARC; i++) { const a = -Math.PI / 2 + i / ARC * Math.PI / 2; pts.push(new THREE.Vector2(R - c + c * Math.cos(a), -w / 2 + c + c * Math.sin(a))); }
  for (let i = 0; i <= TREAD; i++) pts.push(new THREE.Vector2(R, -w / 2 + c + (w - 2 * c) * i / TREAD));
  for (let i = 1; i <= ARC; i++) { const a = i / ARC * Math.PI / 2; pts.push(new THREE.Vector2(R - c + c * Math.cos(a), w / 2 - c + c * Math.sin(a))); }
  for (let i = SIDE - 1; i >= 0; i--) { const t = i / SIDE, r = rim + (R - c - rim) * t; pts.push(new THREE.Vector2(r, w / 2 + bulge * Math.sin(t * Math.PI))); }
  return new THREE.LatheGeometry(pts, 44).rotateX(Math.PI / 2);
}
