import * as engine from '../engine/engine.ts';
import { isApp } from '../engine/native.ts';
import { currentPc } from '../engine/pairing.ts';
import { usePcs } from './hooks.ts';
import './StartScreen.css';

export function StartScreen({ onStart, warn, openSettings, openPcs, preview }: { onStart: () => void; warn: string; openSettings: () => void; openPcs: () => void; preview: boolean }) {
  usePcs();
  const app = isApp(), pc = app ? currentPc() : null;
  return (
    <div className="overlay start">
      <h1>Phone Wheel</h1>
      <p>Hold your phone sideways like a steering wheel and tilt to steer. Hold the pedals with your thumbs.
        Pedals, buttons, curves and layout can all be changed in Settings.</p>
      {preview
        ? <p className="preview-note">Desktop preview: the mouse across the window (or ← →) stands in for the phone's tilt.</p>
        : !app && <p className="rotate">Turn your phone sideways first.</p>}
      {!app && !engine.hasToken() && !preview && <p className="warn">Not paired yet: scan the QR code shown on the PC to connect this phone.</p>}
      {app && <div className="pc-line">{pc ? <>PC: <b>{pc.name}</b> {pc.host}</> : 'No PC picked yet.'}
        <button onClick={openPcs}>{pc ? 'Change' : 'Pick your PC'}</button></div>}
      <div className="row">
        <button className="primary big" onClick={onStart}>START DRIVING</button>
        <button className="big" onClick={openSettings}>Settings</button>
      </div>
      {warn && <div className="warn">{warn}</div>}
    </div>
  );
}
