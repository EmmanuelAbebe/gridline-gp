// Desktop preview: no tilt sensors on a PC, so the mouse's position across the window (or ← → / A D, Space = centre)
// stands in for the phone's tilt; P = as if the phone was put down (the "are you there?" screen). On with ?preview, or by itself on a device with a mouse and no touch screen.
import { previewTilt, testAway, setDash, state } from './engine.ts';

export const isPreview = () =>
  new URLSearchParams(location.search).has('preview') || (matchMedia('(pointer: fine)').matches && !('ontouchstart' in window));

const RANGE = 60;          // degrees of fake tilt from the window's centre to its edge
export function startPreview() {
  let mouse = 0, keys = 0, held = 0;
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') mouse = ((e.clientX / innerWidth) * 2 - 1) * RANGE; });
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') held = -1;
    if (e.key === 'ArrowRight' || e.key === 'd') held = 1;
    if (e.key === ' ') { mouse = 0; keys = 0; }
    if (e.key === 'p') testAway();
  });
  addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) held = 0; });
  // a pretend dash: the revs climb with the gas, shift up at the top
  let gear = 1, rpm = 6000, last = performance.now();
  const TOP = [0, 95, 135, 172, 210, 250, 290, 330, 350];
  const tick = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    rpm = Math.max(5000, rpm + dt * (state.gas > 0.1 ? state.gas * (2600 - gear * 220) : -3000));
    if (rpm > 11900 && gear < 8) { gear++; rpm = rpm * TOP[gear - 1] / TOP[gear]; }
    if (rpm < 7600 && gear > 1 && state.gas < 0.1) { gear--; rpm = rpm * TOP[gear + 1] / TOP[gear]; }
    setDash({ g: String(gear), q: 0, r: Math.min(1, Math.max(0, (rpm - 8500) / 3300)), v: TOP[gear] * rpm / 12000 });
    keys = held ? Math.max(-RANGE, Math.min(RANGE, keys + held * 2)) : keys * 0.85;
    previewTilt(mouse + keys);
    requestAnimationFrame(tick);
  };
  tick();
}
