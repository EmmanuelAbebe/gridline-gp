import { SIM } from '../sim/index.js';
import { PREFS, RACE_SETUP } from './config.js';
import { SCENARIOS } from './audio/scenarios.js';
import { $, createEmitter } from './util.js';
import { createControllerPanel } from './controller-panel.js';
import { createButtonPanel } from './button-panel.js';
import { createOnlinePanel } from './online-panel.js';

// Settings screen (start menu SETTINGS, pause menu, or O): tabs of controls built from the TABS table below.
// Values live elsewhere (race setup, prefs, graphics mode); main.js passes a binding { get(key), set(key, value),
// note?(key, value), action(name) } and this module only draws the controls and reports changes.
const pct = v => v + ' %';
const seg = (key, label, options, note, when) => ({ type: 'seg', key, label, options, note, when });
const slider = (key, label, fmt, note) => ({ type: 'slider', key, label, fmt, note, limits: PREFS.limits[key] });
const buttons = (...list) => ({ type: 'buttons', list });
// a self-drawing block (make(bind) → { el, tick(pad) }), built once and kept: it may hold state and listeners
const panel = make => ({ type: 'panel', make });
const ON_OFF = [[true, 'ON'], [false, 'OFF']];
const LEVELS = [['off', 'OFF'], ['low', 'LOW'], ['on', 'ON']];
const C = RACE_SETUP.choices, WEAR = SIM.WEAR;

const KEYS = `<div class="keys">
  <span><kbd>↑</kbd> <kbd>W</kbd></span><span>Throttle</span>
  <span><kbd>↓</kbd> <kbd>S</kbd></span><span>Brake (stopped: hold brake + throttle for reverse, then throttle backs up)</span>
  <span><kbd>←</kbd><kbd>→</kbd> <kbd>A</kbd><kbd>D</kbd></span><span>Steer (eased in, so a tap is not full lock)</span>
  <span><kbd>Q</kbd> <kbd>E</kbd></span><span>Shift down / up (semi-auto and manual gearbox)</span>
  <span><kbd>B</kbd> <kbd>X</kbd></span><span>Box this lap, overtake mode (when set to BUTTON)</span>
  <span><kbd>Z</kbd> <kbd>N</kbd></span><span>Straight mode, pit limiter (when set to BUTTON in Settings → Driving)</span>
  <span><kbd>C</kbd></span><span>Camera</span>
  <span><kbd>R</kbd></span><span>Look back (hold)</span>
  <span><kbd>Space</kbd></span><span>Handbrake (hold): locks the rear wheels, for hairpins</span>
  <span><kbd>P</kbd> <kbd>Esc</kbd></span><span>Pause</span>
  <span><kbd>O</kbd></span><span>Settings</span>
  <span><kbd>M</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>V</kbd></span><span>Sound, FPS counter, graphics mode, full screen</span>
  <span><kbd>T</kbd> <kbd>L</kbd> <kbd>I</kbd></span><span>Design tools, HUD layout, input monitor</span>
</div>
<p class="note">Controller: right trigger gas, left trigger brake, the left stick (or the phone's tilt) steers, the right stick looks left / right, A confirms and B goes back in menus. What every other button does is yours to set: Settings → Buttons.</p>`;

const TABS = [
  { id: 'driving', label: 'Driving', items: [
    seg('gearbox', 'Gearbox', C.gearbox, v => ({
      auto: 'The car shifts for you.',
      semi: 'You shift up, the car shifts down as you slow. You can still click down early.',
      manual: 'You shift every gear. Clicks down while too fast wait and go in as you slow.' })[v]
      + (v === 'auto' ? '' : ' Shift: Q / E, pad LB / RB, phone buttons 1 / 2 or flicks on the phone pedals.')),
    seg('assists', 'Assists', C.assists, v => RACE_SETUP.assistNotes[v]),
    ...[['steer', 'Steering help', 'Full tilt asks only for the grip there is: no running wide from too much lock.'],
      ['stability', 'Stability', 'Catches the rear when it starts to slide.'],
      ['tc', 'Traction control', 'Stops wheel spin on the throttle. Off: full gas in low gears spins the rears.'],
      ['abs', 'ABS', 'Stops the brakes locking. Off: too much brake locks the fronts and the car goes straight on.']]
      .map(([k, label, note]) => seg('a.' + k, label, LEVELS, () => note, b => b.get('assists') === 'custom')),
    // pit stops: what wears out (applies from the next race). Box: B, pad X / phone button 3, or the BOX button.
    seg('fuel', 'Fuel use', C.fuel, v => !WEAR.fuel[v] ? 'No fuel use.'
      : `A full tank lasts ${WEAR.fuel[v]} laps: longer races need a stop. Cars start with what the race needs.`
        + ' Box with B, pad X or the BOX button: the car drives itself through the pit lane.'),
    seg('tyres', 'Tyre wear', C.tyres, v => !WEAR.tyres[v] ? 'Tyres never wear.'
      : `Worn out after about ${WEAR.tyres[v]} laps (sliding wears them faster): less grip.`),
    seg('tyreTemp', 'Tyre temperature', C.tyreTemp, v => v === 'on'
      ? 'Tyres grip best at 90–110 °C. Off the blankets (70 °C) at the start and after a pit stop they grip less until you warm them up; sliding and wheelspin overheat them. Every car, the AI too.'
      : 'Tyres always grip as if at their best temperature.'),
    seg('damage', 'Damage', C.damage, v => v === 'on'
      ? 'Hits break the front wing (understeer), the floor (less downforce) or the suspension (the car pulls). Repaired in the pits.'
      : 'Hits never damage the car.'),
    // active aero and overtake mode (applies from the next race; the overtake trigger at once)
    // driving aids on screen (prefs: at once)
    seg('racingLine', 'Racing line', [['full', 'FULL'], ['braking', 'BRAKING'], ['off', 'OFF']], v => ({
      full: 'The fastest line (the ALIEN rival\'s best lap) on the road: green on the gas, amber lifting, red braking (darker = harder).',
      braking: 'Only the braking zones of the fastest line, fading in before each one.',
      off: 'No line on the road.' })[v]),
    seg('hudMirror', 'Mirror on screen', ON_OFF, v => v ? 'A rear-view mirror strip at the top of the screen (move it with the HUD layout editor, L).' : 'No mirror strip (R or the REAR button looks back).'),
    seg('ghostInputs', 'Ghost inputs', ON_OFF, v => v ? 'Time trial against an AI ghost: its steering, gas and brake as live charts, with yours on top.' : 'No input charts.'),
    seg('pauseOnBlur', 'Pause when you leave', ON_OFF, v => v ? 'The race pauses when you switch to another window or the game is hidden.' : 'The race carries on in the background.'),
    seg('aero', 'Active aero', C.aero, v => v === 'on'
      ? 'Every car opens its wing flaps on the straights (straight mode: less drag, about 350 km/h) and closes them to brake and turn (corner mode). The zones are marked on the minimap.'
      : 'Wings stay in corner mode: about 330 km/h.'),
    seg('overtake', 'Overtake mode', C.overtake, v => ({
      auto: 'Within 1 s of the car ahead at the line: the next lap the electric motor keeps its full 350 kW up to 337 km/h (not 290), with extra battery, for 5 s; used for you on the straights when you are close.',
      button: 'Within 1 s of the car ahead at the line: the next lap the electric motor keeps its full 350 kW up to 337 km/h (not 290), with extra battery, for 5 s. Switch it on with X, pad View or the BOOST button.',
      off: 'No overtake boost for anyone.' })[v], b => b.get('aero') === 'on'),
    { ...buttons(['Edit the zones on the map', 'zones']), when: b => b.get('aero') === 'on' && b.get('inMenu') },   // (from the start menu)
    seg('straight', 'Straight mode', C.straight, v => v === 'auto'
      ? 'Your wings open by themselves in the zones on full throttle, as every AI car\'s do.'
      : 'You open the wings yourself (Z or your controller\'s straight-mode button: Settings → Buttons), only in the zones (green on the map, the chip shows dashed): at any throttle and steering, your call. The brakes, the zone\'s end or the button again close them. The AI stays automatic.', b => b.get('aero') === 'on'),
    seg('limiter', 'Pit limiter', C.limiter, v => v === 'auto'
      ? 'The car holds 80 km/h by itself from the pit wall\'s start to its end.'
      : 'Your own limiter (N or your controller\'s pit-limiter button): switch it on before the pit lane\'s line, off after the end of the pit wall. It holds 80 km/h but does not brake: over 80 in the pit lane is a 5 s time penalty, as in F1. Left on, it holds you to 80 on the track too.'),
  ] },
  { id: 'controller', label: 'Controller', items: [
    panel(createControllerPanel),
    slider('smoothing', 'Steering smoothing', v => v ? String(v) : 'OFF',
      v => v ? `The steering takes ${Math.round(1000 * v / PREFS.smoothingRate)} ms from centre to full lock.`
        : 'Off: the car gets your controller\'s steering exactly as it arrives. Smoothing on the phone wheel is set in its own app.'),
    seg('speedSteer', 'Speed-sensitive steering', [['on', 'ON'], ['off', 'OFF']], v => v === 'on'
      ? 'Your controller\'s travel matches what the tyres can use at every speed (like a wheel with a quicker ratio when slow), even with assists off; the last 15 % reaches full lock for catching slides. The car itself is unchanged.'
      : 'Off: full travel is always the full 17° lock (unless Steering help is on). At 300 km/h only the first ~20 % of the travel is within the grip.'),
    slider('calm', 'Steering at speed', v => v ? v + ' % calm' : 'DIRECT', v => v
      ? 'Small tilts turn the car gently at any speed, like the first versions; full tilt still uses all the grip.'
      : 'Direct: the same tilt asks for the same share of grip, so at high speed (lots of downforce) a small tilt turns hard.'),
    slider('deadZone', 'Steering dead zone', pct, () => 'Steering ignored around the centre.'),
    slider('range', 'Full lock at', v => v + ' % travel', v => v < 100 ? `Full lock arrives at ${v} % of the controller's travel.` : 'Full lock at the end of the controller\'s travel.'),
    slider('curve', 'Steering response', v => v === 1 ? 'LINEAR' : v.toFixed(1),
      v => v === 1 ? 'Linear: the wheel turns as much as you turn the controller.' : 'Finer near the centre, quicker toward full lock.'),
    slider('pedalDeadZone', 'Trigger dead zone', pct, () => 'Gas and brake ignored near rest.'),
    slider('brakeForce', 'Brake force', pct, v => v >= 100
      ? 'Full pedal = the car\'s full braking force, the same at any speed, as on a real car. Without ABS the fronts lock from ~80 % pedal at 320 km/h and ~30 % at 80 km/h: ease off as you slow and the downforce goes.'
      : `Full pedal = ${v} % of the car's braking force (the same at any speed). Without ABS the fronts lock from ~${Math.min(100, Math.round(80 * 100 / v))} % pedal at 320 km/h and ~${Math.round(30 * 100 / v)} % at 80 km/h.`),
    { type: 'readout' },
    buttons(['Test controls', 'inputs'], ['Reset controller', 'resetController']),
  ] },
  { id: 'buttons', label: 'Buttons', items: [panel(createButtonPanel)] },
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
    seg('noiseColour', 'Noise', [[0, 'WHITE'], [1, 'PINK'], [2, 'BROWN']], v => ['White: flat and hissy.', 'Pink: softer highs, easy on the ears for long sessions.', 'Brown: deep and rumbly, the softest.'][v] + ' For wind, tyres, kerbs, gravel and the other noise-based sounds.'),
    seg('doppler', 'Doppler', ON_OFF, v => v ? 'Cars rise in pitch coming at you and drop going away, by the real speed difference: strongest when you are slow or stopped.' : 'Other cars keep their own pitch.'),
    slider('shake', 'Camera shake', v => v ? v + ' %' : 'OFF', () => 'A jolt when a car passes close, buffeting in dirty air.'),
    seg('shiftBeep', 'Shift beep', ON_OFF, () => 'A beep in your ear at the shift point (semi-auto and manual), as some drivers use.'),
    buttons(['Sound studio: tweak the sound by ear', 'studio']),
    { type: 'html', html: '<p class="lbl" style="margin:4px 0 0">Test sounds</p>' },
    buttons(...Object.entries(SCENARIOS).map(([id, s]) => [s.label, 'sound:' + id])),
    { type: 'html', html: '<p class="note">The cockpit tests use the driver mix: what you hear in the helmet, earplugs in. The others are an outside microphone.</p>' },
  ] },
  { id: 'tools', label: 'Tools', items: [
    panel(createOnlinePanel),
    buttons(['Design tools', 'tweak'], ['HUD layout', 'layout'], ['Input monitor', 'inputs']),
    { type: 'html', html: '<p class="note">Design tools (T) edit the car, cameras and HUD look. HUD layout (L) moves the race panels; start a race first.</p>' },
    seg('updateCheck', 'Check for updates', ON_OFF, v => v ? 'At start the game looks on GitHub for a newer version and tells you on the start menu. It downloads nothing by itself and sends nothing about you.' : 'The game never looks for updates. (The online leaderboard goes online only once you join it or pick its ghost.)'),
    { type: 'html', html: '<p class="lbl" style="margin:4px 0 0">Report a bug</p>' },
    buttons(['Open log folder', 'logs']),
    { type: 'html', html: '<p class="note">Found a bug? Report it at github.com/EmmanuelAbebe/gridline-gp/issues and attach gridline.log (and gridline-previous.log if the game crashed and you restarted it) from this folder. Desktop app only.</p>' },
    { type: 'html', html: '<p class="lbl" style="margin:4px 0 0">Credits</p><p class="note">The 2026 car is based on "F1 2026 concept (polygon model)" by Qvist_designs (sketchfab.com/Qvist_Designs), licensed under CC-BY-4.0. Changed for the game: cut down, split into moving parts, painted. Its driver is based on "race driver" by BELAZ (CC-BY-4.0; a Ready Player Me avatar, CC BY-NC-SA 4.0), the helmet on "Racing helmet" by MizuCorp and the steering wheel on "Steering-Wheel type Formula" by OscarContrerasLithgow (both CC-BY-4.0), seated and posed for the game. See CREDITS.md.</p>' },
  ] },
];

export const SettingsScreen = (() => {
  const root = $('setOv'), tabBar = $('setTabs'), body = $('setBody'), events = createEmitter();
  let bind = null, tab = TABS[0].id, open = false;
  const refresh = [];           // per visible control: () => redraw from the bound value
  let readout = null;
  const panels = new Set();      // panels on the visible tab

  function control(it) {
    const row = document.createElement('div'); row.className = 'set-item';
    if (it.type === 'html') { row.innerHTML = it.html; return row; }
    if (it.type === 'panel') { it.instance ||= it.make(bind); panels.add(it.instance); row.append(it.instance.el); return row; }
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
    tabBar.innerHTML = ''; body.innerHTML = ''; refresh.length = 0; readout = null; panels.clear();
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
    // every frame while open: the panels (controller list) and the live steering bars (raw from the device, shaped for the car)
    tick(pad, shaped) {
      if (!open) return;
      for (const p of panels) p.tick(pad);
      if (readout) [pad.connected ? pad.steerRaw : 0, pad.connected ? shaped : 0].forEach((v, i) => {
        const w = Math.min(1, Math.abs(v)) * 50;
        readout[i].style.left = (v < 0 ? 50 - w : 50) + '%'; readout[i].style.width = w + '%';
      });
    },
  };
})();
