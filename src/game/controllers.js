// Every device that can drive the car, as one list (Settings → Controller shows it, Input reads the chosen one).
// Each device is a gamepad-like snapshot in the standard Gamepad layout { key, kind, label, id, mapping, axes,
// buttons, timestamp, connected }, so Input reads them all the same way:
//   phone     the phone wheel in the desktop app (phone-wheel.js)
//   gamepad   anything the browser's Gamepad API sees: Xbox / PlayStation / generic pads, and also wheels, joysticks
//             and custom controllers that present themselves as a game controller (most do). `kind` is a guess from
//             the device name (wheel, joystick, xbox, playstation, gamepad); per-kind input mapping (wheel pedals on
//             their own axes, force feedback) plugs in here later: KINDS[kind].
// Choice: prefs.controller = 'auto' (phone, then a standard-layout pad, then any) or a device key.
import { PhoneWheel } from './phone-wheel.js';

export const KINDS = {
  phone: { label: 'Phone wheel', note: 'Tilt to steer, on-screen pedals.' },
  wheel: { label: 'Wheel', note: 'Steering on its first axis. Separate pedal axes need per-device mapping (coming).' },
  joystick: { label: 'Joystick', note: 'Steering on its first axis, triggers or buttons for the pedals.' },
  xbox: { label: 'Xbox controller', note: 'Left stick steers, RT gas, LT brake.' },
  playstation: { label: 'PlayStation controller', note: 'Left stick steers, R2 gas, L2 brake.' },
  gamepad: { label: 'Controller', note: 'Left stick steers, right trigger gas, left trigger brake.' },
};
// a device name (Gamepad.id) → its kind. The phone-wheel/server.py virtual pad calls itself an Xbox 360 pad.
export function kindOf(id) {
  if (/wheel|racing|\bg(25|27|29|92\d)\b|\bt(150|248|300|500|gt)\b|\btmx\b|fanatec|moza|simucube/i.test(id)) return 'wheel';
  if (/joystick|hotas|flight|stick(?!.*pad)|x52|t\.16000|vkb|virpil/i.test(id)) return 'joystick';
  if (/xbox|x-box|xinput|045e/i.test(id)) return 'xbox';
  if (/playstation|dualshock|dualsense|wireless controller|054c/i.test(id)) return 'playstation';
  return 'gamepad';
}
// the readable part of a Gamepad.id ("Xbox 360 Controller (XInput STANDARD GAMEPAD)" → "Xbox 360 Controller")
export const nameOf = id => id.replace(/\s*\(.*$/, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim() || 'Controller';

const wrap = new Map();       // Gamepad.id → its device object (kept, so a pad keeps its key across frames)
function gamepads() {
  const list = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter(g => g && g.connected) : [];
  return list.map(g => {
    let d = wrap.get(g.id);
    if (!d) { d = { key: 'pad:' + g.id, kind: kindOf(g.id), label: nameOf(g.id), id: g.id }; wrap.set(g.id, d); }
    return Object.assign(d, { mapping: g.mapping, axes: g.axes, buttons: g.buttons, timestamp: g.timestamp, connected: true });
  });
}

export const Controllers = {
  // every connected device, the phone first
  list() { const p = PhoneWheel.pad(); return p ? [p, ...gamepads()] : gamepads(); },
  // the device that drives, from `want` (prefs.controller): a missing chosen device falls back to auto
  pick(want = 'auto', list = this.list()) {
    return list.find(d => d.key === want) || list.find(d => d.kind === 'phone') || list.find(d => d.mapping === 'standard') || list[0] || null;
  },
};
