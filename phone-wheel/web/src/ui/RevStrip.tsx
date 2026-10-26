// The game's rev lights along the top of the driving screen (2026-10-26, the user's pick of four mock-ups): 15 LEDs like
// an F1 wheel, 5 green, 5 red, 5 blue, lit from the game's rev share (8500 rpm to the shift point); all blue and
// flashing = shift now. Dark until the game sends a dash (engine.dash).
import { useRef } from 'react';
import * as engine from '../engine/engine.ts';
import { useFrame } from './hooks.ts';
import './RevStrip.css';

const N = 15, colour = (i: number) => (i < 5 ? 'g' : i < 10 ? 'r' : 'b');

export function RevStrip() {
  const box = useRef<HTMLDivElement>(null);
  let shown = '';
  useFrame(() => {
    const el = box.current, d = engine.dash;
    if (!el) return;
    const now = !!d.g && d.r >= 1, lit = d.g ? Math.round(d.r * N) : 0, key = now ? 'now' : String(lit);
    if (key === shown) return;
    shown = key;
    el.classList.toggle('now', now);
    [...el.children].forEach((led, i) => { led.className = `led ${now ? 'b on' : colour(i) + (i < lit ? ' on' : '')}`; });
  });
  return <div className="revstrip" ref={box} aria-hidden="true">{Array.from({ length: N }, (_, i) => <i key={i} className={`led ${colour(i)}`} />)}</div>;
}
