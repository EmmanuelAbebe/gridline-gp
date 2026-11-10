// The driving screen. Standard layout = the race wheel (2026-10-31, the user's pick): brake | upshift | the wheel face |
// downshift | gas, the rev lights over the middle (Layout → Rev lights and screen data), the face = PIT buttons | screen |
// RACE buttons over the ECU map row (WheelFace.tsx); pedals swappable, upshift beside the brake unless swapShift, pedal
// width from the Pedal width setting, labels from Layout → Labels. Your own layout (Layout → Move and resize,
// `layout.free`): every element is placed by itself at its saved box. Each element sits in a [data-slot] box in both,
// which is what the layout editor measures and moves. The car (2026-11-10, settings.ts forCar): the electric car's
// face has the race's energy along the top and the ENERGY row, its ATTACK button shows its state; a kart's face is the
// screen with one row of buttons under it.
import type { CSSProperties, ReactNode } from 'react';
import type { CarKind, Config, FreeLayout, Rect } from '../settings/settings.ts';
import { Pedal } from './Pedal.tsx';
import { ShiftButton } from './ShiftButton.tsx';
import { EnergyStrip, RevStrip } from './RevStrip.tsx';
import { AuxButton } from './AuxButton.tsx';
import { Cluster, EnergyRow, MapRow, WheelScreen, liveButton } from './WheelFace.tsx';
import { FullButton, ReconnectButton, SettingsButton, WheelButton } from './Parts.tsx';
import './Drive.css';

export interface Slot { id: string; label: string; el: ReactNode }
// every element on the screen with this profile, for your own layout and the editor
export function slotsOf(cfg: Config, openSettings: () => void, preview: boolean, car: CarKind = 'hybrid'): Slot[] {
  const L = cfg.layout, lb = L.labels, out: Slot[] = [
    { id: 'brake', label: 'BRAKE', el: <Pedal kind="brake" cfg={cfg.brake} flick={cfg.flick} toCenter={1} labels={lb.pedals} /> },
    { id: 'gas', label: 'GAS', el: <Pedal kind="gas" cfg={cfg.gas} flick={cfg.flick} toCenter={-1} labels={lb.pedals} /> },
  ];
  if (L.shiftButtons) out.push(
    { id: 'up', label: 'UPSHIFT', el: <ShiftButton side="left" dir="up" bind={cfg.flick.up} labels={lb.shift} /> },
    { id: 'down', label: 'DOWNSHIFT', el: <ShiftButton side="right" dir="down" bind={cfg.flick.down} labels={lb.shift} /> });
  if (L.dash) out.push(car === 'electric' ? { id: 'rev', label: 'ENERGY', el: <EnergyStrip label={lb.gauges} /> } : { id: 'rev', label: 'REV LIGHTS', el: <RevStrip label={lb.gauges} /> });
  out.push({ id: 'screen', label: 'SCREEN', el: <WheelScreen cfg={cfg} preview={preview} car={car} /> });
  if (L.ecu) out.push(car === 'electric' ? { id: 'maps', label: 'ENERGY ROW', el: <EnergyRow /> } : { id: 'maps', label: 'ECU MAPS', el: <MapRow /> });
  cfg.buttons.forEach((b, i) => out.push({ id: `btn${i}`, label: b.label || b.bind, el: <AuxButton key={`${i}-${b.bind}-${b.toggle}`} index={i} btn={b} live={liveButton(car, b.bind)} /> }));
  out.push(
    { id: 'wheel', label: 'WHEEL', el: <WheelButton cfg={cfg} /> },
    { id: 'settings', label: 'SETTINGS', el: <SettingsButton open={openSettings} /> },
    { id: 'reconnect', label: 'RECONNECT', el: <ReconnectButton /> },
    { id: 'full', label: 'FULL SCREEN', el: <FullButton /> });
  return out;
}
// the pairs MIRROR copies across the screen: left element → right one (the pedals, the shift keys, the round buttons and
// the k-th PIT button ↔ the k-th RACE button)
export function mirrorPairs(cfg: Config): [string, string][] {
  const pit = cfg.buttons.flatMap((b, i) => b.side === 'pit' ? [`btn${i}`] : []), race = cfg.buttons.flatMap((b, i) => b.side === 'race' ? [`btn${i}`] : []);
  return [['brake', 'gas'], ['up', 'down'], ['wheel', 'reconnect'], ['settings', 'full'],
    ...pit.slice(0, race.length).map((p, k): [string, string] => [p, race[k]])];
}
// an element the saved layout doesn't know yet (a button added since): a small box in the middle
export const fallbackRect = (k: number): Rect => ({ x: 0.44, y: Math.min(0.8, 0.3 + 0.12 * k), w: 0.12, h: 0.1 });
export const boxStyle = (r: Rect): CSSProperties => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

export function Drive({ cfg, openSettings, preview, free, car = 'hybrid' }: { cfg: Config; openSettings: () => void; preview: boolean; free?: FreeLayout | null; car?: CarKind }) {
  const L = cfg.layout, lb = L.labels, own = free !== undefined ? free : L.free;
  if (own) {
    let missing = 0;
    return (
      <div className="drive free">
        {slotsOf(cfg, openSettings, preview, car).map((s) => (
          <div key={s.id} className={`slot slot-${s.id}`} data-slot={s.id} style={boxStyle(own[s.id] ?? fallbackRect(missing++))}>{s.el}</div>
        ))}
      </div>
    );
  }
  const [left, right] = L.swapPedals ? (['gas', 'brake'] as const) : (['brake', 'gas'] as const);
  const up = (L.swapShift ? right : left) === 'brake' ? 'left' : 'right';   // the side upshift is on
  const style = { '--pedal-size': L.pedalSize } as CSSProperties;
  return (
    <div className={`drive racewheel car-${car} ${L.shiftButtons ? '' : 'no-shift'} ${L.dash ? 'with-dash' : ''} size-${L.buttonSize}`} style={style}>
      {L.dash && <div className="slot" data-slot="rev" style={{ gridArea: 'rev' }}>{car === 'electric' ? <EnergyStrip label={lb.gauges} /> : <RevStrip label={lb.gauges} />}</div>}
      <div className="slot" data-slot={left} style={{ gridArea: 'p1' }}>
        <Pedal key={left} kind={left} cfg={cfg[left]} flick={cfg.flick} toCenter={1} labels={lb.pedals} /></div>
      {L.shiftButtons && <div className="slot" data-slot={up === 'left' ? 'up' : 'down'} style={{ gridArea: 's1' }}>
        <ShiftButton side="left" dir={up === 'left' ? 'up' : 'down'} bind={up === 'left' ? cfg.flick.up : cfg.flick.down} labels={lb.shift} /></div>}
      {car === 'kart'
        ? <div className="face kart" style={{ gridArea: 'mid' }}>
          <div className="slot" data-slot="screen"><WheelScreen cfg={cfg} preview={preview} car={car} /></div>
          <Cluster cfg={cfg} side="row" openSettings={openSettings} car={car} />
        </div>
        : <div className={`face ${L.ecu ? 'with-maps' : ''}`} style={{ gridArea: 'mid' }}>
          <Cluster cfg={cfg} side="pit" openSettings={openSettings} car={car} />
          <div className="slot" data-slot="screen"><WheelScreen cfg={cfg} preview={preview} car={car} /></div>
          <Cluster cfg={cfg} side="race" openSettings={openSettings} car={car} />
          {L.ecu && <div className="slot maps" data-slot="maps">{car === 'electric' ? <EnergyRow /> : <MapRow />}</div>}
        </div>}
      {L.shiftButtons && <div className="slot" data-slot={up === 'right' ? 'up' : 'down'} style={{ gridArea: 's2' }}>
        <ShiftButton side="right" dir={up === 'right' ? 'up' : 'down'} bind={up === 'right' ? cfg.flick.up : cfg.flick.down} labels={lb.shift} /></div>}
      <div className="slot" data-slot={right} style={{ gridArea: 'p2' }}>
        <Pedal key={right} kind={right} cfg={cfg[right]} flick={cfg.flick} toCenter={-1} labels={lb.pedals} /></div>
    </div>
  );
}
