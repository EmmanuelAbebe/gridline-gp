// The phone wheel as the game sees it: the desktop app runs its server (desktop/phone-link.cjs) and passes the
// phone's input and status through window.gridlineApp.phone. In a plain browser `available` is false (the
// standalone phone-wheel/server.py still works there: it shows up as a gamepad).
// pad() = the phone as a standard-layout gamepad snapshot (controllers.js), or null when no phone is connected.
import { createEmitter } from './util.js';

// phone button bits (phone-wheel BUTTONS: A B X Y LB RB BACK START GUIDE LS RS UP DOWN LEFT RIGHT) → standard Gamepad indices
const TO_STANDARD = [0, 1, 2, 3, 4, 5, 8, 9, 16, 10, 11, 12, 13, 14, 15];
const LT = 6, RT = 7;

export const PhoneWheel = (() => {
  const api = globalThis.window?.gridlineApp?.phone ?? null, events = createEmitter();
  let status = { running: false, phones: 0, url: '', qr: '', link: null, note: '', error: '' };
  const input = { s: 0, g: 0, b: 0, k: 0, t: 0 };
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  const snapshot = { kind: 'phone', key: 'phone', label: 'Phone wheel', id: 'Phone wheel', mapping: 'standard', connected: true,
    timestamp: 0, axes: [0, 0, 0, 0], buttons };
  if (api) {
    api.onInput(i => { Object.assign(input, i, { t: performance.now() }); });
    api.onStatus(s => { status = s; events.emit('status', s); });
    api.status().then(s => { status = s; events.emit('status', s); });
  }
  return {
    available: !!api,
    get status() { return status; },
    on: events.on,
    start: opts => api ? api.start(opts) : Promise.resolve(status),
    stop: () => api ? api.stop() : Promise.resolve(status),
    pad() {
      if (!status.phones) return null;
      snapshot.axes[0] = input.s; snapshot.timestamp = input.t;
      buttons.forEach(b => { b.pressed = false; b.value = 0; });
      TO_STANDARD.forEach((std, bit) => { if (input.k >> bit & 1) { buttons[std].pressed = true; buttons[std].value = 1; } });
      buttons[LT].value = input.b; buttons[LT].pressed = input.b > 0.5;
      buttons[RT].value = input.g; buttons[RT].pressed = input.g > 0.5;
      return snapshot;
    },
  };
})();
