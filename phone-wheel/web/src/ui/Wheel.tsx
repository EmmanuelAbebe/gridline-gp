// The steering wheel drawing (Center turns it with the steering, without re-rendering).
import type { Ref } from 'react';

export function Wheel({ ref }: { ref: Ref<SVGSVGElement> }) {
  return (
    <svg className="wheel" ref={ref} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="7" />
      <circle cx="50" cy="50" r="9" fill="currentColor" />
      <path d="M8 52 L41 52 M59 52 L92 52 M50 59 L50 93" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      <rect x="47" y="3" width="6" height="10" rx="2" fill="var(--accent)" />
    </svg>
  );
}
