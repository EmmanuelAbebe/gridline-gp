import type { ButtonSize } from '../../settings/settings.ts';
import { buzz } from '../screen.ts';
import { Choice, Field, Slider, Toggle } from './controls.tsx';
import type { TabProps } from './Settings.tsx';

export function LayoutTab({ cfg, update }: TabProps) {
  const L = cfg.layout;
  return <>
    <h2>Layout</h2>
    <Toggle label="Swap pedals" hint="gas on the left, brake on the right" value={L.swapPedals} onChange={(v) => update((c) => { c.layout.swapPedals = v; })} />
    <Slider label="Pedal width" min={0.6} max={1.6} step={0.1} value={L.pedalSize} onChange={(v) => update((c) => { c.layout.pedalSize = v; })} fmt={(v) => v.toFixed(1) + '×'} />
    <Choice<ButtonSize> label="Button size" value={L.buttonSize} onChange={(v) => update((c) => { c.layout.buttonSize = v; })}
      options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} />
    <Toggle label="Show wheel" value={L.showWheel} onChange={(v) => update((c) => { c.layout.showWheel = v; })} />
    <Toggle label="Quick sliders" hint="sensitivity and smoothing on the driving screen" value={L.quickSliders}
      onChange={(v) => update((c) => { c.layout.quickSliders = v; })} />
    <Toggle label="Touch vibration" hint="buzz when you press a pedal or button (game feedback: Feedback tab)" value={L.haptics} onChange={(v) => update((c) => { c.layout.haptics = v; })} />
    {L.haptics && <Field label="Test vibration" hint="nothing? Check the phone's own vibration setting"><button onClick={() => buzz([60, 60, 120])}>Buzz</button></Field>}
  </>;
}
