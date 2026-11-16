// The free livery (2026-11-16, the user's pick of every screen on the canvas "Gridline livery & lights": A zones, B layers,
// C spray, E1 exhaust, E2 parts): the data, its validation and the car's zones. Pure (tests/livery.test.js); the painting
// is livery-paint.js (canvases + the shader), the garage's Look tab edits it.
//
// The Blender cars have no UV map, so nothing is painted on a skin: a fragment's colour comes from where it is on the car
//   - zones: boxes in the car's frame (x forward, y up, |z| out from the middle; later boxes win), each a colour + finish;
//   - layers (stripes, fades, shapes, text, logos) and spray: drawn on five flat panels (the car seen from its right, left,
//     top, front, rear) and projected back onto the body by the surface's facing (livery-paint.js).
// Units: metres in the car's frame; colours 0xrrggbb.
import { BRANDS } from './config.js';

export const FINISH_IDS = ['gloss', 'metallic', 'satin', 'matte'];
// a zone's finish: one of the paint finishes or bare carbon
export const ZONE_FINISHES = [...FINISH_IDS, 'carbon'];
export const CARBON = 0x101114;

// the zones in the garage's list (wheels = the rim colour) and the ones the Parts tab sets (tcam, exhaust, foil: not listed)
export const ZONES = [
  ['nose', 'Nose'], ['fwing', 'Front wing'], ['cell', 'Cockpit'], ['pods', 'Sidepods'], ['cover', 'Engine cover'], ['fin', 'Fin'],
  ['halo', 'Halo'], ['mirrors', 'Mirrors'], ['rwing', 'Rear wing'], ['plates', 'Endplates'], ['floor', 'Floor edge'], ['wheels', 'Wheel covers'],
];
export const ZONE_IDS = [...ZONES.map(z => z[0]), 'tcam', 'exhaust', 'foil'];
export const zoneIndex = id => ZONE_IDS.indexOf(id);

// which of a car's materials a box paints: 1 = the body colour, 2 = the accent, 4 = carbon
export const MAT = { main: 1, accent: 2, carbon: 4, paint: 3, all: 7 };
// per model: the boxes [zone, xmin, xmax, ymin, ymax, |z|min, |z|max, materials] (measured on car.glb / fe.glb with
// tools/blender/out/peek; later ones win), the panels' extent (side: x × y, top: x × z, front / rear: z × y), the exhaust's
// pipe (x from its root to its lip), the race number's and the name's spots
export const MODELS = {
  f1: {
    boxes: [
      ['nose', 0.95, 3.2, 0.06, 1.2, 0, 0.34, MAT.paint],
      ['cell', -0.05, 0.95, 0.06, 1.2, 0, 0.44, MAT.paint],
      ['pods', -1.45, 0.62, 0.06, 0.78, 0.3, 1.0, MAT.paint],
      ['cover', -2.0, -0.05, 0.3, 1.2, 0, 0.62, MAT.paint],
      ['fin', -1.95, -0.55, 0.8, 1.2, 0, 0.07, MAT.paint],
      ['halo', -0.08, 1.02, 0.8, 1.06, 0, 0.36, MAT.all],
      ['halo', 0.78, 1.06, 0.68, 1.06, 0, 0.05, MAT.all],          // (its centre pillar)
      ['tcam', -0.36, -0.11, 0.94, 1.15, 0, 0.13, MAT.all],
      ['mirrors', 0.4, 0.82, 0.56, 0.86, 0.44, 0.74, MAT.all],
      ['fwing', 2.0, 3.2, 0, 0.42, 0.13, 1.0, MAT.all],
      ['rwing', -2.7, -1.8, 0.62, 1.2, 0, 0.5, MAT.all],
      ['plates', -2.7, -1.8, 0.25, 1.2, 0.48, 1.0, MAT.all],
      ['floor', -2.7, 3.2, -0.1, 0.1, 0, 1.0, MAT.all],
      ['foil', -1.98, -1.62, 0.4, 0.66, 0, 0.12, MAT.all],
      ['exhaust', -2.2, -1.98, 0.42, 0.6, 0, 0.056, MAT.all],
    ],
    panels: { x: [-2.6, 3.1], y: [-0.02, 1.18], z: 1.0 },
    exhaust: { root: -1.98, lip: -2.11, y: 0.505 },
    number: { side: [-0.55, 0.78, 0.16], nose: [1.95, 0, 0.16] }, name: [0.42, 0.6, 0.055],
  },
  fe: {
    boxes: [
      ['nose', 0.9, 2.6, 0.06, 1.2, 0, 0.32, MAT.paint],
      ['cell', -0.15, 0.9, 0.06, 1.2, 0, 0.42, MAT.paint],
      ['pods', -1.3, 0.5, 0.06, 0.7, 0.3, 1.0, MAT.paint],
      ['cover', -1.75, -0.15, 0.3, 1.2, 0, 0.6, MAT.paint],
      ['halo', -0.15, 0.85, 0.7, 0.85, 0, 0.28, MAT.all],
      ['mirrors', 0.42, 0.66, 0.58, 0.76, 0.3, 0.5, MAT.all],
      ['fwing', 1.75, 2.6, 0, 0.36, 0.13, 1.0, MAT.all],
      ['rwing', -2.3, -1.7, 0.5, 1.2, 0, 0.6, MAT.all],
      ['plates', -2.3, -1.7, 0.2, 1.2, 0.6, 1.0, MAT.all],
      ['floor', -2.3, 2.6, -0.1, 0.1, 0, 1.0, MAT.all],
    ],
    panels: { x: [-2.25, 2.6], y: [-0.02, 1.08], z: 0.95 },
    exhaust: null,
    number: { side: [-0.8, 0.58, 0.18], nose: [1.6, 0, 0.14] }, name: [0.32, 0.54, 0.05],
  },
};
export const modelOf = key => MODELS[key] ?? MODELS.f1;

// the zone at a point of the car (what the shader works out per pixel): its id or null
export function zoneAt(model, p, mat = MAT.main) {
  let zone = null; const az = Math.abs(p.z);
  for (const [id, x0, x1, y0, y1, z0, z1, m] of modelOf(model).boxes)
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && az >= z0 && az <= z1 && (m & mat)) zone = id;
  return zone;
}

// ---- the five panels: where each sits in the paint texture (2048 × 2048, v up) and how the car maps onto it
export const ATLAS = 2048;
export const PANELS = ['right', 'left', 'top', 'front', 'rear'];
const PANEL_RECTS = { right: [0, 0, 2048, 440], left: [0, 440, 2048, 440], top: [0, 880, 2048, 720], front: [0, 1600, 732, 440], rear: [732, 1600, 732, 440] };
// a panel's rectangle in texture pixels [x, y (from the top), w, h]
export const panelRect = name => PANEL_RECTS[name];
// the panel a surface faces most (normal in the car's frame); a face pointing down gets none (the underside isn't painted)
export function panelOf(n) {
  const ax = Math.abs(n.x), ay = n.y, az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return 'top';
  if (-n.y > Math.max(ax, az)) return null;
  return az >= ax ? (n.z >= 0 ? 'right' : 'left') : n.x >= 0 ? 'front' : 'rear';
}
// a point's two coordinates on a panel's plane (side: x, y; top: x, z; front / rear: z, y) and back
export const planeOf = (panel, p) => panel === 'right' || panel === 'left' ? [p.x, p.y] : panel === 'top' ? [p.x, p.z] : [p.z, p.y];
// plane coordinates → texture pixels (x right, y down). The panels face the viewer: from the right the nose is to the
// right, from the left to the left (mirrored), from above the nose to the right and the car's left at the top, from the
// front its left to the right, from behind its right to the right; so text drawn upright in pixels reads the right way round.
export function toPixel(model, panel, a, b) {
  const P = modelOf(model).panels, [rx, ry, rw, rh] = PANEL_RECTS[panel];
  const ux = (a - P.x[0]) / (P.x[1] - P.x[0]), uz = (a + P.z) / (2 * P.z), vy = (b - P.y[0]) / (P.y[1] - P.y[0]);
  switch (panel) {
    case 'right': return [rx + ux * rw, ry + (1 - vy) * rh];
    case 'left': return [rx + (1 - ux) * rw, ry + (1 - vy) * rh];
    case 'top': return [rx + ux * rw, ry + (b + P.z) / (2 * P.z) * rh];
    case 'front': return [rx + (1 - uz) * rw, ry + (1 - vy) * rh];
    default: return [rx + uz * rw, ry + (1 - vy) * rh];
  }
}
// pixels per metre on a panel (x, y): sizes in metres → pixels
export function pixelsPerMetre(model, panel) {
  const P = modelOf(model).panels, [, , rw, rh] = PANEL_RECTS[panel], L = P.x[1] - P.x[0], H = P.y[1] - P.y[0], W = 2 * P.z;
  return panel === 'top' ? [rw / L, rh / W] : panel === 'front' || panel === 'rear' ? [rw / W, rh / H] : [rw / L, rh / H];
}
// the other side's twin of a point on a panel (mirror left / right): its panel and plane coordinates
export const twinOf = (panel, a, b) => panel === 'right' ? ['left', a, b] : panel === 'left' ? ['right', a, b] : panel === 'top' ? ['top', a, -b] : [panel, -a, b];

// ---- layers (B)
export const LAYER_KINDS = ['stripe', 'fade', 'shape', 'text', 'logo'];
export const LAYER_VIEWS = ['side', 'top', 'front', 'rear'];
export const SHAPES = ['chevron', 'circle', 'ring', 'triangle', 'diamond', 'star', 'square', 'arrow', 'bolt'];
export const MAX_LAYERS = 40;
const num = (v, lo, hi, d) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = (v, list, d) => list.includes(v) ? v : d;
const colour = (v, d) => colourOf(v) ?? d;
export function colourOf(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  const m = typeof v === 'string' && /^#?([0-9a-f]{6})$/i.exec(v.trim());
  return m ? parseInt(m[1], 16) : null;
}
// a new layer of a kind, where it starts (the side of the car, about the sidepod)
export function newLayer(kind, colour = 0xf2f3f0, id = Date.now() % 1e9) {
  const base = { id, kind, view: 'side', side: 'both', x: -0.2, y: 0.5, w: 1.2, h: 0.18, a: 0, c: colour, c2: colour, o: 1, body: false, on: true };
  return validLayer({ ...base, ...{
    stripe: { x: 0.4, y: 0.62, w: 4.5, h: 0.12, a: 4 },
    fade: { x: -1.2, y: 0.5, w: 2.4, h: 1.2, a: 0, c2: colour },
    shape: { shape: 'chevron', x: -0.3, y: 0.42, w: 0.6, h: 0.45 },
    text: { text: 'GRIDLINE', x: -0.4, y: 0.5, w: 1.0, h: 0.12 },
    logo: { brand: BRANDS[0][0], x: -0.3, y: 0.52, w: 0.8, h: 0.16 },
  }[kind] });
}
export function validLayer(l) {
  if (!l || typeof l !== 'object' || !LAYER_KINDS.includes(l.kind)) return null;
  const out = {
    id: Number.isInteger(l.id) ? l.id : 0, kind: l.kind, view: pick(l.view, LAYER_VIEWS, 'side'), side: pick(l.side, ['both', 'right', 'left'], 'both'),
    x: num(l.x, -4, 4, 0), y: num(l.y, -2, 2, 0.5), w: num(l.w, 0.02, 6, 1), h: num(l.h, 0.01, 3, 0.2), a: num(l.a, -180, 180, 0),
    c: colour(l.c, 0xf2f3f0), c2: colour(l.c2, colour(l.c, 0xf2f3f0)), o: num(l.o, 0, 1, 1), body: !!l.body, on: l.on !== false,
  };
  if (l.kind === 'shape') out.shape = pick(l.shape, SHAPES, 'chevron');
  if (l.kind === 'text') out.text = String(l.text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 24);
  if (l.kind === 'logo') out.brand = pick(l.brand, BRANDS.map(b => b[0]), BRANDS[0][0]);
  return out;
}

// ---- spray (C): strokes in the panels' plane coordinates, millimetres
//   { k: 's' spray | 'e' eraser | 'l' a straight line (tape), c, r (brush radius, mm), soft, flow (0–100), lock (zone index
//     + 1: paint only on that zone; 0 = anywhere), m (mirrored to the other side), p: [panel index, a, b, …] }
export const MAX_SPRAY_POINTS = 60000;
export function validStroke(s) {
  if (!s || typeof s !== 'object' || !['s', 'e', 'l'].includes(s.k) || !Array.isArray(s.p)) return null;
  const p = [];
  for (let i = 0; i + 2 < s.p.length + 0; i += 3) {
    const k = s.p[i] | 0, a = Math.round(+s.p[i + 1]), b = Math.round(+s.p[i + 2]);
    if (k >= 0 && k < PANELS.length && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) < 5000 && Math.abs(b) < 5000) p.push(k, a, b);
  }
  if (!p.length) return null;
  return { k: s.k, c: colour(s.c, 0xffffff), r: Math.round(num(s.r, 5, 600, 60)), soft: Math.round(num(s.soft, 0, 100, 70)), flow: Math.round(num(s.flow, 1, 100, 55)),
    lock: Math.round(num(s.lock, 0, ZONE_IDS.length, 0)), m: !!s.m, p };
}

// ---- parts (E2) and the exhaust (E1)
export const EXHAUSTS = {
  worn: { label: 'RACE-WORN', name: 'Race-worn Inconel', stops: [0xc9b27a, 0x8a6a3e, 0x5a4128, 0x3a2a1c], lip: 0x1a120c, rough: 0.55, metal: 0.7 },
  fresh: { label: 'FRESH', name: 'Fresh Inconel', stops: [0xb9bcbf, 0xa2a5a8, 0x8d9093, 0x76797c], lip: 0x3a3c3e, rough: 0.35, metal: 0.9 },
  ti: { label: 'TI TINT', name: 'Titanium heat tint', stops: [0xd8c07a, 0xa8682e, 0x6a3c8a, 0x2f5fb8], lip: 0x14203a, rough: 0.25, metal: 0.95 },
  ceramic: { label: 'CERAMIC', name: 'Ceramic coated', stops: [0xd9d8d3, 0xcfcdc7, 0xc3c1bb, 0xb5b3ad], lip: 0x2a2826, rough: 0.8, metal: 0 },
  black: { label: 'BLACK', name: 'Black coated', stops: [0x3a3b3d, 0x2e2f31, 0x252628, 0x1c1d1f], lip: 0x0a0a0b, rough: 0.6, metal: 0.2 },
};
export const CARBON_LOOKS = [['gloss', 'GLOSS'], ['matte', 'MATTE'], ['body', 'BODY'], ['accent', 'ACCENT']];
export const PARTS_DEFAULTS = Object.freeze({ carbon: 'gloss', exhaust: 'worn', foil: true, glow: true });
export function validParts(p = {}) {
  return { carbon: pick(p.carbon, CARBON_LOOKS.map(c => c[0]), 'gloss'), exhaust: pick(p.exhaust, Object.keys(EXHAUSTS), 'worn'), foil: p.foil !== false, glow: p.glow !== false };
}
// the Parts tab's shortcuts for three zones: [zone, label, note, [[value, label, colour or 'body' / 'accent' / null]]]
export const PART_ZONES = [
  ['halo', 'Halo', 'real teams: carbon or body colour', [['carbon', 'CARBON', CARBON], ['body', 'BODY', 'body'], ['accent', 'ACCENT', 'accent']]],
  ['tcam', 'T-camera', 'real: yellow on a team\'s second car, black on the first', [['yellow', 'YELLOW', 0xe8ff1a], ['black', 'BLACK', 0x0b0b0c], ['accent', 'ACCENT', null]]],
  ['mirrors', 'Mirror housings', 'the outside of the mirrors', [['body', 'BODY', null], ['accent', 'ACCENT', 'accent'], ['carbon', 'CARBON', CARBON]]],
];

// a zone: { c: colour or null, f: finish or null, ref: 'body' / 'accent' = always that colour (the Parts tab) }
// ---- the whole livery's new parts (the colours, number, finish and model stay garage-store.js's)
export function validZones(z = {}) {
  const out = {};
  if (z && typeof z === 'object') for (const id of ZONE_IDS) {
    const v = z[id]; if (!v || typeof v !== 'object') continue;
    const c = colourOf(v.c), f = ZONE_FINISHES.includes(v.f) ? v.f : null, ref = ['body', 'accent'].includes(v.ref) ? v.ref : null;
    if (c !== null || f || ref) out[id] = ref ? { c: null, f, ref } : { c, f };
  }
  return out;
}
export function validNumberLook(n = {}) {
  return { colour: colourOf(n?.colour), side: n?.side !== false, nose: n?.nose !== false };
}
export function liveryExtras(l = {}) {
  const layers = (Array.isArray(l.layers) ? l.layers : []).map(validLayer).filter(Boolean).slice(0, MAX_LAYERS);
  let points = 0; const spray = [];
  for (const s of Array.isArray(l.spray) ? l.spray : []) { const v = validStroke(s); if (v && (points += v.p.length) <= MAX_SPRAY_POINTS) spray.push(v); }
  return { zones: validZones(l.zones), layers, spray, parts: validParts(l.parts), numberLook: validNumberLook(l.numberLook),
    name: String(l.name ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 16) };
}
// a zone's colour on a livery: its own, else what it inherits (null = the material's own: body / accent / carbon)
export const zoneColour = (L, id) => L.zones?.[id]?.c ?? null;

// ---- presets (invented designs): the colours plus zones and layers
export const PRESETS = [
  { name: 'Classic yellow', color: 0xffc21a, accent: 0x111111, zones: { fwing: { c: 0x111111 }, rwing: { c: 0x111111 }, halo: { c: CARBON, f: 'carbon' } },
    layers: [{ kind: 'stripe', c: 0x111111, x: 0.4, y: 0.62, w: 4.6, h: 0.1, a: 4 }] },
  { name: 'Night blue', color: 0x0a1a4a, accent: 0x16b5c9, zones: { fin: { c: 0x16b5c9 }, plates: { c: 0x16b5c9 } },
    layers: [{ kind: 'fade', c: 0x1f5bff, c2: 0x1f5bff, x: -1.4, y: 0.5, w: 2.6, h: 1.2, a: 180 }, { kind: 'shape', shape: 'chevron', c: 0x16b5c9, x: -0.3, y: 0.42, w: 0.6, h: 0.45 }] },
  { name: 'Racing red', color: 0xd7261e, accent: 0xf2f3f0, zones: { cover: { c: 0xd7261e }, nose: { c: 0xf2f3f0 }, fwing: { c: 0xf2f3f0 } }, layers: [] },
  { name: 'Matte stealth', color: 0x2a2d32, accent: 0xff6a00, zones: { pods: { f: 'matte' }, cover: { f: 'matte' }, nose: { f: 'matte' }, cell: { f: 'matte' }, plates: { c: 0xff6a00 } },
    layers: [{ kind: 'stripe', c: 0xff6a00, x: 0.4, y: 0.62, w: 4.6, h: 0.03, a: 4 }] },
  { name: 'Silver arrow', color: 0xb9bdc2, accent: 0x00a19c, finish: 'metallic', zones: { fwing: { c: CARBON, f: 'carbon' }, halo: { c: CARBON, f: 'carbon' } },
    layers: [{ kind: 'fade', c: 0x00a19c, c2: 0x00a19c, x: -1.6, y: 0.5, w: 1.6, h: 1.2, a: 180 }] },
];
// a preset applied to a livery (keeps the number, the name, the rims, the model and the spray)
export function applyPreset(L, p) {
  return { ...L, color: p.color, accent: p.accent, finish: p.finish ?? 'gloss', zones: validZones(p.zones),
    layers: p.layers.map((l, i) => validLayer({ ...newLayer(l.kind, l.c, i + 1), ...l, id: i + 1 })).filter(Boolean) };
}
