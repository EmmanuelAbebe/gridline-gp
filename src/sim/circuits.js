// A circuit is a closed loop of control points (x, z in metres). Adding one only needs a new entry.
// `landmarks` say where trackside buildings go (render-only): a sample index, or a negative number = metres before
// the start line. `style`: 'permanent' (default) or 'street' (walls close to the road; tuning.js RUNOFF).
// `theme` = the scenery (render-only, game config.js THEMES). `corners()` builds control points from a polygon whose vertices carry a corner radius.

// Polygon [x, z, radius] → control points: each vertex with r > 0 becomes a circular arc of that radius tangent to
// both straights (points every ~arcStep m), r = 0 passes through the vertex; long straights get midpoints so the
// spline stays straight between corners.
export function corners(poly, arcStep = 12, straightStep = 120) { return layout(poly, arcStep, straightStep).ctrl; }

// The same, plus each vertex's arc (start, middle, end points; one point for r = 0) and turn direction, for course().
function layout(poly, arcStep = 12, straightStep = 120) {
  const M = poly.length, out = [], ends = [], turns = [];
  for (let i = 0; i < M; i++) {
    const [px, pz] = poly[(i - 1 + M) % M], [x, z, r] = poly[i], [nx, nz] = poly[(i + 1) % M];
    let ax = x - px, az = z - pz, bx = nx - x, bz = nz - z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz); ax /= la; az /= la; bx /= lb; bz /= lb;
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    turns.push(turn);
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
  return { ctrl: out.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]), ends, turns };
}

// A circuit with hills and banking: polygon vertices [x, z, radius, height, bank] (height in m; bank in degrees, the
// road tilted into the corner: its outside higher; leave it out for none) → { ctrl, heights }. heights = keys in track
// order: [x, z, height, bank] where bank is signed for the track (rad, + = the road rises toward its right, +N):
// the height at every vertex's arc middle, the bank at its start, middle and end (0 at vertices without one).
// track.js turns them into smooth profiles (elevation.js).
export function course(poly, arcStep = 12, straightStep = 120) {
  const { ctrl, ends, turns } = layout(poly, arcStep, straightStep), heights = [];
  poly.forEach(([, , , y = 0, bank = 0], i) => {
    const arc = ends[i], b = -Math.sign(turns[i]) * bank * Math.PI / 180;   // a right turn (+) banks up toward its left
    const mid = arc[Math.floor(arc.length / 2)];
    if (arc.length > 1) heights.push([...arc[0], null, b]);
    heights.push([...mid, y, b]);
    if (arc.length > 1) heights.push([...arc[arc.length - 1], null, b]);
  });
  return { ctrl, heights };
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
  // ---- hills and banking (course(): [x, z, radius, height, bank°]; elevation.js) ----
  // after a classic forest circuit: a hairpin, down into a dip and flat out up the steep esses, a long climb
  hautvale: {
    name: 'Hautvale', theme: 'forest', landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    ...course([
      [0, 0, 0, 42], [220, 0, 16, 43],                    // line, hairpin right
      [-40, 300, 90, 12],                                  // downhill, left at the bottom (the dip)
      [-60, 450, 100, 26], [-170, 590, 160, 40],           // steep right up, left over the crest
      [-260, 1150, 28, 58], [-390, 1180, 26, 57],          // the long climb, chicane right-left
      [-470, 1420, 24, 40],                                // downhill right hairpin
      [-700, 1250, 0, 26], [-820, 1000, 110, 18], [-800, 820, 110, 18],   // double-apex left
      [-1000, 650, 40, 22], [-1080, 520, 40, 24],          // chicane
      [-1000, 300, 60, 26],                                // right
      [-850, -40, 300, 34],                                // long fast left
      [-520, -40, 22, 38], [-460, 0, 22, 39],              // final chicane
    ]),
    blurb: 'Down to the dip and flat out up the steep esses, a long climb to a chicane, a double-apex left.',
  },
  // a figure of eight: the back straight crosses over the first part on a bridge
  saltcross: {
    name: 'Saltcross', theme: 'downs', landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    ...course([
      [-100, 0, 0, 30], [380, 0, 130, 27],                 // line, fast right
      [500, 150, 70, 24],                                  // right
      [430, 270, 55, 24], [510, 380, 55, 25], [440, 480, 60, 26],   // esses
      [470, 580, 90, 22],                                  // right onto the diagonal
      [200, 700, 0, 10],                                   // under the bridge
      [-420, 1080, 18, 6],                                 // hairpin left
      [100, 1260, 220, 7],                                 // long left
      [480, 1150, 60, 9], [520, 1020, 60, 12],             // double left
      [460, 880, 0, 22],
      [200, 690, 0, 30],                                   // over the bridge
      [-350, 260, 120, 32],                                // fast left
      [-430, 140, 25, 31], [-520, 90, 25, 31],             // chicane
      [-560, 0, 30, 30],                                   // right onto the straight
    ]),
    blurb: 'A figure of eight: esses, under the bridge to a hairpin, a long double left, then back over the bridge.',
  },
  // short and hilly, with a plunging corkscrew
  cantera: {
    name: 'Cantera Hills', theme: 'moor', landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    ...course([
      [100, 0, 0, 20], [460, 0, 300, 24],                  // line, fast left over a crest
      [760, -140, 22, 21],                                 // hairpin left
      [520, -330, 35, 24], [330, -290, 35, 27],            // right, left
      [230, -500, 40, 32],                                 // right
      [-120, -600, 45, 40],                                // left at the top of the hill
      [-280, -380, 300, 50],                               // uphill kink
      [-300, -260, 16, 56], [-235, -205, 16, 42],          // the corkscrew: left over the crest, right down the drop
      [-330, -60, 90, 34],                                 // fast downhill sweep
      [-470, 70, 22, 28],                                  // hairpin left
      [-250, 0, 60, 22],                                   // right onto the straight
    ]),
    blurb: 'Climb the hill, a blind left over the crest, then the corkscrew: a right plunging 14 m down the drop.',
  },
  // a road course inside an oval: its banked turns and an infield
  ironvale: {
    name: 'Ironvale Speedway', theme: 'downs', landmarks: { gantry: 2, grandstand: -103, pits: -82 },
    ...course([
      [0, 0, 0, 10], [500, 0, 24, 10],                     // line, the oval's front straight, left into the infield
      [520, -170, 28, 10], [280, -150, 30, 10],            // left, right
      [160, -270, 30, 10], [-120, -250, 40, 10],           // left, right
      [-160, -420, 30, 10],                                // left onto the oval's back straight
      [-820, -420, 90, 10, 20], [-820, 0, 90, 10, 20],     // two banked lefts (20°) and the short chute between
    ]),
    blurb: 'An oval and its infield: two 20° banked turns taken flat out, a twisty infield, long straights to draft on.',
  },
});
// every circuit carries its key as `id`
for (const [id, c] of Object.entries(CIRCUITS)) /** @type {{ id: string }} */ (/** @type {unknown} */ (c)).id = id;
