import * as engine from '../engine/engine.ts';
import './StartScreen.css';

export function StartScreen({ onStart, warn, openSettings, preview }: { onStart: () => void; warn: string; openSettings: () => void; preview: boolean }) {
  return (
    <div className="overlay start">
      <h1>Phone Wheel</h1>
      <p>Hold your phone sideways like a steering wheel and tilt to steer. Hold the pedals with your thumbs.
        Pedals, buttons, curves and layout can all be changed in Settings.</p>
      {preview
        ? <p className="preview-note">Desktop preview: the mouse across the window (or ← →) stands in for the phone's tilt.</p>
        : <p className="rotate">Turn your phone sideways first.</p>}
      {!engine.hasToken() && !preview && <p className="warn">Not paired yet: scan the QR code shown on the PC to connect this phone.</p>}
      <div className="row">
        <button className="primary big" onClick={onStart}>START DRIVING</button>
        <button className="big" onClick={openSettings}>Settings</button>
      </div>
      {warn && <div className="warn">{warn}</div>}
    </div>
  );
}
