// The player's car as data: livery (looks), race setup and open mods (physics, SIM SETUP / MODS), validated on load,
// and the lap records per circuit, kept apart for stock and modified cars. Pure functions (no DOM, no storage:
// main.js reads / writes localStorage through Settings), tested in tests/garage-store.test.js.
import { SIM } from '../sim/index.js';

const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
const PLAYER = SIM.DRIVERS.find(d => d.player);

// paint finishes for the body (car-models.js FINISH_LOOKS has the material for each)
export const FINISHES = [['gloss', 'GLOSS'], ['metallic', 'METALLIC'], ['satin', 'SATIN'], ['matte', 'MATTE']];
// the car model (docs/car-plan.md): the part-built car the design tools edit, or the Blender one (2026, being built)
export const CAR_MODELS = [['classic', 'CLASSIC'], ['2026', '2026']];
export const LIVERY_DEFAULTS = Object.freeze({ color: PLAYER.color, accent: PLAYER.accent, number: PLAYER.number, finish: 'gloss', rims: 0x3a3d42, model: 'classic' });
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
    model: CAR_MODELS.some(([m]) => m === l.model) ? l.model : d.model,
  };
}

// tyres and the pit box (SIM COMPOUNDS, a car's pitPlan): the compound you start on, and what the crew does at your
// stops: the next set (AUTO = the team's choice for the laps left, as the AI teams do), a new front wing if it is
// damaged, repairs to the floor and suspension. The pause menu changes the plan for the race you are in.
export const COMPOUND_NAMES = Object.keys(SIM.COMPOUNDS);
export const STRATEGY_DEFAULTS = Object.freeze({ start: 'medium', next: 'auto', wing: true, repair: true });
export function validStrategy(t = {}) {
  const d = STRATEGY_DEFAULTS, bool = (v, def) => typeof v === 'boolean' ? v : def;
  return { start: COMPOUND_NAMES.includes(t.start) ? t.start : d.start, next: t.next === 'auto' || t.next === 'same' || COMPOUND_NAMES.includes(t.next) ? t.next : d.next,
    wing: bool(t.wing, d.wing), repair: bool(t.repair, d.repair) };
}
// the race car's pit plan (SIM PitPlan) from it
export const pitPlanOf = t => ({ tyres: t.next, wing: t.wing, repair: t.repair });

// saved JSON (or null) → { livery, setup, mods, tyres }
// (physics 2 made the stock car 770 kg: a car saved before it with the old stock 800 kg is stock, not a mass mod)
const OLD_STOCK = { 1: { mass: 800 } };
export function loadGarage(json) {
  const s = parse(json), old = OLD_STOCK[s.physics ?? 1], mods = s.mods && typeof s.mods === 'object' ? { ...s.mods } : s.mods;
  if (old && mods) for (const [k, v] of Object.entries(old)) if (mods[k] === v) delete mods[k];
  return { physics: SIM.TUNING.PHYSICS, livery: validLivery(s.livery), setup: SIM.validSetup(s.setup), mods: SIM.validMods(mods), tyres: validStrategy(s.tyres) };
}
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
