// The driving screen: brake | centre column | gas (swappable), pedal width from the layout settings.
import type { CSSProperties } from 'react';
import type { Config } from '../settings/settings.ts';
import type { Update } from './App.tsx';
import { Pedal } from './Pedal.tsx';
import { Center } from './Center.tsx';
import './Drive.css';

export function Drive({ cfg, update, openSettings, preview }: { cfg: Config; update: Update; openSettings: () => void; preview: boolean }) {
  const L = cfg.layout;
  const [left, right] = L.swapPedals ? (['gas', 'brake'] as const) : (['brake', 'gas'] as const);
  const style = { gridTemplateColumns: `${L.pedalSize}fr 1.1fr ${L.pedalSize}fr` } as CSSProperties;
  return (
    <div className="drive" style={style}>
      <Pedal key={left} kind={left} cfg={cfg[left]} flick={cfg.flick} toCenter={1} />
      <Center cfg={cfg} update={update} openSettings={openSettings} preview={preview} />
      <Pedal key={right} kind={right} cfg={cfg[right]} flick={cfg.flick} toCenter={-1} />
    </div>
  );
}
