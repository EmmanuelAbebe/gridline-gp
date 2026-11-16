// The garage's LOOK tab for the Blender cars (2026-11-16, the canvas "Gridline livery & lights", every screen): sub-tabs
// ZONES (A: click a part on the car or in the list, colour + finish), LAYERS (B: stripes, fades, shapes, text, logos;
// drag one on the car to move it), SPRAY (C: brush / tape / fill / eraser / colour pick on the car, mirrored), PARTS (E2:
// carbon, halo, T-camera, mirrors, the exhaust E1), LIGHTS (L2 / L3: the rear lights, Settings → Graphics too), NUMBER &
// NAME, PRESETS. The data is livery.js's; the car paints it with livery-paint.js. garage.js hosts it: render(body) builds
// the panel, pointerDown(e, hit) takes the pointer when a tool uses the car.
import { SWATCHES, FINISHES, hexOf } from './garage-store.js';
import { ZONES, ZONE_IDS, zoneAt, MAT, LAYER_KINDS, LAYER_VIEWS, SHAPES, newLayer, validLayer, EXHAUSTS, CARBON_LOOKS, PART_ZONES, PRESETS, applyPreset,
  panelOf, planeOf, PANELS, zoneIndex, MAX_LAYERS, MAX_SPRAY_POINTS } from './livery.js';
import { BRANDS } from './config.js';

export const LOOK_TABS = [['zones', 'Zones'], ['layers', 'Layers'], ['spray', 'Spray'], ['parts', 'Parts'], ['lights', 'Lights'], ['number', 'Number & name'], ['presets', 'Presets']];
const KIND_NAMES = { stripe: 'Stripe', fade: 'Fade', shape: 'Shape', text: 'Text', logo: 'Logo' };
const TOOLS = [['spray', 'SPRAY'], ['tape', 'TAPE'], ['fill', 'FILL'], ['erase', 'ERASER'], ['pick', 'PICK']];
const ZONE_FIN = [...FINISHES, ['carbon', 'BARE CARBON']];
const MAT_OF_ROLE = { paint_main: MAT.main, paint_accent: MAT.accent, carbon: MAT.carbon };

// ctx: { el, button, seg, livery(), changed(what), repaint(), model(), prefs: { get(k), set(k, v) }, render() }
export function createLook(ctx) {
  const { el, button, seg } = ctx;
  let sub = 'zones', zone = 'cover', layerId = null, tool = 'spray', redo = [];
  const brush = { c: 0x2e6bff, r: 150, soft: 70, flow: 55, m: true, lock: false };
  const L = () => ctx.livery();
  const done = () => { ctx.changed('look'); ctx.render(); };

  // a colour row: swatches + any colour (the garage's look)
  function colours(current, set, extra = []) {
    const sw = el('div', 'gar-swatches'), pick = el('input');
    for (const [label, onclick, on] of extra) { const b = button(label, onclick, 'gar-mini'); b.setAttribute('aria-pressed', String(!!on)); sw.append(b); }
    for (const c of SWATCHES) { const b = button('', () => set(c), 'gar-swatch'); b.dataset.c = String(c); b.style.background = hexOf(c); b.title = hexOf(c); b.setAttribute('aria-pressed', String(c === current)); sw.append(b); }
    Object.assign(pick, { type: 'color', value: hexOf(current ?? 0xffffff), title: 'Any colour' });
    pick.oninput = () => set(parseInt(pick.value.slice(1), 16));
    sw.append(pick); return sw;
  }
  const item = (label, control, note) => { const r = el('div', 'set-item'), h = el('div', 'row'); h.append(el('span', 'lbl', label), control); r.append(h); if (note) r.append(el('p', 'note', note)); return r; };
  const stack = (label, control, note) => { const r = el('div', 'set-item gar-stack'); r.append(el('span', 'lbl', label), control); if (note) r.append(el('p', 'note', note)); return r; };
  function range(label, min, max, step, value, fmt, onInput) {
    const r = el('div', 'gar-range'), input = el('input'), out = el('output', '', fmt(value));
    Object.assign(input, { type: 'range', min, max, step, value }); input.setAttribute('aria-label', label);
    input.oninput = () => { out.textContent = fmt(+input.value); onInput(+input.value); };
    input.onchange = () => ctx.changed('look');
    r.append(el('span', 'lbl', label), input, out); return r;
  }

  // ---- ZONES (A)
  function zonesTab(body) {
    const l = L();
    body.append(stack('Body colour', colours(l.color, c => { l.color = c; done(); })), stack('Accent colour', colours(l.accent, c => { l.accent = c; done(); })));
    body.append(item('Paint finish', seg(FINISHES, l.finish, v => { l.finish = v; done(); })));
    const grid = el('div', 'gar-zones');
    for (const [id, name] of ZONES) {
      const c = id === 'wheels' ? l.rims : zoneShown(id);
      const b = button('', () => { zone = id; ctx.render(); }, 'gar-zone');
      const chip = el('i'); chip.style.background = c === null ? 'transparent' : hexOf(c); if (c === null) chip.className = 'own';
      b.append(chip, el('span', '', name)); b.setAttribute('aria-pressed', String(id === zone)); grid.append(b);
    }
    body.append(el('p', 'gar-head', 'Zones · click one here or on the car (mirrored left / right)'), grid);
    const name = ZONES.find(z => z[0] === zone)[1];
    if (zone === 'wheels') { body.append(stack(`${name} · colour`, colours(l.rims, c => { l.rims = c; done(); }))); return; }
    const z = l.zones[zone];
    body.append(stack(`${name} · colour`, colours(z?.c ?? null, c => { l.zones[zone] = { ...l.zones[zone], c, ref: undefined }; delete l.zones[zone].ref; done(); },
      [['AS DESIGNED', () => { delete l.zones[zone]; done(); }, !z]])));
    body.append(stack(`${name} · finish`, seg(ZONE_FIN, z?.f ?? null, v => { l.zones[zone] = { c: z?.c ?? null, f: v, ...(z?.ref ? { ref: z.ref } : {}) }; done(); })));
    const btns = el('div', 'set-item btns');
    btns.append(button('Copy to all', () => { for (const [id] of ZONES) if (id !== 'wheels' && id !== zone) l.zones[id] = { ...z }; done(); }),
      button('All as designed', () => { l.zones = {}; done(); }));
    body.append(btns, el('p', 'note', 'As designed = the body or accent colour, or bare carbon, as the car was drawn. Bare carbon: the colour of the carbon parts with their finish.'));
  }
  const zoneShown = id => { const z = L().zones[id]; return z?.ref === 'body' ? L().color : z?.ref === 'accent' ? L().accent : z?.c ?? null; };

  // ---- LAYERS (B)
  const layerOf = () => L().layers.find(x => x.id === layerId) ?? null;
  function layersTab(body) {
    const l = L(), list = el('div', 'gar-layers');
    if (!layerOf()) layerId = l.layers[l.layers.length - 1]?.id ?? null;
    for (const ly of [...l.layers].reverse()) {
      const row = el('div', 'gar-layer'), b = button('', () => { layerId = ly.id; ctx.render(); }, 'gar-layer-pick');
      const chip = el('i'); chip.style.background = hexOf(ly.c);
      b.append(chip, el('span', '', layerName(ly)), el('small', '', KIND_NAMES[ly.kind].toUpperCase()));
      b.setAttribute('aria-pressed', String(ly.id === layerId));
      const eye = button(ly.on ? 'ON' : 'OFF', () => { ly.on = !ly.on; done(); }, 'gar-mini'); eye.setAttribute('aria-label', `Show ${layerName(ly)}`);
      row.append(b, eye); list.append(row);
    }
    body.append(el('p', 'gar-head', `Layers · the top one in front (${l.layers.length} of ${MAX_LAYERS})`), list);
    if (!l.layers.length) body.append(el('p', 'note', 'No layers yet: add a stripe, a fade, a shape, text or a logo.'));
    const add = el('div', 'gar-chips');
    for (const k of LAYER_KINDS) add.append(button('+ ' + KIND_NAMES[k], () => {
      if (l.layers.length >= MAX_LAYERS) return;
      const nl = newLayer(k, k === 'fade' ? l.accent : 0xf2f3f0, Math.max(0, ...l.layers.map(x => x.id)) + 1); l.layers.push(nl); layerId = nl.id; done();
    }, ''));
    body.append(add);
    const ly = layerOf(); if (!ly) return;
    const set = (k, v) => { ly[k] = v; Object.assign(ly, validLayer(ly)); ctx.repaint(); };
    body.append(el('p', 'gar-head', layerName(ly) + ' · drag it on the car to move it'));
    body.append(stack('Colour', colours(ly.c, c => { ly.c = c; ly.c2 = c; done(); })));
    if (ly.kind === 'shape') body.append(stack('Shape', seg(SHAPES.map(s => [s, s.toUpperCase()]), ly.shape, v => { ly.shape = v; done(); })));
    if (ly.kind === 'text') { const t = el('input', 'gar-text'); Object.assign(t, { type: 'text', value: ly.text, maxLength: 24 }); t.setAttribute('aria-label', 'Text'); t.oninput = () => set('text', t.value); t.onchange = () => ctx.changed('look'); body.append(stack('Text', t)); }
    if (ly.kind === 'logo') body.append(stack('Logo', seg(BRANDS.map(b => [b[0], b[0]]), ly.brand, v => { ly.brand = v; done(); })));
    body.append(stack('On', seg(LAYER_VIEWS.map(v => [v, v.toUpperCase()]), ly.view, v => { ly.view = v; if (v === 'top') ly.y = 0; else if (v !== 'side') { ly.x = 0; ly.y = 0.4; } else ly.y = 0.5; done(); })));
    body.append(stack(ly.view === 'side' ? 'Sides' : 'Mirror', seg(ly.view === 'side' ? [['both', 'BOTH'], ['right', 'RIGHT'], ['left', 'LEFT']] : [['both', 'MIRROR L / R'], ['right', 'ONE']], ly.side === 'left' && ly.view !== 'side' ? 'right' : ly.side, v => { ly.side = v; done(); })));
    const sl = el('div', 'gar-ranges');
    sl.append(range('Length', 0.05, 6, 0.01, ly.w, v => v.toFixed(2) + ' m', v => set('w', v)), range('Height', 0.01, 3, 0.01, ly.h, v => v.toFixed(2) + ' m', v => set('h', v)),
      range('Angle', -180, 180, 1, ly.a, v => v + '°', v => set('a', v)), range('Opacity', 0, 1, 0.01, ly.o, v => Math.round(v * 100) + ' %', v => set('o', v)),
      range(ly.view === 'side' || ly.view === 'top' ? 'Along' : 'Across', -3, 3.2, 0.01, ly.x, v => v.toFixed(2) + ' m', v => set('x', v)),
      range(ly.view === 'top' ? 'Across' : 'Up', -1, 1.2, 0.01, ly.y, v => v.toFixed(2) + ' m', v => set('y', v)));
    body.append(sl);
    const btns = el('div', 'gar-chips'), i = l.layers.indexOf(ly);
    const bodyOnly = button('BODY ONLY', () => { ly.body = !ly.body; done(); }, ''); bodyOnly.setAttribute('aria-pressed', String(ly.body));
    btns.append(bodyOnly,
      button('↑ UP', () => { if (i < l.layers.length - 1) { [l.layers[i], l.layers[i + 1]] = [l.layers[i + 1], l.layers[i]]; done(); } }, ''),
      button('↓ DOWN', () => { if (i > 0) { [l.layers[i], l.layers[i - 1]] = [l.layers[i - 1], l.layers[i]]; done(); } }, ''),
      button('DUPLICATE', () => { if (l.layers.length < MAX_LAYERS) { const d = { ...ly, id: Math.max(...l.layers.map(x => x.id)) + 1, x: ly.x - 0.2 }; l.layers.splice(i + 1, 0, d); layerId = d.id; done(); } }, ''),
      button('DELETE', () => { l.layers.splice(i, 1); layerId = null; done(); }, ''));
    body.append(btns, el('p', 'note', 'Body only: stays off the carbon parts (wings, floor). A layer on the side wraps over the body as seen from the side; top, front and rear the same from there.'));
  }
  const layerName = ly => ly.kind === 'text' ? `“${ly.text || ' '}”` : ly.kind === 'logo' ? ly.brand : ly.kind === 'shape' ? ly.shape[0].toUpperCase() + ly.shape.slice(1) : KIND_NAMES[ly.kind];

  // ---- SPRAY (C)
  function sprayTab(body) {
    const l = L();
    body.append(el('p', 'gar-head', 'Spray · paint on the car: drag with the left button, right-drag turns it'));
    body.append(item('Tool', seg(TOOLS, tool, v => { tool = v; ctx.render(); })));
    body.append(stack('Colour', colours(brush.c, c => { brush.c = c; ctx.render(); })));
    const sl = el('div', 'gar-ranges');
    sl.append(range('Size', 10, 600, 5, brush.r, v => (v / 10).toFixed(0) + ' cm', v => { brush.r = v; }),
      range('Softness', 0, 100, 1, brush.soft, v => v + ' %', v => { brush.soft = v; }),
      range('Flow', 5, 100, 1, brush.flow, v => v + ' %', v => { brush.flow = v; }));
    body.append(sl);
    const opts = el('div', 'gar-chips');
    for (const [k, label] of [['m', 'MIRROR L / R'], ['lock', 'STAY IN ZONE']]) { const b = button(label, () => { brush[k] = !brush[k]; ctx.render(); }, ''); b.setAttribute('aria-pressed', String(brush[k])); opts.append(b); }
    body.append(opts);
    const points = l.spray.reduce((a, s) => a + s.p.length, 0);
    const btns = el('div', 'gar-chips');
    btns.append(button('UNDO', () => { if (l.spray.length) { redo.push(l.spray.pop()); done(); } }, ''),
      button('REDO', () => { if (redo.length) { l.spray.push(redo.pop()); done(); } }, ''),
      button('CLEAR', () => { if (l.spray.length) { redo = [...l.spray].reverse(); l.spray = []; done(); } }, ''));
    body.append(btns, el('p', 'note', `${l.spray.length} strokes · ${Math.round(points / MAX_SPRAY_POINTS * 100)} % of the room for spray. Tape: press at one end, let go at the other (on one side of the car). Fill: paints the zone you click. Stay in zone: the stroke keeps to the zone it starts on. Undo brings a cleared car back too.`));
  }

  // ---- PARTS (E2) and the exhaust (E1)
  function partsTab(body) {
    const l = L();
    body.append(item('Bare carbon', seg(CARBON_LOOKS, l.parts.carbon, v => { l.parts.carbon = v; done(); }), 'Wings, floor, suspension: gloss or matte carbon, or painted the body / accent colour.'));
    for (const [id, label, note, opts] of PART_ZONES) {
      const z = l.zones[id], now = opts.find(([, , c]) => c === 'body' || c === 'accent' ? z?.ref === c : c === null ? !z : z?.c === c)?.[0];
      body.append(item(label, seg(opts.map(o => [o[0], o[1]]), now, v => {
        const c = opts.find(o => o[0] === v)[2];
        if (c === null) delete l.zones[id]; else if (c === 'body' || c === 'accent') l.zones[id] = { c: null, f: null, ref: c }; else l.zones[id] = { c, f: c === 0x101114 ? 'carbon' : null };
        done();
      }), note));
    }
    body.append(el('p', 'gar-head', 'Exhaust'));
    body.append(stack('Finish', seg(Object.entries(EXHAUSTS).map(([k, e]) => [k, e.label]), l.parts.exhaust, v => { l.parts.exhaust = v; done(); }), EXHAUSTS[l.parts.exhaust].name + (l.parts.exhaust === 'worn' ? ': as the real pipes look after a run (Inconel: straw, bronze and brown, a sooty lip).' : l.parts.exhaust === 'ti' ? ': the rainbow of a titanium road-car pipe; not what an F1 pipe does.' : '.')));
    const t = el('div', 'gar-chips');
    for (const [k, label] of [['foil', 'GOLD HEAT FOIL'], ['glow', 'GLOWS UNDER LOAD']]) { const b = button(label, () => { l.parts[k] = !l.parts[k]; done(); }, ''); b.setAttribute('aria-pressed', String(l.parts[k])); t.append(b); }
    body.append(t, el('p', 'note', 'Gold foil shields the bodywork round the pipe. Glows under load: the lip glows orange after a few seconds flat out and cools off the throttle. The rivals run race-worn pipes with foil.'));
  }

  // ---- LIGHTS (L2 / L3): the prefs, as in Settings → Graphics
  function lightsTab(body) {
    const p = ctx.prefs;
    body.append(item('Rear lights', seg([['real', 'REAL'], ['realBrake', 'REAL + BRAKING'], ['brake', 'BRAKE LIGHTS']], p.get('rearLights'), v => { p.set('rearLights', v); ctx.render(); }), ({
      real: 'As the real 2026 cars: no brake lights. The light on the crash structure and the two on the endplates flash while a car harvests energy (fast when it super clips at full throttle) and stay on with the pit limiter or when it is stopped off the road.',
      realBrake: 'As real, and on under hard braking too, so you can read the car ahead in a pack.',
      brake: 'Brake lights, like a road car: on with the brake pedal.' })[p.get('rearLights')]));
    body.append(item('Look', seg([['led', 'LED'], ['ledLight', 'LED + LIGHT']], p.get('lightLook'), v => { p.set('lightLook', v); ctx.render(); }),
      p.get('lightLook') === 'led' ? 'LED dots with a tight glow.' : 'LED dots, and the two nearest lit cars light their bodywork and the road behind (Quality mode).'));
    body.append(el('p', 'note', 'Every car in the race, yours too. Also in Settings → Graphics.'));
  }

  // ---- NUMBER & NAME
  function numberTab(body) {
    const l = L(), step = el('div', 'stepper'), out = el('output', '', String(l.number));
    const bump = d => { l.number = (l.number + d + 100) % 100; out.textContent = String(l.number); ctx.changed('look'); };
    step.append(button('−', () => bump(-1), ''), out, button('+', () => bump(1), ''));
    body.append(item('Race number', step));
    body.append(stack('Number colour', colours(l.numberLook.colour, c => { l.numberLook.colour = c; done(); }, [['AUTO', () => { l.numberLook.colour = null; done(); }, l.numberLook.colour === null]])));
    const where = el('div', 'gar-chips');
    for (const [k, label] of [['side', 'ON THE SIDES'], ['nose', 'ON THE NOSE']]) { const b = button(label, () => { l.numberLook[k] = !l.numberLook[k]; done(); }, ''); b.setAttribute('aria-pressed', String(l.numberLook[k])); where.append(b); }
    body.append(stack('Where', where));
    const t = el('input', 'gar-text'); Object.assign(t, { type: 'text', value: l.name, maxLength: 16, placeholder: 'Your name' }); t.setAttribute('aria-label', 'Name on the car');
    t.oninput = () => { l.name = t.value.replace(/[\u0000-\u001f]/g, '').slice(0, 16); ctx.repaint(); }; t.onchange = () => ctx.changed('look');
    body.append(stack('Name on the car', t, 'Under the cockpit on both sides, in the number\'s colour. AUTO = white or black, whichever shows on the body.'));
  }

  // ---- PRESETS
  function presetsTab(body) {
    const grid = el('div', 'gar-presets');
    for (const p of PRESETS) {
      const b = button('', () => { Object.assign(ctx.livery(), applyPreset(L(), p)); done(); }, 'gar-preset'), chips = el('span', 'chips');
      for (const c of [p.color, p.accent, ...p.layers.map(x => x.c)].slice(0, 4)) { const i = el('i'); i.style.background = hexOf(c); chips.append(i); }
      b.append(chips, el('b', '', p.name)); grid.append(b);
    }
    body.append(el('p', 'gar-head', 'Presets'), grid, el('p', 'note', 'A preset sets the colours, zones and layers; your number, name, rims and spray stay.'));
  }

  // ---- the pointer on the car (garage.js: a hit = { point, normal, role } in the car's frame, or null)
  function pointerDown(e, hitAt) {
    if (e.button !== 0) return null;
    const hit = hitAt(e); if (!hit) return null;
    const model = ctx.model()?.modelKey; if (!model) return null;
    const l = L(), zoneHere = h => zoneAt(model, h.point, MAT_OF_ROLE[h.role] ?? MAT.main);
    if (sub === 'zones') { const z = zoneHere(hit); if (z && ZONES.some(x => x[0] === z)) { zone = z; ctx.render(); } return { move() {}, up() {} }; }
    if (sub === 'layers') {
      const ly = layerOf(); if (!ly) return null;
      const place = h => {
        const panel = panelOf(h.normal); if (!panel) return;
        const view = panel === 'right' || panel === 'left' ? 'side' : panel;
        if (view !== ly.view) { ly.view = view; if (view === 'side' && ly.side !== 'both') ly.side = panel; }
        if (view === 'side' && ly.side !== 'both') ly.side = panel;
        [ly.x, ly.y] = planeOf(panel, h.point); ctx.repaint();
      };
      place(hit);
      return { move(ev) { const h = hitAt(ev); if (h) place(h); }, up() { done(); } };
    }
    if (sub !== 'spray') return null;
    const panel0 = panelOf(hit.normal);
    if (tool === 'fill') { const z = zoneHere(hit); if (z) { if (z === 'wheels') l.rims = brush.c; else l.zones[z] = { c: brush.c, f: l.zones[z]?.f ?? null }; done(); } return { move() {}, up() {} }; }
    if (tool === 'pick') {
      const z = zoneHere(hit), here = panel0 && ctx.model()?.colourAt?.(panel0, ...planeOf(panel0, hit.point));
      brush.c = here ?? (z ? zoneShown(z) : null) ?? (hit.role === 'paint_accent' ? l.accent : hit.role === 'carbon' ? 0x101114 : l.color); tool = 'spray'; ctx.render();
      return { move() {}, up() {} };
    }
    if (!panel0) return { move() {}, up() {} };
    const total = () => l.spray.reduce((a, s) => a + s.p.length, 0);
    const lock = brush.lock ? zoneIndex(zoneHere(hit) ?? '') + 1 : 0;
    const st = { k: tool === 'erase' ? 'e' : tool === 'tape' ? 'l' : 's', c: brush.c, r: brush.r, soft: brush.soft, flow: brush.flow, lock: Math.max(0, lock), m: brush.m, p: [] };
    const mm = (panel, pt) => planeOf(panel, pt).map(v => Math.round(v * 1000));
    const addPoint = h => {
      const panel = panelOf(h.normal); if (!panel || total() + 3 > MAX_SPRAY_POINTS) return;
      st.p.push(PANELS.indexOf(panel), ...mm(panel, h.point)); ctx.repaint();
    };
    redo = [];
    if (st.k === 'l') {
      const start = [PANELS.indexOf(panel0), ...mm(panel0, hit.point)];
      return { move() {}, up(ev) {
        const h = hitAt(ev); if (!h || panelOf(h.normal) !== panel0) return;
        st.p = [...start, PANELS.indexOf(panel0), ...mm(panel0, h.point)]; l.spray.push(st); done();
      } };
    }
    l.spray.push(st); addPoint(hit);
    return { move(ev) { const h = hitAt(ev); if (h) addPoint(h); }, up() { if (!st.p.length) l.spray.pop(); done(); } };
  }

  return {
    get sub() { return sub; },
    // the right-drag turns the car while a tool uses the left one
    get usesCar() { return sub === 'zones' || sub === 'layers' || sub === 'spray'; },
    render(body) {
      const chips = el('div', 'gar-chips gar-looktabs');
      for (const [id, label] of LOOK_TABS) { const b = button(label, () => { sub = id; ctx.render(); }, ''); b.setAttribute('aria-pressed', String(id === sub)); chips.append(b); }
      body.append(chips);
      ({ zones: zonesTab, layers: layersTab, spray: sprayTab, parts: partsTab, lights: lightsTab, number: numberTab, presets: presetsTab })[sub](body);
    },
    pointerDown,
    ZONE_IDS,
  };
}
