// A pedal: hold to build pressure (ramp), slide the thumb up (slide) or on / off (instant), plus flick to shift
// (a quick sideways flick toward the screen centre taps the shift button). Writes engine.state.gas / brake directly,
// every animation frame while pressed, without React re-rendering.
import { useEffect, useRef } from 'react';
import * as engine from '../engine/engine.ts';
import { createFlick, pedalValue, type FlickCfg, type PedalCfg } from '../settings/settings.ts';
import { buzz } from './screen.ts';
import './Pedal.css';

const HINT = { ramp: 'hold longer = harder', slide: 'slide up = harder', instant: 'full on touch' };

// toCenter: +1 for the left pedal, -1 for the right (the direction of a flick toward the screen centre)
export function Pedal({ kind, cfg, flick, toCenter }: { kind: 'gas' | 'brake'; cfg: PedalCfg; flick: FlickCfg; toCenter: 1 | -1 }) {
  const el = useRef<HTMLDivElement>(null), fill = useRef<HTMLDivElement>(null), mark = useRef<HTMLDivElement>(null);
  const st = useRef({ pid: null as number | null, t0: 0, y: 0 });
  const cfgRef = useRef(cfg), flickRef = useRef(flick), flicker = useRef(createFlick());
  cfgRef.current = cfg; flickRef.current = flick;
  const shift = kind === 'brake' ? 'down' : 'up';

  const flicked = () => {
    engine.tap(flickRef.current[shift]);
    buzz(35);
    const m = mark.current;
    if (m) { m.classList.remove('show'); void m.offsetWidth; m.classList.add('show'); }
  };
  const track = (e: React.PointerEvent) => {
    if (flickRef.current.on && flicker.current.add(e.clientX, e.clientY, performance.now(), toCenter, flickRef.current)) flicked();
  };
  const put = (v: number) => {
    engine.state[kind] = v;
    if (fill.current) fill.current.style.height = v * 100 + '%';
  };
  const progress = () => {
    const c = cfgRef.current, s = st.current;
    if (c.mode === 'slide' && el.current) {
      const r = el.current.getBoundingClientRect();
      return (r.bottom - s.y) / (r.height * 0.85);          // the top 15% counts as fully pressed
    }
    if (c.mode === 'instant') return 1;
    return (performance.now() - s.t0) / 1000 / c.rampTime;
  };
  const tick = () => {
    if (st.current.pid === null) return;
    put(pedalValue(progress(), cfgRef.current));
    requestAnimationFrame(tick);
  };
  const release = () => {
    st.current.pid = null;
    put(0);
    el.current?.classList.remove('active');
  };
  useEffect(() => release, []);                              // let go if the pedal is removed or swapped

  const down = (e: React.PointerEvent) => {
    const s = st.current;
    if (s.pid !== null) return;
    s.pid = e.pointerId; s.t0 = performance.now(); s.y = e.clientY;
    flicker.current.reset(); track(e);
    el.current?.setPointerCapture(e.pointerId);
    el.current?.classList.add('active');
    buzz(12);
    tick();
  };
  const move = (e: React.PointerEvent) => { if (e.pointerId === st.current.pid) { st.current.y = e.clientY; track(e); } };
  const up = (e: React.PointerEvent) => { if (e.pointerId === st.current.pid) release(); };

  return (
    <div className={`pedal ${kind}`} ref={el} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="fill" ref={fill} />
      <div className="label">{kind === 'gas' ? 'GAS' : 'BRAKE'}</div>
      <div className="hint">{HINT[cfg.mode]}{flick.on && <><br />flick {toCenter > 0 ? '→' : '←'} = shift {shift}</>}</div>
      <div className="shiftmark" ref={mark}>{shift === 'up' ? '▲' : '▼'}</div>
    </div>
  );
}
