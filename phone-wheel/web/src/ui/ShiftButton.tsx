// UPSHIFT / DOWNSHIFT: tall keys beside the pedals, built like them (a face on a base). A press taps the bound
// controller button once (engine.tap: held long enough for the game to see it), so quick double taps are two shifts.
import { useRef } from 'react';
import * as engine from '../engine/engine.ts';
import type { ButtonId } from '../settings/settings.ts';
import { buzz } from './screen.ts';
import './ShiftButton.css';

export function ShiftButton({ side, dir, bind }: { side: 'left' | 'right'; dir: 'up' | 'down'; bind: ButtonId }) {
  const el = useRef<HTMLDivElement>(null);
  const press = (e: React.PointerEvent) => {
    engine.tap(bind); buzz(20);
    el.current?.setPointerCapture(e.pointerId);
    el.current?.classList.add('pressed');
  };
  const lift = () => el.current?.classList.remove('pressed');
  return (
    <div className={`shift ${side} ${dir}`} ref={el} onPointerDown={press} onPointerUp={lift} onPointerCancel={lift}>
      <div className="face"><span className="arrow">{dir === 'up' ? '▲' : '▼'}</span><span className="word">{dir === 'up' ? 'UPSHIFT' : 'DOWNSHIFT'}</span></div>
    </div>
  );
}
