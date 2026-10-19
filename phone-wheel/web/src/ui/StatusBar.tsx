// Top of the driving screen: connection state, link quality, and the Reconnect / Full screen / Settings buttons.
import { useRef } from 'react';
import * as engine from '../engine/engine.ts';
import { useFrame, useFullscreen, useStatus } from './hooks.ts';
import { buzz, toggleFullscreen } from './screen.ts';
import './StatusBar.css';

const TEXT: Record<engine.Phase, string> = {
  idle: 'not started', connecting: 'connecting…', connected: 'connected to PC', lost: 'connection lost, retrying…',
  unpaired: 'not paired: scan the PC\'s QR code',
};
// "good · 9 ms · 60 Hz": round trip to the PC, messages per second it receives, and the worst stall if any
function linkText(l: typeof engine.link) {
  if (!l.quality) return '';
  if (l.quality === 'stalled') return 'stalled · no reply';
  const stall = Math.max(l.gap, l.sendGap);
  return `${l.quality} · ${l.rtt ?? '–'} ms · ${l.hz} Hz${stall > 100 ? ` · stall ${stall} ms` : ''}`;
}

export function StatusBar({ openSettings, preview }: { openSettings: () => void; preview: boolean }) {
  const status = useStatus(), full = useFullscreen(), linkEl = useRef<HTMLDivElement>(null);
  let shown = '';
  useFrame(() => {
    const el = linkEl.current, t = status.phase === 'connected' ? linkText(engine.link) : '';
    if (!el || t === shown) return;
    shown = t; el.textContent = t; el.className = `linkq ${engine.link.quality}`;
    const l = engine.link;
    el.title = `round trip ${l.rtt ?? '–'} ms (worst of last 10: ${l.rttMax ?? '–'} ms), PC receives ${l.hz}/s, longest pause ${l.gap} ms (PC) / ${l.sendGap} ms (phone)`;
  });
  const ok = status.phase === 'connected', trouble = status.phase === 'lost' || status.phase === 'unpaired';
  return (
    <div className="topbar">
      <div className={`status ${ok ? 'ok' : trouble ? 'bad' : ''}`}><i />{preview && !ok ? 'preview (no PC)' : TEXT[status.phase]}</div>
      <div className="linkq" ref={linkEl} />
      <button className={`icon ${trouble ? 'primary' : ''}`} onClick={() => { engine.reconnect(); buzz(20); }} title="Reconnect to the PC now" aria-label="Reconnect">↻</button>
      <button className="icon" onClick={() => toggleFullscreen()} title={full ? 'Leave full screen' : 'Full screen, locked sideways'} aria-label="Full screen">{full ? '🗗' : '⛶'}</button>
      <button className="small" onClick={openSettings}>⚙ Settings</button>
    </div>
  );
}
