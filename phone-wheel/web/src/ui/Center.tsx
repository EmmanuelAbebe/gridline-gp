// The middle column of the driving screen: status bar, wheel, live readout, the on-screen buttons, Center, quick sliders.
import { useRef } from 'react';
import * as engine from '../engine/engine.ts';
import type { Config } from '../settings/settings.ts';
import type { Update } from './App.tsx';
import { useFrame } from './hooks.ts';
import { buzz } from './screen.ts';
import { StatusBar } from './StatusBar.tsx';
import { Wheel } from './Wheel.tsx';
import { AuxButton } from './AuxButton.tsx';

export function Center({ cfg, update, openSettings, preview }: { cfg: Config; update: Update; openSettings: () => void; preview: boolean }) {
  const wheel = useRef<SVGSVGElement>(null), readout = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const s = engine.state.steer;
    if (wheel.current) wheel.current.style.transform = `rotate(${s * 90}deg)`;
    if (readout.current) readout.current.textContent = `steer ${s >= 0 ? '+' : ''}${s.toFixed(2)}`;
  });
  const L = cfg.layout;
  return (
    <div className="center">
      <StatusBar openSettings={openSettings} preview={preview} />
      {L.showWheel && <Wheel ref={wheel} />}
      <div className="readout" ref={readout}>steer +0.00</div>
      {cfg.buttons.length > 0 && (
        <div className={`aux size-${L.buttonSize}`}>
          {cfg.buttons.map((b, i) => <AuxButton key={`${i}-${b.bind}-${b.toggle}`} index={i} btn={b} />)}
        </div>
      )}
      <div className="row"><button onClick={() => { engine.center(); buzz(30); }}>Center</button></div>
      {L.quickSliders && <>
        <label className="quick">Sensitivity
          <input type="range" min={-35} max={70} value={cfg.steer.sensitivity} onChange={(e) => update((c) => { c.steer.sensitivity = +e.target.value; })} />
        </label>
        <label className="quick">Smoothing
          <input type="range" min={0} max={90} value={cfg.steer.smoothing} onChange={(e) => update((c) => { c.steer.smoothing = +e.target.value; })} />
        </label>
      </>}
    </div>
  );
}
