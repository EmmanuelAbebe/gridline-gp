// Sound Studio (Settings → Sound → Sound studio): tweak every sound setting by ear. A test bench at the top plays
// the engine (your rpm and throttle, a rev sweep, or a run through the gears; cockpit or outside mix; a rival driving
// past) while the sliders below edit SOUND live. Changes are saved (localStorage gridline.sound) and used in races.
import { SOUND, SOUND_DEFAULTS, getPath, setPath, soundOverrides, applySoundOverrides } from './audio/audio-config.js';
import { Sound } from './sound.js';
import { Settings } from './settings.js';
import { $ } from './util.js';

const KEY = 'gridline.sound';
// [path, label, min, max, step, hint?]
const GROUPS = [
  ['Tone: bass and treble', [
    ['mix.driver.low', 'Cockpit bass (dB)', -6, 20, 0.5, 'low shelf: the engine you feel behind your back'],
    ['mix.driver.high', 'Cockpit treble (dB)', -24, 6, 0.5, 'high shelf: earplugs and helmet'],
    ['mix.tv.low', 'Outside bass (dB)', -6, 20, 0.5],
    ['mix.tv.high', 'Outside treble (dB)', -24, 6, 0.5],
    ['eq.lowHz', 'Bass corner (Hz)', 60, 400, 5],
    ['eq.highHz', 'Treble corner (Hz)', 800, 8000, 50],
  ]],
  ['Engine character', [
    ['engine.drive.load', 'Rasp on throttle', 0.3, 4, 0.05, 'saturation: higher = harsher, more aggressive'],
    ['engine.drive.coast', 'Rasp off throttle', 0.2, 2.5, 0.05],
    ['engine.loadTilt', 'Mellowness on throttle', 0.3, 2, 0.02, 'higher = fewer high harmonics, smoother'],
    ['engine.coastTilt', 'Mellowness off throttle', 0.5, 2.5, 0.02],
    ['engine.halfOrder', 'V6 growl', 0, 1, 0.01, 'the uneven-firing half orders'],
    ['engine.tone.base', 'Exhaust filter base (Hz)', 200, 4000, 25, 'everything above is cut'],
    ['engine.tone.rpm', 'Filter opens with rpm (Hz)', 0, 8000, 50],
    ['engine.tone.load', 'Filter opens with throttle (Hz)', 0, 8000, 50],
    ['engine.texture', 'Combustion grit', 0, 0.6, 0.01],
    ['engine.jitterCents', 'Roughness (pitch wander, cents)', 0, 40, 0.5],
  ]],
  ['Engine level', [
    ['engine.gain.idle', 'Level at idle', 0, 0.6, 0.01],
    ['engine.gain.load', 'Extra on throttle', 0, 0.8, 0.01],
    ['engine.gain.rpm', 'Extra with rpm', 0, 0.6, 0.01],
    ['engine.limiterHz', 'Rev limiter rate (Hz)', 6, 40, 1],
  ]],
  ['Airbox, turbo, hybrid, pops', [
    ['engine.intake.gain', 'Airbox roar', 0, 1, 0.01],
    ['engine.intake.cutoff', 'Airbox tone (Hz)', 120, 1500, 10],
    ['mix.driver.intake', 'Airbox in cockpit', 0, 2, 0.05],
    ['mix.tv.intake', 'Airbox outside', 0, 2, 0.05],
    ['engine.turbo.gain', 'Turbo whistle', 0, 0.08, 0.001],
    ['engine.turbo.low', 'Turbo pitch low (Hz)', 800, 6000, 50],
    ['engine.turbo.high', 'Turbo pitch high (Hz)', 2000, 12000, 50],
    ['engine.turbo.chirp', 'Lift-off chirp', 0, 0.3, 0.005],
    ['engine.ers.gain', 'Hybrid whine (deploy)', 0, 0.05, 0.001],
    ['engine.ers.harvest', 'Hybrid whine (braking)', 0, 0.05, 0.001],
    ['engine.crackle.gain', 'Overrun pops', 0, 0.8, 0.01],
    ['engine.crackle.rate', 'Pops per second', 0, 60, 1],
  ]],
  ['Gear shifts', [
    ['shift.crack', 'Upshift crack', 0, 1, 0.01],
    ['shift.blip', 'Downshift blip', 0, 1, 0.01],
    ['shift.clunk', 'Gearbox clunk', 0, 1, 0.01],
  ]],
  ['Other cars', [
    ['rivals.gain', 'Rival engines', 0, 3, 0.05],
    ['rivals.refDistance', 'Full volume within (m)', 2, 40, 1],
    ['rivals.rolloff', 'Fade with distance', 0.3, 3, 0.05],
    ['rivals.air.perMetre', 'Air dulls them over (m)', 20, 400, 5],
    ['mix.driver.rivalsHigh', 'Rivals treble, cockpit (dB)', -24, 6, 0.5],
    ['mix.tv.rivalsHigh', 'Rivals treble, outside (dB)', -24, 6, 0.5],
    ['passBy.gain', 'Pass-by whoosh', 0, 1, 0.01],
  ]],
  ['Tyres, surfaces, wind, crowd', [
    ['tyres.squeal', 'Tyre squeal', 0, 0.4, 0.005],
    ['tyres.lock', 'Lock-up', 0, 0.5, 0.005],
    ['tyres.spin', 'Wheel spin', 0, 0.4, 0.005],
    ['surface.kerb', 'Kerb rumble', 0, 0.8, 0.01],
    ['surface.grass', 'Grass', 0, 0.6, 0.01],
    ['surface.sand', 'Gravel', 0, 0.6, 0.01],
    ['wind.gain', 'Wind', 0, 0.5, 0.005],
    ['mix.driver.wind', 'Wind in cockpit', 0, 2, 0.05],
    ['crowd.gain', 'Crowd', 0, 0.3, 0.005],
  ]],
  ['Camera shake', [
    ['shake.passBy', 'Close-pass jolt (m)', 0, 0.2, 0.002],
    ['shake.buffet', 'Dirty-air buffeting (m)', 0, 0.06, 0.001],
    ['shake.decay', 'Jolt fades over (s)', 0.05, 1, 0.01],
  ]],
];
// presets: overrides on top of the defaults
const PRESETS = {
  Default: {},
  Warm: { 'engine.drive.load': 1.1, 'engine.loadTilt': 1.0, 'engine.tone.load': 1500, 'engine.texture': 0.1,
    'mix.driver.low': 13, 'mix.driver.high': -14, 'mix.tv.low': 8, 'mix.tv.high': -7 },
  Raw: { 'engine.drive.load': 2.1, 'engine.drive.coast': 0.7, 'engine.loadTilt': 0.62, 'engine.tone.base': 900, 'engine.tone.rpm': 3600,
    'engine.tone.load': 3200, 'engine.texture': 0.22, 'mix.driver.low': 7, 'mix.driver.high': -9, 'mix.tv.low': 2, 'mix.tv.high': 0 },
};
const GEAR_KMH = [0, 108, 142, 174, 205, 235, 265, 296, 340];

export const SoundStudio = (() => {
  try { applySoundOverrides(JSON.parse(Settings.get(KEY) || '{}')); } catch (e) {}
  const root = $('studio'), bench = { mode: 'sweep', mix: 'driver', mine: true, pass: 0, rpm: 9000, thr: 1 };
  let open = false, raf = 0, t0 = 0, last = 0, saveTimer = 0, passT = 0;
  const inputs = [];   // { path, input, out } for redraw
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => Settings.set(KEY, JSON.stringify(soundOverrides())), 300); };
  const fmt = (v, step) => step >= 1 ? String(Math.round(v)) : v.toFixed(step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

  function seg(label, options, get, set) {
    const row = document.createElement('div'); row.className = 'tw-row wide'; row.innerHTML = `<span>${label}</span>`;
    const box = document.createElement('div'); box.className = 'tw-btns';
    const draw = () => [...box.children].forEach((b, i) => b.classList.toggle('on', options[i][0] === get()));
    for (const [v, text] of options) { const b = document.createElement('button'); b.type = 'button'; b.className = 'iconbtn'; b.textContent = text; b.onclick = () => { set(v); draw(); }; box.append(b); }
    row.append(box); draw(); return row;
  }
  function slider(label, min, max, step, get, set, hint) {
    const row = document.createElement('label'); row.className = 'tw-row'; row.title = hint || '';
    const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step }), out = document.createElement('output');
    row.append(Object.assign(document.createElement('span'), { textContent: label }), input, out);
    const draw = () => { input.value = get(); out.textContent = fmt(+get(), step); };
    input.oninput = () => { set(+input.value); draw(); };
    draw(); return { row, draw };
  }
  function build() {
    root.innerHTML = '';
    const head = document.createElement('div'); head.className = 'tw-head';
    head.innerHTML = '<span>Sound studio</span>';
    const close = Object.assign(document.createElement('button'), { type: 'button', className: 'iconbtn', textContent: 'CLOSE' }); close.onclick = () => toggle(false);
    head.append(close); root.append(head);
    root.append(Object.assign(document.createElement('p'), { className: 'tw-note', textContent: 'Play the bench, move the sliders, listen. Changes are kept and used in races. Hover a slider for what it does.' }));
    // test bench
    const b = document.createElement('details'); b.open = true; b.innerHTML = '<summary>Test bench</summary>';
    const body = document.createElement('div'); body.className = 'tw-body';
    body.append(seg('Play', [['manual', 'MANUAL'], ['sweep', 'REV SWEEP'], ['drive', 'GEARS'], ['off', 'STOP']], () => bench.mode, v => { bench.mode = v; }));
    body.append(seg('Listen', [['driver', 'COCKPIT'], ['tv', 'OUTSIDE']], () => bench.mix, v => { bench.mix = v; }));
    body.append(seg('Your engine', [[true, 'ON'], [false, 'OFF']], () => bench.mine, v => { bench.mine = v; }));
    body.append(seg('Car passing', [[0, 'NONE'], [100, '100'], [200, '200'], [300, '300 KM/H']], () => bench.pass, v => { bench.pass = v; passT = 0; }));
    body.append(slider('RPM (manual)', 4000, 12500, 50, () => bench.rpm, v => { bench.rpm = v; bench.mode = 'manual'; }).row);
    body.append(slider('Throttle (manual)', 0, 1, 0.01, () => bench.thr, v => { bench.thr = v; bench.mode = 'manual'; }).row);
    b.append(body); root.append(b);
    // presets + import / export
    const pr = document.createElement('details'); pr.innerHTML = '<summary>Presets, reset, share</summary>';
    const pb = document.createElement('div'); pb.className = 'tw-body';
    const btns = document.createElement('div'); btns.className = 'tw-btns';
    for (const [name, over] of Object.entries(PRESETS)) { const x = Object.assign(document.createElement('button'), { type: 'button', className: 'iconbtn', textContent: name === 'Default' ? 'DEFAULT (RESET ALL)' : name.toUpperCase() }); x.onclick = () => use(over); btns.append(x); }
    const io = Object.assign(document.createElement('textarea'), { rows: 4, placeholder: 'Export puts your settings here; paste some here and press Import.' });
    io.style.cssText = 'width:100%;background:#1d232b;color:var(--text);border:1px solid var(--rule);border-radius:3px;font:12px monospace';
    const exp = Object.assign(document.createElement('button'), { type: 'button', className: 'iconbtn', textContent: 'EXPORT' }); exp.onclick = () => { io.value = JSON.stringify(soundOverrides(), null, 1); io.select(); };
    const imp = Object.assign(document.createElement('button'), { type: 'button', className: 'iconbtn', textContent: 'IMPORT' }); imp.onclick = () => { try { use(JSON.parse(io.value)); } catch (e) { io.value = 'Not valid settings: ' + e.message; } };
    btns.append(exp, imp); pb.append(btns, io); pr.append(pb); root.append(pr);
    // every setting
    inputs.length = 0;
    for (const [title, items] of GROUPS) {
      const d = document.createElement('details'); d.innerHTML = `<summary>${title}</summary>`;
      const body2 = document.createElement('div'); body2.className = 'tw-body';
      for (const [path, label, min, max, step, hint] of items) {
        const sl = slider(label, min, max, step, () => getPath(SOUND, path), v => { setPath(SOUND, path, v); Sound.refresh(); save(); }, hint + (hint ? ' · ' : '') + 'default ' + getPath(SOUND_DEFAULTS, path));
        inputs.push(sl); body2.append(sl.row);
      }
      d.append(body2); root.append(d);
    }
    root.querySelector('details:nth-of-type(3)').open = true;   // tone, the first thing to try
  }
  function use(over) { applySoundOverrides(over); Sound.refresh(); save(); for (const i of inputs) i.draw(); }

  // the bench: listener in the car (cockpit) or 6 m to the side (outside); a rival every 6 s at bench.pass km/h
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now; const t = (now - t0) / 1000;
    let rpm = bench.rpm, thr = bench.thr, gear = 4, speed = 40;
    if (bench.mode === 'sweep') { const k = t % 5; rpm = k < 3.2 ? 5000 + 7500 * k / 3.2 : Math.max(5000, 12500 - (k - 3.2) * 4200); thr = k < 3.2 ? 1 : 0; }
    else if (bench.mode === 'drive') {   // full throttle up through the gears, every 12 s again
      const k = t % 12, kmh = 60 + 280 * (1 - Math.exp(-k / 3.2)); gear = 1; while (gear < 8 && kmh / GEAR_KMH[gear] * 12000 > 11800) gear++;
      rpm = kmh / GEAR_KMH[gear] * 12000; thr = k < 11.5 ? 1 : 0; speed = kmh / 3.6;
    }
    const playing = bench.mode !== 'off';
    const rivals = [];
    if (bench.pass) {
      passT = (passT + dt) % 6; const v = bench.pass / 3.6, g = GEAR_KMH.findIndex(x => x > bench.pass * 1.02) || 8;
      rivals.push({ id: 'bench', x: (passT - 3) * v, y: 0.6, z: 8, vx: v, vz: 0, rpm: bench.pass / GEAR_KMH[g] * 12000, thr: 1, gear: g });
    }
    Sound.benchFrame({ mix: bench.mix, active: true, playerOn: playing && bench.mine, doppler: true, shiftBeep: false, dt,
      listener: { x: 0, y: 1, z: bench.mix === 'tv' ? -6 : 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0 },
      player: { rpm, thr: playing ? thr : 0, brk: 0, speed, gear, limiter: rpm >= 12400, slideF: 0, slideR: 0, lockF: false, spinR: false,
        surface: 'track', onKerb: false, slip: 0, beepRpm: 0 }, rivals });
  }
  function toggle(on = !open) {
    open = on; root.hidden = !on;
    if (on) { build(); Sound.bench(true); t0 = last = performance.now(); raf = requestAnimationFrame(tick); }
    else {
      cancelAnimationFrame(raf);
      Sound.benchFrame({ mix: bench.mix, active: false, dt: 0, listener: { x: 0, y: 1, z: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0 },
        player: { rpm: 4000, thr: 0, brk: 0, speed: 0, gear: 0, slideF: 0, slideR: 0, surface: 'track', slip: 0 }, rivals: [] });
      Sound.bench(false);
    }
  }
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); toggle(false); } });
  return { toggle, get open() { return open; } };
})();
