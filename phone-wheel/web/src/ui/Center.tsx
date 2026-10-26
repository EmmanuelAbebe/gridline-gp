// The middle column (2026-10-26, user: no status line; gear and speed as high as possible, the important buttons under
// them): the game's gear + speed (or the connection state while there is no dash), the extra on-screen buttons (BOX,
// REAR, ...), then a row of small round buttons: wheel (turns with the steering; tap = straight ahead), Settings,
// Reconnect (its dot = link quality), full screen.
import { useRef, useState } from 'react';
import { RiFullscreenExitFill, RiFullscreenFill, RiRefreshLine, RiSettings3Fill } from 'react-icons/ri';
import * as engine from '../engine/engine.ts';
import type { Config } from '../settings/settings.ts';
import { useFrame, useFullscreen, useStatus } from './hooks.ts';
import { buzz, toggleFullscreen } from './screen.ts';
import { Wheel } from './Wheel.tsx';
import { AuxButton } from './AuxButton.tsx';

const TEXT: Record<engine.Phase, string> = {
  idle: 'not started', connecting: 'connecting…', connected: 'connected', lost: 'connection lost, retrying…',
  unpaired: 'not paired: scan the PC\'s QR code',
};
function linkTitle(l: typeof engine.link) {
  return `${l.quality || 'no link'} · round trip ${l.rtt ?? '–'} ms (worst ${l.rttMax ?? '–'} ms) · PC receives ${l.hz}/s · longest pause ${Math.max(l.gap, l.sendGap)} ms`;
}

export function Center({ cfg, openSettings, preview }: { cfg: Config; openSettings: () => void; preview: boolean }) {
  const wheel = useRef<SVGSVGElement>(null), gear = useRef<HTMLDivElement>(null), kmh = useRef<HTMLDivElement>(null);
  const queued = useRef<HTMLDivElement>(null), dot = useRef<HTMLElement>(null), reconnectBtn = useRef<HTMLButtonElement>(null);
  const [centred, setCentred] = useState(false);
  const status = useStatus(), full = useFullscreen(), ok = status.phase === 'connected';
  const trouble = status.phase === 'lost' || status.phase === 'unpaired';
  const L = cfg.layout, showDash = L.dash && (ok || preview);
  useFrame(() => {
    const s = engine.state.steer, d = engine.dash;
    if (wheel.current) { wheel.current.style.transform = `rotate(${s * 90}deg)`; wheel.current.classList.toggle('lock', Math.abs(s) >= 0.98); }   // full lock: red
    if (gear.current) gear.current.textContent = d.g || '–';
    if (kmh.current) kmh.current.textContent = d.g ? `${d.v} km/h` : '';
    if (queued.current) queued.current.textContent = d.g && d.q ? `▼ ${d.q}` : '';
    if (dot.current) dot.current.className = `q ${ok ? engine.link.quality : ''}`;
    if (reconnectBtn.current) reconnectBtn.current.title = `Reconnect to the PC now (${linkTitle(engine.link)})`;
  });
  const centre = () => { engine.center(); buzz(30); setCentred(true); setTimeout(() => setCentred(false), 300); };
  return (
    <div className={`center ${cfg.buttons.length > 2 ? 'crowded' : ''}`}>
      {showDash
        ? <div className="dash"><div className="gear" ref={gear}>–</div><div className="kmh" ref={kmh} /><div className="queued" ref={queued} /></div>
        : <div className={`conn ${trouble ? 'bad' : ''}`}>{preview && !ok ? 'preview (no PC)' : TEXT[status.phase]}</div>}
      {cfg.buttons.length > 0 && (
        <div className={`aux size-${L.buttonSize}`}>
          {cfg.buttons.map((b, i) => <AuxButton key={`${i}-${b.bind}-${b.toggle}`} index={i} btn={b} />)}
        </div>
      )}
      <div className="rounds">
        {L.showWheel
          ? <button className={`round wheel-btn ${centred ? 'centred' : ''}`} onClick={centre} title="Tap: this is straight ahead" aria-label="Centre the steering"><Wheel ref={wheel} /></button>
          : <button className="round" onClick={centre} title="Tap: this is straight ahead" aria-label="Centre the steering">C</button>}
        <button className="round" onClick={openSettings} title="Settings" aria-label="Settings"><RiSettings3Fill /></button>
        <button className={`round ${trouble ? 'primary' : ''}`} ref={reconnectBtn} onClick={() => { engine.reconnect(); buzz(20); }} aria-label="Reconnect">
          <RiRefreshLine /><i ref={dot} className="q" /></button>
        <button className="round" onClick={() => toggleFullscreen()} title={full ? 'Leave full screen' : 'Full screen, locked sideways'} aria-label="Full screen">
          {full ? <RiFullscreenExitFill /> : <RiFullscreenFill />}</button>
      </div>
    </div>
  );
}
