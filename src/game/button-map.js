// Which controller button does what (2026-10-28; user: "a mechanism to configure buttons and their actions from a
// controller device to the game"). One map per device (controllers.js key: 'phone', 'pad:<Gamepad.id>'), so the phone
// wheel's own buttons (DRS, PIT, M, OT ...: on the phone each is bound to a standard button, phone Settings → Buttons) and
// an Xbox pad keep their own layouts; a device without one uses DEFAULT_MAP. Buttons are standard Gamepad indices.
// Guide = the next ECU map (the phone's MAP button presses it). Menus always take A = confirm and B = back, whatever the map (Input 'menu' events). The triggers are the pedals.
// Pure: no DOM, no storage (main.js loads / saves the JSON through Settings); tests/button-map.test.js.

// standard Gamepad layout → the names shown (Xbox wording; the phone's binds use the same ones)
export const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS click', 'RS click',
  'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide'];
export const PEDALS = [6, 7];               // LT / RT: never bound (brake / gas)
export const MAX_PER_ACTION = 2;
export const buttonName = i => BUTTON_NAMES[i] ?? `Button ${i}`;

// [action, label, note, held]: held = works while the button is down (the rest fire once per press)
export const ACTIONS = [
  ['shiftDown', 'Shift down', 'Semi-auto and manual gearbox.'],
  ['shiftUp', 'Shift up', 'Semi-auto and manual gearbox.'],
  ['aero', 'Straight mode (DRS)', 'With Straight mode on BUTTON (Settings → Driving): opens the wings in a zone, closes them again.'],
  ['boost', 'Overtake mode', 'With Overtake mode on BUTTON (Settings → Driving).'],
  ['limiter', 'Pit limiter', 'With Pit limiter on BUTTON (Settings → Driving): on before the pit lane, off after it.'],
  ['box', 'Box this lap', 'Tells the team you are coming in.'],
  ['mapUp', 'ECU map up', 'With ECU maps on MANUAL (Settings → Driving): HARVEST → BALANCED → ATTACK → QUALI → HARVEST …'],
  ['mapDown', 'ECU map down', 'With ECU maps on MANUAL: the other way round.'],
  ['pause', 'Menu / pause', ''],
  ['camera', 'Camera', ''],
  ['lookBack', 'Look back', 'While held.', true],
  ['handbrake', 'Handbrake', 'While held: locks the rear wheels.', true],
];
export const HELD = new Set(ACTIONS.filter(a => a[3]).map(a => a[0]));

export const DEFAULT_MAP = Object.freeze({
  shiftDown: [0, 4], shiftUp: [1, 5], aero: [], boost: [8], limiter: [], box: [2], mapUp: [16], mapDown: [], pause: [9], camera: [3],
  lookBack: [11], handbrake: [10],
});

const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
const okButton = i => Number.isInteger(i) && i >= 0 && i < 32 && !PEDALS.includes(i);
// one device's map, checked: every action present, buttons valid, each button on one action only (the first keeps it)
export function cleanMap(m) {
  const out = {}, used = new Set();
  for (const [a] of ACTIONS) {
    const list = Array.isArray(m?.[a]) ? m[a] : DEFAULT_MAP[a];
    out[a] = [];
    for (const i of list) if (okButton(i) && !used.has(i) && out[a].length < MAX_PER_ACTION) { used.add(i); out[a].push(i); }
  }
  return out;
}
// saved JSON → { devices: { key: map } }
export function loadButtonMaps(json) {
  const s = parse(json), devices = {};
  for (const [k, m] of Object.entries(s.devices || {})) if (typeof k === 'string' && m && typeof m === 'object') devices[k] = cleanMap(m);
  return { devices };
}
export const mapFor = (store, key) => store.devices[key] || DEFAULT_MAP;
export const isCustom = (store, key) => !!store.devices[key];

// button i now does `action` on that device (taken off any other action; an action keeps its newest MAX_PER_ACTION)
export function bindButton(store, key, action, i) {
  if (!okButton(i) || !ACTIONS.some(a => a[0] === action)) return store;
  const m = cleanMap(mapFor(store, key));
  for (const a in m) m[a] = m[a].filter(b => b !== i);
  m[action] = [...m[action], i].slice(-MAX_PER_ACTION);
  return { devices: { ...store.devices, [key]: m } };
}
export function unbindButton(store, key, action, i) {
  const m = cleanMap(mapFor(store, key));
  m[action] = m[action].filter(b => b !== i);
  return { devices: { ...store.devices, [key]: m } };
}
export function resetDevice(store, key) {
  const devices = { ...store.devices }; delete devices[key];
  return { devices };
}
// button index → the action it does on that map (or null)
export function actionOf(map, i) {
  for (const a in map) if (map[a].includes(i)) return a;
  return null;
}
