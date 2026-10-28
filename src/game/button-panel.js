// Settings → Buttons: what each button on the controller in use does (button-map.js; one layout per device). SET on a
// row, then press the button on the controller: it takes that action (and leaves any other). Pressing any button shows
// what it does now, and the chips of held buttons light up, so a phone's labelled buttons (DRS, PIT, M, OT ...: on the
// phone each one sends a standard button) are easy to find. Built by the settings screen through its `panel` item;
// `bind` = the settings binding (get / set 'buttonMaps'), tick() runs every frame while the tab is shown.
import { Input } from './input.js';
import { ACTIONS, PEDALS, buttonName, mapFor, isCustom, bindButton, unbindButton, resetDevice, actionOf } from './button-map.js';

const CAPTURE_TIME = 8000;   // ms to press a button after SET
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function button(label, onclick, cls = 'btn ghost small') { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; }
const labelOf = a => ACTIONS.find(x => x[0] === a)?.[1] ?? '';

export function createButtonPanel(bind) {
  const root = el('div', 'dev-panel'), card = el('div', 'dev-card bm');
  root.append(card);
  let deviceKey = '', capturing = null, timer = 0, live = null, chips = [], seen = 0;   // seen: the last tick (shown)

  function stopCapture() { capturing = null; clearTimeout(timer); Input.capture(null); }
  function startCapture(action) {
    capturing = action;
    Input.capture((i, dev) => {
      clearTimeout(timer); capturing = null;
      if (!root.isConnected || performance.now() - seen > 300) return;   // (the tab or the screen was left meanwhile)
      bind.set('buttonMaps', bindButton(bind.get('buttonMaps'), dev.key, action, i));
      draw();
    });
    clearTimeout(timer); timer = setTimeout(() => { stopCapture(); draw(); }, CAPTURE_TIME);
    draw();
  }

  function draw() {
    const dev = Input.device, store = bind.get('buttonMaps');
    card.replaceChildren(); chips = [];
    deviceKey = dev?.key ?? '';
    const head = el('div', 'row');
    head.append(el('span', 'lbl', dev ? `Buttons · ${dev.label}` : 'Buttons'),
      el('span', 'dev-state' + (dev && isCustom(store, dev.key) ? ' on' : ''), !dev ? 'NO CONTROLLER' : isCustom(store, dev.key) ? 'YOUR LAYOUT' : 'DEFAULT'));
    card.append(head);
    if (!dev) {
      card.append(el('p', 'note', 'Connect a controller or the phone wheel (Settings → Controller), then set what its buttons do here.'));
      return;
    }
    card.append(el('p', 'note', 'Press SET, then the button on the controller. Each controller keeps its own layout. On the phone wheel every on-screen button (DRS, PIT, M, OT ...) sends one of the controller buttons (the phone\'s Settings → Buttons): give each its own and set it here.'));
    live = el('p', 'note bm-live', 'Press any button to see what it does.');
    card.append(live);
    const map = mapFor(store, dev.key);
    for (const [action, label, note] of ACTIONS) {
      const row = el('div', 'dev-row bm-row' + (capturing === action ? ' active' : ''));
      const info = el('div');
      info.append(el('b', '', label));
      if (note) info.append(el('p', 'note', note));
      const side = el('div', 'bm-keys');
      if (capturing === action) {
        side.append(el('span', 'dev-state on', 'PRESS A BUTTON…'), button('Cancel', () => { stopCapture(); draw(); }));
      } else {
        for (const i of map[action]) {
          const c = el('span', 'bm-chip');
          c.dataset.i = String(i);
          c.append(el('span', '', buttonName(i)), button('×', () => { bind.set('buttonMaps', unbindButton(bind.get('buttonMaps'), dev.key, action, i)); draw(); }, 'bm-x'));
          c.lastElementChild.setAttribute('aria-label', `Remove ${buttonName(i)} from ${label}`);
          side.append(c); chips.push(c);
        }
        if (!map[action].length) side.append(el('span', 'note', 'none'));
        side.append(button('Set', () => startCapture(action)));
      }
      row.append(info, side);
      card.append(row);
    }
    const btns = el('div', 'btns');
    btns.append(button('Reset to default', () => { stopCapture(); bind.set('buttonMaps', resetDevice(bind.get('buttonMaps'), dev.key)); draw(); }));
    card.append(btns, el('p', 'note', 'Always: the triggers are gas and brake, A confirms and B goes back in menus (as well as what you set here). The D-pad is a backup for the pedals and steering unless you give its buttons an action. Keyboard: Settings → Keys.'));
  }

  draw();
  return {
    el: root,
    tick() {
      seen = performance.now();
      const dev = Input.device;
      if ((dev?.key ?? '') !== deviceKey) { stopCapture(); draw(); return; }
      if (!dev) return;
      const map = mapFor(bind.get('buttonMaps'), dev.key), down = [];
      dev.buttons.forEach((b, i) => { if (!PEDALS.includes(i) && (b.pressed || b.value > 0.5)) down.push(i); });
      for (const c of chips) c.classList.toggle('down', down.includes(+c.dataset.i));
      if (live && down.length) {
        const text = down.map(i => `${buttonName(i)}: ${actionOf(map, i) ? labelOf(actionOf(map, i)) : i === 0 ? 'confirm in menus' : i === 1 ? 'back in menus' : 'nothing yet'}`).join(' · ');
        if (live.textContent !== text) live.textContent = text;
      }
    },
  };
}
