// A circuit is a closed loop of control points (x, z in metres). Adding one only needs a new entry.
// `landmarks` are sample indices (at the default 1200 samples) where trackside buildings go; render-only.
export const CIRCUITS = Object.freeze({
  elkmoor: {
    name: 'Elkmoor Park',
    ctrl: [[-200,0],[200,0],[450,0],[560,-40],[590,-140],[540,-230],[440,-250],[360,-200],[300,-260],[220,-330],[100,-340],[0,-280],[-60,-180],[-160,-160],[-280,-220],[-380,-200],[-430,-110],[-380,-20]],
    landmarks: { gantry: 2, grandstand: 1150, pits: 1160 },
  },
});
