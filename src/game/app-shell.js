import { Hud } from './hud.js';
import { $ } from './util.js';
import { VERSION, stageLabel } from './version.js';

// Full screen and quit (the quit button: only on the paddock, the start menu's home). In the desktop app (desktop/main.js
// exposes window.gridlineApp) full screen switches the app window between full screen and a maximised frameless window,
// and the quit button closes the app.
// In a browser it uses the Fullscreen API and the quit buttons stay hidden.
export const AppShell = (() => {
  const app = window.gridlineApp || null;
  const supported = !!app || !!document.fullscreenEnabled;
  // full screen is chosen in Settings → Graphics (Display) or with V; nothing else shows a button for it (2026-11-01)
  let full = false;
  const fullListeners = [];
  const label = on => { full = !!on; fullListeners.forEach(fn => fn(full)); };
  if (app) { app.onFullscreen(label); app.isFullscreen().then(label); }
  else document.addEventListener('fullscreenchange', () => label(!!document.fullscreenElement));
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
  $('versionTag').textContent = stageLabel(VERSION); $('versionTag').title = 'Version ' + VERSION;
  // a newer release on GitHub (desktop app only, desktop/update-check.cjs): a bar on the start menu, DOWNLOAD opens
  // its page; ✕ hides it until the next start
  function checkUpdate() {
    app?.checkUpdate?.().then(r => {
      if (!r) return;
      $('updateText').textContent = `Gridline GP ${r.version} is out (you have ${VERSION})`;
      $('updateBtn').onclick = () => app.openRelease(r.url);
      $('updateHide').onclick = () => { $('updateBar').hidden = true; };
      $('updateBar').hidden = false;
    }).catch(() => {});
  }
  return {
    isApp: !!app,
    fullSupported: supported,
    get full() { return full; },
    onFullscreen(fn) { fullListeners.push(fn); },   // fn(on) whenever the window goes in or out of full screen
    get quitOpen() { return !ask.hidden; },
    askQuit, cancelQuit, checkUpdate,
    onAskQuit(fn) { listeners.push(fn); },        // (main.js pauses a running race)
    toggleFullscreen() {
      if (app) { app.toggleFullscreen().then(label); return; }
      if (!supported) return;
      const req = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      req.catch(() => Hud.toast('Full screen was blocked by the browser'));
    },
  };
})();
