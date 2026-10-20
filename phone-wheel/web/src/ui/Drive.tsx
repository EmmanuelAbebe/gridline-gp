// The driving screen, left to right: brake | upshift | middle column | downshift | gas, with the connection status
// along the bottom of the middle three (pedals swappable, upshift beside the brake unless swapShift; widths from
// theme.css and the pedal width setting).
import type { CSSProperties } from 'react';
import type { Config } from '../settings/settings.ts';
import { Pedal } from './Pedal.tsx';
import { ShiftButton } from './ShiftButton.tsx';
import { Center } from './Center.tsx';
import { StatusLine } from './StatusLine.tsx';
import './Drive.css';

export function Drive({ cfg, openSettings, preview }: { cfg: Config; openSettings: () => void; preview: boolean }) {
  const L = cfg.layout;
  const [left, right] = L.swapPedals ? (['gas', 'brake'] as const) : (['brake', 'gas'] as const);
  const up = (L.swapShift ? right : left) === 'brake' ? 'left' : 'right';   // the side upshift is on
  const style = { '--pedal-fr': `${1.4 * L.pedalSize}fr` } as CSSProperties;
  return (
    <div className={`drive ${L.shiftButtons ? '' : 'no-shift'}`} style={style}>
      <Pedal key={left} kind={left} cfg={cfg[left]} flick={cfg.flick} toCenter={1} />
      {L.shiftButtons && <ShiftButton side="left" dir={up === 'left' ? 'up' : 'down'} bind={up === 'left' ? cfg.flick.up : cfg.flick.down} />}
      <Center cfg={cfg} openSettings={openSettings} />
      {L.shiftButtons && <ShiftButton side="right" dir={up === 'right' ? 'up' : 'down'} bind={up === 'right' ? cfg.flick.up : cfg.flick.down} />}
      <Pedal key={right} kind={right} cfg={cfg[right]} flick={cfg.flick} toCenter={-1} />
      <StatusLine preview={preview} />
    </div>
  );
}
