// The phone-wheel app's centring (in place of the wheel button, 2026-11-17; user: "the center button can be replaced by a
// prompt screen when a race starts"): when the game starts sending the dash (the race's lights, a time trial or practice
// starting, or the link back while standing still) a card over the middle asks to hold the wheel straight and tap CENTRE.
// The pedals beside it keep working; it goes by itself once the car is moving (> GONE_KMH). Settings → Steering → Center
// now does the same any time.
import { useRef, useState } from 'react';
import * as engine from '../engine/engine.ts';
import { useFrame } from './hooks.ts';
import { buzz } from './screen.ts';
import { Wheel } from './Wheel.tsx';
import './CentrePrompt.css';

const ASK_BELOW = 50, GONE_KMH = 60;     // km/h: asked only when (nearly) standing; dropped once driving off
let driving = false;                      // (module-level: the prompt unmounts while Settings is open)

export function CentrePrompt() {
  const [show, setShow] = useState(false);
  const shown = useRef(false), wheel = useRef<SVGSVGElement>(null);
  const set = (v: boolean) => { if (shown.current !== v) { shown.current = v; setShow(v); } };
  useFrame(() => {
    const d = engine.dash, live = !!d.g;
    if (live && !driving && d.v < ASK_BELOW) set(true);
    if (!live || d.v > GONE_KMH) set(false);
    driving = live;
    const s = engine.state.steer;
    if (wheel.current) { wheel.current.style.transform = `rotate(${s * 90}deg)`; wheel.current.classList.toggle('lock', Math.abs(s) >= 0.98); }
  });
  if (!show) return null;
  const centre = () => { engine.center(); buzz(30); set(false); };
  return (
    <div className="centre-prompt" role="dialog" aria-label="Centre the steering">
      <Wheel ref={wheel} />
      <p>Hold the wheel straight</p>
      <button className="primary big" onClick={centre}>CENTRE</button>
      <button className="skip" onClick={() => set(false)}>keep as it is</button>
    </div>
  );
}
