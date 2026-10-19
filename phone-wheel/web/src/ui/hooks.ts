// Small React hooks around the engine and the screen.
import { useEffect, useRef, useState } from 'react';
import * as engine from '../engine/engine.ts';
import { isFullscreen } from './screen.ts';

// the connection status (re-renders when it changes)
export function useStatus() {
  const [s, setS] = useState(engine.getStatus);
  useEffect(() => engine.onStatus(setS), []);
  return s;
}

// Runs `fn` every animation frame while mounted: for the 60 Hz bits (wheel, meters) that skip React rendering.
export function useFrame(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id = 0;
    const loop = () => { ref.current(); id = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(id);
  }, []);
}

export function useFullscreen() {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const f = () => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  return on;
}

export function usePortrait() {
  const [p, setP] = useState(() => matchMedia('(orientation: portrait)').matches);
  useEffect(() => {
    const m = matchMedia('(orientation: portrait)'), f = () => setP(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return p;
}
