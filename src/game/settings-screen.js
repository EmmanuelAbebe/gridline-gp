import { PREFS, RACE_SETUP } from './config.js';
import { SCENARIOS } from './audio/scenarios.js';
import { $, createEmitter } from './util.js';

// Settings screen (start menu SETTINGS, pause menu, or O): tabs of controls built from the TABS table below.
// Values live elsewhere (race setup, prefs, graphics mode); main.js passes a binding { get(key), set(key, value),
// note?(key, value), action(name) } and this module only draws the controls and reports changes.
const pct = v => v + ' %';
const seg = (key, label, options, note, when) => ({ type: 'seg', key, label, options, note, when });
const slider = (key, label, fmt, note) => ({ type: 'slider', key, label, fmt, note, limits: PREFS.limits[key] });
const buttons = (...list) => ({ type: 'buttons', list });
const ON_OFF = [[true, 'ON'], [false, 'OFF']];
const LEVELS = [['off', 'OFF'], ['low', 'LOW'], ['on', 'ON']];

const KEYS = `<div class="keys">
  <span><kbd>↑</kbd> <kbd>W</kbd></span><span>Throttle</span>
  <span><kbd>↓</kbd> <kbd>S</kbd></span><span>Brake / reverse</span>
  <span><kbd>←</kbd><kbd>→</kbd> <kbd>A</kbd><kbd>D</kbd></span><span>Steer (eased in, so a tap is not full lock)</span>
  <span><kbd>Q</kbd> <kbd>E</kbd></span><span>Shift down / up (semi-auto and manual gearbox)</span>
  <span><kbd>C</kbd></span><span>Camera</span>
  <span><kbd>P</kbd> <kbd>Esc</kbd></span><span>Pause</span>
  <span><kbd>O</kbd></span><span>Settings</span>
  <span><kbd>M</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>V</kbd></span><span>Sound, FPS counter, graphics mode, full screen</span>
  <span><kbd>T</kbd> <kbd>L</kbd> <kbd>I</kbd></span><span>Design tools, HUD layout, input monitor</span>
</div>
<p class="note">Controller: right trigger gas, left trigger brake, LB / RB or A / B (phone buttons 1 / 2) shift down / up
while racing, A confirms in menus, START pauses, Y changes camera.</p>`;

const TABS = [
  { id: 'driving', label: 'Driving', items: [
    seg('gearbox', 'Gearbox', [['auto', 'AUTO'], ['semi', 'SEMI-AUTO'], ['manual', 'MANUAL']], v => ({
      auto: 'The car shifts for you.',
      semi: 'You shift up, the car shifts down as you slow. You can still click down early.',
      manual: 'You shift every gear. Clicks down while too fast wait and go in as you slow.' })[v]
      + (v === 'auto' ? '' : ' Shift: Q / E, pad LB / RB, phone buttons 1 / 2 or flicks on the phone pedals.')),
    seg('assists', 'Assists', [['off', 'OFF'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['custom', 'CUSTOM']], v => RACE_SETUP.assistNotes[v]),
    ...[['steer', 'Steering help', 'Full tilt asks only for the grip there is: no running wide from too much lock.'],
      ['stability', 'Stability', 'Catches the rear when it starts to slide.'],
      ['tc', 'Traction control', 'Stops wheel spin on the throttle. Off: full gas in low gears spins the rears.'],
      ['abs', 'ABS', 'Stops the brakes locking. Off: too much brake locks the fronts and the car goes straight on.']]
      .map(([k, label, note]) => seg('a.' + k, label, LEVELS, () => note, b => b.get('assists') === 'custom')),
  ] },
  { id: 'controller', label: 'Controller', items: [
    { type: 'status' },
    slider('smoothing', 'Steering smoothing', v => v ? String(v) : 'OFF',
      v => v ? `The steering takes ${Math.round(1000 * v / PREFS.smoothingRate)} ms from centre to full lock.`
        : 'Off: the car gets your controller\'s steering exactly as it arrives. Smoothing on the phone wheel is set in its own app.'),
    slider('calm', 'Steering at speed', v => v ? v + ' % calm' : 'DIRECT', v => v
      ? 'Small tilts turn the car gently at any speed, like the first versions; full tilt still uses all the grip.'
      : 'Direct: the same tilt asks for the same share of grip, so at high speed (lots of downforce) a small tilt turns hard.'),
    slider('deadZone', 'Steering dead zone', pct, () => 'Steering ignored around the centre.'),
    slider('range', 'Full lock at', v => v + ' % travel', v => v < 100 ? `Full lock arrives at ${v} % of the controller's travel.` : 'Full lock at the end of the controller\'s travel.'),
    slider('curve', 'Steering response', v => v === 1 ? 'LINEAR' : v.toFixed(1),
      v => v === 1 ? 'Linear: the wheel turns as much as you turn the controller.' : 'Finer near the centre, quicker toward full lock.'),
    slider('pedalDeadZone', 'Trigger dead zone', pct, () => 'Gas and brake ignored near rest.'),
    { type: 'readout' },
    buttons(['Test controls', 'inputs'], ['Reset controller', 'resetController']),
  ] },
  { id: 'keyboard', label: 'Keys', items: [{ type: 'html', html: KEYS }] },
  { id: 'graphics', label: 'Graphics', items: [
    seg('gfx', 'Graphics', [['quality', 'QUALITY'], ['perf', 'PERFORMANCE']]),
    seg('showFps', 'FPS counter', ON_OFF),
    buttons(['Full screen', 'fullscreen']),
  ] },
  { id: 'sound', label: 'Sound', items: [
    seg('sound', 'Sound', ON_OFF),
    slider('volume', 'Volume', pct),
    slider('engineVol', 'Engines', pct, () => 'Your engine and the other cars.'),
    slider('fxVol', 'Effects', pct, () => 'Tyres, kerbs, wind, shifts, crashes, cars rushing past.'),
    slider('ambVol', 'Crowd', pct),
    seg('doppler', 'Doppler', ON_OFF, v => v ? 'Cars rise in pitch coming at you and drop going away, by the real speed difference: strongest when you are slow or stopped.' : 'Other cars keep their own pitch.'),
    slider('shake', 'Camera shake', v => v ? v + ' %' : 'OFF', () => 'A jolt when a car passes close, buffeting in dirty air.'),
    seg('shiftBeep', 'Shift beep', ON_OFF, () => 'A beep in your ear at the shift point (semi-auto and manual), as some drivers use.'),
    buttons(['Sound studio: tweak the sound by ear', 'studio']),
    { type: 'html', html: '<p class="lbl" style="margin:4px 0 0">Test sounds</p>' },
    buttons(...Object.entries(SCENARIOS).map(([id, s]) => [s.label, 'sound:' + id])),
    { type: 'html', html: '<p class="note">The cockpit tests use the driver mix: what you hear in the helmet, earplugs in. The others are an outside microphone.</p>' },
  ] },
  { id: 'tools', label: 'Tools', items: [
    buttons(['Design tools', 'tweak'], ['HUD layout', 'layout'], ['Input monitor', 'inputs']),
    { type: 'html', html: '<p class="note">Design tools (T) edit the car, cameras and HUD look. HUD layout (L) moves the race panels; start a race first.</p>' },
  ] },
];

export const SettingsScreen = (() => {
  const root = $('setOv'), tabBar = $('setTabs'), body = $('setBody'), events = createEmitter();
  let bind = null, tab = TABS[0].id, open = false;
  const refresh = [];           // per visible control: () => redraw from the bound value
  let readout = null, status = null;

  function control(it) {
    const row = document.createElement('div'); row.className = 'set-item';
    if (it.type === 'html') { row.innerHTML = it.html; return row; }
    if (it.type === 'status') { row.innerHTML = '<p class="note set-status"></p>'; status = row.firstChild; return row; }
    if (it.type === 'readout') {
      row.innerHTML = '<div class="set-readout"><span class="lbl">Controller</span><i><b></b><u></u></i><span class="lbl">To the car</span><i><b></b><u></u></i></div>';
      readout = [...row.querySelectorAll('u')]; return row;
    }
    if (it.type === 'buttons') {
      row.className += ' btns';
      for (const [label, action] of it.list) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost small'; b.textContent = label;
        b.onclick = () => bind.action(action); row.append(b);
      }
      return row;
    }
    const head = document.createElement('div'); head.className = 'row';
    head.innerHTML = `<span class="lbl">${it.label}</span>`;
    const note = document.createElement('p'); note.className = 'note';
    let draw;
    if (it.type === 'seg') {
      const s = document.createElement('div'); s.className = 'seg';
      for (const [value, text] of it.options) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
        b.onclick = () => { bind.set(it.key, value); render(); };   // a choice may show or hide other controls
        s.append(b);
      }
      head.append(s);
      draw = v => it.options.forEach(([value], i) => s.children[i].setAttribute('aria-pressed', String(value === v)));
    } else {
      const [min, max, step] = it.limits, wrap = document.createElement('div'), input = document.createElement('input'), out = document.createElement('output');
      wrap.className = 'set-slider';
      Object.assign(input, { type: 'range', min, max, step });
      input.oninput = () => { bind.set(it.key, +input.value); redraw(); };
      wrap.append(input, out); head.append(wrap);
      draw = v => { input.value = v; out.textContent = it.fmt(v); };
    }
    row.append(head, note);
    refresh.push(() => {
      const v = bind.get(it.key); draw(v);
      const text = bind.note?.(it.key, v) ?? it.note?.(v) ?? '';
      note.textContent = text; note.hidden = !text;
    });
    return row;
  }

  function render() {
    tabBar.innerHTML = ''; body.innerHTML = ''; refresh.length = 0; readout = status = null;
    for (const t of TABS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t.label;
      b.setAttribute('aria-pressed', String(t.id === tab)); b.onclick = () => { tab = t.id; render(); };
      tabBar.append(b);
    }
    for (const it of TABS.find(t => t.id === tab).items) if (!it.when || it.when(bind)) body.append(control(it));
    redraw();
  }
  function redraw() { for (const f of refresh) f(); }

  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  $('setClose').onclick = () => close();
  function close() { if (!open) return; open = false; root.hidden = true; events.emit('close'); }

  return {
    on: events.on,
    get open() { return open; },
    bind(b) { bind = b; },
    show(tabId) { if (tabId) tab = tabId; open = true; root.hidden = false; render(); $('setClose').focus(); },
    close, redraw,
    // every frame while open: controller status and the live steering bars (raw from the device, shaped for the car)
    tick(pad, shaped) {
      if (!open) return;
      if (status) {
        const text = pad.connected ? `Connected: ${pad.id.replace(/\s*\(.*$/, '') || 'controller'}` : 'No controller seen yet: press a pedal or button on it.';
        if (status.textContent !== text) status.textContent = text;
      }
      if (readout) [pad.connected ? pad.steerRaw : 0, pad.connected ? shaped : 0].forEach((v, i) => {
        const w = Math.min(1, Math.abs(v)) * 50;
        readout[i].style.left = (v < 0 ? 50 - w : 50) + '%'; readout[i].style.width = w + '%';
      });
    },
  };
})();
