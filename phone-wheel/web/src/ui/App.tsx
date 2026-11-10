// The page: the driving screen, with the start screen over it until START, and Settings over both when open.
import { useEffect, useState } from 'react';
import * as engine from '../engine/engine.ts';
import { isPreview, startPreview } from '../engine/preview.ts';
import { CAR_KINDS, clone, forCar, loadStore, sanitize, saveStore, setCarLayout, type CarKind, type Config, type Store } from '../settings/settings.ts';
import { enterFullscreen, keepAwake, setHaptics } from './screen.ts';
import { StartScreen } from './StartScreen.tsx';
import { Drive, mirrorPairs, slotsOf } from './Drive.tsx';
import { clusterGroups, LayoutEditor, measureLayout, type Draft } from './LayoutEditor.tsx';
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
  const [draft, setDraft] = useState<Draft | null>(null);   // Layout → Move and resize: the boxes (and groups) being edited
  // the car the game says you drive (engine.dash.c, remembered): the race wheel as that car has it (settings.ts forCar)
  const [car, setCar] = useState<CarKind>(() => engine.getCar());
  useEffect(() => engine.onCar(setCar), []);
  const profile = store.profiles[store.active], cfg = forCar(profile, car);

  engine.setConfig(cfg);                     // cheap, and keeps the engine in step on every render
  setHaptics(cfg.layout.haptics);
  useEffect(() => saveStore(store), [store]);
  const editing = draft !== null;
  useEffect(() => { engine.state.paused = settingsOpen || editing; if (settingsOpen || editing) engine.stopFeedback(); }, [settingsOpen, editing]);

  const update: Update = (fn) => setStore((s) => { const next = clone(s); fn(next.profiles[next.active]); return next; });
  // a layout made in the game's phone designer: on the active profile, for the car it was made for (checked like a saved one)
  useEffect(() => engine.onLayoutFromGame((l) => update((c) => {
    const L = sanitize({ ...c, layout: { ...c.layout, free: l.free, groups: l.groups, labels: l.labels ?? c.layout.labels } }).layout;
    const kind = CAR_KINDS.includes(l.car as CarKind) ? l.car as CarKind : 'hybrid';
    setCarLayout(c, kind, L.free, L.groups); c.layout.labels = L.labels;
  })), []);

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
      <Drive cfg={cfg} car={car} openSettings={() => setSettingsOpen(true)} preview={preview} free={editing ? draft.boxes : undefined} />
      {editing && <LayoutEditor slots={slotsOf(cfg, () => {}, preview, car)} pairs={mirrorPairs(cfg)} draft={draft} setDraft={setDraft} cancel={() => setDraft(null)}
        done={() => { const d = draft; update((c) => setCarLayout(c, car, d.boxes, d.groups)); setDraft(null); }}
        standard={() => { update((c) => setCarLayout(c, car, null, {})); setDraft(null); }} />}
      {started && !settingsOpen && !editing && !preview && <RotateHint />}
      {!started && <StartScreen onStart={start} warn={warn} openSettings={() => setSettingsOpen(true)} preview={preview} />}
      {started && !settingsOpen && !editing && <AwayScreen />}
      {settingsOpen && <Settings store={store} setStore={setStore} cfg={cfg} car={car} update={update} close={() => setSettingsOpen(false)}
        editLayout={() => { setDraft({ boxes: measureLayout(), groups: cfg.layout.free ? cfg.layout.groups : clusterGroups(cfg) }); setSettingsOpen(false); }} />}
    </>
  );
}
