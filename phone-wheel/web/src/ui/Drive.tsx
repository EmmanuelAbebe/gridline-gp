// The driving screen. Standard layout, left to right: brake | upshift | middle column | downshift | gas, under the
// game's rev lights (Layout → Rev lights and gear; pedals swappable, upshift beside the brake unless swapShift; widths
// from theme.css and the pedal width setting). Your own layout (Layout → Move and resize, `layout.free`): every
// element is placed by itself at its saved box. Each element sits in a [data-slot] box in both, which is what the
// layout editor measures and moves.
import type { CSSProperties, ReactNode } from 'react';
import type { Config, FreeLayout, Rect } from '../settings/settings.ts';
import { Pedal } from './Pedal.tsx';
import { ShiftButton } from './ShiftButton.tsx';
import { Center } from './Center.tsx';
import { RevStrip } from './RevStrip.tsx';
import { AuxButton } from './AuxButton.tsx';
import { DashReadout, FullButton, ReconnectButton, SettingsButton, WheelButton } from './Parts.tsx';
import './Drive.css';

export interface Slot { id: string; label: string; el: ReactNode }
// every element on the screen with this profile, for your own layout and the editor
export function slotsOf(cfg: Config, openSettings: () => void, preview: boolean): Slot[] {
  const L = cfg.layout, out: Slot[] = [
    { id: 'brake', label: 'BRAKE', el: <Pedal kind="brake" cfg={cfg.brake} flick={cfg.flick} toCenter={1} /> },
    { id: 'gas', label: 'GAS', el: <Pedal kind="gas" cfg={cfg.gas} flick={cfg.flick} toCenter={-1} /> },
  ];
  if (L.shiftButtons) out.push(
    { id: 'up', label: 'UPSHIFT', el: <ShiftButton side="left" dir="up" bind={cfg.flick.up} /> },
    { id: 'down', label: 'DOWNSHIFT', el: <ShiftButton side="right" dir="down" bind={cfg.flick.down} /> });
  if (L.dash) out.push({ id: 'rev', label: 'REV LIGHTS', el: <RevStrip /> });
  out.push({ id: 'dash', label: L.dash ? 'GEAR' : 'STATUS', el: <DashReadout cfg={cfg} preview={preview} /> });
  cfg.buttons.forEach((b, i) => out.push({ id: `btn${i}`, label: b.label || b.bind, el: <AuxButton key={`${i}-${b.bind}-${b.toggle}`} index={i} btn={b} /> }));
  out.push(
    { id: 'wheel', label: 'WHEEL', el: <WheelButton cfg={cfg} /> },
    { id: 'settings', label: 'SETTINGS', el: <SettingsButton open={openSettings} /> },
    { id: 'reconnect', label: 'RECONNECT', el: <ReconnectButton /> },
    { id: 'full', label: 'FULL SCREEN', el: <FullButton /> });
  return out;
}
// an element the saved layout doesn't know yet (a button added since): a small box in the middle
export const fallbackRect = (k: number): Rect => ({ x: 0.44, y: Math.min(0.8, 0.3 + 0.12 * k), w: 0.12, h: 0.1 });
export const boxStyle = (r: Rect): CSSProperties => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

export function Drive({ cfg, openSettings, preview, free }: { cfg: Config; openSettings: () => void; preview: boolean; free?: FreeLayout | null }) {
  const L = cfg.layout, own = free !== undefined ? free : L.free;
  if (own) {
    let missing = 0;
    return (
      <div className="drive free">
        {slotsOf(cfg, openSettings, preview).map((s) => (
          <div key={s.id} className={`slot slot-${s.id}`} data-slot={s.id} style={boxStyle(own[s.id] ?? fallbackRect(missing++))}>{s.el}</div>
        ))}
      </div>
    );
  }
  const [left, right] = L.swapPedals ? (['gas', 'brake'] as const) : (['brake', 'gas'] as const);
  const up = (L.swapShift ? right : left) === 'brake' ? 'left' : 'right';   // the side upshift is on
  const style = { '--pedal-fr': `${1.4 * L.pedalSize}fr` } as CSSProperties;
  return (
    <div className={`drive ${L.shiftButtons ? '' : 'no-shift'} ${L.dash ? 'with-dash' : ''}`} style={style}>
      {L.dash && <div className="slot" data-slot="rev" style={{ gridArea: 'rev' }}><RevStrip /></div>}
      <div className="slot" data-slot={left} style={{ gridArea: 'p1' }}><Pedal key={left} kind={left} cfg={cfg[left]} flick={cfg.flick} toCenter={1} /></div>
      {L.shiftButtons && <div className="slot" data-slot={up === 'left' ? 'up' : 'down'} style={{ gridArea: 's1' }}>
        <ShiftButton side="left" dir={up === 'left' ? 'up' : 'down'} bind={up === 'left' ? cfg.flick.up : cfg.flick.down} /></div>}
      <Center cfg={cfg} openSettings={openSettings} preview={preview} />
      {L.shiftButtons && <div className="slot" data-slot={up === 'right' ? 'up' : 'down'} style={{ gridArea: 's2' }}>
        <ShiftButton side="right" dir={up === 'right' ? 'up' : 'down'} bind={up === 'right' ? cfg.flick.up : cfg.flick.down} /></div>}
      <div className="slot" data-slot={right} style={{ gridArea: 'p2' }}><Pedal key={right} kind={right} cfg={cfg[right]} flick={cfg.flick} toCenter={-1} /></div>
    </div>
  );
}
