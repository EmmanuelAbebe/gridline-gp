import { CONFIG } from './config.js';
import { $, createEmitter } from './util.js';

// Keyboard, touch buttons and Gamepad API (standard Xbox mapping; the phone wheel shows up as one).
// Exposes `drive` (read by the sim) and emits: 'action' (name), 'padchange' (connected), 'gesture' (for audio unlock).
export const Input = (() => {
  const KEY_DRIVE = { ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right' };
  const KEY_ACTIONS = { KeyC:'camera', KeyM:'mute', KeyP:'pause', Escape:'pause', KeyF:'fps', KeyG:'graphics', KeyT:'tweak', KeyL:'layout', KeyV:'fullscreen' };
  const PAD = { A: 0, Y: 3, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const PAD_ACTIONS = [[PAD.A, 'confirm'], [PAD.START, 'pause'], [PAD.Y, 'camera']];
  const TOUCH = { tLeft: 'left', tRight: 'right', tBrake: 'down', tGas: 'up' };

  const events = createEmitter();
  const held = { up: false, down: false, left: false, right: false };
  const drive = { steer: 0, thr: 0, brk: 0, analog: false };
  const gamepadAllowed = !(document.featurePolicy && document.featurePolicy.allowsFeature && !document.featurePolicy.allowsFeature('gamepad'));
  let padPrev = [], padConnected = false;

  const typing = e => e.target instanceof Element && e.target.matches('input, select, textarea');   // design-tool fields
  addEventListener('keydown', e => {
    if (typing(e)) return;
    const k = KEY_DRIVE[e.code];
    if (k) { held[k] = true; e.preventDefault(); }
    if (!e.repeat && KEY_ACTIONS[e.code]) events.emit('action', KEY_ACTIONS[e.code]);
  });
  addEventListener('keyup', e => { const k = KEY_DRIVE[e.code]; if (k) { held[k] = false; e.preventDefault(); } });
  addEventListener('blur', () => { for (const k in held) held[k] = false; });

  for (const [id, key] of Object.entries(TOUCH)) {
    const b = $(id);
    const on = e => { e.preventDefault(); held[key] = true; b.classList.add('on'); events.emit('gesture'); };
    const off = e => { e.preventDefault(); held[key] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, off);
  }

  function pickPad() {
    const list = navigator.getGamepads ? [...navigator.getGamepads()].filter(g => g && g.connected) : [];
    return list.find(g => g.mapping === 'standard') || list[0] || null;
  }
  const pressed = (p, i) => { const b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
  const deadZone = (x, dz) => Math.abs(x) < dz ? 0 : Math.sign(x) * (Math.abs(x) - dz) / (1 - dz);

  // Called once per frame: merges every source into `drive` and fires button actions on press edges.
  function poll() {
    const p = pickPad();
    if (!!p !== padConnected) { padConnected = !!p; events.emit('padchange', padConnected); }
    let steer = (held.right ? 1 : 0) - (held.left ? 1 : 0), thr = held.up ? 1 : 0, brk = held.down ? 1 : 0, analog = false;
    if (p) {
      const x = deadZone(p.axes[0] || 0, CONFIG.padDeadZone);
      let pt = p.buttons[PAD.RT] ? p.buttons[PAD.RT].value : 0, pb = p.buttons[PAD.LT] ? p.buttons[PAD.LT].value : 0;
      if (p.mapping !== 'standard' && p.axes.length >= 6) {           // raw Xbox layout: triggers on axes 5 / 2, -1 at rest
        if (p.axes[5] > -0.98 || p.axes[2] > -0.98) { pt = Math.max(pt, (p.axes[5] + 1) / 2); pb = Math.max(pb, (p.axes[2] + 1) / 2); }
      }
      if (x !== 0) { steer = x; analog = true; }
      thr = Math.max(thr, pt); brk = Math.max(brk, pb);
      if (pressed(p, PAD.UP)) thr = 1;                               // D-pad as backup pedals / steering
      if (pressed(p, PAD.DOWN)) brk = 1;
      if (pressed(p, PAD.LEFT)) steer = -1;
      if (pressed(p, PAD.RIGHT)) steer = 1;
      for (const [i, action] of PAD_ACTIONS) if (pressed(p, i) && !padPrev[i]) events.emit('action', action);
      padPrev = p.buttons.map((b, i) => pressed(p, i));
    }
    drive.steer = steer; drive.thr = thr; drive.brk = brk; drive.analog = analog;
  }
  addEventListener('gamepadconnected', poll);
  addEventListener('gamepaddisconnected', poll);

  return { drive, poll, on: events.on, gamepadAllowed };
})();

