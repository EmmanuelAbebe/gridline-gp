// Design the phone wheel's layout in the game (2026-10-31; user: "use an interface in the game itself to design the
// phone-wheel (edit mode only)"). Settings → Controller → Design the layout here: the game asks the connected phone for
// its active profile and screen size (PhoneWheel.askLayout), shows the phone page itself in `?designer` mode
// (phone-wheel/web: ui/Designer.tsx, the same layout editor as on the phone) in a frame at the phone's screen size,
// scaled to fit, and sends what you make back to the phone (PhoneWheel.setLayout), which puts it on that profile.
// Nothing drives meanwhile: it is opened from the settings, which pause a race.
import { $ } from './util.js';
import { PhoneWheel } from './phone-wheel.js';

const PAGE = '../phone-wheel/web/dist/index.html?designer';   // (beside dist/ in the repo and in the app)
const FALLBACK = { w: 844, h: 390 };                            // a phone's landscape screen in CSS px, if it doesn't say

export const PhoneDesigner = (() => {
  let shown = false, frame = null, scr = FALLBACK, cfg = null;
  const note = t => { $('phoneDesignNote').textContent = t; };
  function fit() {
    if (!shown) return;
    const stage = $('phoneDesignStage'), k = Math.min(1.6, (innerWidth - 64) / scr.w, (innerHeight - 150) / scr.h);
    stage.style.width = `${scr.w * k}px`; stage.style.height = `${scr.h * k}px`;
    Object.assign(frame.style, { width: `${scr.w}px`, height: `${scr.h}px`, transform: `scale(${k})` });
  }
  // the frame's messages: ready → it gets the profile; done → the layout goes to the phone; cancel
  function onMessage(e) {
    if (!frame || e.source !== frame.contentWindow || !e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'gridline-design-ready' && cfg) frame.contentWindow.postMessage({ type: 'gridline-design', cfg }, '*');
    else if (e.data.type === 'gridline-design-done') {
      const l = e.data.layout;
      if (l && typeof l === 'object') { PhoneWheel.setLayout({ free: l.free ?? null, groups: l.groups ?? {}, labels: l.labels }); close(); return; }
    } else if (e.data.type === 'gridline-design-cancel') close();
  }
  async function open() {
    if (shown) return;
    shown = true;
    $('phoneDesignOv').hidden = false;
    $('phoneDesignClose').hidden = true;
    note('Asking the phone for its layout…');
    const got = await PhoneWheel.askLayout();
    if (!shown) return;
    if (!got) {
      note('No answer from the phone: connect it (above) and press START DRIVING on it, then try again.');
      $('phoneDesignClose').hidden = false;
      return;
    }
    cfg = got.cfg; scr = got.scr || FALLBACK;
    note(`Your phone's layout (${scr.w} × ${scr.h}). DONE sends it to the phone; STD = back to the race wheel.`);
    frame = document.createElement('iframe');
    frame.title = 'Phone wheel layout editor';
    frame.src = new URL(PAGE, location.href).href;
    $('phoneDesignStage').replaceChildren(frame);
    fit();
  }
  function close() {
    if (!shown) return;
    shown = false; cfg = null;
    $('phoneDesignOv').hidden = true;
    $('phoneDesignStage').replaceChildren();
    frame = null;
  }
  globalThis.addEventListener?.('message', onMessage);
  globalThis.addEventListener?.('resize', fit);
  globalThis.document?.getElementById('phoneDesignClose')?.addEventListener('click', close);
  return { open, close, get isOpen() { return shown; } };
})();
