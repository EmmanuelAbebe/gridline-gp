// An on-screen button: held (pressed while the finger is down) or toggle (tap on, tap off).
// live: a button whose face shows a game state (the electric car's ATTACK: its name, the state under it, data-state)
import { useEffect, useRef, useState } from 'react';
import * as engine from '../engine/engine.ts';
import type { ButtonCfg } from '../settings/settings.ts';
import { buzz } from './screen.ts';
import { useFrame } from './hooks.ts';
import './AuxButton.css';

export interface LiveFace { label: string; sub: (d: typeof engine.dash) => string; state: (d: typeof engine.dash) => string }

export function AuxButton({ index, btn, live = null }: { index: number; btn: ButtonCfg; live?: LiveFace | null }) {
  const face = useRef<HTMLButtonElement>(null), sub = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    if (!live || !face.current) return;
    const d = engine.dash, s = live.state(d), t = live.sub(d);
    if (face.current.dataset.state !== s) face.current.dataset.state = s;
    if (sub.current && sub.current.textContent !== t) sub.current.textContent = t;
  });
  const [down, setDown] = useState(false);
  const pid = useRef<number | null>(null), on = useRef(false);
  useEffect(() => () => engine.setButton(index, false), [index]);

  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
    buzz(15);
    if (btn.toggle) { on.current = !on.current; engine.setButton(index, on.current); setDown(on.current); return; }
    pid.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    engine.setButton(index, true); setDown(true);
  };
  const lift = (e: React.PointerEvent) => {
    if (btn.toggle || e.pointerId !== pid.current) return;
    pid.current = null; engine.setButton(index, false); setDown(false);
  };
  return (
    <button ref={face} className={`auxbtn ${down ? 'down' : ''} ${live ? 'live' : ''}`} onPointerDown={press} onPointerUp={lift} onPointerCancel={lift}>
      {live ? <>{live.label}<span className="sub" ref={sub} /></> : btn.label || btn.bind}
    </button>
  );
}
