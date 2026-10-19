import { PREFS } from './config.js';
import { $, createEmitter } from './util.js';
import { Controllers } from './controllers.js';

// Keyboard, touch buttons and one controller (controllers.js: the phone wheel, or a Gamepad API device in the standard
// Xbox layout), chosen by prefs.controller.
// Exposes `drive` (read by the sim) and emits: 'action' (name), 'padchange' (connected), 'gesture' (for audio unlock).
export const Input = (() => {
  const KEY_DRIVE = { ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right' };
  const KEY_ACTIONS = { KeyC:'camera', KeyM:'mute', KeyP:'pause', Escape:'pause', KeyF:'fps', KeyG:'graphics', KeyT:'tweak', KeyL:'layout', KeyV:'fullscreen', KeyI:'inputs', KeyO:'settings',
    KeyQ:'shiftDown', KeyE:'shiftUp', KeyB:'box' };
  const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  // A / B are the phone wheel's buttons 1 and 2: confirm in menus, shift down / up while racing (the game decides)
  const PAD_ACTIONS = [[PAD.A, 'primary'], [PAD.B, 'secondary'], [PAD.LB, 'shiftDown'], [PAD.RB, 'shiftUp'],
    [PAD.START, 'pause'], [PAD.Y, 'camera'], [PAD.X, 'box']];
  const TOUCH = { tLeft: 'left', tRight: 'right', tBrake: 'down', tGas: 'up' };

  const events = createEmitter();
  const held = { up: false, down: false, left: false, right: false };
  const drive = { steer: 0, thr: 0, brk: 0, analog: false };
  // the connected controller as the browser reports it, for the input monitor: id, mapping, and `timestamp`,
  // which the browser bumps every time the device sends new data (so its change rate = the controller's update rate)
  const pad = { connected: false, key: '', kind: '', label: '', id: '', mapping: '', timestamp: 0, steerRaw: 0 };
  // controller shaping from the Settings screen (fractions; setConfig converts from the screen's percentages)
  const cfg = { deadZone: 0, range: 1, curve: 1, pedalDeadZone: 0, controller: 'auto' };
  function setConfig(p) {
    cfg.controller = p.controller || 'auto';
    cfg.deadZone = p.deadZone / 100; cfg.range = p.range / 100; cfg.curve = p.curve; cfg.pedalDeadZone = p.pedalDeadZone / 100;
  }
  setConfig(PREFS.defaults);
  const gamepadAllowed = !(document.featurePolicy && document.featurePolicy.allowsFeature && !document.featurePolicy.allowsFeature('gamepad'));
  let padPrev = [], padKey = '';

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

  const pressed = (p, i) => { const b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
  const deadZone = (x, dz) => Math.abs(x) < dz ? 0 : Math.sign(x) * (Math.abs(x) - dz) / (1 - dz);
  // analog steering: dead zone, then full lock at `range` of the travel, then the response curve
  const shapeSteer = x => { const d = Math.min(1, Math.abs(deadZone(x, cfg.deadZone)) / cfg.range); return Math.sign(x) * d ** cfg.curve; };

  // Called once per frame: merges every source into `drive` and fires button actions on press edges.
  function poll() {
    const p = Controllers.pick(cfg.controller);
    if ((p?.key ?? '') !== padKey) { padKey = p?.key ?? ''; events.emit('padchange', !!p, p?.label ?? ''); }   // connected, or another device
    let steer = (held.right ? 1 : 0) - (held.left ? 1 : 0), thr = held.up ? 1 : 0, brk = held.down ? 1 : 0, analog = false;
    pad.connected = !!p;
    if (p) {
      if (pad.key !== p.key) padPrev = p.buttons.map((b, i) => pressed(p, i));   // another device: buttons already held don't fire
      pad.key = p.key; pad.kind = p.kind; pad.label = p.label; pad.id = p.id; pad.mapping = p.mapping; pad.timestamp = p.timestamp; pad.steerRaw = p.axes[0] || 0;
      const x = shapeSteer(p.axes[0] || 0);
      let pt = p.buttons[PAD.RT] ? p.buttons[PAD.RT].value : 0, pb = p.buttons[PAD.LT] ? p.buttons[PAD.LT].value : 0;
      if (p.mapping !== 'standard' && p.axes.length >= 6) {           // raw Xbox layout: triggers on axes 5 / 2, -1 at rest
        if (p.axes[5] > -0.98 || p.axes[2] > -0.98) { pt = Math.max(pt, (p.axes[5] + 1) / 2); pb = Math.max(pb, (p.axes[2] + 1) / 2); }
      }
      if (x !== 0) { steer = x; analog = true; }
      thr = Math.max(thr, deadZone(pt, cfg.pedalDeadZone)); brk = Math.max(brk, deadZone(pb, cfg.pedalDeadZone));
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

  return { drive, pad, poll, on: events.on, gamepadAllowed, setConfig, shapeSteer };
})();

