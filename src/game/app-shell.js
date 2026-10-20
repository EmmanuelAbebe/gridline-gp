import { Hud } from './hud.js';
import { $ } from './util.js';

// Full screen and quit. In the desktop app (desktop/main.js exposes window.gridlineApp) full screen switches the
// app window between full screen and a maximised frameless window, and the quit buttons close the app.
// In a browser it uses the Fullscreen API and the quit buttons stay hidden.
export const AppShell = (() => {
  const app = window.gridlineApp || null;
  const supported = !!app || !!document.fullscreenEnabled;
  const label = on => {
    $('fullBtn').textContent = on ? (app ? 'WINDOW' : 'EXIT FULL') : 'FULL SCREEN';
    $('fullStartBtn').textContent = on ? (app ? 'Window mode' : 'Exit full screen') : 'Full screen';
  };
  if (app) { app.onFullscreen(label); app.isFullscreen().then(label); }
  else document.addEventListener('fullscreenchange', () => label(!!document.fullscreenElement));
  if (!supported) $('fullBtn').hidden = $('fullStartBtn').hidden = true;
  // Quit asks first (the Quit buttons, and Alt+F4 / closing the window: the app asks the page, desktop/main.cjs)
  const ask = $('quitOv'), listeners = [];
  let lastFocus = null;
  function askQuit() {
    if (!app || !ask.hidden) return;
    lastFocus = document.activeElement; ask.hidden = false; $('quitStayBtn').focus();
    listeners.forEach(fn => fn());
  }
  function cancelQuit() { if (ask.hidden) return; ask.hidden = true; lastFocus?.focus?.(); }
  $('quitStayBtn').onclick = cancelQuit;
  $('quitYesBtn').onclick = () => app.quit();
  ask.addEventListener('click', e => { if (e.target === ask) cancelQuit(); });      // a click beside the card = stay
  for (const b of document.querySelectorAll('[data-quit]')) { b.hidden = !app; b.onclick = askQuit; }
  app?.onAskQuit?.(askQuit);
  return {
    isApp: !!app,
    get quitOpen() { return !ask.hidden; },
    askQuit, cancelQuit,
    onAskQuit(fn) { listeners.push(fn); },        // (main.js pauses a running race)
    toggleFullscreen() {
      if (app) { app.toggleFullscreen().then(label); return; }
      if (!supported) return;
      const req = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      req.catch(() => Hud.toast('Full screen was blocked by the browser'));
    },
  };
})();
