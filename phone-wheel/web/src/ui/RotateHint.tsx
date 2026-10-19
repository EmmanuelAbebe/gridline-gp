// While driving with the phone upright (full screen and the landscape lock are lost when you switch apps): a prompt
// to turn it sideways, and a button that goes full screen and locks it there again.
import { usePortrait } from './hooks.ts';
import { enterFullscreen } from './screen.ts';
import './StartScreen.css';

export function RotateHint() {
  const portrait = usePortrait();
  if (!portrait) return null;
  return (
    <div className="overlay rotate-hint">
      <h1>Turn the phone sideways</h1>
      <p>The wheel works in landscape. The page can lock it sideways in full screen.</p>
      <button className="primary big" onClick={() => enterFullscreen()}>FULL SCREEN, SIDEWAYS</button>
    </div>
  );
}
