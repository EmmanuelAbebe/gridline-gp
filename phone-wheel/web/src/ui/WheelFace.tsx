// The race wheel's face (2026-10-31, the user's pick of the phone mock-ups, "idea 1", with their own edits): the screen in
// the middle (battery, place / lap and delta, the gear, speed, rpm), the on-screen buttons in two clusters beside it (PIT
// on the left, RACE on the right: each button's `side`), the small round buttons under them, and the ECU map row under
// it all (tap a map: the game switches to MANUAL and picks it; A / M switches AUTO / MANUAL). Everything game-side
// comes from engine.dash; nothing re-renders at 60 Hz (useFrame writes the DOM).
import { useRef } from 'react';
import * as engine from '../engine/engine.ts';
import type { Config, Side } from '../settings/settings.ts';
import { AuxButton } from './AuxButton.tsx';
import { FullButton, ReconnectButton, SettingsButton, WheelButton } from './Parts.tsx';
import { useFrame, useStatus } from './hooks.ts';
import { buzz } from './screen.ts';
import './WheelFace.css';

const STATUS: Record<engine.Phase, string> = {
  idle: 'not started', connecting: 'connecting…', connected: 'waiting for the game', lost: 'connection lost, retrying…',
  unpaired: 'not paired: scan the PC\'s QR code',
};
const MAP_IDS = ['harvest', 'balanced', 'attack', 'quali'];

export function WheelScreen({ cfg, preview }: { cfg: Config; preview: boolean }) {
  const r = { gear: useRef<HTMLDivElement>(null), kmh: useRef<HTMLElement>(null), rpm: useRef<HTMLElement>(null), pos: useRef<HTMLElement>(null),
    lap: useRef<HTMLSpanElement>(null), delta: useRef<HTMLElement>(null), fill: useRef<HTMLElement>(null), pct: useRef<HTMLSpanElement>(null),
    box: useRef<HTMLDivElement>(null), queued: useRef<HTMLSpanElement>(null) };
  const status = useStatus(), ok = status.phase === 'connected' || preview, L = cfg.layout;
  useFrame(() => {
    const d = engine.dash, live = !!d.g && L.dash;
    if (!r.box.current) return;
    r.box.current.dataset.live = live ? '1' : '';
    if (r.gear.current) r.gear.current.textContent = live ? d.g : '–';
    if (r.queued.current) r.queued.current.textContent = live && d.q ? `▼${d.q}` : '';
    if (r.kmh.current) r.kmh.current.textContent = live ? String(d.v) : '–';
    if (r.rpm.current) r.rpm.current.textContent = live ? d.n.toLocaleString('en-GB') : '–';
    if (r.pos.current) r.pos.current.textContent = live && d.p ? `P${d.p}` : '';
    if (r.lap.current) r.lap.current.textContent = !live || !d.l ? '' : d.t ? `· LAP ${d.l}/${d.t}` : `· LAP ${d.l}`;
    if (r.delta.current) {
      const v = live ? d.d : null;
      r.delta.current.textContent = v === null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(3);
      r.delta.current.className = 'delta ' + (v === null ? '' : v > 0.005 ? 'slower' : v < -0.005 ? 'faster' : '');
    }
    if (r.fill.current) { r.fill.current.style.width = `${live ? d.b : 0}%`; r.fill.current.dataset.flow = d.k > 0 ? 'out' : d.k < 0 ? 'in' : ''; }
    if (r.pct.current) r.pct.current.textContent = live ? `${d.b}%` : '';
  });
  return (
    <div className="wscreen" ref={r.box}>
      {L.ecu && <div className="ers">
        {L.labels.gauges && <span className="gauge-label">ERS</span>}
        <i className="bar"><b ref={r.fill} /></i>
        {L.labels.gauges && <span className="pct" ref={r.pct} />}
      </div>}
      <div className="info"><span><b ref={r.pos} /> <span ref={r.lap} /></span><b ref={r.delta} className="delta" /></div>
      {ok
        ? <div className="gearbox"><div className="gear" ref={r.gear}>–</div><span className="queued" ref={r.queued} /></div>
        : <div className={`status ${status.phase === 'lost' || status.phase === 'unpaired' ? 'bad' : ''}`}>{STATUS[status.phase]}</div>}
      <div className="speed"><b ref={r.kmh}>–</b><span>km/h</span></div>
      <div className="rpm"><b ref={r.rpm}>–</b><span>rpm</span></div>
    </div>
  );
}

export function MapRow() {
  const row = useRef<HTMLDivElement>(null);
  let shown = '';
  useFrame(() => {
    const d = engine.dash, key = `${d.g ? d.e : -1}${d.m}`;
    if (!row.current || key === shown) return;
    shown = key;
    [...row.current.querySelectorAll<HTMLElement>('[data-i]')].forEach((b) => b.classList.toggle('on', +b.dataset.i! === d.e && !!d.g));
    const am = row.current.querySelector<HTMLElement>('.am');
    if (am) { am.textContent = d.m; am.classList.toggle('on', d.m === 'A'); }
  });
  const pick = (cmd: number) => { engine.ecu(cmd); buzz(15); };
  return (
    <div className="maprow" ref={row}>
      {engine.ECU_SHORT.map((name, i) => (
        <button key={name} data-i={i} data-map={MAP_IDS[i]} onClick={() => pick(i)} aria-label={`ECU map ${engine.ECU_MAPS[i]}`}>{name}</button>))}
      <button className="am on" onClick={() => pick(engine.dash.m === 'M' ? 4 : 5)} aria-label="ECU maps AUTO or MANUAL">A</button>
    </div>
  );
}

// one side's buttons (cfg.buttons with that side; engine.setButton takes their index in the whole list), then two
// small round buttons
export function Cluster({ cfg, side, openSettings }: { cfg: Config; side: Side; openSettings: () => void }) {
  return (
    <div className={`cluster ${side}`}>
      <span className="cluster-name">{side === 'pit' ? 'PIT' : 'RACE'}</span>
      {cfg.buttons.map((b, i) => b.side === side && (
        <div key={`${i}-${b.bind}-${b.toggle}`} className="slot" data-slot={`btn${i}`}><AuxButton index={i} btn={b} /></div>))}
      <div className="utils">
        {side === 'pit'
          ? <><div className="slot" data-slot="wheel"><WheelButton cfg={cfg} /></div><div className="slot" data-slot="settings"><SettingsButton open={openSettings} /></div></>
          : <><div className="slot" data-slot="reconnect"><ReconnectButton /></div><div className="slot" data-slot="full"><FullButton /></div></>}
      </div>
    </div>
  );
}
