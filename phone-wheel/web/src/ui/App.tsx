// The page: the driving screen, with the start screen over it until START, and Settings over both when open.
import { useEffect, useState } from 'react';
import * as engine from '../engine/engine.ts';
import { isPreview, startPreview } from '../engine/preview.ts';
import { clone, loadStore, saveStore, type Config, type Store } from '../settings/settings.ts';
import { enterFullscreen, keepAwake, setHaptics } from './screen.ts';
import { StartScreen } from './StartScreen.tsx';
import { Drive } from './Drive.tsx';
import { RotateHint } from './RotateHint.tsx';
import { AwayScreen } from './AwayScreen.tsx';
import { Settings } from './settings/Settings.tsx';

// edits the active profile: update(c => { c.steer.smoothing = 30 })
export type Update = (fn: (c: Config) => void) => void;
const preview = isPreview();

export function App() {
  const [store, setStore] = useState<Store>(() => loadStore());
  const [started, setStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warn, setWarn] = useState('');
  const cfg = store.profiles[store.active];

  engine.setConfig(cfg);                     // cheap, and keeps the engine in step on every render
  setHaptics(cfg.layout.haptics);
  useEffect(() => saveStore(store), [store]);
  useEffect(() => { engine.state.paused = settingsOpen; if (settingsOpen) engine.stopFeedback(); }, [settingsOpen]);

  const update: Update = (fn) => setStore((s) => { const next = clone(s); fn(next.profiles[next.active]); return next; });

  async function start() {
    if (!window.isSecureContext) {
      setWarn("Open the exact link the PC shows (https:// over Wi-Fi or Bluetooth, http://localhost over USB), otherwise the phone won't share tilt data.");
      return;
    }
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DME?.requestPermission === 'function') { try { await DME.requestPermission(); } catch { /* iOS: refused */ } }
    if (!preview) await enterFullscreen();
    keepAwake();
    if (preview) startPreview();
    engine.start();
    setWarn(''); setStarted(true);
    setTimeout(() => {
      if (!engine.state.gotMotion) {
        setStarted(false);
        setWarn('No tilt data from the phone\'s sensors. Check that motion sensors are allowed for Chrome (Settings → Site settings → Motion sensors).');
      }
    }, 1500);
  }

  return (
    <>
      <Drive cfg={cfg} openSettings={() => setSettingsOpen(true)} preview={preview} />
      {started && !settingsOpen && !preview && <RotateHint />}
      {!started && <StartScreen onStart={start} warn={warn} openSettings={() => setSettingsOpen(true)} preview={preview} />}
      {started && !settingsOpen && <AwayScreen />}
      {settingsOpen && <Settings store={store} setStore={setStore} cfg={cfg} update={update} close={() => setSettingsOpen(false)} />}
    </>
  );
}
