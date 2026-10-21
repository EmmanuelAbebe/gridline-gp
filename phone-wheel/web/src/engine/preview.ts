// Desktop preview: no tilt sensors on a PC, so the mouse's position across the window (or ← → / A D, Space = centre)
// stands in for the phone's tilt; P = as if the phone was put down (the "are you there?" screen). On with ?preview, or by itself on a device with a mouse and no touch screen.
import { previewTilt, testAway } from './engine.ts';

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
  const tick = () => {
    keys = held ? Math.max(-RANGE, Math.min(RANGE, keys + held * 2)) : keys * 0.85;
    previewTilt(mouse + keys);
    requestAnimationFrame(tick);
  };
  tick();
}
