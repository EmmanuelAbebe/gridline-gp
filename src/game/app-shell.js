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
  for (const b of document.querySelectorAll('[data-quit]')) { b.hidden = !app; b.onclick = () => app.quit(); }
  return {
    isApp: !!app,
    toggleFullscreen() {
      if (app) { app.toggleFullscreen().then(label); return; }
      if (!supported) return;
      const req = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      req.catch(() => Hud.toast('Full screen was blocked by the browser'));
    },
  };
})();
