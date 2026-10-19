import { useState } from 'react';
import { BUTTONS, pedalValue, type ButtonId, type PedalMode } from '../../settings/settings.ts';
import { Choice, CurvePreview, Slider, Toggle, WithPreview } from './controls.tsx';
import type { TabProps } from './Settings.tsx';

const MODE_HINT = { ramp: 'pressure builds the longer you hold', slide: 'slide your thumb up to press harder', instant: 'full pressure as soon as you touch' };

export function PedalsTab({ cfg, update }: TabProps) {
  const [which, setWhich] = useState<'gas' | 'brake'>('gas');
  const p = cfg[which], f = cfg.flick;
  return <>
    <h2>Pedals</h2>
    <Choice label="Edit" value={which} options={[['gas', 'Gas'], ['brake', 'Brake']] as const} onChange={setWhich} />
    <Choice<PedalMode> label="Mode" value={p.mode} hint={MODE_HINT[p.mode]} onChange={(v) => update((c) => { c[which].mode = v; })}
      options={[['ramp', 'Hold to build'], ['slide', 'Slide'], ['instant', 'On / off']]} />
    {p.mode === 'ramp' && <Slider label="Ramp time" hint="seconds from touch to full" min={0.1} max={5} step={0.1} value={p.rampTime}
      onChange={(v) => update((c) => { c[which].rampTime = v; })} fmt={(v) => v.toFixed(1) + ' s'} />}
    {p.mode !== 'instant' && <>
      <Slider label="Start value" hint="pressure the moment you touch" min={0} max={1} step={0.05} value={p.min}
        onChange={(v) => update((c) => { c[which].min = v; })} fmt={(v) => Math.round(v * 100) + '%'} />
      <WithPreview>
        <Slider label="Curve" hint="above 1 = gentle start, below 1 = quick start" min={0.3} max={3} step={0.1} value={p.curve}
          onChange={(v) => update((c) => { c[which].curve = v; })} fmt={(v) => v.toFixed(1)} />
        <CurvePreview fn={(x) => pedalValue(x, p)} caption={p.mode === 'ramp' ? 'hold time → pressure' : 'thumb height → pressure'} />
      </WithPreview>
    </>}
    <Slider label="Maximum" hint="cap the pedal below full" min={0.1} max={1} step={0.05} value={p.max}
      onChange={(v) => update((c) => { c[which].max = v; })} fmt={(v) => Math.round(v * 100) + '%'} />
    <h2>Flick to shift</h2>
    <Toggle label="Flick to shift" hint="while on a pedal, flick your thumb toward the middle: brake = shift down, gas = shift up"
      value={f.on} onChange={(v) => update((c) => { c.flick.on = v; })} />
    {f.on && <>
      <Slider label="Flick distance" hint="how far the thumb must move; more = fewer accidental shifts" min={15} max={120} value={f.distance}
        onChange={(v) => update((c) => { c.flick.distance = v; })} fmt={(v) => v + ' px'} />
      <Slider label="Flick speed" hint="the distance has to happen within this time" min={80} max={400} step={10} value={f.time}
        onChange={(v) => update((c) => { c.flick.time = v; })} fmt={(v) => v + ' ms'} />
      <BindSelect label="Shift down sends" value={f.down} onChange={(v) => update((c) => { c.flick.down = v; })} />
      <BindSelect label="Shift up sends" value={f.up} onChange={(v) => update((c) => { c.flick.up = v; })} />
    </>}
  </>;
}

export function BindSelect({ label, value, onChange }: { label: string; value: ButtonId; onChange: (v: ButtonId) => void }) {
  return (
    <label className="field">
      <span className="name">{label}<small>Gridline GP shifts on LB / RB (or A / B)</small></span>
      <select value={value} onChange={(e) => onChange(e.target.value as ButtonId)}>
        {BUTTONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}
