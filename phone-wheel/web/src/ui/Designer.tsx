// The phone page inside the game (2026-10-31, user: "use an interface in the game itself to design the phone-wheel (edit
// mode only)"): `?designer` = no driving, no connection; the game's phone designer (src/game/phone-designer.js) puts this
// page in a frame at the phone's own screen size and posts { type: 'gridline-design', cfg } (the phone's active profile).
// It shows the driving screen with the layout editor over it; DONE / STD post the layout back ('gridline-design-done',
// { free, groups, labels }), ✕ posts 'gridline-design-cancel'. The game sends the layout on to the phone.
import { useEffect, useState } from 'react';
import * as engine from '../engine/engine.ts';
import { CAR_KINDS, forCar, sanitize, type CarKind, type Config } from '../settings/settings.ts';
import { Drive, mirrorPairs, slotsOf } from './Drive.tsx';
import { clusterGroups, LayoutEditor, measureLayout, type Draft } from './LayoutEditor.tsx';

const post = (msg: Record<string, unknown>) => window.parent.postMessage(msg, '*');
// what the screen shows meanwhile: a car mid-lap
const SAMPLE = { g: '4', q: 0, r: 0.5, v: 187, n: 10950, e: 1, m: 'A', b: 63, k: 1, p: 4, l: 3, t: 5, d: -0.214, w: 92, j: 74, x: 28, a: 1, u: 2, o: 0 };

export function Designer() {
  const [cfg, setCfg] = useState<Config | null>(null), [draft, setDraft] = useState<Draft | null>(null), [car, setCar] = useState<CarKind>('hybrid');
  useEffect(() => {
    const take = (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== 'gridline-design') return;
      // (the game says which car you are designing for: its version of the profile, settings.ts forCar)
      const kind: CarKind = CAR_KINDS.includes(e.data.car) ? e.data.car : 'hybrid', c = forCar(sanitize(e.data.cfg), kind);
      engine.setDash({ ...SAMPLE, c: kind });
      setCar(kind); setCfg(c); setDraft(c.layout.free ? { boxes: c.layout.free, groups: c.layout.groups } : null);
    };
    addEventListener('message', take);
    post({ type: 'gridline-design-ready' });
    return () => removeEventListener('message', take);
  }, []);
  // the race wheel as drawn: measure it once it is on the screen
  useEffect(() => {
    if (!cfg || draft) return;
    const id = requestAnimationFrame(() => setDraft({ boxes: measureLayout(), groups: clusterGroups(cfg) }));
    return () => cancelAnimationFrame(id);
  }, [cfg, draft]);
  if (!cfg) return <div className="designer-wait">Waiting for the game…</div>;
  return (
    <>
      <Drive cfg={cfg} car={car} openSettings={() => {}} preview free={draft ? draft.boxes : undefined} />
      {draft && <LayoutEditor slots={slotsOf(cfg, () => {}, true, car)} pairs={mirrorPairs(cfg)} draft={draft} setDraft={setDraft}
        cancel={() => post({ type: 'gridline-design-cancel' })}
        done={() => post({ type: 'gridline-design-done', layout: { free: draft.boxes, groups: draft.groups, labels: cfg.layout.labels, car } })}
        standard={() => post({ type: 'gridline-design-done', layout: { free: null, groups: {}, labels: cfg.layout.labels, car } })} />}
    </>
  );
}
