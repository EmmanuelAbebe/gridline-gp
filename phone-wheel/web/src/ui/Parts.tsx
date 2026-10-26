// The driving screen's small parts, placed by Center (the standard grid) or by Drive one by one (your own layout,
// Layout → Move and resize): the game's gear + speed (or the connection state), the wheel (tap = straight ahead),
// Settings, Reconnect (its dot = link quality) and full screen.
import { useRef, useState } from 'react';
import { RiFullscreenExitFill, RiFullscreenFill, RiRefreshLine, RiSettings3Fill } from 'react-icons/ri';
import * as engine from '../engine/engine.ts';
import type { Config } from '../settings/settings.ts';
import { useFrame, useFullscreen, useStatus } from './hooks.ts';
import { buzz, toggleFullscreen } from './screen.ts';
import { Wheel } from './Wheel.tsx';

const TEXT: Record<engine.Phase, string> = {
  idle: 'not started', connecting: 'connecting…', connected: 'connected', lost: 'connection lost, retrying…',
  unpaired: 'not paired: scan the PC\'s QR code',
};
const trouble = (s: engine.Status) => s.phase === 'lost' || s.phase === 'unpaired';

export function DashReadout({ cfg, preview }: { cfg: Config; preview: boolean }) {
  const gear = useRef<HTMLDivElement>(null), kmh = useRef<HTMLDivElement>(null), queued = useRef<HTMLDivElement>(null);
  const status = useStatus(), ok = status.phase === 'connected';
  useFrame(() => {
    const d = engine.dash;
    if (gear.current) gear.current.textContent = d.g || '–';
    if (kmh.current) kmh.current.textContent = d.g ? `${d.v} km/h` : '';
    if (queued.current) queued.current.textContent = d.g && d.q ? `▼ ${d.q}` : '';
  });
  if (!cfg.layout.dash || !(ok || preview)) return <div className={`conn ${trouble(status) ? 'bad' : ''}`}>{preview && !ok ? 'preview (no PC)' : TEXT[status.phase]}</div>;
  return <div className="dash"><div className="gear" ref={gear}>–</div><div className="kmh" ref={kmh} /><div className="queued" ref={queued} /></div>;
}

export function WheelButton({ cfg }: { cfg: Config }) {
  const wheel = useRef<SVGSVGElement>(null);
  const [centred, setCentred] = useState(false);
  useFrame(() => {
    const s = engine.state.steer;
    if (wheel.current) { wheel.current.style.transform = `rotate(${s * 90}deg)`; wheel.current.classList.toggle('lock', Math.abs(s) >= 0.98); }   // full lock: red
  });
  const centre = () => { engine.center(); buzz(30); setCentred(true); setTimeout(() => setCentred(false), 300); };
  return cfg.layout.showWheel
    ? <button className={`round wheel-btn ${centred ? 'centred' : ''}`} onClick={centre} title="Tap: this is straight ahead" aria-label="Centre the steering"><Wheel ref={wheel} /></button>
    : <button className="round" onClick={centre} title="Tap: this is straight ahead" aria-label="Centre the steering">C</button>;
}

export function SettingsButton({ open }: { open: () => void }) {
  return <button className="round" onClick={open} title="Settings" aria-label="Settings"><RiSettings3Fill /></button>;
}

export function ReconnectButton() {
  const dot = useRef<HTMLElement>(null), btn = useRef<HTMLButtonElement>(null);
  const status = useStatus(), ok = status.phase === 'connected';
  useFrame(() => {
    const l = engine.link;
    if (dot.current) dot.current.className = `q ${ok ? l.quality : ''}`;
    if (btn.current) btn.current.title = `Reconnect to the PC now (${l.quality || 'no link'} · round trip ${l.rtt ?? '–'} ms, worst ${l.rttMax ?? '–'} ms · PC receives ${l.hz}/s · longest pause ${Math.max(l.gap, l.sendGap)} ms)`;
  });
  return (
    <button className={`round ${trouble(status) ? 'primary' : ''}`} ref={btn} onClick={() => { engine.reconnect(); buzz(20); }} aria-label="Reconnect">
      <RiRefreshLine /><i ref={dot} className="q" /></button>
  );
}

export function FullButton() {
  const full = useFullscreen();
  return (
    <button className="round" onClick={() => toggleFullscreen()} title={full ? 'Leave full screen' : 'Full screen, locked sideways'} aria-label="Full screen">
      {full ? <RiFullscreenExitFill /> : <RiFullscreenFill />}</button>
  );
}
