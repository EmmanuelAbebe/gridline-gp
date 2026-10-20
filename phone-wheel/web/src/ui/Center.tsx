// The middle column: Settings at the top, the wheel (turns with the steering; tap it to set straight ahead) with the
// extra on-screen buttons under it, Reconnect at the bottom.
import { useRef, useState } from 'react';
import { RiRefreshLine, RiSettings3Fill } from 'react-icons/ri';
import * as engine from '../engine/engine.ts';
import type { Config } from '../settings/settings.ts';
import { useFrame, useStatus } from './hooks.ts';
import { buzz } from './screen.ts';
import { Wheel } from './Wheel.tsx';
import { AuxButton } from './AuxButton.tsx';

export function Center({ cfg, openSettings }: { cfg: Config; openSettings: () => void }) {
  const wheel = useRef<SVGSVGElement>(null), readout = useRef<HTMLDivElement>(null);
  const [centred, setCentred] = useState(false);
  const status = useStatus(), trouble = status.phase === 'lost' || status.phase === 'unpaired';
  useFrame(() => {
    const s = engine.state.steer;
    if (wheel.current) wheel.current.style.transform = `rotate(${s * 90}deg)`;
    if (readout.current) readout.current.textContent = `${s >= 0 ? '+' : ''}${s.toFixed(2)}`;
  });
  const centre = () => { engine.center(); buzz(30); setCentred(true); setTimeout(() => setCentred(false), 300); };
  const L = cfg.layout;
  return (
    <div className={`center ${cfg.buttons.length > 1 ? 'crowded' : ''}`}>
      <button className="round" onClick={openSettings} title="Settings" aria-label="Settings"><RiSettings3Fill /></button>
      <div className="mid">
        {L.showWheel
          ? <button className={`wheel-btn ${centred ? 'centred' : ''}`} onClick={centre} title="Tap: this is straight ahead" aria-label="Centre the steering"><Wheel ref={wheel} /></button>
          : <button onClick={centre}>Center</button>}
        <div className="readout" ref={readout}>+0.00</div>
        {cfg.buttons.length > 0 && (
          <div className={`aux size-${L.buttonSize}`}>
            {cfg.buttons.map((b, i) => <AuxButton key={`${i}-${b.bind}-${b.toggle}`} index={i} btn={b} />)}
          </div>
        )}
      </div>
      <button className={`round ${trouble ? 'primary' : ''}`} onClick={() => { engine.reconnect(); buzz(20); }} title="Reconnect to the PC now" aria-label="Reconnect"><RiRefreshLine /></button>
    </div>
  );
}
