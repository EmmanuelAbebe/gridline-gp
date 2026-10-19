import { DESIGN_DEFAULTS } from './design-defaults.js';
import { Design } from './design.js';
import { CarModels } from './car-models.js';
import { Hud } from './hud.js';
import { $, createEmitter } from './util.js';

// Tweak panel: every number in Design.data (cameras, car parts, wheels, steering wheel, HUD theme) with live preview.
// Emits 'camera' (id to switch to), 'freeze' (bool), 'layout' (open layout mode).
export const TweakPanel = (() => {
  const root = $('tweak'), events = createEmitter();
  let camId = 'chase', partIdx = 0, wheelIdx = 0, frozen = false;

  // tiny DOM helpers
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e[k] = v;
    }
    e.append(...kids.filter(k => k != null && k !== false)); return e;
  };
  // a value inside an object: obj[key], or obj[key][idx] for vectors
  const ref = (obj, key, idx) => ({ get: () => idx === undefined ? obj[key] : obj[key][idx], set: v => { if (idx === undefined) obj[key] = v; else obj[key][idx] = v; } });
  function num(label, obj, key, [min, max, step], onChange, idx) {
    const r = ref(obj, key, idx);
    const range = h('input', { type: 'range', min, max, step, value: r.get() });
    const box = h('input', { type: 'number', step, value: r.get() });
    range.addEventListener('input', () => { box.value = range.value; r.set(+range.value); onChange(); });
    box.addEventListener('input', () => { if (box.value === '' || !isFinite(+box.value)) return; range.value = box.value; r.set(+box.value); onChange(); });
    return h('label', { class: 'tw-row' }, h('span', {}, label), range, box);
  }
  const check = (label, obj, key, onChange) =>
    h('label', { class: 'tw-check' }, h('input', { type: 'checkbox', checked: !!obj[key], onchange: e => { obj[key] = e.target.checked; onChange(); } }), label);
  function choose(label, value, options, onPick) {
    const sel = h('select', { onchange: () => onPick(sel.value) }, ...options.map(([v, t]) => h('option', { value: v, textContent: t })));
    sel.value = value;
    return h('label', { class: 'tw-row wide' }, h('span', {}, label), sel);
  }
  const colorRow = (label, obj, key, onChange) =>
    h('label', { class: 'tw-row wide' }, h('span', {}, label), h('input', { type: 'color', value: obj[key], oninput: e => { obj[key] = e.target.value; onChange(); } }));
  const textRow = (label, obj, key, onChange) =>
    h('label', { class: 'tw-row wide' }, h('span', {}, label), h('input', { type: 'text', value: obj[key], onchange: e => { obj[key] = e.target.value; onChange(); } }));
  const buttons = (...list) => h('div', { class: 'tw-btns' }, ...list.map(([t, fn]) => h('button', { type: 'button', className: 'iconbtn', textContent: t, onclick: fn })));
  const sub = text => h('div', { class: 'tw-sub' }, text);
  const vec3 = (title, obj, key, ranges, onChange, names = ['x', 'y', 'z']) =>
    [sub(title), ...names.map((n, i) => num(n, obj, key, ranges[i], onChange, i))];

  const sections = {};
  function section(id, title, render, open = false) {
    const body = h('div', { class: 'tw-body' });
    const el = h('details', { open }, h('summary', {}, title), body);
    el.addEventListener('toggle', () => { if (el.open) render(body); });
    sections[id] = { el, body, render };
    return el;
  }
  const rerender = id => { const s = sections[id]; if (s && s.el.open) s.render(s.body); };

  // ---- cameras ----
  function renderCamera(body) {
    const cams = Design.data.cameras, cam = cams.find(c => c.id === camId) || cams[0], ch = () => Design.changed('cameras');
    body.replaceChildren(
      choose('Camera', cam.id, cams.map(c => [c.id, c.label]), id => { camId = id; events.emit('camera', id); rerender('camera'); }),
      sub('Eye position (m from the car centre)'),
      num('Back', cam, 'back', [-5, 40, 0.01], ch), num('Side', cam, 'side', [-3, 3, 0.01], ch), num('Height', cam, 'height', [0.1, 30, 0.01], ch),
      sub('Aim'),
      num('Look ahead', cam, 'ahead', [1, 80, 0.1], ch), num('Look height', cam, 'lookY', [-5, 10, 0.01], ch),
      num('FOV', cam, 'fov', [20, 120, 0.5], ch), num('FOV + speed', cam, 'fovGain', [0, 40, 0.5], ch),
      num('Head lean', cam, 'lean', [0, 0.2, 0.005], ch), num('Near clip', cam, 'near', [0.01, 2, 0.01], ch),
      num('Follow', cam, 'k', [1, 60, 0.5], ch),
      check('Rigid (no smoothing)', cam, 'rigid', ch), check('Show cockpit-view car parts', cam, 'cockpitBody', ch),
      buttons(['RESET CAMERAS', () => Design.reset('cameras')]));
  }

  // ---- car body ----
  const SIZE_LABELS = { box: ['Length', 'Height', 'Width'], rounded: ['Thickness', 'Height', 'Width'], sphere: ['Radius'], cylinder: ['Radius', 'Length'], torus: ['Radius', 'Tube', 'Arc °'],
    loft: ['Scale x', 'Scale y', 'Scale z'], body: ['Scale x', 'Scale y', 'Scale z'], wing: ['Chord', 'Thickness', 'Span'], rod: ['To x', 'To y', 'To z'], decal: ['Width', 'Height'] };
  const COLOR_ROLES = [['body', 'Team colour'], ['accent', 'Team accent'], ['dark', 'Carbon (dark)'], ['tyre', 'Rubber'], ['custom', 'Custom…']];
  function renderParts(body) {
    const parts = Design.data.car.parts, ch = () => Design.changed('car'), redo = () => { ch(); rerender('parts'); };
    partIdx = Math.max(0, Math.min(partIdx, parts.length - 1));
    const p = parts[partIdx];
    const list = [
      choose('Part', String(partIdx), parts.map((q, i) => [String(i), `${i + 1}. ${q.name}${q.show === 'off' ? ' (off)' : ''}`]), v => { partIdx = +v; rerender('parts'); }),
      buttons(
        ['ADD', () => { parts.push(Design.part({ name: 'new part', size: [0.2, 0.2, 0.2], pos: [1.2, 0.7, 0], color: '#ff3da5' })); partIdx = parts.length - 1; redo(); }],
        ['DUPLICATE', () => { if (!p) return; parts.splice(partIdx + 1, 0, Design.part(JSON.parse(JSON.stringify({ ...p, name: p.name + ' copy' })))); partIdx++; redo(); }],
        ['DELETE', () => { if (!p) return; parts.splice(partIdx, 1); redo(); }],
        ['RESET CAR', () => Design.reset('car')]),
    ];
    if (p) {
      const custom = String(p.color).startsWith('#');
      const picker = h('input', { type: 'color', value: custom ? p.color : '#ffffff', oninput: e => { p.color = e.target.value; ch(); } });
      list.push(
        textRow('Name', p, 'name', redo),
        choose('Shape', p.shape, [['box', 'Box'], ['rounded', 'Rounded box'], ['sphere', 'Sphere'], ['cylinder', 'Cylinder'], ['torus', 'Torus / ring'], ['loft', 'Curved body (sections)'], ['body', 'One-piece body'], ['wing', 'Wing'], ['rod', 'Rod'], ['decal', 'Race number']], v => { p.shape = v; redo(); }),
        sub('Size (m)'),
        ...SIZE_LABELS[p.shape].map((l, i) => num(l, p, 'size', p.shape === 'torus' && i === 2 ? [1, 360, 1] : p.shape === 'rod' ? [-3, 3, 0.001] : [0.001, 4, 0.001], ch, i)),
        p.shape === 'rounded' && num('Corner radius', p, 'radius', [0, 0.5, 0.001], ch),
        p.shape === 'rod' && num('Rod radius', p, 'radius', [0.002, 0.2, 0.001], ch),
        p.shape === 'wing' && num('Camber', Object.assign(p, { camber: p.camber ?? 0.05 }), 'camber', [0, 0.2, 0.005], ch),
        ...(p.steer
          ? vec3('Position (m from wheel centre)', p, 'pos', [[-0.5, 0.5, 0.0005], [-0.5, 0.5, 0.0005], [-0.5, 0.5, 0.0005]], ch)
          : vec3('Position (m) · x forward, y up, z right', p, 'pos', [[-4, 4, 0.005], [-1, 3, 0.005], [-2, 2, 0.005]], ch)),
        ...vec3('Rotation (°)', p, 'rot', [[-180, 180, 1], [-180, 180, 1], [-180, 180, 1]], ch),
        choose('Colour', custom ? 'custom' : p.color, COLOR_ROLES, v => { p.color = v === 'custom' ? picker.value : v; redo(); }),
        custom && h('label', { class: 'tw-row wide' }, h('span', {}, 'Custom'), picker),
        choose('Finish', p.finish || 'auto', [['auto', 'From colour'], ['paint', 'Paint'], ['carbon', 'Carbon'], ['rubber', 'Rubber'], ['metal', 'Metal'], ['light', 'Brake light'], ['decal', 'Race number']], v => { if (v === 'auto') delete p.finish; else p.finish = v; redo(); }),
        choose('Visible', p.show, [['always', 'Always'], ['outside', 'Outside views only'], ['cockpit', 'Cockpit view only'], ['off', 'Hidden']], v => { p.show = v; redo(); }),
        check('Part of the steering wheel', p, 'steer', () => {   // keep the part where it is when switching frames
          const piv = Design.data.car.steering.pivot, sgn = p.steer ? -1 : 1;
          p.pos = p.pos.map((v, i) => Math.round((v + sgn * piv[i]) * 10000) / 10000); redo();
        }));
    }
    body.replaceChildren(...list.filter(Boolean));
  }

  // ---- wheels + steering wheel ----
  function renderWheels(body) {
    const car = Design.data.car, ch = () => Design.changed('car');
    wheelIdx = Math.max(0, Math.min(wheelIdx, car.wheels.length - 1));
    const w = car.wheels[wheelIdx];
    body.replaceChildren(
      choose('Wheel', String(wheelIdx), car.wheels.map((q, i) => [String(i), q.name]), v => { wheelIdx = +v; rerender('wheels'); }),
      ...vec3('Position (m)', w, 'pos', [[-4, 4, 0.005], [0, 1.5, 0.005], [-2, 2, 0.005]], ch),
      num('Radius', w, 'radius', [0.1, 1, 0.005], ch), num('Width', w, 'width', [0.05, 1, 0.005], ch),
      check('Steers', w, 'front', ch));
  }

  // ---- steering wheel + its screen (same controls for both) ----
  function renderSteering(body) {
    const car = Design.data.car, st = car.steering, sc = car.screen, ch = () => Design.changed('car');
    // width/height are shown in metres: the wheel's natural size (its parts) × its scale
    const natural = CarModels.measure(car.parts.filter(p => p.steer && p.show !== 'off'));
    const r3 = v => Math.round(v * 1000) / 1000;
    const dims = { width: r3(natural[2] * st.scale[2]), height: r3(natural[1] * st.scale[1]) };
    const resize = () => {
      if (natural[2] > 0) st.scale[2] = dims.width / natural[2];
      if (natural[1] > 0) st.scale[1] = dims.height / natural[1];
      st.scale[0] = (st.scale[1] + st.scale[2]) / 2;            // depth follows, so parts keep their proportions
      ch();
    };
    body.replaceChildren(
      h('p', { class: 'tw-note', textContent: 'The wheel moves as one piece: every part marked "Part of the steering wheel" plus the screen, which is fixed to it.' }),
      sub('Steering wheel'),
      ...vec3('Position (m)', st, 'pivot', [[-1, 2, 0.005], [0, 2, 0.005], [-1, 1, 0.005]], ch),
      ...vec3('Rotation (°)', st, 'rot', [[-180, 180, 1], [-180, 180, 1], [-180, 180, 1]], ch),
      natural[2] > 0 && num('Width (m)', dims, 'width', [0.05, 1, 0.001], resize),
      natural[1] > 0 && num('Height (m)', dims, 'height', [0.03, 1, 0.001], resize),
      num('Lock (°)', st, 'lock', [0, 540, 1], ch),
      buttons(['RESET STEERING WHEEL', () => {
        const d = Design.defaults().car;
        car.parts = car.parts.filter(p => !p.steer).concat(d.parts.filter(p => p.steer));
        car.steering = d.steering; car.screen = d.screen; ch(); rerender('steering'); rerender('parts');
      }]),
      sub('Screen · rev lights, speed, gear (your car)'),
      choose('Visible', sc.show, [['cockpit', 'Cockpit view only'], ['always', 'Always'], ['outside', 'Outside views only'], ['off', 'Hidden']], v => { sc.show = v; ch(); }),
      ...vec3('Position (m on the wheel)', sc, 'pos', [[-0.3, 0.3, 0.0005], [-0.3, 0.3, 0.0005], [-0.3, 0.3, 0.0005]], ch),
      ...vec3('Rotation (°)', sc, 'rot', [[-180, 180, 1], [-180, 180, 1], [-180, 180, 1]], ch),
      num('Width (m)', sc, 'size', [0.01, 0.4, 0.001], ch, 0), num('Height (m)', sc, 'size', [0.01, 0.4, 0.001], ch, 1));
  }

  // ---- HUD theme ----
  function renderTheme(body) {
    const t = Design.data.hud.theme, ch = () => Design.changed('hud');
    body.replaceChildren(
      colorRow('Accent', t, 'accent', ch), colorRow('Panels', t, 'panel', ch), num('Panel opacity', t, 'panelOpacity', [0, 1, 0.01], ch),
      colorRow('Text', t, 'text', ch), colorRow('Labels', t, 'muted', ch), num('Corner radius', t, 'radius', [0, 24, 1], ch),
      choose('Font', t.font, [['Saira Condensed', 'Saira Condensed'], ['Saira', 'Saira'], ['Arial Narrow', 'Arial Narrow'], ['system-ui', 'System'], ['monospace', 'Monospace']], v => { t.font = v; ch(); }),
      buttons(['ARRANGE PANELS (L)', () => events.emit('layout')], ['RESET THEME', () => { Design.data.hud.theme = JSON.parse(JSON.stringify(DESIGN_DEFAULTS.hud.theme)); ch(); rerender('theme'); }]));
  }

  // ---- save / load ----
  function renderFile(body) {
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => {
      const f = file.files[0]; if (!f) return;
      f.text().then(txt => { try { Design.replace(JSON.parse(txt)); Hud.toast('Design imported'); } catch (e) { Hud.toast('That file is not a design export'); } });
      file.value = '';
    } });
    body.replaceChildren(
      h('p', { class: 'tw-note', textContent: 'Every change is saved in this browser automatically. Export to keep a copy, move it to another browser, or make it the built-in default (paste it over DESIGN_DEFAULTS in src/game/design-defaults.js).' }),
      buttons(
        ['EXPORT FILE', () => { const a = h('a', { href: URL.createObjectURL(new Blob([Design.json()], { type: 'application/json' })), download: 'gridline-design.json' }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }],
        ['IMPORT FILE', () => file.click()],
        ['COPY JSON', () => navigator.clipboard.writeText(Design.json()).then(() => Hud.toast('Design copied'), () => Hud.toast('Clipboard blocked: use Export'))],
        ['RESET EVERYTHING', () => { if (window.confirm('Reset cameras, car and HUD to the defaults?')) Design.reset(); }]),
      file);
  }

  root.append(
    h('div', { class: 'tw-head' }, h('b', {}, 'Design tools'), h('button', { type: 'button', className: 'iconbtn', textContent: 'CLOSE (T)', onclick: () => toggle(false) })),
    h('label', { class: 'tw-check' }, h('input', { type: 'checkbox', onchange: e => { frozen = e.target.checked; events.emit('freeze', frozen); } }), 'Freeze the race while designing'),
    section('camera', 'Cameras', renderCamera, true),
    section('parts', 'Car body', renderParts),
    section('wheels', 'Road wheels', renderWheels),
    section('steering', 'Steering wheel & screen', renderSteering),
    section('theme', 'HUD theme', renderTheme),
    section('file', 'Save / load', renderFile));
  Design.on('replaced', () => { for (const id in sections) rerender(id); });

  function toggle(force) {
    const open = force ?? root.hidden;
    root.hidden = !open;
    if (open) for (const id in sections) rerender(id);
  }
  return { toggle, on: events.on, setCamera(id) { camId = id; rerender('camera'); } };
})();
