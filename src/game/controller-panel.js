// Settings → Controller, top: the devices. The phone wheel card (connect over Wi-Fi / Bluetooth / USB, QR code to pair,
// live link quality; desktop app only) and the list of every other controller the game sees (Xbox / PlayStation
// pads, wheels, joysticks...), with which one drives (prefs.controller: AUTO or a device). Built by the settings
// screen through its `panel` item; `bind` is the settings binding (get / set prefs), tick() runs every frame.
import { PhoneWheel } from './phone-wheel.js';
import { Controllers, KINDS } from './controllers.js';

const LINKS = [['wifi', 'WI-FI'], ['bluetooth', 'BLUETOOTH'], ['usb', 'USB']];
const LINK_STEPS = {
  wifi: 'Phone on the same Wi-Fi as this PC.',
  bluetooth: 'Pair the phone with this PC once, then turn on Bluetooth tethering on the phone (Samsung: Settings → Connections → Mobile Hotspot and Tethering). No router in between: the steadiest link.',
  usb: 'USB cable, USB debugging on (Developer options), and adb installed on this PC.',
};

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function button(label, onclick, cls = 'btn ghost small') { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; }
function seg(options, current, onpick) {
  const s = el('div', 'seg');
  for (const [v, text] of options) { const b = button(text, () => onpick(v), ''); b.setAttribute('aria-pressed', String(v === current)); s.append(b); }
  return s;
}

export function createControllerPanel(bind) {
  const root = el('div', 'dev-panel'), phoneCard = el('div', 'dev-card'), listCard = el('div', 'dev-card');
  root.append(phoneCard, listCard);
  let busy = false, listSig = '';

  // ---- phone wheel ----
  function drawPhone() {
    const s = PhoneWheel.status, link = bind.get('phoneLink');
    phoneCard.replaceChildren();
    const head = el('div', 'row');
    head.append(el('span', 'lbl', 'Phone wheel'), el('span', 'dev-state' + (s.phones ? ' on' : ''), phoneState(s)));
    phoneCard.append(head);
    if (!PhoneWheel.available) {
      phoneCard.append(el('p', 'note', 'Connecting the phone runs in the desktop app (Gridline GP). In a browser, run phone-wheel/server.py: the phone then shows up below as a controller.'));
      return;
    }
    const linkRow = el('div', 'row');
    linkRow.append(el('span', 'lbl dim', 'Link'), seg(LINKS, link, v => {
      bind.set('phoneLink', v); drawPhone();
      if (PhoneWheel.status.running) start();           // switch the running link over
    }));
    phoneCard.append(linkRow, el('p', 'note', LINK_STEPS[link]));
    const btns = el('div', 'btns');
    if (!s.running) btns.append(button(busy ? 'Starting…' : 'Connect phone', () => start(), 'btn small'));
    else {
      btns.append(button('Stop', async () => { busy = true; await PhoneWheel.stop(); busy = false; drawPhone(); }));
      btns.append(button('New pairing code', () => start(true)));
    }
    const auto = el('div', 'row');
    auto.append(el('span', 'lbl dim', 'Start with the game'), seg([[true, 'ON'], [false, 'OFF']], bind.get('phoneAuto'), v => { bind.set('phoneAuto', v); drawPhone(); }));
    phoneCard.append(btns);
    if (s.error) phoneCard.append(el('p', 'note warn', s.error));
    if (s.running && !s.phones) {
      const pair = el('div', 'dev-pair'), qr = el('div', 'dev-qr'), steps = el('div', 'dev-steps');
      qr.innerHTML = s.qr;                               // SVG made by the app (desktop/phone-link.cjs) from its own URL
      steps.append(el('p', 'note', '1. Scan the code with the phone camera, or open:'), el('code', 'dev-url', s.url),
        el('p', 'note', s.link === 'usb' ? '2. Chrome opens it as a secure page: no warning.'
          : '2. The phone warns about the certificate (made by this PC for itself): tap Advanced → Proceed.'),
        el('p', 'note', '3. Hold the phone like a wheel and press gas once.'));
      if (s.note) steps.append(el('p', 'note warn', s.note));
      pair.append(qr, steps);
      phoneCard.append(pair);
    } else if (s.note) phoneCard.append(el('p', 'note warn', s.note));
    phoneCard.append(auto);
  }
  function phoneState(s) {
    if (!PhoneWheel.available) return 'DESKTOP APP ONLY';
    if (s.phones) return ['CONNECTED', s.hz ? `${s.hz} Hz` : '', typeof s.rtt === 'number' ? `${Math.round(s.rtt)} ms` : ''].filter(Boolean).join(' · ');
    return s.running ? 'WAITING FOR THE PHONE' : 'OFF';
  }
  async function start(renewCode = false) {
    busy = true; drawPhone();
    await PhoneWheel.start({ link: bind.get('phoneLink'), renewCode });
    busy = false; drawPhone();
  }
  let lastPhone = '';
  PhoneWheel.on('status', s => {
    // redraw on anything but the live numbers (those only change the state label)
    const sig = [s.running, s.phones > 0, s.url, s.note, s.error, s.link].join('|');
    if (sig !== lastPhone) { lastPhone = sig; if (root.isConnected) drawPhone(); }
    else phoneCard.querySelector('.dev-state')?.replaceChildren(phoneState(s));
  });

  // ---- every controller ----
  function drawList(list, active) {
    listCard.replaceChildren();
    const want = bind.get('controller');
    const head = el('div', 'row');
    head.append(el('span', 'lbl', 'Controllers'), seg([['auto', 'AUTO']], want === 'auto' ? 'auto' : '', () => { bind.set('controller', 'auto'); listSig = ''; }));
    listCard.append(head);
    if (!list.length) {
      listCard.append(el('p', 'note', 'None seen yet. Plug in or pair a controller (Xbox, PlayStation, wheel, joystick...) and press a button on it: browsers only report a controller once it has been used.'));
      return;
    }
    for (const d of list) {
      const row = el('div', 'dev-row' + (d.key === active ? ' active' : ''));
      const info = el('div');
      info.append(el('b', '', d.label), el('span', 'note', ` ${KINDS[d.kind].label}${d.mapping === 'standard' || d.kind === 'phone' ? '' : ' · raw layout'}`));
      info.append(el('p', 'note', KINDS[d.kind].note));
      row.append(info, d.key === active ? el('span', 'dev-state on', 'IN USE') : button('Use', () => { bind.set('controller', d.key); listSig = ''; }));
      listCard.append(row);
    }
    if (want !== 'auto' && !list.some(d => d.key === want)) listCard.append(el('p', 'note', 'The controller you picked isn\'t connected: using the first one available.'));
  }

  drawPhone();
  return {
    el: root,
    tick(pad) {
      const list = Controllers.list(), active = pad.connected ? pad.key : '';
      const sig = list.map(d => d.key).join('|') + '#' + active + '#' + bind.get('controller');
      if (sig !== listSig) { listSig = sig; drawList(list, active); }
    },
  };
}
