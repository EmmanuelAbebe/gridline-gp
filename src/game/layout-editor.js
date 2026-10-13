import { Design } from './design.js';
import { HudStyle } from './hud-style.js';
import { $, createEmitter } from './util.js';

// Layout mode: drag panels to move, mouse wheel (or −/+) to resize, per panel hide/reset.
// Positions are stored relative to the nearest edge or centre, so they survive window resizes.
export const LayoutEditor = (() => {
  const bar = $('layBar'), events = createEmitter();
  let active = false, selected = null, scope = 'all', camId = 'chase', camLabel = '', drag = null;
  const scopeKey = () => scope === 'all' ? 'all' : camId;

  function fromRect(r) {
    const W = innerWidth, H = innerHeight, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const h = cx < W / 3 ? 'l' : cx > W * 2 / 3 ? 'r' : 'c', v = cy < H / 3 ? 't' : cy > H * 2 / 3 ? 'b' : 'c';
    return { anchor: v + h,
      x: Math.round(h === 'l' ? r.left : h === 'r' ? W - r.right : cx - W / 2),
      y: Math.round(v === 't' ? r.top : v === 'b' ? H - r.bottom : cy - H / 2) };
  }
  // The entry being edited for a panel, created on first edit from where the panel is right now.
  function entryFor(id) {
    const L = Design.data.hud.layouts, key = scopeKey();
    L[key] ||= {};
    if (!L[key][id]) { const cur = HudStyle.layoutFor(camId)[id]; L[key][id] = { ...fromRect($(id).getBoundingClientRect()), scale: cur ? cur.scale : 1, hidden: cur ? cur.hidden : false }; }
    return L[key][id];
  }
  const commit = () => { Design.changed('hud'); refreshBar(); };

  function select(id) {
    selected = id;
    for (const pid in HudStyle.PANELS) $(pid).classList.toggle('sel', pid === id);
    refreshBar();
  }
  function scaleBy(f) { if (!selected) return; const e = entryFor(selected); e.scale = Math.round(Math.min(3, Math.max(0.4, e.scale * f)) * 100) / 100; commit(); }

  for (const id in HudStyle.PANELS) {
    const el = $(id);
    el.addEventListener('pointerdown', e => {
      if (!active) return;
      e.preventDefault(); e.stopPropagation(); select(id);
      drag = { id, sx: e.clientX, sy: e.clientY, r: el.getBoundingClientRect() };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}   // keeps the drag when the pointer leaves the panel
    });
    el.addEventListener('pointermove', e => {
      if (!drag || drag.id !== id) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, r = drag.r;
      Object.assign(entryFor(id), fromRect({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy, width: r.width, height: r.height }));
      commit();
    });
    const end = () => { drag = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => { if (!active) return; e.preventDefault(); select(id); scaleBy(e.deltaY < 0 ? 1.06 : 1 / 1.06); }, { passive: false });
  }

  // toolbar
  const scopeSel = document.createElement('select');
  scopeSel.addEventListener('change', () => { scope = scopeSel.value; refreshBar(); });
  const selName = document.createElement('span'); selName.className = 'tw-note';
  const button = (label, fn, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'iconbtn'; b.textContent = label; if (title) b.title = title; b.onclick = fn; return b; };
  const hideBtn = button('HIDE', () => { if (!selected) return; const e = entryFor(selected); e.hidden = !e.hidden; commit(); });
  const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = 'HUD layout';
  bar.append(lbl, scopeSel, selName,
    button('−', () => scaleBy(1 / 1.1), 'Smaller'), button('+', () => scaleBy(1.1), 'Bigger'), hideBtn,
    button('RESET PANEL', () => { const L = Design.data.hud.layouts[scopeKey()]; if (selected && L) { delete L[selected]; commit(); } }),
    button('RESET LAYOUT', () => { if (scope === 'all') Design.data.hud.layouts.all = {}; else delete Design.data.hud.layouts[camId]; commit(); }),
    button('DONE', () => exit()));

  function refreshBar() {
    scopeSel.innerHTML = `<option value="all">All views</option><option value="view">${camLabel} view only</option>`;
    scopeSel.value = scope;
    const cur = selected && HudStyle.layoutFor(camId)[selected];
    selName.textContent = selected ? `${HudStyle.PANELS[selected]}${cur ? ' · ' + Math.round(cur.scale * 100) + '%' : ''}` : 'Drag a panel · scroll to resize';
    hideBtn.textContent = cur && cur.hidden ? 'SHOW' : 'HIDE';
  }
  function enter(cam) {
    active = true; camId = cam.id; camLabel = cam.label;
    scope = Design.data.hud.layouts[camId] ? 'view' : 'all';
    document.body.classList.add('layout-mode');
    for (const id in HudStyle.PANELS) $(id).classList.add('lay-target');
    if (!$('msg').textContent) $('msg').textContent = 'GO';                        // sample text so empty panels can be grabbed
    if (!$('toast').textContent) $('toast').textContent = 'Lap 1  1:23.456';
    bar.hidden = false; refreshBar();
  }
  function exit() {
    active = false; drag = null; select(null);
    document.body.classList.remove('layout-mode');
    for (const id in HudStyle.PANELS) $(id).classList.remove('lay-target');
    bar.hidden = true; events.emit('exit');
  }
  return {
    get active() { return active; }, enter, exit, on: events.on,
    setCamera(cam) { camId = cam.id; camLabel = cam.label; if (active) { if (scope === 'view' && !Design.data.hud.layouts[camId]) scope = 'all'; refreshBar(); } },
  };
})();
