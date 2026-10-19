// The Settings screen's wiring: what each setting reads and writes, its actions, and opening it over the start or
// pause menu (a running race pauses first; closing goes back to that menu). main.js passes the game state and the
// commands that change it (`act`: setGfx, setPref, setDriving, togglePause, toggleLayout).
import { PREFS, PHASE, RACE_SETUP } from './config.js';
import { Screens } from './screens.js';
import { Sound } from './sound.js';
import { AppShell } from './app-shell.js';
import { InputMonitor } from './input-monitor.js';
import { SettingsScreen } from './settings-screen.js';
import { SoundStudio } from './sound-studio.js';
import { TweakPanel } from './tweak-panel.js';
import { SOUND } from './audio/audio-config.js';

// race-setup choices (gearbox, assists, fuel, active aero...) live in game.setup; a.* = CUSTOM assists
const isDriving = key => Object.hasOwn(RACE_SETUP.choices, key) || key.startsWith('a.');

export function bindSettings(game, act) {
  SettingsScreen.bind({
    get(key) {
      if (key === 'noiseColour') return SOUND.noise.colour;
      return isDriving(key) ? (key.startsWith('a.') ? game.setup.custom[key.slice(2)] : game.setup[key]) : key === 'gfx' ? game.gfx
        : key === 'sound' ? !game.prefs.muted : game.prefs[key];
    },
    set(key, value) {
      if (key === 'noiseColour') SoundStudio.set('noise.colour', value);
      else if (isDriving(key)) act.setDriving(key, value);
      else if (key === 'gfx') act.setGfx(value, true);
      else if (key === 'sound') { Sound.init(); act.setPref('muted', !value); }
      else act.setPref(key, value);
    },
    note: key => key === 'gfx' ? game.gfxNote : undefined,
    action(name) {
      if (name === 'resetController') {
        for (const k of ['smoothing', 'calm', 'deadZone', 'range', 'curve', 'pedalDeadZone']) game.prefs[k] = PREFS.defaults[k];
        act.setPref('smoothing', PREFS.defaults.smoothing); SettingsScreen.redraw();
      } else if (name === 'inputs') InputMonitor.toggle(true);
      else if (name.startsWith('sound:')) Sound.test(name.slice(6));
      else if (name === 'studio') { SettingsScreen.close(); SoundStudio.toggle(true); }
      else if (name === 'fullscreen') AppShell.toggleFullscreen();
      else if (name === 'tweak') { SettingsScreen.close(); TweakPanel.toggle(); }
      else if (name === 'layout') { SettingsScreen.close(); act.toggleLayout(); }
    },
  });

  let back = null;                             // the menu it was opened from
  SettingsScreen.on('close', () => { if (back) Screens.show(back); back = null; });
  return {
    open(tab) {
      if (SettingsScreen.open) return;
      if (game.race && !game.paused && !game.resultsShown && game.phase !== PHASE.MENU) act.togglePause();
      back = Screens.current();
      Screens.show(null); SettingsScreen.show(tab);
    },
    toggle() { if (SettingsScreen.open) SettingsScreen.close(); else this.open(); },
  };
}
