import * as THREE from 'three';

// The car's body as one closed surface (design shape 'body'): survival cell + nose, sidepods, engine cover and airbox
// are joined into a single skin with a real cockpit opening cut into it, instead of separate shapes pushed into
// each other (their nearly touching surfaces flickered: z-fighting, and the joins showed jagged lines).
//
// Each component is a list of sections [x, y, halfWidth, halfHeight, roundness, z?] (roundness: 2 = ellipse,
// higher = squarer; z = sideways centre, for the sidepods, mirrored to the left), joined along x by Catmull-Rom
// curves like a loft. At every station along the car the cross-section is the union of the components there,
// sampled on fixed rays from the cell's centre line (so a vertex keeps its direction from station to station and
// the mesh never shears), blended with a smooth maximum (fillets where the parts meet).
//   p.tub      survival cell from the nose tip to the crash structure (sets the length of the body)
//   p.pods     right sidepod (and its mirror); where it starts at full size, the step facing forward is its inlet
//   p.cover    engine cover        p.airbox  roll hoop + airbox (its forward-facing start = the intake)
//   p.keel     under the tub, down into the floor plate: the body meets the floor instead of floating above it
//   p.cockpit  { from, to, floor, side }: x range of the opening, its floor height, and the ray angle (degrees
//              above horizontal) where the rim sits: the opening is as wide as the body is at that angle
//   p.accentFrom  x ahead of which the nose is in the accent colour
// Faces get roles: 0 = the part's colour, 1 = openings, cockpit floor and end walls (dark), 2 = accent (car-models.js mergeParts reads them).
export const BODY_ROLES = [null, { color: '#0d0e10', finish: 'rubber' }, { color: 'accent' }];

const HALF = 64;                  // rays per side, bottom (-90°) to top (+90°)
const STEP = 0.05;                // station spacing along x (m)
const EDGE = 0.004;               // gap between the two stations at a sharp step (inlet, cockpit wall)
const FILLET = 0.12;              // fillet size where two parts meet (m): smooth maximum of their radii
const LIP = 0.93;                 // the cockpit rim: the opening starts this share of the way in from the side (padding)
const CREASE = Math.cos(55 * Math.PI / 180);

const catmull = (a, b, c, d, t) => 0.5 * (2*b + (c - a)*t + (2*a - 5*b + 4*c - d)*t*t + (3*b - a - 3*c + d)*t*t*t);
// sections → a function x → [y, hw, hh, n, z] | null (outside the component's x range), densely sampled
function component(list) {
  const S = (Array.isArray(list) ? list : []).filter(s => Array.isArray(s) && s.length >= 4)
    .map(s => [+s[0] || 0, +s[1] || 0, Math.max(0, +s[2] || 0), Math.max(0, +s[3] || 0), Math.max(0.5, +s[4] || 2), +s[5] || 0])
    .sort((a, b) => b[0] - a[0]);
  if (S.length < 2) return null;
  const rows = [];
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i - 1] || S[i], b = S[i], c = S[i + 1], d = S[i + 2] || S[i + 1];
    for (let k = 0; k < 16; k++) rows.push(b.map((_, j) => catmull(a[j], b[j], c[j], d[j], k / 16)));
  }
  rows.push(S[S.length - 1]);
  const x0 = S[0][0], x1 = S[S.length - 1][0];
  const at = x => {
    if (x > x0 + 1e-9 || x < x1 - 1e-9) return null;
    let i = 0; while (i < rows.length - 2 && rows[i + 1][0] > x) i++;
    const a = rows[i], b = rows[i + 1], t = a[0] === b[0] ? 0 : (a[0] - x) / (a[0] - b[0]);
    return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t);
  };
  return { x0, x1, at };
}

// smooth maximum: the larger value, rounded by up to FILLET / 4 where the two are within FILLET of each other
const smax = (a, b) => { const h = Math.max(0, FILLET - Math.abs(a - b)) / FILLET; return Math.max(a, b) + h * h * FILLET / 4; };

// far crossing of the ray o + t·d with a superellipse (cz, cy, hw, hh, n): t; a ray that misses gets a radius that
// falls off quickly with how far it misses (0 well clear of it)
function farHit(oz, oy, dz, dy, cz, cy, hw, hh, n) {
  if (hw < 1e-4 || hh < 1e-4) return 0;
  // in coordinates scaled by the half-sizes the shape fits the unit square: a ray missing its circumcircle misses
  const qz = (cz - oz) / hw, qy = (cy - oy) / hh, ez = dz / hw, ey = dy / hh, ee = ez * ez + ey * ey;
  const tp = (qz * ez + qy * ey) / ee, mz = ez * tp - qz, my = ey * tp - qy;
  if (mz * mz + my * my > 2) return 0;
  const F = t => Math.abs(ez * t - qz) ** n + Math.abs(ey * t - qy) ** n;
  let a = Math.max(0, tp);
  if (F(a) > 1) {                                  // the closest point (round norm) is outside: search the corners
    let lo = 0, hi = tp + 2 / Math.sqrt(ee);
    for (let i = 0; i < 30; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (F(m1) < F(m2)) hi = m2; else lo = m1; }
    a = (lo + hi) / 2;
    // a near miss still counts, fading fast, so the smooth maximum fillets the join instead of leaving a crease
    const f = F(a);
    if (f > 1) return a * f ** (-6 / n);
  }
  let b = a + 2 / Math.sqrt(ee);                   // past the far side of the circumcircle
  for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (F(m) <= 1) a = m; else b = m; }
  return a;
}

const cache = new Map();
export function bodyShell(size, p) {
  const key = JSON.stringify([size, p.tub, p.pods, p.cover, p.airbox, p.keel, p.cockpit, p.accentFrom]);
  if (!cache.has(key)) { if (cache.size > 16) cache.clear(); cache.set(key, build(size, p)); }
  return cache.get(key).clone();
}

function build(size, p) {
  const tub = component(p.tub) || component([[2, 0.4, 0.2, 0.15, 3], [-2, 0.4, 0.2, 0.15, 3]]);
  const pods = component(p.pods), cover = component(p.cover), airbox = component(p.airbox), keel = component(p.keel);
  const ck = p.cockpit && Number.isFinite(+p.cockpit.from) ? p.cockpit : null;
  const accentFrom = Number.isFinite(+p.accentFrom) ? +p.accentFrom : Infinity;
  // stations: even spacing plus a pair at each sharp step (component starts, the cockpit's ends)
  const xs = new Set();
  for (let x = tub.x0; x > tub.x1; x -= STEP) xs.add(+x.toFixed(4));
  xs.add(tub.x1);
  const steps = [pods, airbox].filter(Boolean).map(c => c.x0);
  if (ck) steps.push(+ck.from);
  for (const s of steps) { xs.add(s); xs.add(+(s + EDGE).toFixed(4)); }
  if (ck) { xs.add(+ck.to); xs.add(+(+ck.to - EDGE).toFixed(4)); }
  const X = [...xs].filter(x => x <= tub.x0 && x >= tub.x1).sort((a, b) => b - a);
  for (let i = X.length - 1; i > 0; i--) if (X[i - 1] - X[i] < EDGE * 0.5) X.splice(i, 1);

  const N = HALF * 2, side = (ck ? +ck.side : 35) * Math.PI / 180;
  const sideIdx = Math.round((side / Math.PI + 0.5) * HALF);           // last vertex of the outer wall
  // the cross-section at x: the components there, and the body's radius along a ray from the centre line
  const sectionAt = x => {
    const T = tub.at(x), parts = [[0, ...T.slice(0, 4)]];
    const add = (c, mirror) => { const s = c && c.at(x); if (s) { parts.push([s[4], s[0], s[1], s[2], s[3]]); if (mirror) parts.push([-s[4], s[0], s[1], s[2], s[3]]); } return s; };
    // a sidepod also gets a fairing across to the tub (its full height, out to the pod's centre): the top and bottom
    // flow into the tub as on a real car, and every point of the section stays visible from the centre line
    const pod = add(pods, true);
    if (pod) parts.push([0, pod[0], pod[4], pod[2], 4]);
    add(cover, false); add(airbox, false); add(keel, false);
    const cy = T[0];
    return { T, cy, r: a => parts.map(([cz, py, hw, hh, n]) => farHit(0, cy, Math.cos(a), Math.sin(a), cz, py, hw, hh, n)).filter(t => t > 0).sort((u, v) => u - v).reduce(smax, 0) };
  };
  // The outline of a section: dense rays (split where neighbouring points are far apart: steep or kinked spots like
  // the airbox on the engine cover), resampled evenly, smoothed (Taubin: rounds the joins into fillets without
  // shrinking the shape), then the vertices spaced by length and curvature, separately below and above the rim.
  // Points are [z, y - cy]. A station just ahead of / behind a sharp step takes its neighbour's directions, so the
  // step between them is a clean face.
  const DENSE = 2, GAP = 0.006, SPACING = 0.004, SMOOTH = 60, BEND = 0.05;
  function layoutFor(sec) {
    const M = HALF * DENSE, pt = a => { const r = sec.r(a); return [Math.cos(a) * r, Math.sin(a) * r]; };
    const dense = [pt(-Math.PI / 2)];
    const refine = (p, q, pa, qa, depth) => {
      if (depth < 6 && Math.hypot(q[0] - p[0], q[1] - p[1]) > GAP) { const ma = (pa + qa) / 2, m = pt(ma); refine(p, m, pa, ma, depth + 1); dense.push(m); refine(m, q, ma, qa, depth + 1); }
    };
    for (let i = 1; i <= M; i++) { const pa = -Math.PI / 2 + (i - 1) / M * Math.PI, qa = pa + Math.PI / M, q = pt(qa); refine(dense.at(-1), q, pa, qa, 0); dense.push(q); }
    // the closed outline (right half, then the left mirrored), resampled evenly from the bottom centre
    const loop = dense.concat(dense.slice(1, -1).reverse().map(([z, y]) => [-z, y]));
    const len = [0];
    for (let i = 1; i <= loop.length; i++) len.push(len[i - 1] + Math.hypot(loop[i % loop.length][0] - loop[i - 1][0], loop[i % loop.length][1] - loop[i - 1][1]));
    const L = len.at(-1), K = 2 * Math.max(16, Math.round(L / SPACING / 2)), even = [];
    for (let n = 0, k = 0; n < K; n++) {
      const want = n / K * L;
      while (len[k + 1] < want) k++;
      const t = (want - len[k]) / Math.max(1e-12, len[k + 1] - len[k]), p = loop[k], q = loop[(k + 1) % loop.length];
      even.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    for (let it = 0; it < SMOOTH * 2; it++) {
      const w = it % 2 ? -0.53 : 0.5, prev = even.map(p => p.slice());
      for (let n = 0; n < K; n++) {
        const a = prev[(n + K - 1) % K], c = prev[(n + 1) % K], p = even[n];
        p[0] += w * ((a[0] + c[0]) / 2 - prev[n][0]); p[1] += w * ((a[1] + c[1]) / 2 - prev[n][1]);
      }
      even[0][0] = 0; even[K / 2][0] = 0;          // the centre line stays on it
    }
    const right = even.slice(0, K / 2 + 1);
    // the rim: the outline point nearest the rim's direction
    let iSide = 0, best = Infinity;
    right.forEach(([z, y], i) => { const d = Math.abs(Math.atan2(y, z) - side); if (d < best) { best = d; iSide = i; } });
    // vertices are spread by length plus BEND metres per radian of turning, so curves and fillets get more of them
    const turn = right.map((p, i) => {
      const a = right[Math.max(0, i - 1)], c = right[Math.min(right.length - 1, i + 1)];
      const u = Math.atan2(p[1] - a[1], p[0] - a[0]), v = Math.atan2(c[1] - p[1], c[0] - p[0]);
      return i && i < right.length - 1 ? Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u))) : 0;
    });
    const out = [];
    const spread = (i0, i1, n0, n1) => {
      const l = [0];
      for (let i = i0 + 1; i <= i1; i++) l.push(l.at(-1) + Math.hypot(right[i][0] - right[i - 1][0], right[i][1] - right[i - 1][1]) + BEND * (turn[i] + turn[i - 1]) / 2);
      const T = l.at(-1) || 1;
      for (let n = n0, k = 0; n <= n1; n++) {
        const want = (n - n0) / Math.max(1, n1 - n0) * T;
        while (k < l.length - 2 && l[k + 1] < want) k++;
        const t = Math.min(1, Math.max(0, (want - l[k]) / Math.max(1e-12, l[k + 1] - l[k]))), p = right[i0 + k], q = right[i0 + Math.min(k + 1, l.length - 1)];
        out[n] = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      }
    };
    spread(0, iSide, 0, sideIdx);
    if (sideIdx < HALF) spread(iSide, right.length - 1, sideIdx, HALF);
    return out;
  }
  const secs = X.map(sectionAt), layouts = secs.map(layoutFor);
  // the same directions as the neighbour's vertices, at this station's own radius
  const project = (sec, from) => from.map(([z, y]) => { const a = Math.atan2(y, z), r = sec.r(a); return [Math.cos(a) * r, Math.sin(a) * r]; });
  const pairs = [...steps, ...(ck ? [+ck.to] : [])];
  X.forEach((x, j) => {
    for (const s of pairs) {
      if (Math.abs(x - s - EDGE) < 1e-6 && X[j + 1] !== undefined) layouts[j] = project(secs[j], layouts[j + 1]);
      if (Math.abs(x - s + EDGE) < 1e-6 && j > 0 && ck && s === +ck.to) layouts[j] = project(secs[j], layouts[j - 1]);
    }
  });
  const rings = [], notched = [], centres = [];
  X.forEach((x, j) => {
    const { T, cy } = secs[j], right = layouts[j].map(([z, y]) => [x, cy + y, z]);
    const inCk = ck && x <= +ck.from + 1e-6 && x >= +ck.to - 1e-6;
    // the stations just ahead of and behind the opening get its layout with no depth, so the walls are upright
    const edge = ck && !inCk && (Math.abs(x - +ck.from - EDGE) < 1e-6 || Math.abs(x - +ck.to + EDGE) < 1e-6);
    if (inCk || edge) {
      // cockpit: in from the rim along the top (the opening is rounded at the front and the back corners), straight
      // down the inner wall, then across the floor to the centre line
      const from = +ck.from, to = +ck.to, round = (d, min) => Math.max(min, Math.sqrt(Math.max(0, 1 - d * d)));
      const xc = Math.min(from, Math.max(to, x));
      let f = 1;
      if (xc > from - 0.22) f = round((xc - (from - 0.22)) / 0.22, 0.4);
      else if (xc < to + 0.07) f = round((to + 0.07 - xc) / 0.07, 0.7);
      const B = HALF - sideIdx, topN = Math.max(1, Math.round(B * 0.2)), wallN = Math.max(1, Math.round(B * 0.3));
      const top = right.slice(sideIdx), rz = right[sideIdx][2], wz = rz * f * LIP;
      // the top surface's height at z (from the rays still in place)
      const yAt = z => { for (let i = 0; i < top.length - 1; i++) { const a = top[i], b = top[i + 1]; if (z <= a[2] && z >= b[2]) return a[1] + (b[1] - a[1]) * (a[2] - z) / Math.max(1e-9, a[2] - b[2]); } return top[top.length - 1][1]; };
      const wy = yAt(wz), fy = Math.min(wy - 0.05, Math.max(+ck.floor, cy - T[2] + 0.03));
      for (let k = 1; k <= B; k++) {
        let z, y;
        if (k <= topN) { z = rz + (wz - rz) * k / topN; y = yAt(z); }
        else if (k <= topN + wallN) { z = wz; y = edge ? wy : wy + (fy - wy) * (k - topN) / wallN; }
        else { z = wz * (1 - (k - topN - wallN) / (B - topN - wallN)); y = edge ? yAt(z) : fy; }
        right[sideIdx + k] = [x, y, z];
      }
    }
    // the full ring: right side bottom → top, then the left side top → bottom (the centre-line points once)
    const ring = right.slice();
    for (let i = HALF - 1; i >= 1; i--) ring.push([right[i][0], right[i][1], -right[i][2]]);
    rings.push(ring); notched.push(!!inCk); centres.push([x, cy, 0]);
  });

  // triangles with a role each: quad (j, i) between ring j and j+1
  const sx = size[0], sy = size[1], sz = size[2], tris = [];
  const V = v => [v[0] * sx, v[1] * sy, v[2] * sz];
  const topN = Math.max(1, Math.round((HALF - sideIdx) * 0.2)), wallN = Math.max(1, Math.round((HALF - sideIdx) * 0.3));
  const slot = i => i <= HALF ? i : N - i;
  const inNotch = i => slot(i) >= sideIdx + topN;
  const inWall = (i, i2) => Math.max(slot(i), slot(i2)) <= sideIdx + topN + wallN;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N, a = rings[j][i], b = rings[j][i2], c = rings[j + 1][i], d = rings[j + 1][i2];
    let role = 0;
    // inside the cockpit: the side walls in the body colour (as seen from the seat), floor and end walls dark
    if ((notched[j] || notched[j + 1]) && inNotch(i) && inNotch(i2)) role = notched[j] && notched[j + 1] && inWall(i, i2) ? 0 : 1;
    else if (Math.min(a[0], c[0]) >= accentFrom) role = 2;
    // a forward-facing step between two close stations = an intake
    const nx = faceNormal(a, b, c)[0];
    if (!role && X[j] - X[j + 1] < EDGE * 1.5 && nx > 0.5) role = 1;
    tris.push([a, b, c, role], [b, d, c, role]);
  }
  // end caps (a fan to the centre); the nose cap is accent like the tip
  const first = rings[0], last = rings[rings.length - 1];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    tris.push([centres[0], first[i2], first[i], X[0] >= accentFrom ? 2 : 0]);
    tris.push([centres[rings.length - 1], last[i], last[i2], 0]);
  }
  return toGeometry(tris.map(([a, b, c, r]) => [V(a), V(b), V(c), r]));
}

function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n);
  return l > 1e-12 ? [n[0] / l, n[1] / l, n[2] / l, l] : [0, 0, 0, 0];
}

// Non-indexed geometry with creased normals: each corner averages the faces around its point that bend less than
// CREASE from its own face (smooth body, sharp rims and intake edges) and a 'role' attribute.
function toGeometry(tris) {
  const keyOf = v => Math.round(v[0] * 1e4) * 1e10 + Math.round(v[1] * 1e4 + 5e4) * 1e5 + Math.round(v[2] * 1e4 + 5e4);
  const around = new Map(), fn = tris.map(([a, b, c]) => faceNormal(a, b, c));
  tris.forEach((t, f) => { if (fn[f][3] === 0) return; for (let k = 0; k < 3; k++) { const key = keyOf(t[k]); (around.get(key) || around.set(key, []).get(key)).push(f); } });
  const pos = [], nor = [], role = [];
  tris.forEach((t, f) => {
    const n0 = fn[f]; if (n0[3] === 0) return;
    for (let k = 0; k < 3; k++) {
      let x = 0, y = 0, z = 0;
      for (const g of around.get(keyOf(t[k]))) {
        const m = fn[g];
        if (m[0] * n0[0] + m[1] * n0[1] + m[2] * n0[2] >= CREASE) { x += m[0] * m[3]; y += m[1] * m[3]; z += m[2] * m[3]; }
      }
      const l = Math.hypot(x, y, z) || 1;
      pos.push(...t[k]); nor.push(x / l, y / l, z / l); role.push(t[3]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('role', new THREE.Float32BufferAttribute(role, 1));
  return g;
}
