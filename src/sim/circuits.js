// A circuit is a closed loop of control points (x, z in metres). Adding one only needs a new entry.
// `landmarks` say where trackside buildings go (render-only): a sample index, or a negative number = metres before
// the start line. `style`: 'permanent' (default) or 'street' (walls close to the road; tuning.js RUNOFF).
// `theme` = the scenery (render-only, game config.js THEMES). `corners()` builds control points from a polygon whose vertices carry a corner radius.

// Polygon [x, z, radius] → control points: each vertex with r > 0 becomes a circular arc of that radius tangent to
// both straights (points every ~arcStep m), r = 0 passes through the vertex; long straights get midpoints so the
// spline stays straight between corners.
export function corners(poly, arcStep = 12, straightStep = 120) {
  const M = poly.length, out = [], ends = [];
  for (let i = 0; i < M; i++) {
    const [px, pz] = poly[(i - 1 + M) % M], [x, z, r] = poly[i], [nx, nz] = poly[(i + 1) % M];
    let ax = x - px, az = z - pz, bx = nx - x, bz = nz - z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz); ax /= la; az /= la; bx /= lb; bz /= lb;
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    if (!r || Math.abs(turn) < 1e-3) { ends.push([[x, z]]); continue; }
    const t = r * Math.tan(Math.abs(turn) / 2), sx = x - ax * t, sz = z - az * t, side = Math.sign(turn);
    const cx = sx - az * r * side, cz = sz + ax * r * side, a0 = Math.atan2(sz - cz, sx - cx);
    const n = Math.max(2, Math.ceil(r * Math.abs(turn) / arcStep)), arc = [];
    for (let k = 0; k <= n; k++) { const a = a0 + turn * k / n; arc.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    ends.push(arc);
  }
  for (let i = 0; i < M; i++) {
    const arc = ends[i], next = ends[(i + 1) % M][0], last = arc[arc.length - 1];
    out.push(...arc);
    const len = Math.hypot(next[0] - last[0], next[1] - last[1]), n = Math.floor(len / straightStep);
    for (let k = 1; k <= n; k++) out.push([last[0] + (next[0] - last[0]) * k / (n + 1), last[1] + (next[1] - last[1]) * k / (n + 1)]);
  }
  return out.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}

export const CIRCUITS = Object.freeze({
  elkmoor: {
    name: 'Elkmoor Park', samples: 1200, theme: 'forest',
    ctrl: [[-200,0],[200,0],[450,0],[560,-40],[590,-140],[540,-230],[440,-250],[360,-200],[300,-260],[220,-330],[100,-340],[0,-280],[-60,-180],[-160,-160],[-280,-220],[-380,-200],[-430,-110],[-380,-20]],
    landmarks: { gantry: 2, grandstand: 1150, pits: 1160 },
    blurb: 'The original: a long left-hand turn 1, a tight hairpin and two fast lefts onto the straight.',
  },
  harrow: {
    name: 'Harrow Downs', theme: 'downs',
    ctrl: corners([[0, 0, 0], [800, 0, 200], [950, 500, 140], [700, 700, 25], [450, 560, 60], [250, 700, 60], [-350, 720, 18],
      [-450, 300, 30], [-300, 250, 25], [-500, 0, 90]]),
    landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    blurb: 'Fast and open: flat-out sweepers, long straights for the slipstream, one hairpin and a chicane.',
  },
  cobalt: {
    name: 'Cobalt Bay', style: 'street', theme: 'harbour',
    ctrl: corners([[100, 0, 0], [450, 0, 20], [450, 200, 22], [700, 200, 18], [700, 450, 25], [300, 450, 15], [300, 320, 20],
      [120, 320, 20], [120, 520, 30], [-200, 520, 18], [-200, 0, 25]]),
    landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    blurb: 'Street circuit: eleven right angles between the blocks. Brake late, square the corners off.',
  },
  marrow: {
    name: 'Marrow Hill', theme: 'woods',
    ctrl: corners([[200, 0, 0], [380, 0, 30], [380, -110, 30], [120, -110, 35], [60, -200, 25], [200, -260, 40], [450, -230, 25],
      [520, -330, 20], [400, -420, 22], [100, -400, 60], [-150, -380, 40], [-250, -250, 35], [-200, -80, 50], [-120, 0, 40]]),
    landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    blurb: 'Twisty: hairpins and esses one after another, short straights. All about traction out of slow corners.',
  },
  northfold: {
    name: 'Northfold', theme: 'moor',
    ctrl: corners([[250, 0, 0], [900, 0, 35], [950, 200, 90], [800, 350, 70], [950, 500, 110], [1300, 600, 25], [1300, 900, 60],
      [600, 900, 150], [-300, 950, 20], [-200, 600, 45], [-350, 350, 40], [-250, 80, 60], [-100, 0, 0]]),
    landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    blurb: 'The long one: a heavy stop into turn 1, fast esses, a long back straight into a hairpin.',
  },
});
// every circuit carries its key as `id`
for (const [id, c] of Object.entries(CIRCUITS)) c.id = id;
