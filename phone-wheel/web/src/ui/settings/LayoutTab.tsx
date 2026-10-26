import type { ButtonSize } from '../../settings/settings.ts';
import { buzz } from '../screen.ts';
import { Choice, Field, Slider, Toggle } from './controls.tsx';
import type { TabProps } from './Settings.tsx';

export function LayoutTab({ cfg, update, editLayout }: TabProps) {
  const L = cfg.layout;
  return <>
    <h2>Layout</h2>
    <Field label="Move and resize" hint={L.free ? 'your own layout: the pedal width, swap and shift key side options below don\'t apply to it' : 'drag any element on the driving screen to where you want it, its corner to resize it'}>
      <div className="seg"><button className="primary" onClick={editLayout}>Edit layout</button>
        {L.free && <button onClick={() => update((c) => { c.layout.free = null; })}>Standard</button>}</div>
    </Field>
    <Toggle label="Swap pedals" hint="gas on the left, brake on the right" value={L.swapPedals} onChange={(v) => update((c) => { c.layout.swapPedals = v; })} />
    <Slider label="Pedal width" min={0.6} max={1.6} step={0.1} value={L.pedalSize} onChange={(v) => update((c) => { c.layout.pedalSize = v; })} fmt={(v) => v.toFixed(1) + '×'} />
    <Choice<ButtonSize> label="Button size" value={L.buttonSize} onChange={(v) => update((c) => { c.layout.buttonSize = v; })}
      options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} />
    <Toggle label="Shift keys" hint="UPSHIFT / DOWNSHIFT beside the pedals (they send the buttons set under Pedals → Flick to shift)"
      value={L.shiftButtons} onChange={(v) => update((c) => { c.layout.shiftButtons = v; })} />
    {L.shiftButtons && <Toggle label="Upshift beside the gas" hint="off: upshift beside the brake, downshift beside the gas" value={L.swapShift}
      onChange={(v) => update((c) => { c.layout.swapShift = v; })} />}
    <Toggle label="Pause when put down" hint="on a table or left alone for 10 s: the phone stops sending and the game pauses until you tap I'M HERE"
      value={L.putDown} onChange={(v) => update((c) => { c.layout.putDown = v; })} />
    <Toggle label="Rev lights and gear" hint="the game's rev lights along the top, gear and speed in the middle (Gridline GP)" value={L.dash}
      onChange={(v) => update((c) => { c.layout.dash = v; })} />
    <Toggle label="Show wheel" hint="tap the wheel to set straight ahead" value={L.showWheel} onChange={(v) => update((c) => { c.layout.showWheel = v; })} />
    <Toggle label="Touch vibration" hint="buzz when you press a pedal or button (game feedback: Feedback tab)" value={L.haptics} onChange={(v) => update((c) => { c.layout.haptics = v; })} />
    {L.haptics && <Field label="Test vibration" hint="nothing? Check the phone's own vibration setting"><button onClick={() => buzz([60, 60, 120])}>Buzz</button></Field>}
  </>;
}
