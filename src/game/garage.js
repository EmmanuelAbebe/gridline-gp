// The garage (start menu GARAGE): the player's car in a studio with a free orbit camera (orbit-camera.js), and a
// panel to change it: LOOK (colours, finish, rims, race number; the car's shape in the design tools), SETUP (race
// setup: real trade-offs, SIM SETUP) and OPEN MODS (no limits, SIM MODS: the car is then MODIFIED), with live numbers
// (SIM specStats) against the stock car. Edits go to `garage` (garage-store.js shape) and are reported with
// 'change'; main.js saves them and puts them on the race car. Renders instead of the race scene while open (frame()).
import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { Display } from './display.js';
import { CarModels } from './car-models.js';
import { Design } from './design.js';
import { $, createEmitter } from './util.js';
import { orbitState, orbitPosition, attachOrbit, clampOrbit, ORBIT } from './orbit-camera.js';
import { FINISHES, SWATCHES, LIVERY_DEFAULTS, hexOf, playerDriver, playerSpec } from './garage-store.js';

const SETUP_UI = {
  wing: { label: 'Wing level', fmt: v => String(v), note: () => 'More wing: more grip in corners and under braking, more drag on the straights (lower top speed).' },
  balance: { label: 'Aero balance', fmt: v => v.toFixed(1) + ' % front', note: v => v > 45 ? 'More front downforce: sharper turn-in in fast corners, the rear gets looser.'
    : v < 45 ? 'Less front downforce: a stable rear in fast corners, but understeer.' : 'Stock balance.' },
  brakes: { label: 'Brake balance', fmt: v => v.toFixed(1) + ' % front', note: v => v > 57 ? 'Toward the front: the fronts lock first (straight on, safe), longer stops.'
    : v < 57 ? 'Toward the rear: rotates the car into corners; without ABS the rears can lock and spin it.' : 'Stock balance.' },
  gearing: { label: 'Gearing', fmt: v => `${v} km/h top gear`, note: () => 'The speed top gear reaches at the redline. Match it to the wing: on low wing or in a slipstream short gears run into the limiter.' },
  mech: { label: 'Mechanical balance', fmt: v => v ? (v > 0 ? '+' : '') + v + (v > 0 ? ' front' : ' rear') : 'NEUTRAL', note: v => v > 0
    ? 'Stiffer rear: more front grip (turns in, more oversteer), less traction out of slow corners.'
    : v < 0 ? 'Stiffer front: a planted rear and better traction, but understeer.' : 'Anti-roll bars at the stock setting.' },
};
const MODS_UI = {
  power: { label: 'Engine power', fmt: v => v + ' %' }, mass: { label: 'Weight', fmt: v => v + ' kg' }, grip: { label: 'Tyre grip', fmt: v => v + ' %' },
  downforce: { label: 'Downforce', fmt: v => v + ' %' }, drag: { label: 'Drag', fmt: v => v + ' %' }, brakes: { label: 'Brake force', fmt: v => v + ' %' },
};
const PRESETS = [['STOCK', {}], ['LOW DOWNFORCE', { wing: 2, gearing: 370 }], ['HIGH DOWNFORCE', { wing: 10, gearing: 320 }]];
const TABS = [['look', 'Look'], ['setup', 'Setup'], ['mods', 'Open mods']];
const VIEWS = [['three', '3/4'], ['front', 'FRONT'], ['side', 'SIDE'], ['rear', 'REAR'], ['top', 'TOP']];

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const button = (label, onclick, cls = 'btn ghost small') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; };
function seg(options, current, onpick) {
  const s = el('div', 'seg');
  for (const [v, text] of options) { const b = button(text, () => onpick(v), ''); b.setAttribute('aria-pressed', String(v === current)); s.append(b); }
  return s;
}

export const Garage = (() => {
  const root = $('garageOv'), stage = $('garStage'), tabsEl = $('garTabs'), body = $('garBody'), events = createEmitter();
  let isOpen = false, garage = null, tab = 'look', scene = null, cam = null, model = null, autoTurn = true, idle = 0, statsQueued = false;
  const orbit = orbitState();
  const STOCK_STATS = SIM.specStats(SIM.STOCK);

  // ---- the studio ----
  function floorTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d'), grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0, '#343b45'); grad.addColorStop(0.55, '#20252c'); grad.addColorStop(1, '#101318');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
    for (let i = 0; i <= 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101318);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1e24, 0.75));
    for (const [color, k, pos] of [[0xffffff, 1.0, [5, 9, 6]], [0x9fc4ff, 0.55, [-6, 4, -5]], [0xffe2c4, 0.35, [-4, 2.5, 6]]]) {
      const l = new THREE.DirectionalLight(color, k); l.position.set(...pos); scene.add(l);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(10, 72), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.55, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.55, 3.62, 120), new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.35 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; scene.add(ring);
    cam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    model = CarModels.create(scene, playerDriver(garage), Design.data.car);
    frameCar();
    attachOrbit(stage, orbit, { onUser: () => { idle = 0; } });
    Design.on('change', section => { if (model && (section === 'car' || section === 'all')) { model.rebuild(Design.data.car); frameCar(); } });
  }
  // centre the car on the turntable and aim at its middle
  function frameCar() {
    const o = model.object; o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o), c = box.getCenter(new THREE.Vector3());
    o.position.set(-c.x, 0, -c.z);
    orbit.target = [0, Math.max(0.3, (box.max.y - box.min.y) * 0.45), 0];
  }
  function setView(id) { const [yaw, pitch] = ORBIT.views[id]; Object.assign(orbit, { yaw, pitch, dist: 9.5, target: [0, orbit.target[1], 0] }); clampOrbit(orbit); idle = 0; }

  // camera aspect and the panel: the car sits in the middle of the free area (left of the panel, or above it)
  function placeCamera() {
    const W = innerWidth, H = innerHeight, panel = root.querySelector('.gar-panel'), wide = W > 860;
    const pw = panel && wide ? panel.offsetWidth + 16 : 0, ph = panel && !wide ? Math.min(panel.offsetHeight, H * 0.55) : 0;
    cam.aspect = (W + pw) / (H + ph);
    cam.setViewOffset(W + pw, H + ph, pw, ph, W, H);
    cam.position.set(...orbitPosition(orbit)); cam.lookAt(...orbit.target);
  }

  // ---- panel ----
  function slider(label, r, value, fmt, note, onInput) {
    const row = el('div', 'set-item'), head = el('div', 'row'), wrap = el('div', 'set-slider'), input = el('input'), out = el('output'), p = el('p', 'note');
    Object.assign(input, { type: 'range', min: r.min, max: r.max, step: r.step, value });
    const draw = v => { out.textContent = fmt(v); const t = note?.(v) ?? ''; p.textContent = t; p.hidden = !t; };
    input.oninput = () => { const v = +input.value; draw(v); onInput(v); };
    input.ondblclick = () => { input.value = r.def; input.oninput(); };          // double-click: back to stock
    draw(value); wrap.append(input, out); head.append(el('span', 'lbl', label), wrap); row.append(head, p);
    return row;
  }
  function colourRow(label, key) {
    const row = el('div', 'set-item'), head = el('div', 'row'), sw = el('div', 'gar-swatches'), pick = el('input');
    Object.assign(pick, { type: 'color', value: hexOf(garage.livery[key]), title: 'Any colour' });
    const set = v => { garage.livery[key] = v; pick.value = hexOf(v); mark(); changed('look'); };
    const mark = () => { for (const b of sw.children) b.setAttribute('aria-pressed', String(+b.dataset.c === garage.livery[key])); };
    for (const c of SWATCHES) { const b = button('', () => set(c), 'gar-swatch'); b.dataset.c = String(c); b.style.background = hexOf(c); b.title = hexOf(c); sw.append(b); }
    pick.oninput = () => set(parseInt(pick.value.slice(1), 16));
    sw.append(pick); mark(); head.append(el('span', 'lbl', label)); row.append(head, sw);
    return row;
  }
  function statsCard() {
    const card = el('div', 'gar-stats'); card.id = 'garStats';
    return card;
  }
  function drawStats() {
    statsQueued = false;
    const card = $('garStats'); if (!card) return;
    const s = SIM.specStats(playerSpec(garage)), b = STOCK_STATS;
    const tile = (label, v, ref, unit, better, digits = 0) => {
      const t = el('div', 'gar-stat'), d = v - ref, good = better === 'up' ? d > 0 : d < 0;
      t.append(el('span', 'lbl', label), el('b', '', v === null ? '–' : v.toFixed(digits) + unit));
      if (v !== null && Math.abs(d) >= (digits ? 0.005 : 0.5)) t.append(el('i', good ? 'up' : 'down', (d > 0 ? '+' : '') + d.toFixed(digits)));
      return t;
    };
    // balance against the stock car (the centre line): left = more understeer, right = more oversteer
    const bal = (label, v, ref) => {
      const t = el('div', 'gar-bal'), bar = el('div', 'gar-bar'), mk = el('u'), st = el('b'), r = v / ref;
      mk.style.left = Math.min(100, Math.max(0, 50 + (r - 1) * 400)) + '%'; st.style.left = '50%'; st.title = 'stock';
      bar.append(st, mk);
      const word = r > 1.01 ? 'MORE OVERSTEER' : r < 0.99 ? 'MORE UNDERSTEER' : 'AS STOCK';
      t.append(el('span', 'lbl', label), bar, el('span', 'gar-balword', word));
      return t;
    };
    card.replaceChildren(
      tile('Top speed', s.top, b.top, ' km/h', 'up'), tile('0–200 km/h', s.t200, b.t200, ' s', 'down', 2),
      tile('Corner 30 m', s.corner[30], b.corner[30], ' km/h', 'up'), tile('Corner 80 m', s.corner[80], b.corner[80], ' km/h', 'up'),
      tile('Braking 300–100', s.brake.dist, b.brake.dist, ' m', 'down'),
      bal('Slow corners', s.balance.slow, b.balance.slow), bal('Fast corners', s.balance.fast, b.balance.fast));
  }
  const queueStats = () => { if (!statsQueued) { statsQueued = true; requestAnimationFrame(drawStats); } };

  function render() {
    tabsEl.replaceChildren(...TABS.map(([id, label]) => { const b = button(label, () => { tab = id; render(); }, ''); b.setAttribute('aria-pressed', String(id === tab)); return b; }));
    body.replaceChildren();
    const L = garage.livery;
    if (tab === 'look') {
      body.append(colourRow('Body colour', 'color'), colourRow('Accent colour', 'accent'), colourRow('Rims', 'rims'));
      const fin = el('div', 'set-item'), fh = el('div', 'row');
      fh.append(el('span', 'lbl', 'Paint finish'), seg(FINISHES, L.finish, v => { L.finish = v; changed('look'); render(); }));
      fin.append(fh, el('p', 'note', 'Metallic, satin and matte show in the Quality graphics mode.')); body.append(fin);
      const num = el('div', 'set-item'), nh = el('div', 'row'), step = el('div', 'stepper'), out = el('output', '', String(L.number));
      const bump = d => { L.number = (L.number + d + 100) % 100; out.textContent = String(L.number); changed('look'); };
      step.append(button('−', () => bump(-1), ''), out, button('+', () => bump(1), ''));
      nh.append(el('span', 'lbl', 'Race number'), step); num.append(nh); body.append(num);
      const btns = el('div', 'set-item btns');
      btns.append(button('Reset look', () => { garage.livery = { ...LIVERY_DEFAULTS }; changed('look'); render(); }),
        button('Edit the car\'s shape (design tools)', () => events.emit('designTools')));
      body.append(btns, el('p', 'note', 'The design tools change the shape of every car in the field (wings, bodywork, wheels, cockpit); the colours and number here are yours alone.'));
    } else if (tab === 'setup') {
      body.append(statsCard(), el('p', 'note', 'Race setup: every change buys something and costs something. The rivals race the stock setup. Applies from the next race. Double-click a slider for stock.'));
      const pre = el('div', 'set-item btns');
      for (const [label, values] of PRESETS) pre.append(button(label, () => { garage.setup = SIM.validSetup(values); changed('setup'); render(); }));
      body.append(pre);
      for (const [k, ui] of Object.entries(SETUP_UI)) body.append(slider(ui.label, SIM.SETUP[k], garage.setup[k], ui.fmt, ui.note, v => { garage.setup[k] = v; changed('setup'); }));
      queueStats();
    } else {
      const warn = el('div', 'gar-warn');
      warn.append(el('b', '', 'Open mods: no limits'), el('p', 'note', 'Change anything about the car. Any mod marks it MODIFIED: the results say so and its lap records are kept apart from stock ones. The rivals stay stock.'));
      body.append(warn, statsCard());
      for (const [k, ui] of Object.entries(MODS_UI)) body.append(slider(ui.label, SIM.MODS[k], garage.mods[k], ui.fmt, null, v => { garage.mods[k] = v; changed('mods'); }));
      body.append(el('div', 'set-item btns'));
      body.lastChild.append(button('Reset all mods', () => { garage.mods = SIM.validMods({}); changed('mods'); render(); }));
      queueStats();
    }
    drawTop();
  }
  function drawTop() {
    const modified = SIM.isModified(garage.mods);
    $('garCar').textContent = `#${garage.livery.number} · Gridline${modified ? ' · MODIFIED' : ''}`;
    $('garCar').classList.toggle('mod', modified);
    $('garViews').replaceChildren(...VIEWS.map(([id, label]) => button(label, () => setView(id), 'iconbtn')),
      Object.assign(button(autoTurn ? 'TURNING' : 'STILL', () => { autoTurn = !autoTurn; drawTop(); }, 'iconbtn'), { title: 'Turn the car slowly when you leave it' }));
  }
  function changed(what) {
    if (what === 'look') model?.setLivery(garage.livery); else queueStats();
    drawTop();
    events.emit('change', garage, what);
  }

  $('garClose').onclick = () => close();
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  function close() { if (!isOpen) return; isOpen = false; root.hidden = true; events.emit('close'); }

  return {
    on: events.on,
    get open() { return isOpen; },
    // g = the game's garage object (edited in place); profile = the graphics profile (materials)
    show(g, profile) {
      garage = g;
      if (!scene) buildScene();
      model.setLivery(garage.livery);
      if (profile) CarModels.applyProfile([model], profile);
      isOpen = true; root.hidden = false; idle = 0; render(); stage.focus();
    },
    close,
    frame(dt) {
      if (!isOpen) return;
      if (autoTurn && (idle += dt) > 4) orbit.yaw += dt * 0.25;
      placeCamera();
      Display.renderWith(scene, cam);
    },
  };
})();
