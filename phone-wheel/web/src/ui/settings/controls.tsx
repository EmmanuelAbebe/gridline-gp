// The settings building blocks: a row with a name (and a hint) and a slider, switch, choice or anything else.
import { useRef, type ReactNode } from 'react';
import * as engine from '../../engine/engine.ts';
import { useFrame } from '../hooks.ts';

function Name({ label, hint }: { label: string; hint?: ReactNode }) {
  return <span className="name">{label}{hint && <small>{hint}</small>}</span>;
}
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><Name label={label} hint={hint} />{children}</div>;
}

export function Slider({ label, hint, value, min, max, step = 1, onChange, fmt = (v) => String(v) }:
  { label: string; hint?: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="field">
      <Name label={label} hint={hint} />
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <output>{fmt(value)}</output>
    </label>
  );
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: ReactNode; value: boolean; onChange: (v: boolean) => void }) {
  return <Field label={label} hint={hint}><button className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>{value ? 'On' : 'Off'}</button></Field>;
}

export function Choice<T extends string>({ label, hint, value, options, onChange }:
  { label: string; hint?: ReactNode; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <Field label={label} hint={hint}>
      <div className="seg">{options.map(([v, text]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>)}</div>
    </Field>
  );
}

// Small graph of a 0..1 → 0..1 response curve.
export function CurvePreview({ fn, caption }: { fn: (x: number) => number; caption: string }) {
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) { const x = i / 40; pts.push(`${(x * 100).toFixed(1)},${(100 - fn(x) * 100).toFixed(1)}`); }
  return (
    <figure className="curve">
      <svg viewBox="-3 -3 106 106">
        <rect className="frame" x="0" y="0" width="100" height="100" />
        <line className="diag" x1="0" y1="100" x2="100" y2="0" />
        <polyline className="line" points={pts.join(' ')} />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
export function WithPreview({ children }: { children: ReactNode }) { return <div className="with-preview">{children}</div>; }

// The steering right now, as a bar from the centre (tilt the phone to try the settings).
export function LiveSteer() {
  const bar = useRef<HTMLDivElement>(null), num = useRef<HTMLOutputElement>(null);
  useFrame(() => {
    const s = engine.state.steer;
    if (bar.current) { bar.current.style.left = (s < 0 ? 50 + s * 50 : 50) + '%'; bar.current.style.width = Math.abs(s) * 50 + '%'; }
    if (num.current) num.current.textContent = (s >= 0 ? '+' : '') + s.toFixed(2);
  });
  return (
    <div className="field">
      <Name label="Live steering" hint="tilt the phone to try your settings" />
      <div className="meter"><div className="mid" /><div className="bar" ref={bar} /></div>
      <output ref={num}>+0.00</output>
    </div>
  );
}
