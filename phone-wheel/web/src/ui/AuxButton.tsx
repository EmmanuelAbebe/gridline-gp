// An on-screen button: held (pressed while the finger is down) or toggle (tap on, tap off).
import { useEffect, useRef, useState } from 'react';
import * as engine from '../engine/engine.ts';
import type { ButtonCfg } from '../settings/settings.ts';
import { buzz } from './screen.ts';
import './AuxButton.css';

export function AuxButton({ index, btn }: { index: number; btn: ButtonCfg }) {
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
    <button className={`auxbtn ${down ? 'down' : ''}`} onPointerDown={press} onPointerUp={lift} onPointerCancel={lift}>
      {btn.label || btn.bind}
    </button>
  );
}
