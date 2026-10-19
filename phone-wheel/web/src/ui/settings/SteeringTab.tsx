import * as engine from '../../engine/engine.ts';
import { steerCurve } from '../../settings/settings.ts';
import { buzz } from '../screen.ts';
import { CurvePreview, Field, LiveSteer, Slider, Toggle, WithPreview } from './controls.tsx';
import type { TabProps } from './Settings.tsx';

export function SteeringTab({ cfg, update }: TabProps) {
  const s = cfg.steer;
  return <>
    <h2>Steering</h2>
    <LiveSteer />
    <Slider label="Sensitivity" hint={`full lock at ${85 - s.sensitivity}° of tilt`} min={-35} max={70} value={s.sensitivity}
      onChange={(v) => update((c) => { c.steer.sensitivity = v; })} />
    <Slider label="Smoothing" hint="0 = raw and twitchy, higher = calmer but laggier" min={0} max={90} value={s.smoothing}
      onChange={(v) => update((c) => { c.steer.smoothing = v; })} />
    <Slider label="Dead zone" hint="ignore small tilts around center" min={0} max={20} value={s.deadzone}
      onChange={(v) => update((c) => { c.steer.deadzone = v; })} fmt={(v) => v + '%'} />
    <WithPreview>
      <Slider label="Response curve" hint="above 1 = finer control near center" min={0.3} max={3} step={0.1} value={s.curve}
        onChange={(v) => update((c) => { c.steer.curve = v; })} fmt={(v) => v.toFixed(1)} />
      <CurvePreview fn={(x) => steerCurve(x, s)} caption="tilt → steering" />
    </WithPreview>
    <Toggle label="Invert" hint="flip if steering goes the wrong way" value={s.invert} onChange={(v) => update((c) => { c.steer.invert = v; })} />
    <Field label="Center" hint="make the current tilt straight ahead"><button onClick={() => { engine.center(); buzz(30); }}>Center now</button></Field>
  </>;
}
