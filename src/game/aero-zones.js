// The player's own straight-mode zones per circuit (zone-editor.js; SIM setAeroZones): { circuitId: [{ from, to }] } in
// metres from the line, saved in localStorage `gridline.aeroZones`; a circuit not in it uses the automatic zones.
// Pure: tests/aero-zones.test.js.
const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
const okZone = z => z && Number.isFinite(z.from) && Number.isFinite(z.to) && z.from >= 0 && z.to >= 0;

export function loadAeroZones(json, circuits) {
  const s = parse(json), out = {};
  for (const [id, list] of Object.entries(s)) if (Object.hasOwn(circuits, id) && Array.isArray(list))
    out[id] = list.filter(okZone).slice(0, 12).map(z => ({ from: +z.from, to: +z.to }));
  return out;
}
export const zonesFor = (store, id) => Object.hasOwn(store, id) ? store[id] : null;
export const withZones = (store, id, list) => {
  const out = { ...store };
  if (list) out[id] = list.map(z => ({ from: Math.round(z.from * 10) / 10, to: Math.round(z.to * 10) / 10 })); else delete out[id];
  return out;
};

// ---- laps kept apart per zone layout (2026-10-28, user: "keep records and ghosts apart per zone layout") ----
// The layout a lap was driven on: '' = the automatic zones (or active aero off: the zones do nothing then), else the
// track's aeroKey ('none' or the zones' metres, e.g. '120-610,1830-2240').
export const zoneTag = (track, activeAero) => activeAero && track.aeroKey && track.aeroKey !== 'auto' ? track.aeroKey : '';
// a lap's class for records, ghosts and sector bests: the car (stock / modified) and the zone layout ('stock',
// 'modified@120-610,...'); the automatic zones keep the old names, so laps saved before this stay where they were
export const lapClass = (modified, zones = '') => (modified ? 'modified' : 'stock') + (zones ? '@' + zones : '');
export const LAP_CLASS = /^(stock|modified)(@[0-9,-]+|@none)?$/;
