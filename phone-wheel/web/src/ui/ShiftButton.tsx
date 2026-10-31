// UPSHIFT / DOWNSHIFT: tall keys beside the pedals, built like them (a face on a base). A press taps the bound
// controller button once (engine.tap: held long enough for the game to see it), so quick double taps are two shifts.
import { useRef } from 'react';
import * as engine from '../engine/engine.ts';
import type { ButtonId } from '../settings/settings.ts';
import { buzz } from './screen.ts';
import './ShiftButton.css';

// labels: UP / DOWN under the arrow (Layout → Labels on the shift keys)
export function ShiftButton({ side, dir, bind, labels = true }: { side: 'left' | 'right'; dir: 'up' | 'down'; bind: ButtonId; labels?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const press = (e: React.PointerEvent) => {
    engine.tap(bind); buzz(20);
    el.current?.setPointerCapture(e.pointerId);
    el.current?.classList.add('pressed');
  };
  const lift = () => el.current?.classList.remove('pressed');
  return (
    <div aria-label={dir === 'up' ? 'Shift up' : 'Shift down'} className={`shift ${side} ${dir}`} ref={el} onPointerDown={press} onPointerUp={lift} onPointerCancel={lift}>
      <div className="face"><span className="arrow">{dir === 'up' ? '▲' : '▼'}</span>{labels && <span className="word">{dir === 'up' ? 'UP' : 'DOWN'}</span>}</div>
    </div>
  );
}
