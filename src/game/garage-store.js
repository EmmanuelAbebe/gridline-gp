// The player's car as data: livery (looks), race setup and open mods (physics, SIM SETUP / MODS), validated on load,
// and the lap records per circuit, kept apart for stock and modified cars. Pure functions (no DOM, no storage:
// main.js reads / writes localStorage through Settings), tested in tests/garage-store.test.js.
import { SIM } from '../sim/index.js';

const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
const PLAYER = SIM.DRIVERS.find(d => d.player);

// paint finishes for the body (car-models.js FINISH_LOOKS has the material for each)
export const FINISHES = [['gloss', 'GLOSS'], ['metallic', 'METALLIC'], ['satin', 'SATIN'], ['matte', 'MATTE']];
export const LIVERY_DEFAULTS = Object.freeze({ color: PLAYER.color, accent: PLAYER.accent, number: PLAYER.number, finish: 'gloss', rims: 0x3a3d42 });
// quick colour choices next to the colour pickers
export const SWATCHES = [0xffc21a, 0xd7261e, 0x2e6bff, 0x12a150, 0xff7a00, 0x8e44ff, 0xf2f3f0, 0x111111, 0x0fb5c9, 0xff4fa3, 0x8a929c, 0x5b3a1e];

// '#rrggbb', 'rrggbb' or a number → 0xrrggbb, else null
export function colourOf(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  const m = typeof v === 'string' && /^#?([0-9a-f]{6})$/i.exec(v.trim());
  return m ? parseInt(m[1], 16) : null;
}
export const hexOf = n => '#' + n.toString(16).padStart(6, '0');

export function validLivery(l = {}) {
  const d = LIVERY_DEFAULTS, n = Math.round(+l.number);
  return {
    color: colourOf(l.color) ?? d.color, accent: colourOf(l.accent) ?? d.accent, rims: colourOf(l.rims) ?? d.rims,
    number: Number.isFinite(n) && n >= 0 && n <= 99 && l.number !== '' && l.number !== null ? n : d.number,
    finish: FINISHES.some(([f]) => f === l.finish) ? l.finish : d.finish,
  };
}

// saved JSON (or null) → { livery, setup, mods }
export function loadGarage(json) {
  const s = parse(json);
  return { livery: validLivery(s.livery), setup: SIM.validSetup(s.setup), mods: SIM.validMods(s.mods) };
}
export const garageDefaults = () => loadGarage(null);
// the player's car for the race: their driver entry with the livery on it, and the spec from setup + mods
export const playerDriver = g => ({ ...PLAYER, color: g.livery.color, accent: g.livery.accent, number: g.livery.number });
export const playerSpec = g => SIM.carSpec(g.setup, g.mods);

// ---- lap records: { [circuit id]: { stock?: seconds, modified?: seconds } } ----
export function loadRecords(json) {
  const s = parse(json), out = {};
  for (const [id, r] of Object.entries(s)) {
    if (!Object.hasOwn(SIM.CIRCUITS, id) || !r || typeof r !== 'object') continue;
    const keep = {};
    for (const k of ['stock', 'modified']) if (Number.isFinite(r[k]) && r[k] > 0) keep[k] = r[k];
    if (Object.keys(keep).length) out[id] = keep;
  }
  return out;
}
// a valid lap: returns true when it beats the record for this circuit and class (and stores it)
export function recordLap(records, circuit, modified, time) {
  if (!(time > 0) || !Number.isFinite(time)) return false;
  const k = modified ? 'modified' : 'stock', r = (records[circuit] ||= {});
  if (r[k] !== undefined && r[k] <= time) return false;
  r[k] = time;
  return true;
}
