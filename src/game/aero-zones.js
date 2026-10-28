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
