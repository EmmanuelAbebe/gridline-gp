import * as engine from '../../engine/engine.ts';
import type { Fx } from '../../engine/haptics.ts';
import { Field, Slider, Toggle } from './controls.tsx';
import type { TabProps } from './Settings.tsx';

// what each test button plays: the same messages the game sends (src/game/haptics.js)
const TESTS: [string, Fx][] = [
  ['Hit', { h: 0.8 }], ['Kerb', { k: 0.6, kh: 12 }], ['Gravel', { o: 0.7 }], ['Grass', { o: 0.4 }], ['Slide', { s: 0.7 }], ['Shift', { g: 1 }], ['Lock', { l: 1 }],
];

export function FeedbackTab({ cfg, update }: TabProps) {
  const F = cfg.feedback;
  return <>
    <h2>Force feedback</h2>
    <Toggle label="Vibration from the game" hint="hits, kerbs, gravel and grass, slides: sent by the PC while you drive" value={F.on}
      onChange={(v) => update((c) => { c.feedback.on = v; })} />
    {F.on && <>
      <Slider label="Strength" min={0.3} max={2} step={0.1} value={F.strength} onChange={(v) => update((c) => { c.feedback.strength = v; })}
        fmt={(v) => Math.round(v * 100) + '%'} />
      <Toggle label="Hits" hint="walls, other cars, sausage kerbs" value={F.hits} onChange={(v) => update((c) => { c.feedback.hits = v; })} />
      <Toggle label="Kerbs" hint="a ripple that speeds up with the car" value={F.kerbs} onChange={(v) => update((c) => { c.feedback.kerbs = v; })} />
      <Toggle label="Off the track" hint="gravel and grass rumble" value={F.offTrack} onChange={(v) => update((c) => { c.feedback.offTrack = v; })} />
      <Toggle label="Slides" hint="tyres sliding, locking or spinning" value={F.slides} onChange={(v) => update((c) => { c.feedback.slides = v; })} />
      <Toggle label="Gear shifts" hint="a short tick on every shift" value={F.shifts} onChange={(v) => update((c) => { c.feedback.shifts = v; })} />
      <Toggle label="Full lock" hint="a knock when the steering reaches full lock, then a light buzz while you hold it" value={F.lock} onChange={(v) => update((c) => { c.feedback.lock = v; })} />
      <Field label="Try it" hint="nothing? Check the phone's own vibration setting">
        <div className="seg">{TESTS.map(([name, fx]) => <button key={name} onClick={() => engine.testFeedback(fx)}>{name}</button>)}</div>
      </Field>
    </>}
  </>;
}
